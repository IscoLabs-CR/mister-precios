import "server-only";
import { esc } from "./resend";
import { formatearMoneda } from "../formato";
import type { Lead, ResultadoCierre, RolCierre, Vendedor } from "../tipos";

/**
 * Todos los correos se arman con PLANTILLAS FIJAS rellenadas con los datos
 * estructurados del lead. Los números, los enlaces y las instrucciones son
 * siempre los mismos: son documentos comerciales que tienen que ser predecibles
 * palabra por palabra.
 *
 * La única excepción es el párrafo de apertura del correo de oportunidad, que
 * sale del borrador que alguien aprobó en el panel (`lead.resumen_borrador`).
 * Aun ahí lo que viaja es texto revisado por una persona, no una respuesta de
 * IA en vivo.
 */

const TIPOGRAFIA =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export type PlantillaCorreo = {
  asunto: string;
  html: string;
  texto: string;
};

/**
 * Base absoluta para los enlaces de los correos. Sin esto los botones salen
 * relativos y no abren desde ninguna bandeja.
 */
function urlSitio(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
  return base.replace(/\/+$/, "");
}

/**
 * Enlace de cierre. Apunta a una PÁGINA, no a un endpoint que mute: Gmail y
 * Outlook hacen prefetch de los enlaces de un correo, así que un GET que
 * cerrara el lead se dispararía solo. La página muestra el botón y el cierre
 * ocurre en el POST.
 */
export function urlCierre(
  lead: Pick<Lead, "id" | "action_token">,
  resultado: ResultadoCierre,
  rol: RolCierre,
): string {
  const parametros = new URLSearchParams({
    resultado,
    token: lead.action_token,
    rol,
  });
  return `${urlSitio()}/cierre/${lead.id}?${parametros.toString()}`;
}

// ---------------------------------------------------------------------------
// Piezas compartidas
// ---------------------------------------------------------------------------

function envoltura(titulo: string, leadCode: string, cuerpo: string): string {
  return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:24px 12px;background:#F7F7F7">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;width:100%;background:#FFFFFF;border:1px solid #ECECEC;border-radius:14px">
    <tr><td style="padding:26px 24px">

      <p style="margin:0 0 4px;${TIPOGRAFIA};font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:#165DFC">Mister Precios</p>
      <h1 style="margin:0 0 6px;${TIPOGRAFIA};font-size:21px;line-height:1.3;color:#101828">${esc(titulo)}</h1>
      <p style="margin:0 0 20px;${TIPOGRAFIA};font-size:14px;color:#4A5565">Código de seguimiento: <strong style="color:#101828">${esc(leadCode)}</strong></p>

      ${cuerpo}

    </td></tr>
  </table>
</body>
</html>`;
}

function fila(etiqueta: string, valor: string, destacado = false): string {
  const estiloValor = destacado
    ? "font-size:18px;font-weight:700;color:#165DFC"
    : "font-size:15px;color:#101828";

  return `<tr>
    <td style="padding:10px 0;border-bottom:1px solid #ECECEC;vertical-align:top;width:42%;${TIPOGRAFIA};font-size:13px;color:#4A5565">${esc(etiqueta)}</td>
    <td style="padding:10px 0;border-bottom:1px solid #ECECEC;vertical-align:top;${TIPOGRAFIA};${estiloValor}">${valor}</td>
  </tr>`;
}

function parrafo(contenido: string): string {
  return `<p style="margin:0 0 16px;${TIPOGRAFIA};font-size:15px;line-height:1.6;color:#101828">${contenido}</p>`;
}

function recuadro(contenido: string): string {
  return `<div style="margin:22px 0 0;padding:14px 16px;background:#E8EFFF;border-radius:10px">
    <p style="margin:0;${TIPOGRAFIA};font-size:14px;line-height:1.6;color:#28325F">${contenido}</p>
  </div>`;
}

function pieDiscreto(contenido: string): string {
  return `<p style="margin:20px 0 0;${TIPOGRAFIA};font-size:12px;line-height:1.6;color:#4A5565">${contenido}</p>`;
}

/**
 * Botón como `<a>` con padding: es lo único que renderiza parecido en todos los
 * clientes de correo. Outlook ignora border-radius y no pasa nada.
 */
function boton(url: string, texto: string, primario: boolean): string {
  const estilo = primario
    ? "background:#165DFC;color:#FFFFFF;border:1px solid #165DFC"
    : "background:#FFFFFF;color:#101828;border:1px solid #ECECEC";

  return `<a href="${esc(url)}" style="display:inline-block;margin:0 8px 8px 0;padding:11px 18px;border-radius:10px;text-decoration:none;${TIPOGRAFIA};font-size:14px;font-weight:600;${estilo}">${esc(texto)}</a>`;
}

// ---------------------------------------------------------------------------
// Paso 3 — resumen ejecutivo al vendedor
// ---------------------------------------------------------------------------

/** Nombre legible del producto para el borrador de respaldo. */
function describirProducto(lead: Lead): string {
  const p = lead.producto_normalizado;
  if (!p) return lead.producto_texto;
  return `${p.marca} ${p.modelo}${p.variante ? ` ${p.variante}` : ""}`;
}

/**
 * Borrador de respaldo, armado con los mismos datos del lead pero sin IA.
 *
 * Existe para que la falta de Gemini —cuota agotada, caída, API key vencida—
 * nunca deje al operador con un cuadro de texto vacío y un lead que no puede
 * enviar. Es más seco que el que redacta el modelo y se nota, que es
 * exactamente lo que se busca: invita a editarlo antes de mandarlo.
 */
export function resumenDeRespaldo(lead: Lead): string {
  const producto = describirProducto(lead);

  const precio =
    lead.precio_a_vencer !== null
      ? ` El precio a vencer es ${formatearMoneda(lead.precio_a_vencer, "CRC")}.`
      : "";

  const flexibilidad = lead.flexible
    ? " El cliente está abierto a opciones similares si no tenés ese modelo exacto."
    : " El cliente busca ese modelo en particular.";

  return (
    `Un cliente nos pidió ayuda para conseguir un mejor precio en ${producto}.` +
    precio +
    flexibilidad +
    " Si podés mejorarlo, respondé este correo con tu cotización."
  );
}

/**
 * Parte el borrador aprobado en párrafos, ya escapados.
 *
 * El escape no es opcional: el texto pasó por un `<textarea>` del panel, así
 * que es entrada de usuario aunque la haya escrito alguien de confianza. Los
 * saltos de línea se respetan porque el operador los puso a mano.
 */
function parrafosDelResumen(resumen: string): string[] {
  return resumen
    .split(/\n+/)
    .map((linea) => linea.trim())
    .filter(Boolean);
}

export function plantillaOportunidad(
  lead: Lead,
  vendedor: Vendedor,
  urlsFotos: string[],
): PlantillaCorreo {
  // El lead_code va bien visible en el asunto: es la llave con la que después
  // se matchea la cotización que el vendedor mande por correo.
  const asunto = `Nueva oportunidad de venta — ${lead.lead_code}`;

  const producto = lead.producto_normalizado;
  const precioAVencer =
    lead.precio_a_vencer !== null
      ? formatearMoneda(lead.precio_a_vencer, "CRC")
      : "—";
  const precioVisto =
    lead.precio_visto !== null
      ? formatearMoneda(lead.precio_visto, lead.moneda)
      : "—";

  const flexibilidad = lead.flexible
    ? "Abierto a opciones similares"
    : "Solo este modelo";

  const filas = [
    fila("Producto", esc(lead.producto_texto)),
    producto
      ? fila(
          "Marca y modelo",
          `${esc(producto.marca)} ${esc(producto.modelo)}${
            producto.variante ? ` · ${esc(producto.variante)}` : ""
          }`,
        )
      : "",
    fila("Precio a vencer", esc(precioAVencer), true),
    fila("Precio que vio el cliente", esc(precioVisto)),
    fila("Flexibilidad", esc(flexibilidad)),
    lead.link_referencia
      ? fila(
          "Referencia",
          `<a href="${esc(lead.link_referencia)}" style="color:#165DFC">${esc(lead.link_referencia)}</a>`,
        )
      : "",
    urlsFotos.length > 0
      ? fila(
          "Fotos",
          urlsFotos
            .map(
              (url, i) =>
                `<a href="${esc(url)}" style="color:#165DFC">Foto ${i + 1}</a>`,
            )
            .join(" &nbsp;·&nbsp; "),
        )
      : "",
    fila("Cliente", esc(lead.nombre)),
  ]
    .filter(Boolean)
    .join("");

  const saludo = vendedor.nombre_contacto
    ? `Hola ${esc(vendedor.nombre_contacto)}`
    : `Hola ${esc(vendedor.nombre_tienda)}`;

  // Un lead siempre debería llegar acá con borrador aprobado; el respaldo cubre
  // el caso raro de un envío disparado por otra vía.
  const resumen = lead.resumen_borrador?.trim() || resumenDeRespaldo(lead);
  const parrafosResumen = parrafosDelResumen(resumen);
  const [primerParrafo = "", ...restoParrafos] = parrafosResumen;

  const apertura = [
    parrafo(`${saludo}: ${esc(primerParrafo)}`),
    ...restoParrafos.map((linea) => parrafo(esc(linea))),
  ].join("");

  const cuerpo = `
      ${apertura}

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        ${filas}
      </table>

      ${recuadro(
        `<strong>¿Podés mejorar ese precio?</strong> Respondé este correo con tu cotización
          (PDF o foto) y dejá <strong>${esc(lead.lead_code)}</strong> en el asunto para que la
          asociemos automáticamente.`,
      )}

      ${pieDiscreto(
        `El cliente está en copia de este correo. Si preferís mandarnos la cotización solo a nosotros, respondé a esta dirección y no a todos.`,
      )}`;

  const texto = [
    `MISTER PRECIOS — Nueva oportunidad de venta`,
    `Código de seguimiento: ${lead.lead_code}`,
    ``,
    `${vendedor.nombre_contacto ?? vendedor.nombre_tienda}: ${primerParrafo}`,
    ...restoParrafos,
    ``,
    `Producto: ${lead.producto_texto}`,
    producto
      ? `Marca y modelo: ${producto.marca} ${producto.modelo}${producto.variante ? ` · ${producto.variante}` : ""}`
      : "",
    `Precio a vencer: ${precioAVencer}`,
    `Precio que vio el cliente: ${precioVisto}`,
    `Flexibilidad: ${flexibilidad}`,
    lead.link_referencia ? `Referencia: ${lead.link_referencia}` : "",
    ...urlsFotos.map((url, i) => `Foto ${i + 1}: ${url}`),
    `Cliente: ${lead.nombre}`,
    ``,
    `¿Podés mejorar ese precio? Respondé este correo con tu cotización (PDF o foto) y dejá ${lead.lead_code} en el asunto para que la asociemos automáticamente.`,
    ``,
    `El cliente está en copia de este correo. Si preferís mandarnos la cotización solo a nosotros, respondé a esta dirección y no a todos.`,
  ]
    .filter((linea) => linea !== "")
    .join("\n");

  return {
    asunto,
    html: envoltura("Nueva oportunidad de venta", lead.lead_code, cuerpo),
    texto,
  };
}

// ---------------------------------------------------------------------------
// Paso 5 — recordatorio a las 24h
// ---------------------------------------------------------------------------

/**
 * Va al vendedor que recibió el resumen y todavía no mandó cotización.
 *
 * Es un empujón, no un reclamo: el vendedor es un aliado comercial, no un
 * proveedor con SLA. Por eso repite el precio a vencer (que es la información
 * accionable) en vez de insistir con el tiempo transcurrido.
 */
export function plantillaRecordatorio24h(
  lead: Lead,
  vendedor: Vendedor,
): PlantillaCorreo {
  const asunto = `Recordatorio: sigue abierta la oportunidad — ${lead.lead_code}`;

  const producto = lead.producto_normalizado
    ? `${lead.producto_normalizado.marca} ${lead.producto_normalizado.modelo}`
    : lead.producto_texto;

  const precioAVencer =
    lead.precio_a_vencer !== null
      ? formatearMoneda(lead.precio_a_vencer, "CRC")
      : "—";

  const saludo = vendedor.nombre_contacto
    ? `Hola ${esc(vendedor.nombre_contacto)}`
    : `Hola ${esc(vendedor.nombre_tienda)}`;

  const cuerpo = `
      ${parrafo(`${saludo}: te escribimos ayer por esta oportunidad y todavía no nos llegó tu cotización. El cliente sigue esperando.`)}

      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        ${fila("Producto", esc(producto))}
        ${fila("Precio a vencer", esc(precioAVencer), true)}
      </table>

      ${recuadro(
        `Respondé este correo con tu cotización (PDF o foto) dejando
          <strong>${esc(lead.lead_code)}</strong> en el asunto. Si ya no tenés el producto
          disponible, contestanos igual y lo movemos a otra tienda.`,
      )}

      ${pieDiscreto("Si ya nos mandaste la cotización en las últimas horas, ignorá este correo.")}`;

  const texto = [
    `MISTER PRECIOS — Recordatorio`,
    `Código de seguimiento: ${lead.lead_code}`,
    ``,
    `${vendedor.nombre_contacto ?? vendedor.nombre_tienda}: te escribimos ayer por esta oportunidad y todavía no nos llegó tu cotización. El cliente sigue esperando.`,
    ``,
    `Producto: ${producto}`,
    `Precio a vencer: ${precioAVencer}`,
    ``,
    `Respondé este correo con tu cotización (PDF o foto) dejando ${lead.lead_code} en el asunto. Si ya no tenés el producto disponible, contestanos igual y lo movemos a otra tienda.`,
    ``,
    `Si ya nos mandaste la cotización en las últimas horas, ignorá este correo.`,
  ].join("\n");

  return {
    asunto,
    html: envoltura("Sigue abierta la oportunidad", lead.lead_code, cuerpo),
    texto,
  };
}

// ---------------------------------------------------------------------------
// Paso 5 — verificación de cierre a las 72h
// ---------------------------------------------------------------------------

/** Las tres respuestas posibles, redactadas distinto según quién recibe. */
const OPCIONES: Record<RolCierre, [ResultadoCierre, string][]> = {
  cliente: [
    ["ganado", "Sí, ya compré"],
    ["en_proceso", "Todavía lo estoy pensando"],
    ["perdido", "No, no compré"],
  ],
  vendedor: [
    ["ganado", "Sí, se concretó"],
    ["en_proceso", "Sigue en negociación"],
    ["perdido", "No se concretó"],
  ],
};

/**
 * Va a las 72h de recibida la cotización, al cliente y al vendedor por
 * separado. Cada uno recibe su propio enlace con `rol` para que la respuesta
 * quede atribuida: el `action_token` identifica al lead, no a la persona.
 */
export function plantillaVerificacion72h(
  lead: Lead,
  rol: RolCierre,
  vendedor: Vendedor | null,
): PlantillaCorreo {
  const asunto = `¿Cómo salió la compra? — ${lead.lead_code}`;

  const producto = lead.producto_normalizado
    ? `${lead.producto_normalizado.marca} ${lead.producto_normalizado.modelo}`
    : lead.producto_texto;

  const saludo =
    rol === "cliente"
      ? `Hola ${esc(lead.nombre)}`
      : vendedor?.nombre_contacto
        ? `Hola ${esc(vendedor.nombre_contacto)}`
        : `Hola ${esc(vendedor?.nombre_tienda ?? "")}`;

  const contexto =
    rol === "cliente"
      ? `hace unos días te pasamos una cotización por <strong>${esc(producto)}</strong>. Contanos cómo salió: es un solo clic y nos sirve para saber si te conseguimos un buen precio.`
      : `hace unos días le pasamos al cliente tu cotización por <strong>${esc(producto)}</strong>. ¿Sabés si se concretó? Es un solo clic.`;

  const opciones = OPCIONES[rol];

  const botones = opciones
    .map(([resultado, texto], indice) =>
      boton(urlCierre(lead, resultado, rol), texto, indice === 0),
    )
    .join("");

  const cuerpo = `
      ${parrafo(`${saludo}: ${contexto}`)}

      <div style="margin:22px 0 0">
        ${botones}
      </div>

      ${pieDiscreto("Vas a ver una página de confirmación antes de que quede registrada tu respuesta.")}`;

  const texto = [
    `MISTER PRECIOS — ¿Cómo salió la compra?`,
    `Código de seguimiento: ${lead.lead_code}`,
    ``,
    rol === "cliente"
      ? `${lead.nombre}: hace unos días te pasamos una cotización por ${producto}. Contanos cómo salió.`
      : `${vendedor?.nombre_contacto ?? vendedor?.nombre_tienda ?? ""}: hace unos días le pasamos al cliente tu cotización por ${producto}. ¿Sabés si se concretó?`,
    ``,
    ...opciones.map(
      ([resultado, etiqueta]) =>
        `${etiqueta}: ${urlCierre(lead, resultado, rol)}`,
    ),
    ``,
    `Vas a ver una página de confirmación antes de que quede registrada tu respuesta.`,
  ].join("\n");

  return {
    asunto,
    html: envoltura("¿Cómo salió la compra?", lead.lead_code, cuerpo),
    texto,
  };
}
