import "server-only";
import * as cheerio from "cheerio";
import type { ResultadoCatalogo } from "./catalogo";
import { aNumero, clavear } from "./validacion";

/* ===========================================================================
 * CLIENTE DEL CATÁLOGO — misterprecios.com
 * ===========================================================================
 *
 * Todo lo que sabe de ESTE sitio en particular vive acá. `catalogo.ts` es el
 * seam genérico que lo consume: si el catálogo cambia de origen, se reescribe
 * este archivo y el resto del proyecto no se entera.
 *
 * El sitio es WordPress y no expone la REST de WooCommerce, pero sí un
 * namespace propio `mp/v1` con un buscador público. La consulta es en dos
 * pasos:
 *
 *   1. GET /wp-json/mp/v1/search?term=...  -> [{type, title, link}]
 *   2. GET <link> y parsear las ofertas de la ficha
 *
 * El buscador solo devuelve títulos y enlaces (es el typeahead del sitio), así
 * que los precios obligan al segundo paso. Ninguna de las dos rutas está
 * bloqueada por robots.txt — sí lo están `?s=`, `mfn_livesearch`, los filtros
 * `mp_*` y `/productos/page/`, que este cliente no toca.
 * ======================================================================== */

const BASE = "https://misterprecios.com";

/**
 * Agente propio y verificable. El WAF del sitio responde 403 al `curl/*` por
 * defecto pero deja pasar cualquier agente descriptivo, así que no hace falta
 * disfrazarse de navegador. Si algún día hay que pedir lista blanca, esta es la
 * cadena que van a buscar en sus logs.
 */
const USER_AGENT = `MisterPreciosBot/1.0 (+${BASE})`;

/** Por request, no para la búsqueda completa. */
const TIMEOUT_MS = 8000;

/**
 * Fichas que se abren por lead. Cada una son ~350 KB y ~1s, y el buscador ya
 * viene ordenado por relevancia: más allá de las primeras solo se paga latencia
 * por candidatos que no van a matchear.
 */
const MAX_FICHAS = 3;

type Sugerencia = { type?: string; title?: string; link?: string };
type Ficha = { titulo: string; url: string };

/** Devuelve null ante cualquier fallo. Nunca lanza: ver el contrato en `catalogo.ts`. */
async function traer(url: string): Promise<string | null> {
  try {
    const respuesta = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/json",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Los precios cambian a diario y este dato termina en el correo al
      // vendedor como "el precio a vencer". Cachear acá lo volvería mentira.
      cache: "no-store",
    });

    if (!respuesta.ok) {
      console.error(`misterprecios: HTTP ${respuesta.status} en ${url}`);
      return null;
    }

    return await respuesta.text();
  } catch (error) {
    // Incluye el timeout del AbortSignal.
    console.error(`misterprecios: falló ${url}:`, error);
    return null;
  }
}

async function buscarFichas(termino: string): Promise<Ficha[]> {
  const url = `${BASE}/wp-json/mp/v1/search?term=${encodeURIComponent(termino)}`;
  const cuerpo = await traer(url);
  if (!cuerpo) return [];

  let datos: unknown;
  try {
    datos = JSON.parse(cuerpo);
  } catch {
    // Pasa si el WAF devuelve su página de bloqueo con status 200.
    console.error("misterprecios: la búsqueda no devolvió JSON.");
    return [];
  }

  if (!Array.isArray(datos)) return [];

  return (datos as Sugerencia[])
    .filter((s) => s.type === "producto" && typeof s.link === "string")
    .slice(0, MAX_FICHAS)
    .map((s) => ({ titulo: String(s.title ?? "").trim(), url: String(s.link) }));
}

/**
 * Ofertas de una ficha de producto.
 *
 * Se cuelga de los atributos `data-*` y no de las clases de maquetado:
 * `data-mp-offer-card` y `data-store-name` los usa el JS del propio sitio para
 * trackear los clics a tienda, así que sobreviven a un rediseño. La
 * disponibilidad es la excepción —sale de la clase `no-disponible`— porque no
 * hay atributo equivalente.
 *
 * `titulo` es el del producto, no el de la oferta: cada tienda lo nombra a su
 * manera y el de la ficha es el que lleva el código de modelo completo, que es
 * contra lo que `filtrarPorFlexibilidad` compara.
 */
function extraerOfertas(html: string, ficha: Ficha): ResultadoCatalogo[] {
  const $ = cheerio.load(html);
  const ofertas: ResultadoCatalogo[] = [];

  $("[data-mp-offer-card]").each((_, elemento) => {
    const tarjeta = $(elemento);
    const enlace = tarjeta.find("[data-store-name]").first();

    const tienda = enlace.attr("data-store-name")?.trim();
    if (!tienda) return;

    const bloque = tarjeta.find(".precio_disponibilidad").first();
    if (bloque.length === 0) return;

    // Los precios vienen como "₡ 135.000": `aNumero` ya quita el símbolo y
    // trata el punto como separador de miles.
    const precio = aNumero(bloque.find("strong").first().text());
    if (precio === null || precio <= 0) return;

    ofertas.push({
      tienda,
      // La ficha no trae ningún id de tienda, solo el nombre; el identificador
      // estable que se puede formar es ese nombre normalizado.
      id_catalogo_tienda: clavear(tienda),
      precio,
      disponible: !bloque.hasClass("no-disponible"),
      titulo: ficha.titulo,
      url: enlace.attr("href") ?? ficha.url,
    });
  });

  return ofertas;
}

/**
 * Todas las ofertas de las primeras `MAX_FICHAS` coincidencias del buscador.
 *
 * No filtra por disponibilidad ni por flexibilidad: eso es decisión del flujo
 * (ver `filtrarPorFlexibilidad` y `validarContraCatalogo`). Acá solo se trae
 * lo que el catálogo tenga.
 */
export async function buscarEnMisterPrecios(
  termino: string,
): Promise<ResultadoCatalogo[]> {
  const fichas = await buscarFichas(termino);
  if (fichas.length === 0) return [];

  const todas: ResultadoCatalogo[] = [];

  // Secuencial a propósito: son varias peticiones contra un WordPress
  // compartido y no hay ninguna prisa. Esto corre en segundo plano, después de
  // que el cliente ya recibió su confirmación.
  for (const ficha of fichas) {
    const html = await traer(ficha.url);
    if (!html) continue;
    todas.push(...extraerOfertas(html, ficha));
  }

  return todas;
}
