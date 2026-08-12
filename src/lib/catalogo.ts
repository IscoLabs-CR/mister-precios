/* ===========================================================================
 * CATÁLOGO — seam de integración
 * ===========================================================================
 *
 * El resto del proyecto solo conoce `ResultadoCatalogo`, `buscarProducto` y
 * `filtrarPorFlexibilidad`. Hoy los tres se resuelven contra misterprecios.com
 * (ver `misterprecios.ts`); cambiar de origen es reescribir ese archivo y, como
 * mucho, el armado del término de búsqueda de acá abajo.
 *
 * Lo que el catálogo aporta es el PRECIO A VENCER, no el vendedor: a quién se
 * le manda el lead se elige a mano en el panel, de la lista de aliados.
 *
 * Garantías que el flujo asume y hay que mantener:
 *   - `buscarProducto` NUNCA lanza: ante un fallo devuelve [] y loguea. El lead
 *     igual cae en `vendedor_no_asignado`, que es cola de trabajo manual; un
 *     throw lo dejaría trabado en `nuevo`.
 *   - `precio` en CRC.
 * ======================================================================== */

import { buscarEnMisterPrecios } from "./misterprecios";
import { claveModelo } from "./validacion";

export type ResultadoCatalogo = {
  tienda: string;
  id_catalogo_tienda: string;
  precio: number;
  disponible: boolean;
  /**
   * Nombre del producto según el catálogo. Está acá para que
   * `filtrarPorFlexibilidad` pueda distinguir una coincidencia exacta de una
   * similar sin volver a consultar el origen.
   */
  titulo: string;
  /** Enlace a la oferta, para que el vendedor vea el precio que hay que ganar. */
  url: string | null;
};

/**
 * Busca el producto normalizado en el catálogo.
 *
 * Devuelve TODOS los candidatos, disponibles o no: distinguir "no existe" de
 * "existe pero está agotado" es información que el flujo necesita, y filtrar
 * acá la perdería.
 */
export async function buscarProducto(productoNormalizado: {
  marca: string;
  modelo: string;
  variante?: string;
}): Promise<ResultadoCatalogo[]> {
  // El modelo es el token de más señal; la marca desambigua cuando el código es
  // corto o genérico. La variante NO entra: el buscador es de texto completo y
  // "65 pulgadas QLED" mete ruido que termina descartando el producto correcto.
  const termino = [productoNormalizado.marca, productoNormalizado.modelo]
    .map((parte) => parte?.trim())
    .filter(Boolean)
    .join(" ");

  if (!termino) return [];

  try {
    return await buscarEnMisterPrecios(termino);
  } catch (error) {
    // `buscarEnMisterPrecios` ya atrapa lo suyo; esto es el cinturón del
    // contrato: pase lo que pase, el flujo recibe un array.
    console.error("buscarProducto:", error);
    return [];
  }
}

/**
 * Aplica la regla de flexibilidad del lead sobre los resultados.
 *
 *   flexible = false -> solo el mismo modelo que pidió el cliente
 *   flexible = true  -> cualquier candidato que haya devuelto el catálogo
 *
 * Vive acá, junto a `buscarProducto`, porque son las dos mitades del mismo
 * seam: quien cambie el origen del catálogo tiene que revisar las dos.
 */
export function filtrarPorFlexibilidad(
  productoNormalizado: { marca: string; modelo: string },
  resultados: ResultadoCatalogo[],
  flexible: boolean,
): ResultadoCatalogo[] {
  if (flexible) return resultados;

  const modelo = claveModelo(productoNormalizado.modelo);

  // Sin modelo no hay forma de saber qué es exacto. Se devuelve vacío en vez de
  // todo: el cliente pidió UN modelo concreto y mandarle otro es peor que
  // mandarlo a revisión manual.
  if (!modelo) return [];

  // El catálogo titula con el código completo del fabricante
  // ("...50\" QN50Q60DAPXPA") y el cliente escribe el corto ("QN50Q60D"), así
  // que la prueba es de contención sobre el título normalizado, no de igualdad.
  return resultados.filter((resultado) =>
    claveModelo(resultado.titulo).includes(modelo),
  );
}
