"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  async function alEnviar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setEntrando(true);

    const datos = new FormData(event.currentTarget);
    const email = String(datos.get("email") ?? "").trim();
    const password = String(datos.get("password") ?? "");

    const supabase = createClient();
    const { error: errorAuth } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (errorAuth) {
      // Mensaje genérico a propósito: distinguir "no existe" de "clave mala"
      // le confirmaría a un atacante qué correos están dados de alta.
      setError("Correo o contraseña incorrectos.");
      setEntrando(false);
      return;
    }

    const volverA = searchParams.get("volverA");
    router.push(volverA?.startsWith("/panel") ? volverA : "/panel");
    router.refresh();
  }

  return (
    <form onSubmit={alEnviar} className="card space-y-4">
      <div>
        <label htmlFor="email" className="etiqueta">
          Correo
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          className="campo"
        />
      </div>

      <div>
        <label htmlFor="password" className="etiqueta">
          Contraseña
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="campo"
        />
      </div>

      {error && (
        <p
          className="rounded-xl bg-alerta-tint px-4 py-3 text-sm text-alerta"
          role="alert"
        >
          {error}
        </p>
      )}

      <button type="submit" className="btn-primario" disabled={entrando}>
        {entrando ? "Entrando…" : "Ingresar"}
      </button>
    </form>
  );
}
