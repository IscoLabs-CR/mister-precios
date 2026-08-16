import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { esEmailAutorizado } from "@/lib/acceso";

const RUTA_LOGIN = "/panel/login";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Tener sesión no es tener acceso: la cuenta además tiene que estar en la
  // lista del panel. Ver el porqué en `lib/acceso.ts`.
  const autorizado = esEmailAutorizado(user?.email);

  const ruta = request.nextUrl.pathname;
  const esAreaPanel = ruta.startsWith("/panel") && !ruta.startsWith(RUTA_LOGIN);

  if (esAreaPanel && !autorizado) {
    const url = request.nextUrl.clone();
    url.pathname = RUTA_LOGIN;
    url.search = "";

    if (user) {
      // Sesión buena, cuenta sin permiso. No se guarda `volverA`: no hay a
      // dónde volver, y el mensaje tiene que decir lo que pasa.
      url.searchParams.set("error", "sin_acceso");
    } else if (ruta !== "/panel") {
      // Para volver a donde quería entrar después de autenticarse.
      url.searchParams.set("volverA", ruta);
    }

    return NextResponse.redirect(url);
  }

  // Solo rebota fuera del login a quien de verdad puede pasar. Si acá se usara
  // `user` en vez de `autorizado`, una cuenta autenticada pero sin permiso
  // quedaría rebotando entre /panel y /panel/login para siempre.
  if (ruta.startsWith(RUTA_LOGIN) && autorizado) {
    const url = request.nextUrl.clone();
    url.pathname = "/panel";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
