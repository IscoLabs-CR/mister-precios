import type { NextConfig } from "next";

const esProduccion = process.env.NODE_ENV === "production";

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
    ];
  },
};

export default nextConfig;
