import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Comparación de secretos en tiempo constante.
 *
 * La usan los dos puntos de la app donde un valor de la URL o de una cabecera
 * se contrasta contra un secreto del servidor: el `CRON_SECRET` de
 * /api/cron/alertas y el `action_token` del enlace de cierre. Un `===` filtra
 * por cuánto tarda en salir, y ambos endpoints son públicos.
 *
 * `timingSafeEqual` exige buffers del mismo largo, así que la diferencia de
 * longitud se responde antes. Eso filtra el largo del secreto, que no es un
 * dato que sirva para adivinarlo.
 */
export function igualSeguro(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
