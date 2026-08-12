import { NextResponse } from "next/server";
import {
  barrerRecordatorios24h,
  barrerVerificaciones72h,
} from "@/lib/flujo/alertas";
import { barrerLeadsAtascados } from "@/lib/flujo/procesar";
import { igualSeguro } from "@/lib/seguridad";

/**
 * UN SOLO endpoint para las dos alertas programadas y el reproceso de leads.
 *
 * No son dos endpoints porque la cantidad de cron jobs es un recurso limitado
 * del plan de Vercel (el plan Hobby permite pocos y con granularidad diaria).
 * Los dos barridos son independientes entre sí, comparten esta autorización y
 * corren en milisegundos, así que separarlos solo gastaría cupo.
 *
 * La cadencia vive en `vercel.json`. Está en cada hora, pero los umbrales son
 * de 24h y 72h: si el plan no admite crons horarios, una corrida diaria cumple
 * igual el requisito, solo que la alerta puede salir hasta un día más tarde.
 *
 * Vercel Cron manda `Authorization: Bearer $CRON_SECRET` automáticamente
 * cuando la variable está definida en el proyecto.
 */

export const dynamic = "force-dynamic";

/**
 * Los barridos de alertas topan en 50 leads cada uno y corren en milisegundos.
 * El que manda acá es el de reproceso: consulta el catálogo externo, así que
 * topa en 5 leads (~5s cada uno) para caber en este techo.
 */
export const maxDuration = 60;

function autorizado(request: Request): boolean {
  const secreto = process.env.CRON_SECRET;

  // Sin secreto configurado el endpoint queda cerrado, no abierto. Un cron que
  // no corre se nota; uno que cualquiera puede disparar, no.
  if (!secreto) {
    console.error("/api/cron/alertas: falta CRON_SECRET en el entorno.");
    return false;
  }

  const cabecera = request.headers.get("authorization") ?? "";
  return igualSeguro(cabecera, `Bearer ${secreto}`);
}

export async function GET(request: Request) {
  if (!autorizado(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  // Tocan conjuntos de leads disjuntos (`nuevo`, `enviado_vendedor` y
  // `cotizado`), así que no hay riesgo de que se pisen.
  const [recordatorios, verificaciones, reproceso] = await Promise.all([
    barrerRecordatorios24h(),
    barrerVerificaciones72h(),
    barrerLeadsAtascados(),
  ]);

  return NextResponse.json({
    ok: true,
    corrida: new Date().toISOString(),
    recordatorios,
    verificaciones,
    reproceso,
  });
}
