import Link from "next/link";
import { requireUsuario } from "@/lib/auth";
import CerrarSesion from "./CerrarSesion";
import Navegacion from "./Navegacion";

export const dynamic = "force-dynamic";

export default async function LayoutPanel({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // El proxy ya bloqueó a los anónimos; esto es el segundo cerrojo.
  const usuario = await requireUsuario();

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link href="/panel" className="min-w-0">
            <span className="eyebrow">Mister Precios</span>
            <span className="block text-sm font-semibold">Panel interno</span>
          </Link>
          <div className="flex items-center gap-3">
            <Navegacion />
            <span className="hidden truncate text-xs text-muted sm:block">
              {usuario.email}
            </span>
            <CerrarSesion />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>
    </div>
  );
}
