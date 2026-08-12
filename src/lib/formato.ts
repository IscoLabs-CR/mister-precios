import type { Moneda } from "./tipos";

/** Zona horaria de presentación. La base guarda todo en UTC. */
export const ZONA_CR = "America/Costa_Rica";

function separarMiles(entero: string, separador: string): string {
  return entero.replace(/\B(?=(\d{3})+(?!\d))/g, separador);
}

/**
 * Formatea a mano en vez de usar `toLocaleString` porque Node y el navegador
 * pueden resolver el locale distinto y producir un desajuste de hidratación.
 */
export function formatearMoneda(monto: number, moneda: Moneda): string {
  const negativo = monto < 0;
  const absoluto = Math.abs(monto);

  let texto: string;
  if (moneda === "CRC") {
    // ₡1.250.000 — sin decimales cuando es entero, que es el caso normal.
    const [entero, decimales] = absoluto.toFixed(2).split(".");
    texto = `₡${separarMiles(entero, ".")}`;
    if (decimales !== "00") texto += `,${decimales}`;
  } else {
    const [entero, decimales] = absoluto.toFixed(2).split(".");
    texto = `$${separarMiles(entero, ",")}.${decimales}`;
  }

  return negativo ? `-${texto}` : texto;
}

const formateadorFecha = new Intl.DateTimeFormat("es-CR", {
  timeZone: ZONA_CR,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});

/**
 * Fecha en hora de Costa Rica. Solo para código de servidor (correos, panel
 * renderizado en el servidor): en el cliente puede desajustar la hidratación.
 */
export function formatearFechaCR(iso: string | Date): string {
  const fecha = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(fecha.getTime())) return "—";
  return formateadorFecha.format(fecha);
}
