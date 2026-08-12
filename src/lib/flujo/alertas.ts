import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "../supabase/admin";
import {
  plantillaRecordatorio24h,
  plantillaVerificacion72h,
} from "../correo/plantillas";
import { enviarCorreo } from "../correo/resend";
import type { Lead, RolCierre, Vendedor } from "../tipos";

/**
 * Los dos barridos programados del paso 5. Los invoca /api/cron/alertas.
 *
 * IDEMPOTENCIA — la regla de todo este archivo:
 *
 *   Se reserva la fila en `alertas_log` ANTES de mandar el correo, nunca
 *   después. El índice único (lead_id, tipo, destinatario) es lo único que
 *   impide el duplicado: si el insert pasa, nadie más mandó ese correo; si
 *   choca, ya salió. Al revés —mandar primero y loguear después— un timeout
 *   entre las dos operaciones duplica el correo en la siguiente corrida, y un
 *   vendedor recibiendo el mismo recordatorio cada hora es peor que uno que no
 *   lo recibe.
 *
 * Si el envío falla, la reserva se libera para que la próxima corrida
 * reintente. El costo de esa liberación es la única ventana de duplicado que
 * queda (falla el borrado justo después de un envío exitoso a medias), y es
 * mucho más angosta que la otra.
 */

const HORA = 60 * 60 * 1000;
const ESPERA_RECORDATORIO = 24 * HORA;
const ESPERA_VERIFICACION = 72 * HORA;

/**
 * Tope por corrida. Con el cron cada hora nunca se va a alcanzar; existe para
 * que un represamiento (la primera corrida después de un incidente) no agote
 * el tiempo de la función y deje todo a medias.
 */
const MAX_POR_CORRIDA = 50;

/** Código de Postgres para violación de índice único. */
const VIOLACION_UNICA = "23505";

type TipoAlerta = "recordatorio_24h" | "verificacion_72h";

/** Un lead con su vendedor ya embebido: evita el N+1 dentro del barrido. */
type LeadConVendedor = Lead & { vendedores: Vendedor | null };

export type ResumenBarrido = {
  /** Leads que cumplían la condición de tiempo. */
  revisados: number;
  /** Correos que salieron en esta corrida. */
  enviados: number;
  /** Ya estaban enviados, o el lead no tenía a quién escribirle. */
  omitidos: number;
  /** Falló el envío: quedan para la próxima corrida. */
  fallidos: number;
};

const RESUMEN_VACIO: ResumenBarrido = {
  revisados: 0,
  enviados: 0,
  omitidos: 0,
  fallidos: 0,
};

async function registrarEvento(
  supabase: SupabaseClient,
  leadId: string,
  estadoAnterior: string | null,
  estadoNuevo: string | null,
  nota: string,
): Promise<void> {
  const { error } = await supabase.from("lead_eventos").insert({
    lead_id: leadId,
    estado_anterior: estadoAnterior,
    estado_nuevo: estadoNuevo,
    nota,
  });

  if (error) console.error("registrarEvento (alertas):", error.message);
}

type Reserva = "nueva" | "duplicada" | "error";

/** Ver la nota de idempotencia arriba: esto va SIEMPRE antes del envío. */
async function reservarAlerta(
  supabase: SupabaseClient,
  leadId: string,
  tipo: TipoAlerta,
  destinatario: string,
): Promise<Reserva> {
  const { error } = await supabase
    .from("alertas_log")
    .insert({ lead_id: leadId, tipo, destinatario });

  if (!error) return "nueva";
  if (error.code === VIOLACION_UNICA) return "duplicada";

  console.error(`reservarAlerta (${tipo}, ${destinatario}):`, error.message);
  return "error";
}

/** Devuelve la reserva al pozo cuando el correo no salió. */
async function liberarAlerta(
  supabase: SupabaseClient,
  leadId: string,
  tipo: TipoAlerta,
  destinatario: string,
): Promise<void> {
  const { error } = await supabase
    .from("alertas_log")
    .delete()
    .eq("lead_id", leadId)
    .eq("tipo", tipo)
    .eq("destinatario", destinatario);

  if (error) {
    // La alerta queda reservada sin haberse enviado: ese lead pierde su
    // recordatorio. Es visible en el panel (el estado no avanzó) y es preferible
    // a arriesgar el duplicado.
    console.error(`liberarAlerta (${tipo}, ${destinatario}):`, error.message);
  }
}

// ---------------------------------------------------------------------------
// Recordatorio a las 24h
// ---------------------------------------------------------------------------

/**
 * Vendedores que recibieron el resumen hace más de 24h y todavía no cotizaron.
 *
 * La consulta calza exactamente con `leads_pendientes_recordatorio_idx`.
 */
export async function barrerRecordatorios24h(): Promise<ResumenBarrido> {
  const supabase = createAdminClient();
  const limite = new Date(Date.now() - ESPERA_RECORDATORIO).toISOString();

  const { data, error } = await supabase
    .from("leads")
    .select("*, vendedores(*)")
    .eq("estado", "enviado_vendedor")
    .eq("recordatorio_24h_enviado", false)
    .lte("fecha_enviado_vendedor", limite)
    .order("fecha_enviado_vendedor", { ascending: true })
    .limit(MAX_POR_CORRIDA);

  if (error) {
    console.error("barrerRecordatorios24h:", error.message);
    return RESUMEN_VACIO;
  }

  const leads = (data ?? []) as LeadConVendedor[];
  const resumen: ResumenBarrido = { ...RESUMEN_VACIO, revisados: leads.length };

  for (const lead of leads) {
    const vendedor = lead.vendedores;

    if (!vendedor?.email) {
      // No debería pasar: `enviado_vendedor` implica que hubo un vendedor. Si
      // pasa, el lead se queda donde está y se ve en el panel.
      console.error(
        `barrerRecordatorios24h: ${lead.lead_code} está enviado pero sin vendedor.`,
      );
      resumen.omitidos += 1;
      continue;
    }

    const reserva = await reservarAlerta(
      supabase,
      lead.id,
      "recordatorio_24h",
      vendedor.email,
    );

    if (reserva === "error") {
      resumen.fallidos += 1;
      continue;
    }

    if (reserva === "duplicada") {
      // El correo salió en una corrida anterior pero el flag no se movió (falló
      // el update después del envío). Se cura acá para sacarlo del barrido.
      await supabase
        .from("leads")
        .update({ recordatorio_24h_enviado: true })
        .eq("id", lead.id);
      resumen.omitidos += 1;
      continue;
    }

    const { asunto, html, texto } = plantillaRecordatorio24h(lead, vendedor);
    const envio = await enviarCorreo({ para: vendedor.email, asunto, html, texto });

    if (!envio.ok) {
      await liberarAlerta(supabase, lead.id, "recordatorio_24h", vendedor.email);
      await registrarEvento(
        supabase,
        lead.id,
        lead.estado,
        lead.estado,
        `Falló el recordatorio de 24h a ${vendedor.email}: ${envio.motivo}`,
      );
      resumen.fallidos += 1;
      continue;
    }

    const { error: errorUpdate } = await supabase
      .from("leads")
      .update({ recordatorio_24h_enviado: true })
      .eq("id", lead.id);

    if (errorUpdate) {
      // El correo ya salió y la reserva quedó puesta, así que la próxima corrida
      // entra por la rama `duplicada` y cura el flag. No se duplica nada.
      console.error(
        `barrerRecordatorios24h: ${lead.lead_code} enviado pero falló el update: ${errorUpdate.message}`,
      );
    }

    await registrarEvento(
      supabase,
      lead.id,
      lead.estado,
      lead.estado,
      `Recordatorio de 24h enviado a ${vendedor.email}.`,
    );
    resumen.enviados += 1;
  }

  return resumen;
}

// ---------------------------------------------------------------------------
// Verificación de cierre a las 72h
// ---------------------------------------------------------------------------

/**
 * Leads cotizados hace más de 72h que todavía no tienen desenlace registrado.
 *
 * La consulta calza exactamente con `leads_pendientes_verificacion_idx`.
 *
 * Va al cliente Y al vendedor, cada uno con su propia fila en `alertas_log`
 * (por eso el índice único incluye `destinatario`). `fecha_verificacion_enviada`
 * se sella solo cuando TODOS los destinatarios quedaron cubiertos: si uno falla,
 * el lead sigue en el barrido y la próxima corrida reintenta únicamente ese,
 * porque los que ya salieron chocan con el índice.
 */
export async function barrerVerificaciones72h(): Promise<ResumenBarrido> {
  const supabase = createAdminClient();
  const limite = new Date(Date.now() - ESPERA_VERIFICACION).toISOString();

  const { data, error } = await supabase
    .from("leads")
    .select("*, vendedores(*)")
    .eq("estado", "cotizado")
    .is("fecha_verificacion_enviada", null)
    .lte("fecha_cotizacion_recibida", limite)
    .order("fecha_cotizacion_recibida", { ascending: true })
    .limit(MAX_POR_CORRIDA);

  if (error) {
    console.error("barrerVerificaciones72h:", error.message);
    return RESUMEN_VACIO;
  }

  const leads = (data ?? []) as LeadConVendedor[];
  const resumen: ResumenBarrido = { ...RESUMEN_VACIO, revisados: leads.length };

  for (const lead of leads) {
    const vendedor = lead.vendedores;

    const destinatarios: { email: string; rol: RolCierre }[] = [
      { email: lead.email, rol: "cliente" },
    ];
    // Una cotización vinculada a mano puede colgar de un lead sin vendedor
    // asignado; en ese caso solo se le pregunta al cliente.
    if (vendedor?.email) {
      destinatarios.push({ email: vendedor.email, rol: "vendedor" });
    }

    let todosCubiertos = true;

    for (const { email, rol } of destinatarios) {
      const reserva = await reservarAlerta(
        supabase,
        lead.id,
        "verificacion_72h",
        email,
      );

      if (reserva === "error") {
        todosCubiertos = false;
        resumen.fallidos += 1;
        continue;
      }

      if (reserva === "duplicada") {
        resumen.omitidos += 1;
        continue;
      }

      const { asunto, html, texto } = plantillaVerificacion72h(lead, rol, vendedor);
      const envio = await enviarCorreo({ para: email, asunto, html, texto });

      if (!envio.ok) {
        await liberarAlerta(supabase, lead.id, "verificacion_72h", email);
        await registrarEvento(
          supabase,
          lead.id,
          lead.estado,
          lead.estado,
          `Falló la verificación de 72h a ${email} (${rol}): ${envio.motivo}`,
        );
        todosCubiertos = false;
        resumen.fallidos += 1;
        continue;
      }

      resumen.enviados += 1;
    }

    if (!todosCubiertos) continue;

    const { error: errorUpdate } = await supabase
      .from("leads")
      .update({ fecha_verificacion_enviada: new Date().toISOString() })
      .eq("id", lead.id);

    if (errorUpdate) {
      // Igual que en el barrido de 24h: las reservas quedaron puestas, así que
      // la próxima corrida entra toda por `duplicada` y sella la fecha sin
      // mandar nada de nuevo.
      console.error(
        `barrerVerificaciones72h: ${lead.lead_code} enviado pero falló el update: ${errorUpdate.message}`,
      );
      continue;
    }

    await registrarEvento(
      supabase,
      lead.id,
      lead.estado,
      lead.estado,
      `Verificación de 72h enviada a ${destinatarios.map((d) => d.email).join(" y ")}.`,
    );
  }

  return resumen;
}
