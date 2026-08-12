import { MONEDAS, type Moneda } from "./tipos";

/**
 * Una sola foto del producto. Con una alcanza para leerle la etiqueta, y las
 * demás eran casi siempre el mismo ángulo repetido.
 */
export const MAX_FOTOS = 1;

/**
 * Tope de la foto YA COMPRIMIDA (ver `comprimirImagen`), no del archivo que
 * eligió el cliente.
 *
 * Está por debajo de los ~4.5 MB en los que Vercel corta el cuerpo de una
 * petición: pasado ese punto la respuesta es un 413 que el código no puede
 * atrapar, así que el cliente vería un error de red sin explicación y el lead
 * se perdería. Con la compresión a 2000px una foto de celular queda cerca de
 * 1 MB, así que este techo solo frena casos patológicos.
 */
export const MAX_BYTES_FOTO = 4 * 1024 * 1024; // 4 MB

/**
 * Largo del resumen ejecutivo del correo. El techo no es técnico: es editorial.
 * Un vendedor lee el correo en el celular entre cliente y cliente, y arriba de
 * ~1200 caracteres deja de leerlo. El piso descarta un borrador vaciado por
 * accidente antes de que salga así.
 */
export const MAX_LARGO_RESUMEN = 1200;
export const MIN_LARGO_RESUMEN = 20;

export const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/webp"] as const;
export type TipoImagen = (typeof TIPOS_IMAGEN)[number];

export const EXTENSION_POR_TIPO: Record<TipoImagen, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Documentos aceptados como respaldo de una cotización: el PDF que manda el
 * vendedor o la foto que le sacó a uno impreso.
 */
export const TIPOS_COTIZACION = [
  "application/pdf",
  ...TIPOS_IMAGEN,
] as const;
export type TipoCotizacion = (typeof TIPOS_COTIZACION)[number];

export const EXTENSION_POR_TIPO_COTIZACION: Record<TipoCotizacion, string> = {
  "application/pdf": "pdf",
  ...EXTENSION_POR_TIPO,
};

/**
 * Tope del adjunto de una cotización.
 *
 * El bucket acepta 20 MB, pero este archivo viaja dentro de una Server Action y
 * ahí manda el límite de la plataforma: Vercel corta los cuerpos de petición en
 * ~4.5 MB con un 413 que no se puede atrapar desde el código. Mejor rechazarlo
 * acá, con un mensaje que se entiende, que dejar que reviente arriba. El
 * archivo es opcional, así que un PDF gigante no impide registrar la cotización.
 */
export const MAX_BYTES_COTIZACION = 4 * 1024 * 1024;

/** Colapsa espacios y recorta. Devuelve "" si no hay contenido real. */
export function normalizarTexto(valor: unknown): string {
  if (typeof valor !== "string") return "";
  return valor.replace(/\s+/g, " ").trim();
}

/** Para comparar nombres de tienda o modelos sin que estorben tildes ni caja. */
export function clavear(valor: string): string {
  return normalizarTexto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * Clave de comparación para códigos de modelo. Más agresiva que `clavear`:
 * también borra espacios, guiones y puntuación, porque "QN-65 Q80D" y
 * "qn65q80d" son el mismo televisor y el catálogo no garantiza cómo lo escribe.
 */
export function claveModelo(valor: string): string {
  return clavear(valor).replace(/[^a-z0-9]/g, "");
}

export function esEmailValido(valor: string): boolean {
  if (valor.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(valor);
}

export function esTelefonoValido(valor: string): boolean {
  const digitos = valor.replace(/[^\d]/g, "");
  return digitos.length >= 8 && digitos.length <= 15;
}

/** Solo http/https: evita que entren `javascript:` o `data:` al correo. */
export function esUrlValida(valor: string): boolean {
  try {
    const url = new URL(valor);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Acepta "1 250 000", "1,250,000" y "1.250.000,50". null si no es un número. */
export function aNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;

  let limpio = valor.replace(/[\s₡$]/g, "");
  if (!limpio) return null;

  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");

  if (ultimaComa > -1 && ultimoPunto > -1) {
    // El separador decimal es el que aparece de último.
    const decimal = ultimaComa > ultimoPunto ? "," : ".";
    const miles = decimal === "," ? "." : ",";
    limpio = limpio.split(miles).join("").replace(decimal, ".");
  } else if (ultimaComa > -1) {
    // Una sola coma: decimal si deja 1-2 dígitos, si no es separador de miles.
    limpio =
      limpio.length - ultimaComa - 1 <= 2
        ? limpio.replace(",", ".")
        : limpio.split(",").join("");
  } else if (ultimoPunto > -1 && limpio.length - ultimoPunto - 1 === 3) {
    // "1.250" es mil doscientos cincuenta, no 1,25.
    limpio = limpio.split(".").join("");
  }

  const numero = Number(limpio);
  return Number.isFinite(numero) ? numero : null;
}

export function esMoneda(valor: unknown): valor is Moneda {
  return (
    typeof valor === "string" && (MONEDAS as readonly string[]).includes(valor)
  );
}

/**
 * Detecta el tipo real por los bytes de cabecera. El `type` que manda el
 * navegador es solo una sugerencia: un .exe renombrado a .jpg lo declara como
 * image/jpeg sin problema.
 */
export function detectarTipoImagen(bytes: Uint8Array): TipoImagen | null {
  if (bytes.length < 12) return null;

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  const firmaPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (firmaPng.every((byte, i) => bytes[i] === byte)) {
    return "image/png";
  }

  // RIFF....WEBP
  const esRiff = [0x52, 0x49, 0x46, 0x46].every((byte, i) => bytes[i] === byte);
  const esWebp = [0x57, 0x45, 0x42, 0x50].every(
    (byte, i) => bytes[8 + i] === byte,
  );
  if (esRiff && esWebp) return "image/webp";

  return null;
}

/**
 * Igual que `detectarTipoImagen` pero aceptando también PDF, que es como llega
 * la mayoría de las cotizaciones. Mismo criterio: manda la firma de los bytes,
 * no la extensión ni el `type` que declare el navegador.
 */
export function detectarTipoCotizacion(
  bytes: Uint8Array,
): TipoCotizacion | null {
  // "%PDF-"
  const firmaPdf = [0x25, 0x50, 0x44, 0x46, 0x2d];
  if (bytes.length >= 5 && firmaPdf.every((byte, i) => bytes[i] === byte)) {
    return "application/pdf";
  }

  return detectarTipoImagen(bytes);
}
