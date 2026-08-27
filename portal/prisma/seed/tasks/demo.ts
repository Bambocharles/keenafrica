import type { SeedTask } from "../types";
import { runDemoSeed } from "./demo/index";

// The canonical demo/test dataset (testing/demo-data.md), Session 15 —
// Demo & Test Environment. Implementation lives under ./demo/ (identity,
// content, activity, messaging, sponsor) since the full canonical universe
// spans every module; this file stays a single "demo" SeedTask per
// docs/SEED_FRAMEWORK.md's convention.
//
// The runner (../index.ts) already refuses to run "demo" tasks unless
// ALLOW_DEMO_SEED=true and NODE_ENV !== "production", so this task itself
// doesn't need to re-check environment. runDemoSeed() itself refuses to run
// a second time on top of already-present demo data (see ./demo/index.ts) —
// use `npm run demo:reset` to wipe and recreate instead.
export const demoTask: SeedTask = {
  name: "demo",
  kind: "demo",
  async run() {
    await runDemoSeed();
  },
};
