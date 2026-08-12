import { globalIgnores } from "eslint/config";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next 16 ya exporta flat config. No usar FlatCompat con él:
// la combinación revienta con "Converting circular structure to JSON".
const eslintConfig = [
  // supabase/ es SQL y (a futuro) Deno; no lo toca el linter de Next.
  globalIgnores([".next/**", "node_modules/**", "supabase/**"]),
  ...coreWebVitals,
  ...typescript,
];

export default eslintConfig;
