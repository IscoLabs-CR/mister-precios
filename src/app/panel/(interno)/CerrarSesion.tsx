"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function CerrarSesion() {
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    await createClient().auth.signOut();
    router.push("/panel/login");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={salir}
      disabled={saliendo}
      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/50 hover:text-ink disabled:opacity-60"
    >
      {saliendo ? "Saliendo…" : "Salir"}
    </button>
  );
}
