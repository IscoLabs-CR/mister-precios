/**
 * Compresión de la foto EN EL NAVEGADOR, antes de subirla.
 *
 * Existe por una restricción de plataforma: Vercel corta los cuerpos de
 * petición cerca de 4.5 MB y responde un 413 que el código no puede atrapar ni
 * explicar. Una foto de celular pesa entre 3 y 8 MB, así que sin esto el
 * formulario funciona en local y falla en producción justo cuando el cliente
 * adjunta la foto — que es el caso que más nos importa, porque de ahí sale el
 * número de modelo.
 *
 * Reducir acá es mejor que subir el límite del servidor: además de resolver el
 * 413, la foto viaja más rápido en datos móviles y Gemini gasta menos tokens al
 * analizarla.
 *
 * NUNCA lanza: si algo falla devuelve el archivo original y la validación de
 * tamaño que sigue decide. Perder la foto por un navegador viejo sería peor que
 * mandarla sin comprimir.
 */

/**
 * Lado largo de la imagen resultante.
 *
 * No es un número cómodo, es el punto donde todavía se lee un código de modelo
 * impreso en una caja aunque el cliente haya sacado la foto de lejos. Bajarlo
 * más ahorraría bytes que no necesitamos ahorrar a costa del único dato que
 * buscamos en la imagen.
 */
export const LADO_MAXIMO = 2000;

/** 0.85 es donde el JPEG deja de ganar tamaño sin perder legibilidad. */
const CALIDAD = 0.85;

function nombreJpeg(original: string): string {
  const base = original.replace(/\.[^.]+$/, "") || "foto";
  return `${base}.jpg`;
}

export async function comprimirImagen(archivo: File): Promise<File> {
  try {
    // `imageOrientation: "from-image"` respeta el EXIF. Sin eso, las fotos
    // tomadas en vertical con el celular se dibujan acostadas en el canvas, y
    // una etiqueta rotada 90° es una etiqueta que la IA no lee.
    const bitmap = await createImageBitmap(archivo, {
      imageOrientation: "from-image",
    });

    const escala = Math.min(
      1,
      LADO_MAXIMO / Math.max(bitmap.width, bitmap.height),
    );
    const ancho = Math.max(1, Math.round(bitmap.width * escala));
    const alto = Math.max(1, Math.round(bitmap.height * escala));

    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;

    const contexto = lienzo.getContext("2d");
    if (!contexto) {
      bitmap.close();
      return archivo;
    }

    contexto.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolver) =>
      lienzo.toBlob(resolver, "image/jpeg", CALIDAD),
    );

    // Si no ganamos nada, nos quedamos con el original: una foto ya optimizada
    // puede crecer al reencodearse.
    if (!blob || blob.size >= archivo.size) return archivo;

    return new File([blob], nombreJpeg(archivo.name), {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return archivo;
  }
}
