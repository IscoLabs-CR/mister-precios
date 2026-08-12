import "server-only";

/**
 * Envío por `fetch` crudo contra la API de Resend, sin SDK: es una sola
 * llamada POST y evita una dependencia más.
 *
 * Toda la app manda correo por acá. Si algún día se cambia de proveedor, este
 * archivo es lo único que se toca.
 */

const ENDPOINT = "https://api.resend.com/emails";

export type Correo = {
  para: string | string[];
  copia?: string | string[];
  asunto: string;
  html: string;
  texto: string;
};

export type ResultadoEnvio =
  | { ok: true; id: string | null }
  | { ok: false; motivo: string };

/**
 * Escapa todo valor que venga del usuario antes de interpolarlo en el HTML del
 * correo. Sin esto, un nombre con `<script>` o unas comillas rotas se cuelan
 * en la bandeja del vendedor.
 */
export function esc(valor: unknown): string {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Nunca lanza: devuelve un resultado que el llamador decide cómo tratar. Quien
 * llama es el responsable de NO avanzar el estado del lead si `ok` es false.
 */
export async function enviarCorreo(correo: Correo): Promise<ResultadoEnvio> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;

  if (!apiKey || !from) {
    return { ok: false, motivo: "Faltan RESEND_API_KEY o MAIL_FROM." };
  }

  try {
    const respuesta = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(correo.para) ? correo.para : [correo.para],
        ...(correo.copia
          ? { cc: Array.isArray(correo.copia) ? correo.copia : [correo.copia] }
          : {}),
        subject: correo.asunto,
        html: correo.html,
        text: correo.texto,
      }),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text();
      return {
        ok: false,
        motivo: `Resend respondió ${respuesta.status}: ${detalle.slice(0, 500)}`,
      };
    }

    const datos = (await respuesta.json()) as { id?: string };
    return { ok: true, id: datos.id ?? null };
  } catch (error) {
    return {
      ok: false,
      motivo: error instanceof Error ? error.message : String(error),
    };
  }
}
