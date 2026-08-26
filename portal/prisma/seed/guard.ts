/**
 * Pulled out of index.ts so the safety rule (never run demo seed data
 * against production, never run it silently) is unit-testable without
 * spawning the CLI or touching a database.
 */
export function assertDemoSeedAllowed(
  env: Record<string, string | undefined>
): void {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run demo seed tasks with NODE_ENV=production."
    );
  }
  if (env.ALLOW_DEMO_SEED !== "true") {
    throw new Error(
      "Refusing to run demo seed tasks: set ALLOW_DEMO_SEED=true to confirm " +
        "this is a disposable development/staging database."
    );
  }
}
