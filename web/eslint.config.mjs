import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored verbatim from the React Bits shadcn registry (dashboard
    // redesign D2 — "references are law"): its useMemo-uniforms mutation is
    // the standard react-three-fiber pattern, not ours to rewrite.
    "app/components/Silk.jsx",
  ]),
]);

export default eslintConfig;
