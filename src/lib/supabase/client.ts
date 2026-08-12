import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente del navegador. Se usa SOLO para la sesión (login y logout).
 *
 * No sirve para leer datos: las tablas tienen RLS sin policies y además se les
 * revocaron los grants a `authenticated`, así que cualquier consulta desde acá
 * devuelve 401. Los datos del panel los trae el servidor con el service role.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
