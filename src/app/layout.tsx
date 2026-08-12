import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";

// Poppins es la tipografía de misterprecios.com. No es variable en Google
// Fonts, así que cada peso es un archivo aparte: se piden solo los cuatro que
// usa el sistema (normal, medium, semibold y el bold de `<strong>`).
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mister Precios",
  description:
    "Te buscamos un mejor precio en nuestra red de tiendas aliadas.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#165DFC",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={poppins.variable}>
      <body>{children}</body>
    </html>
  );
}
