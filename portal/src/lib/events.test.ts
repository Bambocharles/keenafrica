import { describe, expect, it, vi } from "vitest";
import { emitDomainEvent, onDomainEvent } from "./events";

describe("domain event bus", () => {
  it("delivers the payload to subscribers of the same event", async () => {
    const handler = vi.fn();
    const unsubscribe = onDomainEvent("UserCreated", handler);

    emitDomainEvent("UserCreated", { userId: "u1" });
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith({ userId: "u1" });
    unsubscribe();
  });

  it("does not deliver to subscribers of a different event", async () => {
    const handler = vi.fn();
    onDomainEvent("RoleChanged", handler);

    emitDomainEvent("UserCreated", { userId: "u1" });
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further delivery", async () => {
    const handler = vi.fn();
    const unsubscribe = onDomainEvent("UserCreated", handler);
    unsubscribe();

    emitDomainEvent("UserCreated", { userId: "u1" });
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
  });

  it("a throwing handler does not stop emitDomainEvent from returning, and other listeners still fire", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const okHandler = vi.fn();

    const unsubBad = onDomainEvent("UserCreated", () => {
      throw new Error("boom");
    });
    const unsubOk = onDomainEvent("UserCreated", okHandler);

    expect(() => emitDomainEvent("UserCreated", { userId: "u1" })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(okHandler).toHaveBeenCalledWith({ userId: "u1" });
    expect(errorSpy).toHaveBeenCalled();

    unsubBad();
    unsubOk();
    errorSpy.mockRestore();
  });
});
