import type { Metadata } from "next";
import { listarVendedores } from "@/lib/panel/consultas";
import { formatearFechaCR } from "@/lib/formato";
import NuevoVendedor from "./NuevoVendedor";

export const metadata: Metadata = {
  title: "Vendedores — Panel Mister Precios",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function VendedoresPage() {
  const vendedores = await listarVendedores();

  return (
    <>
      <h1 className="text-2xl font-semibold">Vendedores aliados</h1>
      <p className="mt-1 text-sm text-muted">
        La red de tiendas a las que se les manda cada oportunidad.
      </p>

      <div className="mt-5">
        <NuevoVendedor />
      </div>

      <div className="card mt-4 !p-0">
        {vendedores.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">
            Todavía no hay vendedores registrados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">Empresa</th>
                  <th className="px-4 py-3 font-medium">Contacto</th>
                  <th className="px-4 py-3 font-medium">Correo</th>
                  <th className="px-4 py-3 font-medium">Teléfono</th>
                  <th className="px-4 py-3 text-right font-medium">Agregado</th>
                </tr>
              </thead>
              <tbody>
                {vendedores.map((vendedor) => (
                  <tr
                    key={vendedor.id}
                    className={`border-b border-line/70 last:border-0 hover:bg-paper ${
                      vendedor.activo ? "" : "opacity-60"
                    }`}
                  >
                    <td className="px-4 py-3 align-top font-medium">
                      {vendedor.nombre_tienda}
                      {!vendedor.activo && (
                        <span className="ml-2 rounded-full bg-line px-2 py-0.5 text-xs font-normal text-muted">
                          inactivo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {vendedor.nombre_contacto ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <a
                        href={`mailto:${vendedor.email}`}
                        className="text-brand hover:underline"
                      >
                        {vendedor.email}
                      </a>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {vendedor.telefono ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right align-top text-xs text-muted">
                      {formatearFechaCR(vendedor.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
