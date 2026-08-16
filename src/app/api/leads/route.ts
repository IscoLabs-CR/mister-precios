import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizarProducto } from "@/lib/ia";
import { consumir, identificarCliente } from "@/lib/limite";
import { subirFotos, type FotoValidada } from "@/lib/storage";
import { procesarLeadNuevo } from "@/lib/flujo/procesar";
import { esCategoriaProducto } from "@/lib/tipos";
import {
  MAX_BYTES_FOTO,
  MAX_FOTOS,
  aNumero,
  detectarTipoImagen,
  esEmailValido,
  esMoneda,
  esTelefonoValido,
  esUrlValida,
  normalizarTexto,
} from "@/lib/validacion";

/**
 * El `after()` del final consulta un catálogo externo, y ese trabajo cuenta
 * contra la duración de la función aunque el cliente ya tenga su respuesta. Sin
 * este techo explícito, el default corta el procesamiento a mitad y el lead se
 * queda en `nuevo` sin log ni reintento.
 *
 * Ojo con el máximo del plan de Vercel: si es menor, este valor no lo sube.
 */
export const maxDuration = 60;

/** Límites de longitud, para que un POST no meta un texto de 10 MB. */
const MAX_LARGO_TEXTO = 2000;
const MAX_LARGO_CAMPO = 200;

/**
 * Techo de solicitudes por IP. Una persona manda una y se va; el margen cubre
 * al que se equivoca, corrige y reintenta un par de veces. Todo lo que pase de
 * ahí en diez minutos no es un cliente.
 *
 * Ojo: es un límite por instancia, no global. Ver el alcance en `lib/limite.ts`.
 */
const MAX_SOLICITUDES = 5;
const VENTANA_MS = 10 * 60 * 1000;

function malaSolicitud(mensaje: string) {
  return NextResponse.json({ error: mensaje }, { status: 400 });
}

export async function POST(request: Request) {
  // Antes de leer el cuerpo: si se rechaza igual, no tiene sentido pagar el
  // parseo de un multipart con una foto adentro.
  const limite = consumir(
    `leads:${identificarCliente(request)}`,
    MAX_SOLICITUDES,
    VENTANA_MS,
  );

  if (!limite.permitido) {
    return NextResponse.json(
      { error: "Recibimos varias solicitudes tuyas. Esperá unos minutos e intentá de nuevo." },
      { status: 429, headers: { "Retry-After": String(limite.reintentarEn) } },
    );
  }

  let datos: FormData;
  try {
    datos = await request.formData();
  } catch {
    return malaSolicitud("Solicitud inválida.");
  }

  // Honeypot: un campo oculto que solo rellenan los bots. Se responde 200 a
  // propósito para no darle señal al que automatiza.
  if (normalizarTexto(datos.get("empresa"))) {
    return NextResponse.json({ ok: true, lead_code: "LEAD-0000" });
  }

  // --- Validación de los campos de texto -----------------------------------
  const nombre = normalizarTexto(datos.get("nombre")).slice(0, MAX_LARGO_CAMPO);
  if (nombre.length < 3) return malaSolicitud("Escribí tu nombre completo.");

  const email = normalizarTexto(datos.get("email")).slice(0, MAX_LARGO_CAMPO);
  if (!esEmailValido(email)) return malaSolicitud("Revisá el correo electrónico.");

  const telefono = normalizarTexto(datos.get("telefono")).slice(0, MAX_LARGO_CAMPO);
  if (!esTelefonoValido(telefono))
    return malaSolicitud("Escribí un teléfono válido.");

  const categoria = normalizarTexto(datos.get("categoria"));
  if (!esCategoriaProducto(categoria))
    return malaSolicitud("Elegí el tipo de producto que buscás.");

  const productoTexto = normalizarTexto(datos.get("producto_texto")).slice(
    0,
    MAX_LARGO_TEXTO,
  );
  if (productoTexto.length < 3)
    return malaSolicitud("Contanos qué producto buscás.");

  const linkReferencia = normalizarTexto(datos.get("link_referencia")).slice(
    0,
    MAX_LARGO_TEXTO,
  );
  if (linkReferencia && !esUrlValida(linkReferencia))
    return malaSolicitud("El link tiene que empezar con http:// o https://");

  const precioVisto = aNumero(datos.get("precio_visto"));
  if (precioVisto === null || precioVisto <= 0)
    return malaSolicitud("Escribí el precio que viste.");

  const monedaCruda = normalizarTexto(datos.get("moneda")) || "CRC";
  if (!esMoneda(monedaCruda)) return malaSolicitud("Moneda no soportada.");

  const flexibleCrudo = normalizarTexto(datos.get("flexible"));
  if (flexibleCrudo !== "true" && flexibleCrudo !== "false")
    return malaSolicitud("Indicá si aceptás opciones similares.");
  const flexible = flexibleCrudo === "true";

  // No hay forma de mandar un `false`: una casilla sin marcar simplemente no
  // viaja en el FormData. Que el lead exista ES el registro de que el cliente
  // autorizó, así que acá se corta el envío en vez de guardarlo sin permiso.
  if (normalizarTexto(datos.get("consentimiento_contacto")) !== "true")
    return malaSolicitud(
      "Necesitamos tu autorización para compartir tu información con los vendedores.",
    );

  // --- Validación de las fotos ---------------------------------------------
  const archivos = datos
    .getAll("fotos")
    .filter((valor): valor is File => valor instanceof File && valor.size > 0);

  if (archivos.length > MAX_FOTOS)
    return malaSolicitud(
      MAX_FOTOS === 1
        ? "Solo podés adjuntar una foto."
        : `Podés subir un máximo de ${MAX_FOTOS} fotos.`,
    );

  if (!linkReferencia && archivos.length === 0)
    return malaSolicitud("Necesitamos un link de referencia o una foto.");

  const fotos: FotoValidada[] = [];
  for (const archivo of archivos) {
    // El navegador ya comprime antes de subir; esto es el cinturón por si el
    // POST no viene del formulario.
    if (archivo.size > MAX_BYTES_FOTO)
      return malaSolicitud(
        `La foto tiene que pesar menos de ${MAX_BYTES_FOTO / (1024 * 1024)} MB.`,
      );

    const bytes = new Uint8Array(await archivo.arrayBuffer());

    // El tipo real sale de los bytes de cabecera, no del `type` que declara el
    // navegador: renombrar un .exe a .jpg engaña a la extensión, no a la firma.
    const tipo = detectarTipoImagen(bytes);
    if (!tipo)
      return malaSolicitud("Solo aceptamos imágenes JPG, PNG o WebP.");

    fotos.push({ bytes, tipo });
  }

  // --- Persistencia ---------------------------------------------------------
  // Si falta configuración, `createAdminClient` lanza. Sin este catch el 500
  // sale con cuerpo vacío y el cliente muestra un error de red engañoso.
  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    console.error("POST /api/leads (config):", error);
    return NextResponse.json(
      { error: "No pudimos registrar tu solicitud. Intentá de nuevo." },
      { status: 500 },
    );
  }

  let rutasFotos: string[];
  try {
    rutasFotos = await subirFotos(supabase, fotos);
  } catch (error) {
    console.error("POST /api/leads (storage):", error);
    return NextResponse.json(
      { error: "No pudimos guardar tus fotos. Intentá de nuevo." },
      { status: 500 },
    );
  }

  // Se analizan juntas las tres cosas que mandó el cliente. La etiqueta de una
  // caja suele tener el modelo exacto que no escribió, y el slug del link suele
  // traerlo también. Se reusan los bytes que ya están en memoria por la
  // validación, no se vuelven a bajar del bucket.
  // Si la IA falla se guarda null y el lead queda en `nuevo`, reintentable.
  // Perder la solicitud del cliente por un error de un tercero sería peor.
  const productoNormalizado = await normalizarProducto(
    productoTexto,
    fotos,
    linkReferencia,
  );

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      nombre,
      email,
      telefono,
      categoria,
      producto_texto: productoTexto,
      producto_normalizado: productoNormalizado,
      link_referencia: linkReferencia || null,
      fotos_urls: rutasFotos,
      precio_visto: precioVisto,
      moneda: monedaCruda,
      flexible,
      consentimiento_contacto: true,
      estado: "nuevo",
    })
    .select("id, lead_code")
    .single();

  if (error || !lead) {
    console.error("POST /api/leads:", error?.message);
    if (rutasFotos.length > 0) {
      await supabase.storage.from("leads-fotos").remove(rutasFotos);
    }
    return NextResponse.json(
      { error: "No pudimos registrar tu solicitud. Intentá de nuevo." },
      { status: 500 },
    );
  }

  // El cliente recibe la confirmación de inmediato; la búsqueda en el catálogo
  // y el correo al vendedor corren después de responder.
  after(() => procesarLeadNuevo(lead.id as string));

  return NextResponse.json({ ok: true, lead_code: lead.lead_code });
}
