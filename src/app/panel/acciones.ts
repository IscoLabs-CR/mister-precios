"use server";

import { revalidatePath } from "next/cache";
import { requireUsuario } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarAVendedor } from "@/lib/flujo/procesar";
import { resumenDeRespaldo } from "@/lib/correo/plantillas";
import { ESTADOS_CERRADOS } from "@/lib/estados";
import { extraerCotizacion, redactarResumenEjecutivo } from "@/lib/ia";
import {
  BUCKET_COTIZACIONES,
  subirCotizacion,
  type ArchivoCotizacion,
} from "@/lib/storage";
import {
  MAX_BYTES_COTIZACION,
  MAX_LARGO_RESUMEN,
  MIN_LARGO_RESUMEN,
  aNumero,
  clavear,
  detectarTipoCotizacion,
  esEmailValido,
  esTelefonoValido,
  normalizarTexto,
} from "@/lib/validacion";
import type { Estado, Lead } from "@/lib/tipos";

export type Resultado = { ok: true; mensaje: string } | { ok: false; error: string };

/** Igual que `Resultado`, pero devuelve el texto para pintarlo en el textarea. */
export type ResultadoBorrador =
  | { ok: true; mensaje: string; texto: string }
  | { ok: false; error: string };

/**
 * Toda acción revalida la sesión por su cuenta. Una Server Action es un
 * endpoint POST: que la página que la ofrece esté protegida no protege a la
 * acción, hay que verificar acá adentro.
 */

async function registrarEvento(
  leadId: string,
  anterior: Estado | null,
  nuevo: Estado | null,
  nota: string,
) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("lead_eventos")
    .insert({ lead_id: leadId, estado_anterior: anterior, estado_nuevo: nuevo, nota });
  if (error) console.error("registrarEvento (panel):", error.message);
}

/**
 * Asigna el vendedor y deja el lead en `validado`, listo para que se le mande
 * el resumen ejecutivo.
 *
 * Esta es la ÚNICA forma de asignar: el flujo automático ya no elige vendedor.
 * Y no manda el correo solo — quien asigna revisa el borrador y decide cuándo
 * enviarlo desde la vista de detalle.
 */
export async function asignarVendedor(
  leadId: string,
  vendedorId: string,
): Promise<Resultado> {
  const usuario = await requireUsuario();
  const supabase = createAdminClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, estado, lead_code")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return { ok: false, error: "No encontramos ese lead." };

  const { data: vendedor } = await supabase
    .from("vendedores")
    .select("id, nombre_tienda")
    .eq("id", vendedorId)
    .eq("activo", true)
    .maybeSingle();

  if (!vendedor) return { ok: false, error: "Ese vendedor no existe o está inactivo." };

  const { error } = await supabase
    .from("leads")
    .update({ vendedor_id: vendedor.id, estado: "validado" })
    .eq("id", leadId);

  if (error) {
    console.error("asignarVendedor:", error.message);
    return { ok: false, error: "No se pudo asignar el vendedor." };
  }

  await registrarEvento(
    leadId,
    lead.estado as Estado,
    "validado",
    `${usuario.email} asignó manualmente a ${vendedor.nombre_tienda}.`,
  );

  revalidatePath("/panel");
  revalidatePath(`/panel/leads/${leadId}`);

  return {
    ok: true,
    mensaje: `Vendedor asignado. Revisá el borrador y mandáselo a ${vendedor.nombre_tienda}.`,
  };
}

/**
 * Genera con IA el borrador del resumen ejecutivo y lo guarda en el lead.
 *
 * Sobrescribe lo que hubiera: el botón dice "regenerar" y regenerar es
 * exactamente eso. Quien lo aprieta con un texto editado a mano lo está
 * descartando a propósito.
 *
 * Si Gemini no responde igual devuelve `ok`, con el borrador de respaldo y un
 * aviso. Que la IA esté caída no puede ser motivo para que un lead se quede sin
 * enviar: el texto de respaldo dice lo mismo, más seco, y es editable.
 */
export async function generarBorrador(
  leadId: string,
): Promise<ResultadoBorrador> {
  const usuario = await requireUsuario();
  const supabase = createAdminClient();

  const { data } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  if (!data) return { ok: false, error: "No encontramos ese lead." };

  const lead = data as Lead;

  const generado = await redactarResumenEjecutivo(lead);
  const texto = generado ?? resumenDeRespaldo(lead);

  const guardado = await escribirBorrador(leadId, texto);
  if (!guardado) return { ok: false, error: "No se pudo guardar el borrador." };

  await registrarEvento(
    leadId,
    null,
    null,
    generado
      ? `${usuario.email} generó el borrador del correo con IA.`
      : `${usuario.email} generó el borrador del correo (la IA no respondió, se usó el texto de respaldo).`,
  );

  revalidatePath(`/panel/leads/${leadId}`);

  return {
    ok: true,
    texto,
    mensaje: generado
      ? "Borrador generado. Leelo y corregí lo que haga falta antes de enviar."
      : "La IA no respondió, así que armamos un borrador base con los datos del lead. Revisalo bien antes de enviar.",
  };
}

/** Guarda el texto que quedó en el textarea del panel. */
export async function guardarBorrador(
  leadId: string,
  textoCrudo: string,
): Promise<Resultado> {
  const usuario = await requireUsuario();

  // Se conservan los saltos de línea (el operador los puso a propósito) pero se
  // limpian los espacios de cada línea y las líneas vacías de más.
  const texto = textoCrudo
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((linea) => linea.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (texto.length < MIN_LARGO_RESUMEN)
    return { ok: false, error: "El resumen quedó demasiado corto." };
  if (texto.length > MAX_LARGO_RESUMEN)
    return {
      ok: false,
      error: `El resumen no puede pasar de ${MAX_LARGO_RESUMEN} caracteres.`,
    };

  const guardado = await escribirBorrador(leadId, texto);
  if (!guardado) return { ok: false, error: "No se pudo guardar el borrador." };

  await registrarEvento(
    leadId,
    null,
    null,
    `${usuario.email} editó el borrador del correo.`,
  );

  revalidatePath(`/panel/leads/${leadId}`);

  return { ok: true, mensaje: "Borrador guardado." };
}

/** Devuelve false si el update falló; el mensaje al usuario lo pone el llamador. */
async function escribirBorrador(leadId: string, texto: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("leads")
    .update({
      resumen_borrador: texto,
      resumen_borrador_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) {
    console.error("escribirBorrador:", error.message);
    return false;
  }

  return true;
}

/**
 * Manda (o reenvía) el resumen ejecutivo al vendedor, con copia al cliente.
 *
 * Exige borrador guardado. Es el candado del flujo entero: el correo lo lee el
 * cliente además del vendedor, así que nada sale sin que una persona haya leído
 * y aprobado el texto exacto que va a salir.
 *
 * `enviarAVendedor` exige estado `validado`, así que para un reenvío sobre un
 * lead ya enviado se lo devuelve a `validado` primero. Es deliberado: el envío
 * y el avance de estado quedan en un solo lugar, y así el reenvío también
 * refresca `fecha_enviado_vendedor` — que es de donde el cron de 24h cuenta.
 *
 * Refrescar esa fecha no alcanza para que el recordatorio vuelva a salir. Hacen
 * falta las dos cosas de abajo: bajar `recordatorio_24h_enviado` (el barrido
 * filtra por ese flag) y borrar la fila de `alertas_log` (el índice único
 * rechazaría el segundo insert). Sin eso el reenvío deja al lead sin
 * recordatorio para siempre, que es justo lo contrario de lo que promete el
 * botón. El borrado no pierde la traza: queda en `lead_eventos`.
 */
export async function enviarResumen(leadId: string): Promise<Resultado> {
  const usuario = await requireUsuario();
  const supabase = createAdminClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, estado, vendedor_id, resumen_borrador")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return { ok: false, error: "No encontramos ese lead." };
  if (!lead.vendedor_id)
    return { ok: false, error: "Primero asignale un vendedor." };
  if (!lead.resumen_borrador?.trim())
    return {
      ok: false,
      error: "Generá y revisá el borrador del resumen antes de enviarlo.",
    };

  if (lead.estado === "validado" || lead.estado === "enviado_vendedor") {
    if (lead.estado === "enviado_vendedor") {
      await supabase
        .from("leads")
        .update({ estado: "validado", recordatorio_24h_enviado: false })
        .eq("id", leadId);

      const { error: errorAlerta } = await supabase
        .from("alertas_log")
        .delete()
        .eq("lead_id", leadId)
        .eq("tipo", "recordatorio_24h");

      if (errorAlerta) {
        // El reenvío puede seguir; lo único que se pierde es el recordatorio
        // automático, y el operador ya está mirando este lead.
        console.error("enviarResumen (alertas_log):", errorAlerta.message);
      } else {
        await registrarEvento(
          leadId,
          "enviado_vendedor",
          "validado",
          `${usuario.email} reenvía el resumen: se reinicia el reloj del recordatorio de 24h.`,
        );
      }
    }
  } else {
    return {
      ok: false,
      error: `No se puede enviar el resumen desde el estado "${lead.estado}".`,
    };
  }

  await enviarAVendedor(leadId);

  const { data: despues } = await supabase
    .from("leads")
    .select("estado")
    .eq("id", leadId)
    .maybeSingle();

  revalidatePath("/panel");
  revalidatePath(`/panel/leads/${leadId}`);

  if (despues?.estado !== "enviado_vendedor") {
    return {
      ok: false,
      error: "El correo no salió. Mirá el historial del lead para ver el motivo.",
    };
  }

  return {
    ok: true,
    mensaje: "Resumen enviado al vendedor, con copia al cliente.",
  };
}

export type DatosVendedor = {
  /** Va a `nombre_tienda`: es el nombre con el que el catálogo lista la tienda. */
  empresa: string;
  /** Persona de contacto dentro de la empresa. */
  nombre: string;
  email: string;
  telefono: string;
};

/**
 * Da de alta un vendedor aliado desde el panel.
 *
 * `id_catalogo` se deriva de la empresa con `clavear()`. Ya no engancha ningún
 * matcheo automático —la asignación es manual desde la lista—, pero se
 * conserva por lo que hace el índice único que hay sobre esa columna: es el
 * candado contra vendedores duplicados. Sin él, la misma tienda cargada dos
 * veces aparece dos veces en el selector de asignación y el operador no tiene
 * cómo saber cuál de las dos tiene el contacto vigente.
 */
export async function crearVendedor(datos: DatosVendedor): Promise<Resultado> {
  const usuario = await requireUsuario();
  const supabase = createAdminClient();

  const empresa = normalizarTexto(datos.empresa);
  const nombre = normalizarTexto(datos.nombre);
  const email = normalizarTexto(datos.email).toLowerCase();
  const telefono = normalizarTexto(datos.telefono);

  // El cliente ya validó por cortesía; acá se revalida todo porque una Server
  // Action es un endpoint POST y nadie garantiza que el formulario sea el que
  // la llamó.
  if (empresa.length < 2)
    return { ok: false, error: "Escribí el nombre de la empresa." };
  if (nombre.length < 3)
    return { ok: false, error: "Escribí el nombre del contacto." };
  if (!esEmailValido(email))
    return { ok: false, error: "Revisá el correo electrónico." };
  if (telefono && !esTelefonoValido(telefono))
    return { ok: false, error: "El teléfono tiene que tener entre 8 y 15 dígitos." };

  const idCatalogo = clavear(empresa);

  const { data: existentes } = await supabase
    .from("vendedores")
    .select("nombre_tienda")
    .eq("id_catalogo", idCatalogo);

  if (existentes && existentes.length > 0) {
    return {
      ok: false,
      error: `Ya hay un vendedor registrado para "${existentes[0].nombre_tienda}".`,
    };
  }

  const { error } = await supabase.from("vendedores").insert({
    nombre_tienda: empresa,
    nombre_contacto: nombre,
    email,
    telefono: telefono || null,
    id_catalogo: idCatalogo,
    activo: true,
  });

  if (error) {
    console.error("crearVendedor:", error.message);
    // 23505 = unique_violation. Solo se llega acá si dos altas simultáneas
    // pasaron juntas el chequeo de arriba.
    if (error.code === "23505")
      return { ok: false, error: `Ya hay un vendedor registrado para "${empresa}".` };
    return { ok: false, error: "No se pudo guardar el vendedor." };
  }

  console.info(`crearVendedor: ${usuario.email} dio de alta a "${empresa}".`);

  revalidatePath("/panel/vendedores");
  // El nuevo vendedor ya aparece en el selector de asignación de los leads.
  revalidatePath("/panel");

  return {
    ok: true,
    mensaje: `${empresa} quedó registrado. Ya podés asignarle leads.`,
  };
}

const MAX_LARGO_CONDICIONES = 500;
const MAX_VIGENCIA_DIAS = 365;

/** Tope de lo que se guarda en `extraido_por_ia`. Es auditoría, no datos. */
const MAX_LARGO_EXTRACCION = 4000;

type ArchivoValidado =
  | { ok: true; archivo: ArchivoCotizacion | null }
  | { ok: false; error: string };

/**
 * Valida el adjunto del formulario de cotización. `archivo: null` significa que
 * no mandaron ninguno, que es válido: el documento es opcional.
 */
async function validarArchivo(datos: FormData): Promise<ArchivoValidado> {
  const archivo = datos.get("archivo");

  if (!(archivo instanceof File) || archivo.size === 0)
    return { ok: true, archivo: null };

  if (archivo.size > MAX_BYTES_COTIZACION)
    return {
      ok: false,
      error: `El documento tiene que pesar menos de ${MAX_BYTES_COTIZACION / (1024 * 1024)} MB. Si no podés adjuntarlo, cargá la cotización sin archivo.`,
    };

  const bytes = new Uint8Array(await archivo.arrayBuffer());

  // Igual que en las fotos del formulario: el tipo real sale de los bytes de
  // cabecera, no de la extensión.
  const tipo = detectarTipoCotizacion(bytes);
  if (!tipo)
    return { ok: false, error: "El documento tiene que ser PDF, JPG, PNG o WebP." };

  return { ok: true, archivo: { bytes, tipo } };
}

export type ResultadoLectura =
  | {
      ok: true;
      mensaje: string;
      /** Valores listos para los campos del formulario. */
      campos: { precio: string; condiciones: string; vigencia: string };
      /** JSON de la respuesta cruda, viaja al submit para auditoría. */
      extraccion: string;
      /** Advertencia que el operador tiene que leer antes de guardar. */
      aviso: string | null;
    }
  | { ok: false; error: string };

/**
 * Lee el documento con IA y devuelve los campos para PRELLENAR el formulario.
 *
 * No guarda nada. Es deliberado: la IA propone, la persona revisa y recién el
 * botón de registrar escribe en la base. Mismo patrón que el borrador del
 * correo, y por el mismo motivo — un precio equivocado acá termina siendo un
 * precio que se le promete a un cliente.
 */
export async function leerCotizacion(
  datos: FormData,
): Promise<ResultadoLectura> {
  await requireUsuario();

  const validacion = await validarArchivo(datos);
  if (!validacion.ok) return { ok: false, error: validacion.error };
  if (!validacion.archivo)
    return { ok: false, error: "Adjuntá el documento primero." };

  const extraido = await extraerCotizacion(validacion.archivo);
  if (!extraido)
    return {
      ok: false,
      error: "No pudimos leer el documento. Escribí los datos a mano.",
    };

  const avisos: string[] = [];
  if (extraido.precio === null)
    avisos.push("No se pudo leer el precio con seguridad: escribilo a mano.");
  if (extraido.moneda === "USD")
    avisos.push(
      "El documento parece estar en DÓLARES y el sistema guarda en colones. Convertí el monto antes de registrar.",
    );

  return {
    ok: true,
    mensaje: "Datos leídos del documento. Revisalos antes de registrar.",
    campos: {
      precio: extraido.precio !== null ? String(extraido.precio) : "",
      condiciones: extraido.condiciones ?? "",
      vigencia: extraido.vigencia_dias !== null ? String(extraido.vigencia_dias) : "",
    },
    extraccion: JSON.stringify(extraido.crudo).slice(0, MAX_LARGO_EXTRACCION),
    aviso: avisos.length > 0 ? avisos.join(" ") : null,
  };
}

/**
 * Recupera la lectura de la IA que viaja en un campo oculto del formulario.
 *
 * Llega del cliente, así que no se confía: se parsea con guarda y se descarta
 * si no es JSON. Da igual que alguien pudiera falsearlo — `extraido_por_ia` es
 * una columna de auditoría, no alimenta ninguna decisión. Lo que se guarda de
 * verdad es lo que quedó en los campos del formulario.
 */
function leerExtraccion(datos: FormData): unknown {
  const crudo = datos.get("extraccion");
  if (typeof crudo !== "string" || !crudo) return null;

  try {
    return JSON.parse(crudo.slice(0, MAX_LARGO_EXTRACCION));
  } catch {
    return null;
  }
}

/**
 * Registra a mano la cotización que el vendedor mandó por correo.
 *
 * Es el paso que cierra el ciclo mientras no exista la recepción automática de
 * correo entrante: sin esto, un lead que ya fue cotizado se queda en
 * `enviado_vendedor` para siempre, le llega el recordatorio de 24h a un
 * vendedor que ya contestó y la verificación de 72h nunca se dispara.
 *
 * El documento es OPCIONAL a propósito. Lo que mueve el flujo es el precio; si
 * el PDF no se puede adjuntar (pesa de más, o el vendedor cotizó por teléfono)
 * igual hay que poder registrar la cotización. Un lead trabado por un adjunto
 * es peor que una cotización sin respaldo.
 */
export async function cargarCotizacion(
  leadId: string,
  datos: FormData,
): Promise<Resultado> {
  const usuario = await requireUsuario();
  const supabase = createAdminClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, estado")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return { ok: false, error: "No encontramos ese lead." };
  if (ESTADOS_CERRADOS.includes(lead.estado as Estado))
    return { ok: false, error: "Ese lead ya está cerrado." };

  const precio = aNumero(datos.get("precio"));
  if (precio === null || precio <= 0)
    return { ok: false, error: "Escribí el precio que cotizó el vendedor." };

  const condiciones = normalizarTexto(datos.get("condiciones")).slice(
    0,
    MAX_LARGO_CONDICIONES,
  );

  let vigencia: number | null = null;
  const vigenciaCruda = normalizarTexto(datos.get("vigencia"));
  if (vigenciaCruda) {
    const dias = aNumero(vigenciaCruda);
    if (dias === null || !Number.isInteger(dias) || dias < 0 || dias > MAX_VIGENCIA_DIAS)
      return {
        ok: false,
        error: `La vigencia tiene que ser un número entero de días, entre 0 y ${MAX_VIGENCIA_DIAS}.`,
      };
    vigencia = dias;
  }

  // --- Documento (opcional) -------------------------------------------------
  const validacion = await validarArchivo(datos);
  if (!validacion.ok) return { ok: false, error: validacion.error };

  let ruta: string | null = null;
  if (validacion.archivo) {
    try {
      ruta = await subirCotizacion(supabase, leadId, validacion.archivo);
    } catch (error) {
      console.error("cargarCotizacion (storage):", error);
      return { ok: false, error: "No se pudo guardar el documento." };
    }
  }

  const { error } = await supabase.from("cotizaciones").insert({
    lead_id: leadId,
    archivo_url: ruta,
    precio_cotizado: precio,
    condiciones: condiciones || null,
    vigencia_dias: vigencia,
    extraido_por_ia: leerExtraccion(datos),
    // `remitente` y `asunto` describen el correo del que se extrajo la
    // cotización. Acá no hubo correo, así que quedan nulos en vez de rellenarse
    // con el operador: quién la cargó se registra en `lead_eventos`.
  });

  if (error) {
    console.error("cargarCotizacion:", error.message);
    // El archivo ya subido no lo va a referenciar nadie.
    if (ruta) await supabase.storage.from(BUCKET_COTIZACIONES).remove([ruta]);
    return { ok: false, error: "No se pudo guardar la cotización." };
  }

  // De acá arranca el reloj de las 72h. `fecha_verificacion_enviada` NO se
  // toca: si ya se preguntó por el cierre, una segunda cotización no tiene por
  // qué disparar la misma pregunta de nuevo.
  await supabase
    .from("leads")
    .update({
      estado: "cotizado",
      fecha_cotizacion_recibida: new Date().toISOString(),
    })
    .eq("id", leadId);

  await registrarEvento(
    leadId,
    lead.estado as Estado,
    "cotizado",
    `${usuario.email} cargó a mano la cotización${ruta ? " con su documento" : " (sin documento)"}.`,
  );

  revalidatePath("/panel");
  revalidatePath(`/panel/leads/${leadId}`);

  return {
    ok: true,
    mensaje:
      "Cotización registrada. En 72 horas se les pregunta al cliente y al vendedor cómo salió.",
  };
}

/** Vincula a mano una cotización que llegó sin un lead_code reconocible. */
export async function vincularCotizacion(
  cotizacionId: string,
  leadId: string,
): Promise<Resultado> {
  const usuario = await requireUsuario();
  const supabase = createAdminClient();

  const { data: cotizacion } = await supabase
    .from("cotizaciones")
    .select("id, lead_id")
    .eq("id", cotizacionId)
    .maybeSingle();

  if (!cotizacion) return { ok: false, error: "No encontramos esa cotización." };
  if (cotizacion.lead_id)
    return { ok: false, error: "Esa cotización ya está vinculada a un lead." };

  const { data: lead } = await supabase
    .from("leads")
    .select("id, estado")
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return { ok: false, error: "No encontramos ese lead." };

  const { error } = await supabase
    .from("cotizaciones")
    .update({ lead_id: leadId })
    .eq("id", cotizacionId);

  if (error) {
    console.error("vincularCotizacion:", error.message);
    return { ok: false, error: "No se pudo vincular la cotización." };
  }

  // La cotización recién ahora cuenta como recibida para este lead, así que de
  // acá arranca el reloj de las 72h.
  await supabase
    .from("leads")
    .update({ estado: "cotizado", fecha_cotizacion_recibida: new Date().toISOString() })
    .eq("id", leadId);

  await registrarEvento(
    leadId,
    lead.estado as Estado,
    "cotizado",
    `${usuario.email} vinculó manualmente una cotización que llegó sin código.`,
  );

  revalidatePath("/panel");
  revalidatePath(`/panel/leads/${leadId}`);

  return { ok: true, mensaje: "Cotización vinculada." };
}
