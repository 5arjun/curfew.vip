import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirrors tsconfig.json's "@/*" path alias so tests can import components
// that follow the shadcn `@/lib/utils` convention (Story 3.5 introduced it).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
