import type { NextConfig } from "next";

const esProduccion = process.env.NODE_ENV === "production";

/**
 * Origen de Supabase, para no abrir la CSP a `*.supabase.co` entero.
 *
 * Del navegador salen dos cosas hacia ahí: las llamadas de Supabase Auth
 * (`connect-src`) y las fotos del panel, que se muestran con URLs firmadas del
 * bucket privado (`img-src`). Si la variable no está en el momento del build se
 * cae al comodín, que es más flojo pero no rompe la página.
 */
function origenSupabase(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "https://*.supabase.co";

  try {
    return new URL(url).origin;
  } catch {
    return "https://*.supabase.co";
  }
}

/**
 * `'unsafe-inline'` en `script-src` es una concesión conocida, no un descuido:
 * Next inyecta scripts de arranque e hidratación en línea, y sacarlo exige
 * pasar a nonces por request desde el proxy, lo que obliga a renderizar todo de
 * forma dinámica y le quita el cacheo estático a la landing pública. El riesgo
 * que deja es acotado: no hay un solo `dangerouslySetInnerHTML` en el proyecto
 * y React escapa todo lo que interpola, así que no hay por dónde inyectar el
 * script que esta directiva permitiría ejecutar.
 *
 * En `style-src` es directamente inevitable: lo piden `next/font` y los estilos
 * en línea que genera el framework.
 *
 * Lo que sí cierra de verdad, y es el motivo de la cabecera:
 *   - `frame-ancestors 'none'` mata el clickjacking (y reemplaza a X-Frame-Options).
 *   - `form-action 'self'` impide que un formulario inyectado postee a otro sitio.
 *   - `base-uri 'self'` frena el secuestro de rutas relativas vía <base>.
 *   - `object-src 'none'` saca del medio a Flash/applets y sus bypass.
 */
function politicaContenido(): string {
  const supabase = origenSupabase();

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase}`,
    "font-src 'self' data:",
    `connect-src 'self' ${supabase}`,
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // El default es 1 MB y no alcanza para el PDF de una cotización. El techo
      // real no es este: Vercel corta los cuerpos de petición cerca de 4.5 MB,
      // así que subir más acá no serviría de nada en producción. Tiene que
      // quedar alineado con MAX_BYTES_COTIZACION, que es el que da el mensaje
      // de error decente antes de que la plataforma responda un 413 mudo.
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    if (!esProduccion) return [];
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: politicaContenido() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // Solo estas dos ramas. La landing y /solicitar son páginas públicas
        // que el negocio quiere que se indexen; el panel y los enlaces de
        // cierre llevan datos de contacto de clientes reales, y que un buscador
        // los levante sería una filtración por la puerta de adelante.
        source: "/:ruta(panel|cierre)/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
