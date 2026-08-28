import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMail } from "@/lib/mailer";

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendMail — no provider configured", () => {
  it("logs to console instead of sending, outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("MAIL_FROM_ADDRESS", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await sendMail({ to: "someone@example.com", subject: "Hi", text: "Hello" });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("someone@example.com");
  });

  it("throws in production rather than silently dropping the email", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("MAIL_FROM_ADDRESS", "");
    await expect(sendMail({ to: "someone@example.com", subject: "Hi", text: "Hello" })).rejects.toThrow(
      /No transactional email provider is configured/
    );
  });
});

describe("sendMail — Resend configured", () => {
  it("POSTs to Resend's API with the configured sender and the message fields", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "test-key-123");
    vi.stubEnv("MAIL_FROM_ADDRESS", "Keen Africa <no-reply@keenafrica.com>");

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await sendMail({ to: "recipient@example.com", subject: "Reset your password", text: "link here" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key-123");

    const body = JSON.parse(init.body);
    expect(body).toEqual({
      from: "Keen Africa <no-reply@keenafrica.com>",
      to: "recipient@example.com",
      subject: "Reset your password",
      text: "link here",
    });
  });

  it("never includes the API key in a thrown error when the request fails", async () => {
    vi.stubEnv("RESEND_API_KEY", "super-secret-key");
    vi.stubEnv("MAIL_FROM_ADDRESS", "Keen Africa <no-reply@keenafrica.com>");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Invalid `to` field",
    });
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      await sendMail({ to: "bad", subject: "x", text: "y" });
    } catch (err) {
      caught = err;
    }
    expect(String(caught)).toContain("422");
    expect(String(caught)).not.toContain("super-secret-key");
  });
});
