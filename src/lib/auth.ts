import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type UsuarioPanel = {
  id: string;
  email: string;
};

/**
 * Guard de página. El proxy ya redirige a quien no tiene sesión, pero cada
 * página del panel vuelve a verificar: una configuración mal hecha del matcher
 * no debería alcanzar para exponer datos.
 */
export async function requireUsuario(): Promise<UsuarioPanel> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/panel/login");

  return { id: user.id, email: user.email ?? "" };
}
