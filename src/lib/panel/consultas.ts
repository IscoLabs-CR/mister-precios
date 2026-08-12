import "server-only";
import { createAdminClient } from "../supabase/admin";
import {
  ESTADOS_CERRADOS,
  ESTADOS_QUE_REQUIEREN_ACCION,
  GRACIA_LEAD_NUEVO_MS,
} from "../estados";
import type { Estado, Lead, Vendedor } from "../tipos";

/**
 * Todas las lecturas del panel pasan por el service role. Las tablas tienen
 * RLS sin policies, así que el cliente `authenticated` del navegador no puede
 * leer nada: la sesión sirve para saber QUIÉN entra, no para autorizar SQL.
 */

export type FilaLead = Lead & {
  vendedores: { nombre_tienda: string } | null;
};

export type Metricas = {
  activos: number;
  cotizadosSemana: number;
  requierenAccion: number;
};

export async function obtenerMetricas(): Promise<Metricas> {
  const supabase = createAdminClient();
  const hace7dias = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const finGracia = new Date(Date.now() - GRACIA_LEAD_NUEVO_MS).toISOString();

  const [
    activos,
    cotizados,
    leadsSinAsignar,
    leadsAtascados,
    cotizacionesSueltas,
  ] = await Promise.all([
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .not("estado", "in", `(${ESTADOS_CERRADOS.join(",")})`),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .gte("fecha_cotizacion_recibida", hace7dias),
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .in("estado", ESTADOS_QUE_REQUIEREN_ACCION),
    // Cualquier lead que siga en `nuevo` pasado el margen de gracia está
    // atascado: o la IA no pudo normalizarlo, o la búsqueda en el catálogo no
    // terminó. El estado por sí solo no los distingue de los que están
    // procesándose en este instante, de ahí el filtro por fecha. Ver
    // `motivoAccion`, que aplica exactamente el mismo criterio.
    supabase
      .from("leads")
      .select("*", { count: "exact", head: true })
      .eq("estado", "nuevo")
      .lt("created_at", finGracia),
    supabase
      .from("cotizaciones")
      .select("*", { count: "exact", head: true })
      .is("lead_id", null),
  ]);

  return {
    activos: activos.count ?? 0,
    cotizadosSemana: cotizados.count ?? 0,
    // Una cotización huérfana también es trabajo manual pendiente, aunque no
    // esté colgando de ningún lead.
    requierenAccion:
      (leadsSinAsignar.count ?? 0) +
      (leadsAtascados.count ?? 0) +
      (cotizacionesSueltas.count ?? 0),
  };
}

/** PostgREST usa `,` y `()` como sintaxis en `or()`; hay que sacarlos del texto. */
function limpiarBusqueda(valor: string): string {
  return valor.replace(/[,()\\%*]/g, "").trim().slice(0, 80);
}

export async function listarLeads(filtros: {
  estado?: string;
  q?: string;
}): Promise<FilaLead[]> {
  const supabase = createAdminClient();

  let consulta = supabase
    .from("leads")
    .select("*, vendedores(nombre_tienda)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (filtros.estado) consulta = consulta.eq("estado", filtros.estado);

  const q = limpiarBusqueda(filtros.q ?? "");
  if (q) consulta = consulta.or(`lead_code.ilike.%${q}%,nombre.ilike.%${q}%`);

  const { data, error } = await consulta;

  if (error) {
    console.error("listarLeads:", error.message);
    return [];
  }

  return (data ?? []) as FilaLead[];
}

export type EventoLead = {
  id: string;
  estado_anterior: Estado | null;
  estado_nuevo: Estado | null;
  nota: string | null;
  created_at: string;
};

export type Cotizacion = {
  id: string;
  lead_id: string | null;
  archivo_url: string | null;
  precio_cotizado: number | null;
  condiciones: string | null;
  vigencia_dias: number | null;
  remitente: string | null;
  asunto: string | null;
  created_at: string;
};

export type DetalleLead = {
  lead: Lead;
  vendedor: Vendedor | null;
  eventos: EventoLead[];
  cotizaciones: Cotizacion[];
};

export async function obtenerDetalleLead(
  id: string,
): Promise<DetalleLead | null> {
  const supabase = createAdminClient();

  const { data: lead, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !lead) {
    if (error) console.error("obtenerDetalleLead:", error.message);
    return null;
  }

  const [vendedorRes, eventosRes, cotizacionesRes] = await Promise.all([
    lead.vendedor_id
      ? supabase.from("vendedores").select("*").eq("id", lead.vendedor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("lead_eventos")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: true }),
    supabase
      .from("cotizaciones")
      .select("*")
      .eq("lead_id", id)
      .order("created_at", { ascending: false }),
  ]);

  return {
    lead: lead as Lead,
    vendedor: (vendedorRes.data as Vendedor | null) ?? null,
    eventos: (eventosRes.data ?? []) as EventoLead[],
    cotizaciones: (cotizacionesRes.data ?? []) as Cotizacion[],
  };
}

/**
 * Todos los vendedores, activos e inactivos. La vista de administración los
 * muestra completos: un vendedor inactivo que no se ve es un vendedor que
 * alguien vuelve a dar de alta duplicado.
 */
export async function listarVendedores(): Promise<Vendedor[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("vendedores")
    .select("*")
    .order("activo", { ascending: false })
    .order("nombre_tienda");

  if (error) {
    console.error("listarVendedores:", error.message);
    return [];
  }

  return (data ?? []) as Vendedor[];
}

export async function listarVendedoresActivos(): Promise<Vendedor[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("vendedores")
    .select("*")
    .eq("activo", true)
    .order("nombre_tienda");

  if (error) {
    console.error("listarVendedoresActivos:", error.message);
    return [];
  }

  return (data ?? []) as Vendedor[];
}

/** Cotizaciones que llegaron sin poder vincularse a ningún lead. */
export async function listarCotizacionesSinAsignar(): Promise<Cotizacion[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("cotizaciones")
    .select("*")
    .is("lead_id", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("listarCotizacionesSinAsignar:", error.message);
    return [];
  }

  return (data ?? []) as Cotizacion[];
}
