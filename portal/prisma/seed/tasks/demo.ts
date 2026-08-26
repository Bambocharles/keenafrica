import type { SeedTask } from "../types";

// Placeholder for the canonical demo/test dataset (testing/demo-data.md),
// owned by Session 15 — Demo & Test Environment. Do not fill this in from
// another session; that recreates exactly the "unrelated sample data
// invented in a feature branch" problem CLAUDE_BUILD_RULES.md warns about.
//
// The runner (../index.ts) already refuses to run "demo" tasks unless
// ALLOW_DEMO_SEED=true and NODE_ENV !== "production", so this task itself
// doesn't need to re-check environment — it only needs to exist so
// `npm run seed:demo` has somewhere to plug in.
export const demoTask: SeedTask = {
  name: "demo",
  kind: "demo",
  async run() {
    throw new Error(
      "Demo dataset not implemented yet — owned by Session 15 (Demo & Test Environment). " +
        "See testing/demo-data.md for the canonical dataset this task should create."
    );
  },
};
