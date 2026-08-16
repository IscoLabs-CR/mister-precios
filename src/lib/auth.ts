import "server-only";
import { redirect } from "next/navigation";
import { esEmailAutorizado } from "./acceso";
import { createClient } from "./supabase/server";

export type UsuarioPanel = {
  id: string;
  email: string;
};

/**
 * Guard de página y de Server Action. El proxy ya filtra, pero cada página del
 * panel y cada acción vuelven a verificar: una configuración mal hecha del
 * matcher no debería alcanzar para exponer datos.
 *
 * Se comprueban las dos cosas por separado, y las dos importan:
 *   - que haya sesión (quién es);
 *   - que esa cuenta esté habilitada para el panel (si puede estar acá).
 * La segunda es la que impide que un alta pública de Supabase Auth se
 * convierta en acceso al panel. Ver `lib/acceso.ts`.
 */
export async function requireUsuario(): Promise<UsuarioPanel> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/panel/login");

  if (!esEmailAutorizado(user.email)) {
    console.error(
      `requireUsuario: ${user.email ?? user.id} tiene sesión pero no está autorizado.`,
    );
    redirect("/panel/login?error=sin_acceso");
  }

  return { id: user.id, email: user.email ?? "" };
}
