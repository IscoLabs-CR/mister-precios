import Link from "next/link";
import type { Metadata } from "next";
import { listarLeads, obtenerMetricas } from "@/lib/panel/consultas";
import { ESTADOS } from "@/lib/tipos";
import { INFO_ESTADO, requiereAccion } from "@/lib/estados";
import Badge from "@/components/Badge";
import { formatearFechaCR, formatearMoneda } from "@/lib/formato";

export const metadata: Metadata = {
  title: "Leads — Panel Mister Precios",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ estado?: string; q?: string }>;
};

export default async function PanelPage({ searchParams }: Props) {
  const { estado = "", q = "" } = await searchParams;

  const [metricas, leads] = await Promise.all([
    obtenerMetricas(),
    listarLeads({ estado, q }),
  ]);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metrica titulo="Leads activos" valor={metricas.activos} />
        <Metrica titulo="Cotizados esta semana" valor={metricas.cotizadosSemana} />
        <Metrica
          titulo="Requieren acción"
          valor={metricas.requierenAccion}
          alerta={metricas.requierenAccion > 0}
        />
      </div>

      <form method="get" className="mt-6 flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Buscar por nombre o código (LEAD-0001)"
          aria-label="Buscar leads"
          className="campo flex-1"
        />
        <select
          name="estado"
          defaultValue={estado}
          aria-label="Filtrar por estado"
          className="campo sm:w-56"
        >
          <option value="">Todos los estados</option>
          {ESTADOS.map((valor) => (
            <option key={valor} value={valor}>
              {INFO_ESTADO[valor].etiqueta}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink/85 sm:w-auto"
        >
          Filtrar
        </button>
        {(estado || q) && (
          <Link
            href="/panel"
            className="flex items-center justify-center rounded-xl border border-line px-5 py-3 text-sm font-medium text-muted hover:text-ink"
          >
            Limpiar
          </Link>
        )}
      </form>

      <div className="card mt-4 !p-0">
        {leads.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">
            {estado || q
              ? "Ningún lead coincide con el filtro."
              : "Todavía no hay leads."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Código</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Producto</th>
                  <th className="px-4 py-3 font-medium">Vendedor</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 text-right font-medium">Creado</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => {
                  const destacado = requiereAccion(lead);
                  const producto = lead.producto_normalizado
                    ? `${lead.producto_normalizado.marca} ${lead.producto_normalizado.modelo}`
                    : lead.producto_texto;

                  return (
                    <tr
                      key={lead.id}
                      className={`border-b border-line/70 last:border-0 hover:bg-paper ${
                        destacado ? "bg-alerta-tint/40" : ""
                      }`}
                    >
                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/panel/leads/${lead.id}`}
                          className="font-medium text-brand hover:underline"
                        >
                          {lead.lead_code}
                        </Link>
                      </td>
                      <td className="px-4 py-3 align-top">{lead.nombre}</td>
                      <td className="max-w-[18rem] px-4 py-3 align-top">
                        <span className="block truncate" title={producto}>
                          {producto}
                        </span>
                        {lead.precio_a_vencer !== null && (
                          <span className="text-xs text-muted">
                            a vencer {formatearMoneda(lead.precio_a_vencer, "CRC")}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {lead.vendedores?.nombre_tienda ?? (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <Badge estado={lead.estado} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right align-top text-xs text-muted">
                        {formatearFechaCR(lead.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {leads.length >= 200 && (
        <p className="mt-3 text-xs text-muted">
          Mostrando los 200 más recientes. Afiná la búsqueda para ver el resto.
        </p>
      )}
    </>
  );
}

function Metrica({
  titulo,
  valor,
  alerta = false,
}: {
  titulo: string;
  valor: number;
  alerta?: boolean;
}) {
  return (
    <div className={`card ${alerta ? "border-alerta/40 bg-alerta-tint" : ""}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {titulo}
      </p>
      <p
        className={`mt-1 text-3xl font-semibold ${alerta ? "text-alerta" : "text-ink"}`}
      >
        {valor}
      </p>
    </div>
  );
}
