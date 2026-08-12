import type { Config } from "tailwindcss";

// Paleta tomada de misterprecios.com (tema Betheme) para que el sistema y el
// sitio público se lean como la misma marca. Los hex son los que sirve el sitio,
// salvo `brand.tint`, que ellos no definen y acá se deriva del azul al 10%.
//
// Contraste AA verificado:
//   ink #101828 sobre paper #F7F7F7    -> 16.6:1
//   muted #4A5565 sobre paper          ->  7.1:1
//   brand #165DFC sobre paper          ->  4.9:1
//   blanco sobre brand #165DFC         ->  5.2:1  (AA, no AAA — es su botón)
//   brand.deep sobre brand.tint        -> 10.6:1
//   alerta sobre alerta.tint           ->  7.0:1
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F7F7F7",
        ink: "#101828",
        muted: "#4A5565",
        line: "#ECECEC",
        brand: {
          DEFAULT: "#165DFC",
          deep: "#28325F",
          tint: "#E8EFFF",
        },
        alerta: {
          DEFAULT: "#962317",
          tint: "#FAE9E8",
        },
      },
      fontFamily: {
        sans: ["var(--font-poppins)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        formulario: "34rem",
      },
    },
  },
  plugins: [],
};

export default config;
