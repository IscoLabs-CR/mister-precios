"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { igualSeguro } from "@/lib/seguridad";
import {
  esResultadoCierre,
  esRolCierre,
  type Estado,
  type ResultadoCierre,
} from "@/lib/tipos";

/**
 * Registro del desenlace desde el enlace que sale en el correo de 72h.
 *
 * Endpoint PÚBLICO: no hay sesión y la única credencial es el `action_token`
 * del lead. Por eso se revalida todo acá adentro sin confiar en nada de lo que
 * ya chequeó la página — una Server Action es un POST que cualquiera puede
 * invocar directo.
 *
 * Y por eso el enlace del correo apunta a la página y no acá: los clientes de
 * correo hacen prefetch de los enlaces, así que el cierre tiene que colgar de
 * un POST deliberado, nunca de un GET.
 */

const ESTADO_POR_RESULTADO: Record<ResultadoCierre, Estado> = {
  ganado: "cerrado_ganado",
  perdido: "cerrado_perdido",
  en_proceso: "en_proceso",
};

/** Un desenlace terminal no se reescribe; "en proceso" sí, porque quien todavía
 *  lo estaba pensando puede volver después a decir en qué terminó. */
const TERMINALES: ResultadoCierre[] = ["ganado", "perdido"];

export async function registrarCierre(datos: FormData): Promise<void> {
  const leadId = String(datos.get("leadId") ?? "");
  const token = String(datos.get("token") ?? "");
  const resultado = datos.get("resultado");
  const rolCrudo = datos.get("rol");

  if (!leadId || !token || !esResultadoCierre(resultado)) {
    redirect(`/cierre/${leadId}?error=invalido`);
  }

  const rol = esRolCierre(rolCrudo) ? rolCrudo : "cliente";
  const supabase = createAdminClient();

  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, estado, action_token, resultado_cierre")
    .eq("id", leadId)
    .maybeSingle();

  // Lead inexistente y token equivocado responden igual: así el enlace no
  // confirma si ese lead existe.
  if (error || !lead || !igualSeguro(token, lead.action_token as string)) {
    redirect(`/cierre/${leadId}?error=invalido`);
  }

  const parametros = new URLSearchParams({ token, resultado, rol });
  const previo = lead.resultado_cierre as ResultadoCierre | null;

  // Ya estaba cerrado: se vuelve a la página, que muestra el desenlace vigente.
  if (previo && TERMINALES.includes(previo)) {
    redirect(`/cierre/${leadId}?${parametros.toString()}`);
  }

  const estadoNuevo = ESTADO_POR_RESULTADO[resultado];

  const { error: errorUpdate } = await supabase
    .from("leads")
    .update({ resultado_cierre: resultado, estado: estadoNuevo })
    .eq("id", leadId);

  if (errorUpdate) {
    console.error("registrarCierre:", errorUpdate.message);
    redirect(`/cierre/${leadId}?${parametros.toString()}&error=fallo`);
  }

  // `rol` sale de la URL del correo: es una atribución declarada, no verificada.
  // El mismo `action_token` le sirve al cliente y al vendedor, así que esto dice
  // a quién se le preguntó, no prueba quién contestó.
  const { error: errorEvento } = await supabase.from("lead_eventos").insert({
    lead_id: leadId,
    estado_anterior: lead.estado,
    estado_nuevo: estadoNuevo,
    nota: `Desenlace "${resultado}" registrado desde el enlace de verificación (${rol}).`,
  });

  if (errorEvento) console.error("registrarCierre (evento):", errorEvento.message);

  revalidatePath("/panel");
  revalidatePath(`/panel/leads/${leadId}`);

  redirect(`/cierre/${leadId}?${parametros.toString()}&hecho=1`);
}
