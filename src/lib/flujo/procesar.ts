import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import { buscarProducto, filtrarPorFlexibilidad } from "../catalogo";
import { plantillaOportunidad } from "../correo/plantillas";
import { enviarCorreo } from "../correo/resend";
import { GRACIA_LEAD_NUEVO_MS } from "../estados";
import { BUCKET_FOTOS, firmarUrls } from "../storage";
import type { Estado, Lead, Vendedor } from "../tipos";

/** Las fotos del correo tienen que seguir abriendo una semana después. */
const VIGENCIA_URL_FOTOS = 7 * 24 * 60 * 60;

async function registrarEvento(
  supabase: SupabaseClient,
  leadId: string,
  estadoAnterior: Estado | null,
  estadoNuevo: Estado | null,
  nota: string | null,
): Promise<void> {
  const { error } = await supabase.from("lead_eventos").insert({
    lead_id: leadId,
    estado_anterior: estadoAnterior,
    estado_nuevo: estadoNuevo,
    nota,
  });

  // El historial es para auditoría: si falla, se loguea pero no se aborta el
  // flujo comercial, que es lo que de verdad importa.
  if (error) console.error("registrarEvento:", error.message);
}

async function obtenerLead(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Lead | null> {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (error) {
    console.error("obtenerLead:", error.message);
    return null;
  }

  return data as Lead;
}

/**
 * Paso 2 — valida el lead contra el catálogo y calcula el precio a vencer.
 *
 * nuevo -> vendedor_no_asignado    (siempre que se pudo buscar, haya habido
 *                                   coincidencias o no)
 * nuevo -> nuevo                   (falta la normalización: reintentable)
 *
 * NO elige vendedor. La asignación es 100% manual desde el panel: se elige de
 * la lista de aliados y recién ahí el lead pasa a `validado`. El automatismo
 * anterior (matcheo por `id_catalogo` y, como respaldo, por nombre de tienda)
 * se quitó a propósito — la tienda más barata del catálogo no siempre es la que
 * conviene contactar, y adivinarlo mandaba correos que después había que
 * desdecir.
 *
 * Lo que sí sigue haciendo, y es la razón por la que este paso existe, es dejar
 * `tienda_candidata` y `precio_a_vencer` en la fila: son el dato con el que la
 * persona decide a quién asignarle el lead y qué precio hay que ganar.
 *
 * Devuelve el estado en el que quedó el lead, o null si no se pudo procesar.
 */
export async function validarContraCatalogo(
  leadId: string,
): Promise<Estado | null> {
  const supabase = createAdminClient();
  const lead = await obtenerLead(supabase, leadId);
  if (!lead) return null;

  if (lead.estado !== "nuevo") {
    console.error(
      `validarContraCatalogo: ${lead.lead_code} está en "${lead.estado}", se esperaba "nuevo".`,
    );
    return lead.estado;
  }

  const producto = lead.producto_normalizado;
  if (!producto) {
    // Se queda en `nuevo` a propósito: sin marca ni modelo no hay nada contra
    // qué buscar, y avanzar el estado escondería el problema.
    console.error(
      `validarContraCatalogo: ${lead.lead_code} no tiene producto_normalizado.`,
    );
    await registrarEvento(
      supabase,
      lead.id,
      "nuevo",
      "nuevo",
      "No se pudo validar: falta la normalización del producto.",
    );
    return "nuevo";
  }

  const resultados = await buscarProducto({
    marca: producto.marca,
    modelo: producto.modelo,
    variante: producto.variante ?? undefined,
  });

  const candidatos = filtrarPorFlexibilidad(producto, resultados, lead.flexible)
    .filter((resultado) => resultado.disponible)
    .sort((a, b) => a.precio - b.precio);

  const ganador = candidatos[0];

  if (!ganador) {
    await supabase
      .from("leads")
      .update({ estado: "vendedor_no_asignado" })
      .eq("id", lead.id);

    await registrarEvento(
      supabase,
      lead.id,
      "nuevo",
      "vendedor_no_asignado",
      lead.flexible
        ? "Sin coincidencias disponibles en el catálogo."
        : "Sin coincidencias exactas disponibles (el cliente pidió solo este modelo).",
    );
    return "vendedor_no_asignado";
  }

  const { error } = await supabase
    .from("leads")
    .update({
      tienda_candidata: ganador.tienda,
      precio_a_vencer: ganador.precio,
      estado: "vendedor_no_asignado",
    })
    .eq("id", lead.id);

  if (error) {
    console.error("validarContraCatalogo:", error.message);
    return null;
  }

  await registrarEvento(
    supabase,
    lead.id,
    "nuevo",
    "vendedor_no_asignado",
    `Mejor precio del catálogo: ${ganador.tienda}. Falta elegir a qué vendedor de la red se le manda.`,
  );

  return "vendedor_no_asignado";
}

/**
 * Paso 3 — manda el resumen ejecutivo al vendedor asignado.
 *
 * validado -> enviado_vendedor   (el correo salió)
 * validado -> validado           (el correo falló: queda listo para reintento)
 *
 * El estado NO avanza si el correo no se envió. Marcar un lead como enviado
 * cuando nadie lo recibió arrancaría el reloj del recordatorio de 24h sobre un
 * vendedor que nunca se enteró.
 *
 * El CLIENTE va en copia. Es una decisión de producto, no un detalle técnico:
 * ve exactamente qué se pidió en su nombre y a quién, y puede corregir de una
 * si algo quedó mal. Tiene dos consecuencias que hay que sostener aguas arriba:
 * el borrador del resumen se redacta sabiendo que el cliente lo lee, y su
 * dirección queda visible para el vendedor desde el primer contacto.
 */
export async function enviarAVendedor(leadId: string): Promise<void> {
  const supabase = createAdminClient();
  const lead = await obtenerLead(supabase, leadId);
  if (!lead) return;

  if (lead.estado !== "validado" || !lead.vendedor_id) {
    console.error(
      `enviarAVendedor: ${lead.lead_code} está en "${lead.estado}" con vendedor ${lead.vendedor_id ?? "null"}; se esperaba "validado" con vendedor.`,
    );
    return;
  }

  const { data: vendedorRaw, error: errorVendedor } = await supabase
    .from("vendedores")
    .select("*")
    .eq("id", lead.vendedor_id)
    .single();

  if (errorVendedor || !vendedorRaw) {
    console.error(
      `enviarAVendedor: no se encontró el vendedor ${lead.vendedor_id}.`,
      errorVendedor?.message,
    );
    return;
  }

  const vendedor = vendedorRaw as Vendedor;

  const urlsFotos = await firmarUrls(
    supabase,
    BUCKET_FOTOS,
    lead.fotos_urls,
    VIGENCIA_URL_FOTOS,
  );

  const { asunto, html, texto } = plantillaOportunidad(lead, vendedor, urlsFotos);

  // El cliente primero. Dos direcciones se descartan: las repetidas entre sí
  // (cliente y copia interna iguales) y la del propio vendedor, que ya está en
  // el `to`. Sin lo segundo, un vendedor que comparte casilla con la copia
  // interna recibe el mismo correo dos veces.
  const copiaInterna = process.env.MAIL_CC_INTERNO?.trim();
  const destinatario = vendedor.email.trim().toLowerCase();
  const copias = [
    ...new Set(
      [lead.email, copiaInterna]
        .map((direccion) => direccion?.trim().toLowerCase())
        .filter((direccion): direccion is string => Boolean(direccion)),
    ),
  ].filter((direccion) => direccion !== destinatario);

  const envio = await enviarCorreo({
    para: vendedor.email,
    copia: copias.length > 0 ? copias : undefined,
    asunto,
    html,
    texto,
  });

  if (!envio.ok) {
    console.error(`enviarAVendedor: ${lead.lead_code}: ${envio.motivo}`);
    await registrarEvento(
      supabase,
      lead.id,
      "validado",
      "validado",
      `Falló el envío del correo a ${vendedor.email}: ${envio.motivo}`,
    );
    return;
  }

  const { error } = await supabase
    .from("leads")
    .update({
      estado: "enviado_vendedor",
      fecha_enviado_vendedor: new Date().toISOString(),
    })
    .eq("id", lead.id);

  if (error) {
    // El correo ya salió pero el estado no se movió: queda en `validado` y un
    // reintento mandaría un duplicado. Es un caso raro y visible en el panel;
    // se prefiere el duplicado antes que un lead marcado como enviado sin
    // haberlo estado.
    console.error(
      `enviarAVendedor: correo enviado para ${lead.lead_code} pero falló el update: ${error.message}`,
    );
    return;
  }

  await registrarEvento(
    supabase,
    lead.id,
    "validado",
    "enviado_vendedor",
    `Resumen ejecutivo enviado a ${vendedor.email}, con copia al cliente (${lead.email}).`,
  );
}

/**
 * Procesa un lead recién capturado: solo el paso 2.
 *
 * El paso 3 (el correo) ya no se encadena acá. Ningún correo sale sin que
 * alguien elija el vendedor y apruebe el borrador del resumen en el panel, así
 * que este trabajo de fondo termina siempre en `vendedor_no_asignado`.
 *
 * NUNCA lanza: corre en segundo plano con `after()`, después de que el cliente
 * ya recibió su confirmación. Un fallo acá deja el lead en un estado
 * reintentable y visible en el panel, nunca rompe la experiencia del cliente.
 */
export async function procesarLeadNuevo(leadId: string): Promise<void> {
  try {
    await validarContraCatalogo(leadId);
  } catch (error) {
    console.error("procesarLeadNuevo:", error);
  }
}

/**
 * Tope por corrida. Mucho más bajo que el de los barridos de alertas porque
 * cada lead acá dispara varias peticiones al catálogo externo: 5 × ~5s deja
 * margen de sobra dentro del `maxDuration` del cron.
 */
const MAX_REPROCESO_POR_CORRIDA = 5;

export type ResumenReproceso = { revisados: number; reprocesados: number };

/**
 * Red de seguridad del paso 2 — levanta los leads que quedaron en `nuevo`.
 *
 * `procesarLeadNuevo` corre dentro del `after()` de /api/leads, y ese trabajo
 * cuenta contra la duración de la función: si el catálogo externo se demora,
 * Vercel corta la invocación sin log ni reintento y el lead se queda ahí para
 * siempre. Este barrido es lo único que lo recupera.
 *
 * Es seguro re-ejecutar: `validarContraCatalogo` exige estado `nuevo` y se
 * sale si el lead ya avanzó, así que uno procesado a medias no se duplica.
 *
 * Solo toma los que YA tienen `producto_normalizado`. Los que no lo tienen
 * fallaron en la IA, no en el catálogo: reintentarlos cada hora llenaría
 * `lead_eventos` de ruido sin cambiar nada. Esos ya se ven en el panel como
 * `sin_normalizar` y necesitan una mano humana.
 */
export async function barrerLeadsAtascados(): Promise<ResumenReproceso> {
  const supabase = createAdminClient();
  const finGracia = new Date(Date.now() - GRACIA_LEAD_NUEVO_MS).toISOString();

  const { data, error } = await supabase
    .from("leads")
    .select("id")
    .eq("estado", "nuevo")
    .not("producto_normalizado", "is", null)
    .lt("created_at", finGracia)
    .order("created_at", { ascending: true })
    .limit(MAX_REPROCESO_POR_CORRIDA);

  if (error) {
    console.error("barrerLeadsAtascados:", error.message);
    return { revisados: 0, reprocesados: 0 };
  }

  const leads = (data ?? []) as { id: string }[];

  // Secuencial: cada uno pega contra el mismo sitio externo.
  for (const lead of leads) {
    await procesarLeadNuevo(lead.id);
  }

  return { revisados: leads.length, reprocesados: leads.length };
}
