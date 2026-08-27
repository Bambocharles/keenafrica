import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    // `.next/` (a gitignored `next build` artifact) copies the whole
    // `src/` tree — including every *.test.ts file — into
    // `.next/standalone/src/**` for the production server bundle. Vitest's
    // default excludes don't know about this Next.js-specific directory, so
    // after any local `npm run build`, every test file was being collected
    // and run TWICE (once from src/, once from the stale build copy) —
    // both copies racing against the same shared dev database. Discovered
    // via a hardcoded-literal test in users.test.ts colliding with its own
    // concurrent duplicate (two "Zephyrine Uncommon Name" rows instead of
    // one) — this was also the actual cause of the "flaky"
    // setFeatureFlag — authorization boundary" failures Session 13's
    // handoff flagged as unexplained, not a real timing bug in that file.
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
  },
});
