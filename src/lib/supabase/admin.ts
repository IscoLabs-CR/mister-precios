import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente con service role: bypassea RLS por completo.
 *
 * Es el ÚNICO camino de acceso a la base en toda la app. Las tablas tienen RLS
 * activo sin ninguna policy, así que ni anon ni authenticated pueden leer nada.
 * El `import "server-only"` hace que el build falle si esto llega a un
 * componente de cliente.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
