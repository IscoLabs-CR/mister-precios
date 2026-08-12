import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXTENSION_POR_TIPO,
  EXTENSION_POR_TIPO_COTIZACION,
  type TipoCotizacion,
  type TipoImagen,
} from "./validacion";

export const BUCKET_FOTOS = "leads-fotos";
export const BUCKET_COTIZACIONES = "cotizaciones";

export type FotoValidada = {
  bytes: Uint8Array;
  tipo: TipoImagen;
};

export type ArchivoCotizacion = {
  bytes: Uint8Array;
  tipo: TipoCotizacion;
};

/**
 * Sube las fotos a una carpeta propia y devuelve las RUTAS (no URLs).
 * Guardamos rutas porque el bucket es privado: la URL firmada se genera al
 * momento de mostrar o de mandar el correo, y expira.
 *
 * La carpeta se nombra con un uuid generado acá, antes de que exista el lead,
 * para no tener que insertar la fila primero.
 */
export async function subirFotos(
  supabase: SupabaseClient,
  fotos: FotoValidada[],
): Promise<string[]> {
  if (fotos.length === 0) return [];

  const carpeta = crypto.randomUUID();
  const rutas: string[] = [];

  for (const [indice, foto] of fotos.entries()) {
    const ruta = `${carpeta}/${indice + 1}.${EXTENSION_POR_TIPO[foto.tipo]}`;

    const { error } = await supabase.storage
      .from(BUCKET_FOTOS)
      .upload(ruta, foto.bytes, {
        contentType: foto.tipo,
        upsert: false,
      });

    if (error) {
      // Dejar huérfanos los archivos ya subidos es peor que un borrado extra:
      // el lead no se va a crear, así que nadie los va a referenciar.
      if (rutas.length > 0) {
        await supabase.storage.from(BUCKET_FOTOS).remove(rutas);
      }
      throw new Error(`No se pudo subir la foto ${indice + 1}: ${error.message}`);
    }

    rutas.push(ruta);
  }

  return rutas;
}

/**
 * Sube el respaldo de una cotización y devuelve la RUTA, igual que `subirFotos`:
 * el bucket es privado y la URL firmada se genera al mostrarla.
 *
 * Se agrupa por lead en vez de por carpeta suelta porque acá el lead ya existe
 * —la cotización se carga desde su propia página—, y así el bucket se puede
 * inspeccionar por lead cuando haga falta.
 */
export async function subirCotizacion(
  supabase: SupabaseClient,
  leadId: string,
  archivo: ArchivoCotizacion,
): Promise<string> {
  const extension = EXTENSION_POR_TIPO_COTIZACION[archivo.tipo];
  const ruta = `${leadId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from(BUCKET_COTIZACIONES)
    .upload(ruta, archivo.bytes, {
      contentType: archivo.tipo,
      upsert: false,
    });

  if (error) {
    throw new Error(`No se pudo subir el documento: ${error.message}`);
  }

  return ruta;
}

/**
 * URLs firmadas para rutas de un bucket privado. Las rutas que fallen se
 * omiten en vez de tumbar toda la operación: un correo con una foto menos vale
 * más que un correo que no sale.
 */
export async function firmarUrls(
  supabase: SupabaseClient,
  bucket: string,
  rutas: string[],
  segundos: number,
): Promise<string[]> {
  if (rutas.length === 0) return [];

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(rutas, segundos);

  if (error) {
    console.error("firmarUrls:", error.message);
    return [];
  }

  return (data ?? [])
    .map((item) => (item.error ? null : item.signedUrl))
    .filter((url): url is string => typeof url === "string" && url.length > 0);
}

/**
 * Igual que `firmarUrls` pero devolviendo un mapa ruta → URL.
 *
 * Es lo que hay que usar cuando la URL tiene que quedar pegada a SU registro y
 * no a una posición. `firmarUrls` descarta las rutas que fallan y las que
 * vienen vacías, así que el índice del resultado no se corresponde con el de la
 * lista original: para las fotos da igual (son "Foto 1..N"), pero para las
 * cotizaciones —donde el documento es opcional— eso mostraría el archivo de una
 * cotización colgando de otra.
 */
export async function firmarUrlsPorRuta(
  supabase: SupabaseClient,
  bucket: string,
  rutas: string[],
  segundos: number,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (rutas.length === 0) return mapa;

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(rutas, segundos);

  if (error) {
    console.error("firmarUrlsPorRuta:", error.message);
    return mapa;
  }

  for (const item of data ?? []) {
    if (item.error || !item.path || !item.signedUrl) continue;
    mapa.set(item.path, item.signedUrl);
  }

  return mapa;
}
