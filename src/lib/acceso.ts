import "server-only";

/**
 * Quién puede entrar al panel.
 *
 * EL PROBLEMA QUE RESUELVE:
 *
 * Hasta acá, la única condición para entrar era "tener una sesión válida de
 * Supabase Auth". Eso alcanza mientras las cuentas se creen a mano desde el
 * dashboard, pero no es una autorización: un proyecto de Supabase viene con el
 * alta pública de usuarios HABILITADA por defecto, y la publishable key está,
 * por diseño, en el JavaScript que sirve el sitio. Con esas dos cosas,
 * cualquiera en internet puede llamar a `signUp()`, confirmarse el correo solo
 * y quedar con una sesión que el proxy y `requireUsuario()` aceptaban como
 * buena — y del otro lado el panel lee con `service_role`, que se salta RLS.
 * El premio era la base entera de leads: nombre, correo y teléfono de cada
 * cliente, más los contactos de los vendedores.
 *
 * Cerrar el alta en el dashboard de Supabase también lo arregla, y hay que
 * hacerlo igual (queda en el informe). Esta lista es la defensa que NO depende
 * de que alguien se acuerde de tocar esa casilla, ni de que un rollback de
 * configuración la vuelva a abrir.
 *
 * FALLA CERRADA: sin la variable configurada no entra NADIE. Es a propósito.
 * Un panel que no abre se nota en el primer login y se arregla en un minuto;
 * uno que deja pasar a cualquiera no se nota nunca.
 */

const VARIABLE = "PANEL_EMAILS_AUTORIZADOS";

/** Correos habilitados, normalizados. Vacío = nadie. */
export function emailsAutorizados(): string[] {
  return (process.env[VARIABLE] ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function esEmailAutorizado(email: string | null | undefined): boolean {
  if (!email) return false;

  const lista = emailsAutorizados();

  if (lista.length === 0) {
    console.error(
      `${VARIABLE} no está configurada: el panel queda cerrado para todos.`,
    );
    return false;
  }

  return lista.includes(email.trim().toLowerCase());
}
