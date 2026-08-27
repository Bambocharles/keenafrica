import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Storage abstraction — Session 13 (Files & Content Assets),
 * PLATFORM_ARCHITECTURE.md §11: "Files should be abstracted behind an
 * Asset/File service. Do not couple business logic directly to a specific
 * object-storage vendor." src/lib/assets.ts is the ONLY caller of this
 * module; nothing else in the app should import it directly.
 *
 * `key` is always an opaque, server-generated identifier (a UUID —
 * src/lib/assets.ts never derives it from user input), never a
 * caller-supplied path — this is what makes path traversal structurally
 * impossible rather than something a filename sanitizer has to catch.
 *
 * Only a local-disk driver exists today. No object-storage bucket/
 * credential exists anywhere in this infra yet (see docs/ASSETS.md's
 * "Known limitations" — same shape as Session 02's missing email-provider
 * blocker) — provisioning one and adding an S3StorageDriver here is an
 * infra decision, not something this session can make unilaterally.
 * Swapping drivers means changing STORAGE_DRIVER + implementing
 * StorageDriver below; no domain model or caller of assets.ts changes.
 */
export interface StorageDriver {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

// turbopackIgnore: a bare process.cwd() here makes Next's file tracer
// conservatively bundle the entire project into .next/standalone (seen as
// a build warning: "Encountered unexpected file in NFT list") — this
// annotation is Next's documented escape hatch for that, since the actual
// path is resolved at runtime, not something the bundler needs to trace.
const LOCAL_ROOT =
  process.env.ASSET_STORAGE_LOCAL_ROOT ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "var", "asset-storage");

/**
 * Keys are opaque UUIDs (see above) — safe to join directly, but resolved
 * paths are still checked to land inside LOCAL_ROOT as a defense-in-depth
 * backstop against a future caller passing something unexpected.
 */
function resolveLocalPath(key: string): string {
  const resolvedRoot = path.resolve(LOCAL_ROOT);
  const resolvedPath = path.resolve(resolvedRoot, key);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return resolvedPath;
}

class LocalDiskStorageDriver implements StorageDriver {
  async put(key: string, data: Buffer): Promise<void> {
    const filePath = resolveLocalPath(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, data, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return readFile(resolveLocalPath(key));
  }

  async delete(key: string): Promise<void> {
    await rm(resolveLocalPath(key), { force: true });
  }
}

let driver: StorageDriver | undefined;

export function getStorageDriver(): StorageDriver {
  if (driver) return driver;

  const kind = process.env.STORAGE_DRIVER ?? "local";
  if (kind !== "local") {
    throw new Error(`Unsupported STORAGE_DRIVER "${kind}" — only "local" is implemented today (see docs/ASSETS.md).`);
  }
  driver = new LocalDiskStorageDriver();
  return driver;
}

/** Test-only: forces a fresh driver instance (e.g. a different LOCAL_ROOT per test file). */
export function __resetStorageDriverForTests(): void {
  driver = undefined;
}
