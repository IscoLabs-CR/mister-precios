import "server-only";

/**
 * Límite de peticiones por cliente, en memoria del proceso.
 *
 * Existe por /api/leads: es el único endpoint sin sesión que ESCRIBE, y cada
 * POST que lo atraviesa sube un archivo al bucket, inserta una fila y gasta una
 * llamada a Gemini. Sin techo, un script deja el bucket lleno, la tabla
 * inservible y la cuota de la IA agotada en una tarde, y todo eso se paga.
 *
 * ALCANCE — leer antes de confiar en esto:
 *
 *   1. El contador vive en la memoria de UNA instancia. En Vercel cada lambda
 *      fría arranca con el mapa vacío, así que bajo concurrencia real el techo
 *      efectivo es `MAXIMO × instancias activas`. Frena el abuso casual y el
 *      bot de formularios, NO a un atacante decidido ni a un ataque distribuido.
 *      Para eso hace falta un contador compartido (Vercel WAF, Upstash, o una
 *      tabla en Postgres) — queda anotado en el informe de seguridad.
 *
 *   2. La identidad sale de `x-forwarded-for`, que solo es confiable si delante
 *      hay un proxy que la reescriba. En Vercel la pone la plataforma y el
 *      cliente no puede falsearla. Si esto se despliega detrás de otra cosa,
 *      hay que revisar de dónde se toma la IP o el límite se esquiva mandando
 *      la cabecera a mano.
 */

type Ventana = { conteo: number; expira: number };

/**
 * Cota del mapa. Sin esto, pegarle al endpoint desde muchas IPs distintas
 * convierte al propio limitador en una fuga de memoria: el ataque que se quería
 * frenar terminaría tumbando la instancia por otro lado.
 */
const MAX_CLAVES = 10_000;

const ventanas = new Map<string, Ventana>();

export type ResultadoLimite = {
  permitido: boolean;
  /** Segundos que faltan para que la ventana se reinicie. Va en `Retry-After`. */
  reintentarEn: number;
};

/** Saca lo vencido y, si aún así el mapa quedó gigante, lo vacía. */
function purgar(ahora: number): void {
  for (const [clave, ventana] of ventanas) {
    if (ventana.expira <= ahora) ventanas.delete(clave);
  }

  // Todo lo que sobrevive está vigente: no hay a quién sacrificar sin abrirle
  // la puerta a alguien. Se reinicia entero, que falla hacia el lado permisivo
  // pero acotado en memoria.
  if (ventanas.size > MAX_CLAVES) ventanas.clear();
}

/**
 * Registra un intento de `clave` y dice si puede pasar.
 *
 * Ventana fija: el primer intento abre el reloj y los siguientes se cuentan
 * contra él hasta que vence.
 */
export function consumir(
  clave: string,
  maximo: number,
  ventanaMs: number,
): ResultadoLimite {
  const ahora = Date.now();
  purgar(ahora);

  const actual = ventanas.get(clave);

  if (!actual || actual.expira <= ahora) {
    ventanas.set(clave, { conteo: 1, expira: ahora + ventanaMs });
    return { permitido: true, reintentarEn: Math.ceil(ventanaMs / 1000) };
  }

  const faltan = Math.max(1, Math.ceil((actual.expira - ahora) / 1000));

  if (actual.conteo >= maximo) {
    return { permitido: false, reintentarEn: faltan };
  }

  actual.conteo += 1;
  return { permitido: true, reintentarEn: faltan };
}

/**
 * IP del cliente según las cabeceras del proxy. Ver la advertencia de arriba
 * sobre cuándo son confiables.
 *
 * `x-forwarded-for` puede traer una cadena ("cliente, proxy1, proxy2"); el
 * primero es el cliente original.
 */
export function identificarCliente(request: Request): string {
  const reenviada = request.headers.get("x-forwarded-for");
  const primera = reenviada?.split(",")[0]?.trim();
  if (primera) return primera;

  return request.headers.get("x-real-ip")?.trim() || "desconocido";
}
