import type { PrismaClient } from "@prisma/client";

export interface SeedTask {
  name: string;
  /**
   * "core"  — safe to run in any environment, including production.
   *           Must be idempotent and must never create fake business data.
   * "demo"  — synthetic/demo data. Never runs unless ALLOW_DEMO_SEED=true
   *           AND NODE_ENV !== "production" (enforced by the runner, not
   *           by individual tasks).
   */
  kind: "core" | "demo";
  run: (prisma: PrismaClient) => Promise<void>;
}
