import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  const ruta = request.nextUrl.pathname;
  const esAreaPanel = ruta.startsWith("/panel") && !ruta.startsWith(RUTA_LOGIN);

  if (esAreaPanel && !user) {
    const url = request.nextUrl.clone();
    url.pathname = RUTA_LOGIN;
    // Para volver a donde quería entrar después de autenticarse.
    if (ruta !== "/panel") url.searchParams.set("volverA", ruta);
    return NextResponse.redirect(url);
  }

  if (ruta.startsWith(RUTA_LOGIN) && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/panel";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
