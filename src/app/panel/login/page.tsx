import { Suspense } from "react";
import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Ingresar — Panel Mister Precios",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-5 py-10">
      <p className="eyebrow">Mister Precios</p>
      <h1 className="mb-6 mt-2 text-2xl font-semibold">Panel interno</h1>
      {/* LoginForm lee ?volverA con useSearchParams, que obliga a un límite de
          Suspense para que el resto de la página siga siendo estática. */}
      <Suspense fallback={<div className="card h-64" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
