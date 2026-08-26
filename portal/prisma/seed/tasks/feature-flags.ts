import { FEATURE_FLAGS } from "@/lib/feature-flags";
import type { SeedTask } from "../types";

// Default flag rows from PLATFORM_ARCHITECTURE.md section 12. All disabled
// until the owning session/module is ready to turn them on. Safe for any
// environment — this is configuration, not demo data.
const DEFAULT_FLAGS: Array<{ key: string; description: string }> = [
  { key: FEATURE_FLAGS.MESSAGING, description: "Platform messaging between roles" },
  { key: FEATURE_FLAGS.CERTIFICATES, description: "Certificate issuance on course completion" },
  { key: FEATURE_FLAGS.SPONSOR_REPORTING, description: "Sponsor-facing impact/reporting views" },
  { key: FEATURE_FLAGS.ADAPTIVE_RECOMMENDATIONS, description: "Adaptive learning recommendations" },
  { key: FEATURE_FLAGS.AI_TUTORING, description: "AI tutoring assistant" },
  { key: FEATURE_FLAGS.UTME_FEATURES, description: "Future UTME-specific features" },
];

export const featureFlagsTask: SeedTask = {
  name: "feature-flags",
  kind: "core",
  async run(prisma) {
    for (const flag of DEFAULT_FLAGS) {
      await prisma.featureFlag.upsert({
        where: { key: flag.key },
        update: { description: flag.description },
        create: { ...flag, enabled: false },
      });
    }
    console.log(`[feature-flags] ${DEFAULT_FLAGS.length} default flag(s) present.`);
  },
};
