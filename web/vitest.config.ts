import path from "node:path";
import { defineConfig } from "vitest/config";

// Mirrors tsconfig.json's "@/*" path alias so tests can import components
// that follow the shadcn `@/lib/utils` convention (Story 3.5 introduced it).
// Timezone and locale are pinned. Several `lib/sets` helpers bucket by LOCAL
// calendar date (`localDayKey`, `localMonthKey`, `localWeekKey`) and format
// via `toLocaleDateString`, so their output — and the assertions over it —
// depend on the machine running the suite. Unpinned, this suite passed here
// and under TZ=UTC/Asia/Tokyo while failing 4 tests under
// TZ=Pacific/Kiritimati and 20 under LC_ALL=de-DE, which made a green gate
// mean "green on this laptop". Pinning makes the run reproducible; it does
// NOT fix the underlying server-timezone/locale exposure in the app itself
// (tracked separately in the story's review findings and deferred-work.md).
export default defineConfig({
  test: {
    env: {
      TZ: "UTC",
      LANG: "en-US",
      LC_ALL: "en-US",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
