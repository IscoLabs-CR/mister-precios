import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  listarCotizacionesSinAsignar,
  listarVendedoresActivos,
  obtenerDetalleLead,
} from "@/lib/panel/consultas";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  BUCKET_COTIZACIONES,
  BUCKET_FOTOS,
  firmarUrls,
  firmarUrlsPorRuta,
} from "@/lib/storage";
import { formatearFechaCR, formatearMoneda } from "@/lib/formato";
import {
  ESTADOS_CERRADOS,
  infoEstado,
  motivoAccion,
  type MotivoAccion,
} from "@/lib/estados";
import { ETIQUETA_CATEGORIA } from "@/lib/tipos";
import Badge from "@/components/Badge";
import {
  AsignarVendedor,
  BorradorCorreo,
  CargarCotizacion,
  VincularCotizacion,
} from "./AccionesLead";

export const metadata: Metadata = {
  title: "Detalle del lead — Panel Mister Precios",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Las URLs firmadas del panel duran poco: se regeneran en cada carga. */
const VIGENCIA_URL = 60 * 15;

export default async function DetalleLeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detalle = await obtenerDetalleLead(id);
  if (!detalle) notFound();

  const { lead, vendedor, eventos, cotizaciones } = detalle;
  const motivo = motivoAccion(lead);

  const supabase = createAdminClient();
  // Los vendedores se cargan siempre: la asignación es manual y se puede
  // cambiar en cualquier momento, incluso después de haber enviado el correo.
  const [urlsFotos, vendedores, cotizacionesSueltas] = await Promise.all([
    firmarUrls(supabase, BUCKET_FOTOS, lead.fotos_urls, VIGENCIA_URL),
    listarVendedoresActivos(),
    motivo ? listarCotizacionesSinAsignar() : Promise.resolve([]),
  ]);

  const rutasCotizaciones = cotizaciones
    .map((c) => c.archivo_url)
    .filter((ruta): ruta is string => Boolean(ruta));
  const urlsCotizaciones = await firmarUrlsPorRuta(
    supabase,
    BUCKET_COTIZACIONES,
    rutasCotizaciones,
    VIGENCIA_URL,
  );

  return (
    <>
      <Link href="/panel" className="text-sm text-muted hover:text-ink">
        ← Volver a los leads
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{lead.lead_code}</h1>
        <Badge estado={lead.estado} />
      </div>

      {motivo && (
        <p className="mt-3 rounded-xl bg-alerta-tint px-4 py-3 text-sm text-alerta">
          {textoMotivo(motivo, lead.estado)}
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="card">
            <h2 className="mb-3 text-sm font-semibold">Solicitud del cliente</h2>
            <dl className="space-y-3 text-sm">
              <Dato etiqueta="Cliente" valor={lead.nombre} />
              <Dato
                etiqueta="Correo"
                valor={
                  <a href={`mailto:${lead.email}`} className="text-brand hover:underline">
                    {lead.email}
                  </a>
                }
              />
              <Dato etiqueta="Teléfono" valor={lead.telefono ?? "—"} />
              <Dato
                etiqueta="Tipo de producto"
                valor={
                  lead.categoria ? ETIQUETA_CATEGORIA[lead.categoria] : "—"
                }
              />
              <Dato etiqueta="Producto (texto original)" valor={lead.producto_texto} />
              <Dato
                etiqueta="Producto normalizado"
                valor={
                  lead.producto_normalizado ? (
                    `${lead.producto_normalizado.marca} ${lead.producto_normalizado.modelo}${
                      lead.producto_normalizado.variante
                        ? ` · ${lead.producto_normalizado.variante}`
                        : ""
                    }`
                  ) : (
                    <span className="text-alerta">
                      Sin normalizar — la IA no pudo identificar el producto.
                    </span>
                  )
                }
              />
              <Dato
                etiqueta="Flexibilidad"
                valor={lead.flexible ? "Abierto a opciones similares" : "Solo este modelo"}
              />
              <Dato
                etiqueta="Precio que vio"
                valor={
                  lead.precio_visto !== null
                    ? formatearMoneda(lead.precio_visto, lead.moneda)
                    : "—"
                }
              />
              <Dato
                etiqueta="Link de referencia"
                valor={
                  lead.link_referencia ? (
                    <a
                      href={lead.link_referencia}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-brand hover:underline"
                    >
                      {lead.link_referencia}
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <Dato etiqueta="Creado" valor={formatearFechaCR(lead.created_at)} />
              {/* Un lead viejo no trae el dato porque la casilla no existía
                  cuando se envió: eso no es lo mismo que una negativa. */}
              <Dato
                etiqueta="Comparte sus datos"
                valor={
                  lead.consentimiento_contacto ? (
                    "Sí, autorizó que los vendedores lo contacten"
                  ) : (
                    <span className="text-muted">Sin registro de autorización</span>
                  )
                }
              />
            </dl>

            {urlsFotos.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                  Fotos ({urlsFotos.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {urlsFotos.map((url, i) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-lg border border-line"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={`Foto ${i + 1} del producto`}
                        className="h-24 w-24 object-cover"
                      />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>

          <BorradorCorreo
            leadId={lead.id}
            borradorInicial={lead.resumen_borrador ?? ""}
            actualizadoEn={
              lead.resumen_borrador_at
                ? formatearFechaCR(lead.resumen_borrador_at)
                : null
            }
            vendedor={
              vendedor
                ? { nombre_tienda: vendedor.nombre_tienda, email: vendedor.email }
                : null
            }
            emailCliente={lead.email}
            yaEnviado={Boolean(lead.fecha_enviado_vendedor)}
          />

          {cotizaciones.length > 0 && (
            <section className="card">
              <h2 className="mb-3 text-sm font-semibold">
                {cotizaciones.length > 1
                  ? `Cotizaciones recibidas (${cotizaciones.length})`
                  : "Cotización recibida"}
              </h2>
              {cotizaciones.map((c) => (
                <dl
                  key={c.id}
                  className="space-y-3 border-t border-line pt-3 text-sm first:border-0 first:pt-0"
                >
                  <Dato
                    etiqueta="Precio cotizado"
                    valor={
                      c.precio_cotizado !== null
                        ? formatearMoneda(c.precio_cotizado, "CRC")
                        : "—"
                    }
                  />
                  <Dato etiqueta="Condiciones" valor={c.condiciones ?? "—"} />
                  <Dato
                    etiqueta="Vigencia"
                    valor={c.vigencia_dias !== null ? `${c.vigencia_dias} días` : "—"}
                  />
                  <Dato etiqueta="Recibida" valor={formatearFechaCR(c.created_at)} />
                  <Dato
                    etiqueta="Documento"
                    valor={
                      c.archivo_url && urlsCotizaciones.get(c.archivo_url) ? (
                        <a
                          href={urlsCotizaciones.get(c.archivo_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand hover:underline"
                        >
                          Abrir original
                        </a>
                      ) : (
                        "—"
                      )
                    }
                  />
                </dl>
              ))}
            </section>
          )}

          {!ESTADOS_CERRADOS.includes(lead.estado) && (
            <CargarCotizacion
              leadId={lead.id}
              yaHayCotizacion={cotizaciones.length > 0}
            />
          )}
        </div>

        <div className="space-y-4">
          <section className="card">
            <h2 className="mb-3 text-sm font-semibold">Vendedor y precio</h2>
            <dl className="space-y-3 text-sm">
              <Dato etiqueta="Tienda candidata" valor={lead.tienda_candidata ?? "—"} />
              <Dato
                etiqueta="Vendedor asignado"
                valor={
                  vendedor ? (
                    <>
                      {vendedor.nombre_tienda}
                      <span className="block text-xs text-muted">{vendedor.email}</span>
                    </>
                  ) : (
                    <span className="text-alerta">Sin asignar</span>
                  )
                }
              />
              <Dato
                etiqueta="Precio a vencer"
                valor={
                  lead.precio_a_vencer !== null
                    ? formatearMoneda(lead.precio_a_vencer, "CRC")
                    : "—"
                }
              />
              <Dato
                etiqueta="Enviado al vendedor"
                valor={
                  lead.fecha_enviado_vendedor
                    ? formatearFechaCR(lead.fecha_enviado_vendedor)
                    : "Todavía no"
                }
              />
            </dl>

            <div className="mt-4 border-t border-line pt-4">
              <AsignarVendedor
                leadId={lead.id}
                vendedores={vendedores}
                vendedorActual={lead.vendedor_id}
              />
            </div>
          </section>

          <section className="card">
            <h2 className="mb-3 text-sm font-semibold">Historial</h2>
            {eventos.length === 0 ? (
              <p className="text-sm text-muted">Sin eventos registrados.</p>
            ) : (
              <ol className="space-y-3">
                {eventos.map((evento) => (
                  <li key={evento.id} className="border-l-2 border-line pl-3">
                    <p className="text-xs text-muted">
                      {formatearFechaCR(evento.created_at)}
                    </p>
                    {evento.estado_nuevo && (
                      <p className="mt-0.5 text-xs font-medium">
                        {evento.estado_anterior !== evento.estado_nuevo
                          ? `${infoEstado(evento.estado_anterior ?? "").etiqueta} → ${infoEstado(evento.estado_nuevo).etiqueta}`
                          : infoEstado(evento.estado_nuevo).etiqueta}
                      </p>
                    )}
                    {evento.nota && (
                      <p className="mt-0.5 text-xs leading-relaxed text-muted">
                        {evento.nota}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      <VincularCotizacion leadId={lead.id} cotizaciones={cotizacionesSueltas} />
    </>
  );
}

/**
 * Qué le falta a este lead, dicho en términos de lo que hay que hacer.
 *
 * `vendedor_no_asignado` dejó de ser una excepción: desde que la asignación es
 * manual, TODOS los leads pasan por acá, así que el mensaje tiene que leerse
 * como el paso siguiente y no como una alarma.
 */
function textoMotivo(motivo: MotivoAccion, estado: string): string {
  if (motivo === "sin_normalizar")
    return "La IA no pudo identificar el producto, así que este lead nunca se buscó en el catálogo. Revisá lo que escribió el cliente y seguí a mano: elegí el vendedor y armá el correo.";

  if (motivo === "sin_procesar")
    return "El producto se identificó, pero la búsqueda en el catálogo no llegó a terminar (no hay precio a vencer). El cron reintenta solo cada hora; si sigue acá, seguí a mano.";

  if (estado === "vendedor_no_asignado")
    return "Falta elegir a qué vendedor se le manda. Seleccionalo de la lista, generá el borrador del correo y enviálo.";

  return "Este lead está esperando una acción manual.";
}

function Dato({
  etiqueta,
  valor,
}: {
  etiqueta: string;
  valor: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="text-xs text-muted">{etiqueta}</dt>
      <dd className="text-ink">{valor}</dd>
    </div>
  );
}
