import { afterEach, describe, expect, it } from "vitest";
import {
  FEATURE_FLAGS,
  isFeatureEnabled,
  _resetFeatureFlagCache,
} from "./feature-flags";

const ORIGINAL_OVERRIDES = process.env.FEATURE_FLAG_OVERRIDES;

afterEach(() => {
  process.env.FEATURE_FLAG_OVERRIDES = ORIGINAL_OVERRIDES;
  _resetFeatureFlagCache();
});

describe("isFeatureEnabled", () => {
  it("honors FEATURE_FLAG_OVERRIDES without touching the database", async () => {
    process.env.FEATURE_FLAG_OVERRIDES = JSON.stringify({
      [FEATURE_FLAGS.MESSAGING]: true,
      [FEATURE_FLAGS.AI_TUTORING]: false,
    });

    await expect(isFeatureEnabled(FEATURE_FLAGS.MESSAGING)).resolves.toBe(true);
    await expect(isFeatureEnabled(FEATURE_FLAGS.AI_TUTORING)).resolves.toBe(
      false
    );
  });

  it("ignores malformed override JSON instead of throwing", async () => {
    process.env.FEATURE_FLAG_OVERRIDES = "{not json";
    // Falls through to the DB lookup path; DATABASE_URL in this test run
    // points at the local dev DB seeded with defaults (all disabled).
    await expect(
      isFeatureEnabled(FEATURE_FLAGS.MESSAGING)
    ).resolves.toBe(false);
  });
});
