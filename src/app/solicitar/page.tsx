import type { Metadata } from "next";
import SolicitudForm from "./SolicitudForm";

export const metadata: Metadata = {
  title: "Pedir cotización — Mister Precios",
  description:
    "Contanos qué producto buscás y te conseguimos un mejor precio en nuestra red de tiendas aliadas.",
};

export default function SolicitarPage() {
  return (
    <main className="mx-auto w-full max-w-formulario px-4 py-8 sm:px-5 sm:py-12">
      <header className="mb-6">
        <p className="eyebrow">Mister Precios</p>
        <h1 className="mt-2 text-2xl font-semibold leading-tight sm:text-3xl">
          Buscanos un mejor precio
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Contanos qué producto querés y a qué precio lo viste. Lo comparamos
          contra nuestra red de tiendas aliadas.
        </p>
      </header>

      <SolicitudForm />
    </main>
  );
}
