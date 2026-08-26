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
});
