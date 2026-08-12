import type { Estado } from "./tipos";

/**
 * Presentación de cada estado en el panel.
 *
 * `requiereAccion` marca los estados que son cola de trabajo manual: se
 * destacan en rojo y alimentan la métrica de "sin asignar". Es la señal más
 * importante del panel — si esos leads se pierden entre los demás, se quedan
 * ahí para siempre.
 *
 * `validado` va en cyan y no en azul a propósito: el azul de marca ya es el
 * badge de `enviado_vendedor`, y en la misma tabla los dos se confundían.
 */
type InfoEstado = {
  etiqueta: string;
  clases: string;
  requiereAccion: boolean;
};

export const INFO_ESTADO: Record<Estado, InfoEstado> = {
  nuevo: {
    etiqueta: "Nuevo",
    clases: "bg-slate-100 text-slate-700 ring-slate-200",
    requiereAccion: false,
  },
  validado: {
    etiqueta: "Validado",
    clases: "bg-cyan-50 text-cyan-800 ring-cyan-200",
    requiereAccion: false,
  },
  vendedor_no_asignado: {
    etiqueta: "Sin vendedor",
    clases: "bg-alerta-tint text-alerta ring-alerta/30",
    requiereAccion: true,
  },
  enviado_vendedor: {
    etiqueta: "Enviado al vendedor",
    clases: "bg-brand-tint text-brand-deep ring-brand/25",
    requiereAccion: false,
  },
  cotizado: {
    etiqueta: "Cotizado",
    clases: "bg-violet-50 text-violet-800 ring-violet-200",
    requiereAccion: false,
  },
  en_proceso: {
    etiqueta: "En proceso",
    clases: "bg-amber-50 text-amber-800 ring-amber-200",
    requiereAccion: false,
  },
  cerrado_ganado: {
    etiqueta: "Ganado",
    clases: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    requiereAccion: false,
  },
  cerrado_perdido: {
    etiqueta: "Perdido",
    clases: "bg-stone-100 text-stone-600 ring-stone-300",
    requiereAccion: false,
  },
  sin_asignar: {
    etiqueta: "Cotización sin asignar",
    clases: "bg-alerta-tint text-alerta ring-alerta/30",
    requiereAccion: true,
  },
};

export const ESTADOS_QUE_REQUIEREN_ACCION = (
  Object.keys(INFO_ESTADO) as Estado[]
).filter((estado) => INFO_ESTADO[estado].requiereAccion);

/** Un lead deja de estar "activo" cuando se cierra, gane o pierda. */
export const ESTADOS_CERRADOS: Estado[] = [
  "cerrado_ganado",
  "cerrado_perdido",
];

export function infoEstado(estado: string): InfoEstado {
  return (
    INFO_ESTADO[estado as Estado] ?? {
      etiqueta: estado,
      clases: "bg-slate-100 text-slate-700 ring-slate-200",
      requiereAccion: false,
    }
  );
}

/**
 * Margen antes de considerar atascado a un lead en `nuevo`.
 *
 * `nuevo` NO es un estado de alarma por sí solo: todo lead pasa por ahí unos
 * segundos mientras corre el procesamiento en segundo plano que dispara
 * /api/leads. Pero pasado ese margen sí lo es, SIEMPRE — el procesamiento tarda
 * segundos, no minutos.
 *
 * Por eso el discriminador es (estado, tiempo transcurrido), que no cabe en
 * `INFO_ESTADO` porque este solo conoce el estado. `producto_normalizado` ya no
 * decide SI el lead requiere acción, solo POR QUÉ: los dos casos existen y se
 * resuelven distinto.
 */
export const GRACIA_LEAD_NUEVO_MS = 5 * 60 * 1000;

export type MotivoAccion = "estado" | "sin_normalizar" | "sin_procesar";

export type LeadEvaluable = {
  estado: string;
  producto_normalizado: unknown;
  created_at: string;
};

/** null = el lead no necesita intervención manual. */
export function motivoAccion(lead: LeadEvaluable): MotivoAccion | null {
  if (infoEstado(lead.estado).requiereAccion) return "estado";

  if (lead.estado !== "nuevo") return null;

  const edad = Date.now() - new Date(lead.created_at).getTime();
  if (edad <= GRACIA_LEAD_NUEVO_MS) return null;

  // Sin normalización, lo que falló fue la IA y no hay con qué buscar. Con
  // normalización, la búsqueda en el catálogo murió a mitad (timeout del sitio
  // externo, o la función cortada antes de terminar el `after()`), y con eso
  // basta para que el barrido de reproceso lo levante solo.
  return lead.producto_normalizado ? "sin_procesar" : "sin_normalizar";
}

export function requiereAccion(lead: LeadEvaluable): boolean {
  return motivoAccion(lead) !== null;
}
