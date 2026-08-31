import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __createS3DriverForTests, __resetStorageDriverForTests, getStorageDriver } from "@/lib/storage";

describe("getStorageDriver — driver selection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetStorageDriverForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    __resetStorageDriverForTests();
  });

  it("defaults to the local driver when STORAGE_DRIVER is unset", () => {
    delete process.env.STORAGE_DRIVER;
    expect(() => getStorageDriver()).not.toThrow();
  });

  it("throws for an unknown STORAGE_DRIVER value", () => {
    process.env.STORAGE_DRIVER = "azure-blob";
    expect(() => getStorageDriver()).toThrow(/Unsupported STORAGE_DRIVER/);
  });

  it("throws a clear error when STORAGE_DRIVER=s3 is missing required env vars", () => {
    process.env.STORAGE_DRIVER = "s3";
    delete process.env.S3_BUCKET;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    expect(() => getStorageDriver()).toThrow(/Missing required env var "S3_BUCKET"/);
  });

  it("builds an S3StorageDriver when STORAGE_DRIVER=s3 and all env vars are set", () => {
    process.env.STORAGE_DRIVER = "s3";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ENDPOINT = "https://example.r2.cloudflarestorage.com";
    process.env.S3_ACCESS_KEY_ID = "test-key-id";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret";
    expect(() => getStorageDriver()).not.toThrow();
  });
});

describe("S3StorageDriver — put/get/delete against the S3 REST API", () => {
  const config = {
    bucket: "test-bucket",
    endpoint: "https://example.r2.cloudflarestorage.com",
    accessKeyId: "test-key-id",
    secretAccessKey: "test-secret-access-key",
    region: "auto",
  };

  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("put() PUTs to <endpoint>/<bucket>/<key> with the body bytes, and signs the request", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    const driver = __createS3DriverForTests(config);

    await driver.put("abc-123-key", Buffer.from("hello world"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // aws4fetch signs the request into a single `Request` object and calls
    // fetch(request) — not fetch(url, init) — so inspect the Request itself.
    const [request] = fetchSpy.mock.calls[0] as [Request];
    expect(request.url).toBe("https://example.r2.cloudflarestorage.com/test-bucket/abc-123-key");
    expect(request.method).toBe("PUT");
    // A real Authorization header with a valid SigV4 signature proves the
    // credentials were actually used, without this test re-implementing
    // SigV4 itself (that's aws4fetch's own, separately-tested job).
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-key-id\//);
  });

  it("put() throws with the response body when the S3 API rejects the upload", async () => {
    fetchSpy.mockResolvedValue(new Response("AccessDenied", { status: 403 }));
    const driver = __createS3DriverForTests(config);

    await expect(driver.put("abc-123-key", Buffer.from("hello"))).rejects.toThrow(/HTTP 403/);
  });

  it("get() GETs the object and returns its bytes as a Buffer", async () => {
    fetchSpy.mockResolvedValue(new Response(Buffer.from("stored bytes"), { status: 200 }));
    const driver = __createS3DriverForTests(config);

    const result = await driver.get("abc-123-key");

    expect(result.equals(Buffer.from("stored bytes"))).toBe(true);
    const [request] = fetchSpy.mock.calls[0] as [Request];
    expect(request.url).toBe("https://example.r2.cloudflarestorage.com/test-bucket/abc-123-key");
    expect(request.method).toBe("GET");
  });

  it("get() throws when the object is missing (404)", async () => {
    fetchSpy.mockResolvedValue(new Response("NoSuchKey", { status: 404 }));
    const driver = __createS3DriverForTests(config);

    await expect(driver.get("missing-key")).rejects.toThrow(/HTTP 404/);
  });

  it("delete() DELETEs the object and succeeds on 204", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
    const driver = __createS3DriverForTests(config);

    await expect(driver.delete("abc-123-key")).resolves.toBeUndefined();
    const [request] = fetchSpy.mock.calls[0] as [Request];
    expect(request.method).toBe("DELETE");
  });

  it("delete() treats 404 as success (idempotent delete of an already-gone object)", async () => {
    fetchSpy.mockResolvedValue(new Response("NoSuchKey", { status: 404 }));
    const driver = __createS3DriverForTests(config);

    await expect(driver.delete("already-gone-key")).resolves.toBeUndefined();
  });

  it("delete() throws on a real failure (not 404)", async () => {
    // 403, not 500/429 — aws4fetch retries 5xx/429 with backoff by design
    // (real resilience against transient object-storage errors), which
    // would make this specific assertion outlast the test timeout for no
    // reason; a non-retried 4xx exercises the same throw path.
    fetchSpy.mockResolvedValue(new Response("AccessDenied", { status: 403 }));
    const driver = __createS3DriverForTests(config);

    await expect(driver.delete("abc-123-key")).rejects.toThrow(/HTTP 403/);
  });

  it("URL-encodes keys that need it, and strips a trailing slash from the endpoint", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 200 }));
    const driver = __createS3DriverForTests({ ...config, endpoint: "https://example.r2.cloudflarestorage.com/" });

    await driver.put("key with spaces", Buffer.from("x"));

    const [request] = fetchSpy.mock.calls[0] as [Request];
    expect(request.url).toBe("https://example.r2.cloudflarestorage.com/test-bucket/key%20with%20spaces");
  });
});
