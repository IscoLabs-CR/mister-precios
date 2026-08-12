"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const SECCIONES = [
  { href: "/panel", etiqueta: "Leads" },
  { href: "/panel/vendedores", etiqueta: "Vendedores" },
] as const;

export default function Navegacion() {
  const ruta = usePathname();

  return (
    <nav className="flex items-center gap-1" aria-label="Secciones del panel">
      {SECCIONES.map(({ href, etiqueta }) => {
        // "/panel" solo se marca activo en su propia ruta; el detalle de un
        // lead (/panel/leads/…) cuelga de él y sí lo hereda.
        const activo =
          href === "/panel"
            ? ruta === "/panel" || ruta.startsWith("/panel/leads")
            : ruta.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            aria-current={activo ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              activo
                ? "bg-brand-tint text-brand-deep"
                : "text-muted hover:text-ink"
            }`}
          >
            {etiqueta}
          </Link>
        );
      })}
    </nav>
  );
}
