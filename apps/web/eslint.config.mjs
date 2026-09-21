import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  { rules: { "react-hooks/set-state-in-effect": "off", "react-hooks/use-memo": "off", "@next/next/no-html-link-for-pages": "off" } },
  globalIgnores([".next/**", "next-env.d.ts"]),
]);
