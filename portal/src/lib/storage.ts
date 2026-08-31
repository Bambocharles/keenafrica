import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

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
 * Session 32 (Production Object Storage) added S3StorageDriver below —
 * a generic S3-API driver, not a Cloudflare-R2-specific one, so this file
 * stays vendor-neutral even though production is currently configured
 * against R2 (see docs/ASSETS.md for the decision writeup: R2 was chosen
 * over a shared ReadWriteMany volume because this infra is self-managed
 * Docker/VM hosts with no managed-cloud RWX story, and Cloudflare is
 * already this domain's DNS/edge/tunnel provider). Swapping vendors again
 * later means changing STORAGE_DRIVER/S3_* env vars, or adding another
 * driver class here — no domain model or caller of assets.ts changes.
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

/**
 * Any S3-compatible object storage (Cloudflare R2 in production today;
 * AWS S3/MinIO/Backblaze B2/etc. would work identically since they all
 * speak the same SigV4-signed REST API). Uses `aws4fetch` — a ~2KB,
 * zero-dependency SigV4 request signer built on the platform `fetch()` —
 * rather than the official `@aws-sdk/client-s3` (a much heavier
 * dependency, with its own XML/streaming machinery, for three verbs this
 * driver needs). Matches this codebase's existing bias (Session 19's
 * mailer: "plain fetch() over an SDK ... deliberately no external
 * dependency" for the same reason).
 */
export interface S3DriverConfig {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

class S3StorageDriver implements StorageDriver {
  private readonly client: AwsClient;
  private readonly endpoint: string;
  private readonly bucket: string;

  constructor(config: S3DriverConfig) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      // R2 (and most S3-compatible vendors outside AWS itself) don't use
      // AWS's per-region signing — "auto" is R2's documented SigV4 region.
      region: config.region ?? "auto",
      service: "s3",
    });
    this.endpoint = config.endpoint.replace(/\/+$/, "");
    this.bucket = config.bucket;
  }

  // `key` is always an opaque server-generated UUID (see module comment),
  // so this never needs path-traversal defenses the local driver needs —
  // it's just a path segment in a signed HTTPS request, never resolved
  // against a local filesystem.
  private objectUrl(key: string): string {
    return `${this.endpoint}/${this.bucket}/${encodeURIComponent(key)}`;
  }

  async put(key: string, data: Buffer): Promise<void> {
    // lib.dom's BodyInit and @types/node's ArrayBufferLike-generic
    // Uint8Array don't structurally align in this TS/@types/node
    // combination (a known ecosystem type mismatch, not a real runtime
    // issue — Node's fetch accepts a Buffer directly).
    const body = data as unknown as BodyInit;
    const res = await this.client.fetch(this.objectUrl(key), {
      method: "PUT",
      body,
      headers: { "Content-Length": String(data.length) },
    });
    if (!res.ok) {
      const text = await res.text();
      // Callers (assets.ts's uploadAsset/getAssetForDownload) generally
      // catch this into a generic user-facing error code — without a
      // server-side log line here, an S3 failure (wrong credential,
      // wrong bucket scope, network issue) was otherwise completely
      // silent, undebuggable in production. The response body is the S3
      // API's own error XML (e.g. "InvalidAccessKeyId"/"AccessDenied") —
      // never credentials.
      console.error(`[storage] S3 put failed for key "${key}" (HTTP ${res.status}): ${text}`);
      throw new Error(`S3 put failed for key "${key}" (HTTP ${res.status}): ${text}`);
    }
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.fetch(this.objectUrl(key), { method: "GET" });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[storage] S3 get failed for key "${key}" (HTTP ${res.status}): ${text}`);
      throw new Error(`S3 get failed for key "${key}" (HTTP ${res.status}): ${text}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.client.fetch(this.objectUrl(key), { method: "DELETE" });
    // S3's DELETE is idempotent by design (204/404 both mean "gone");
    // src/lib/assets.ts already calls delete() with .catch(() => {}) at
    // its one call site, but this driver shouldn't rely on that to treat
    // an already-absent object as success.
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      console.error(`[storage] S3 delete failed for key "${key}" (HTTP ${res.status}): ${text}`);
      throw new Error(`S3 delete failed for key "${key}" (HTTP ${res.status}): ${text}`);
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var "${name}" for STORAGE_DRIVER=s3 (see docs/ENVIRONMENT.md).`);
  }
  return value;
}

let driver: StorageDriver | undefined;

export function getStorageDriver(): StorageDriver {
  if (driver) return driver;

  const kind = process.env.STORAGE_DRIVER ?? "local";
  if (kind === "local") {
    driver = new LocalDiskStorageDriver();
  } else if (kind === "s3") {
    driver = new S3StorageDriver({
      bucket: requireEnv("S3_BUCKET"),
      endpoint: requireEnv("S3_ENDPOINT"),
      accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
      region: process.env.S3_REGION,
    });
  } else {
    throw new Error(`Unsupported STORAGE_DRIVER "${kind}" — only "local" and "s3" are implemented (see docs/ASSETS.md).`);
  }
  return driver;
}

/** Test-only: forces a fresh driver instance (e.g. a different LOCAL_ROOT per test file). */
export function __resetStorageDriverForTests(): void {
  driver = undefined;
}

/** Test-only: builds an S3StorageDriver directly, bypassing env-var config. */
export function __createS3DriverForTests(config: S3DriverConfig): StorageDriver {
  return new S3StorageDriver(config);
}
