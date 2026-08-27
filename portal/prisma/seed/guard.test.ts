import { describe, expect, it } from "vitest";
import { assertDemoSeedAllowed } from "./guard";

describe("assertDemoSeedAllowed", () => {
  it("throws when NODE_ENV is production, even with ALLOW_DEMO_SEED set", () => {
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: "production", ALLOW_DEMO_SEED: "true" })
    ).toThrow(/production/i);
  });

  it("throws when ALLOW_DEMO_SEED is not exactly 'true'", () => {
    expect(() => assertDemoSeedAllowed({ NODE_ENV: "development" })).toThrow(
      /ALLOW_DEMO_SEED/
    );
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: "development", ALLOW_DEMO_SEED: "1" })
    ).toThrow(/ALLOW_DEMO_SEED/);
  });

  it("allows demo seeding only outside production with the flag explicitly set", () => {
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: "development", ALLOW_DEMO_SEED: "true" })
    ).not.toThrow();
    expect(() =>
      assertDemoSeedAllowed({ NODE_ENV: "staging", ALLOW_DEMO_SEED: "true" })
    ).not.toThrow();
  });

  // Session 16 — DATABASE_URL is checked independently of NODE_ENV, closing
  // the gap flagged in status/project-status.md's Session 15 handoff: a
  // developer with prod DB access but NODE_ENV unset was not previously
  // blocked.
  it("throws when DATABASE_URL matches the production role naming convention, even with NODE_ENV unset", () => {
    expect(() =>
      assertDemoSeedAllowed({
        ALLOW_DEMO_SEED: "true",
        DATABASE_URL: "postgresql://kf_portal_prod_migrator:x@postgres01/portal",
      })
    ).toThrow(/production/i);
    expect(() =>
      assertDemoSeedAllowed({
        NODE_ENV: "development",
        ALLOW_DEMO_SEED: "true",
        DATABASE_URL: "postgresql://kf_portal_prod_app:x@postgres01/portal",
      })
    ).toThrow(/production/i);
  });

  it("does not throw on a DATABASE_URL that doesn't match the production naming convention", () => {
    expect(() =>
      assertDemoSeedAllowed({
        NODE_ENV: "development",
        ALLOW_DEMO_SEED: "true",
        DATABASE_URL: "postgresql://postgres:devpass@localhost:55432/portal_dev",
      })
    ).not.toThrow();
  });
});
