// DH-0057: the transient loopback redirect receiver.
import { describe, expect, test } from "bun:test";
import { LoopbackTimeoutError, startLoopbackReceiver } from "./oauth-loopback.ts";

describe("startLoopbackReceiver", () => {
  test("binds loopback only and closes after use", async () => {
    const receiver = startLoopbackReceiver();
    // Bound to 127.0.0.1, never 0.0.0.0 / a routable host.
    expect(receiver.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const waiting = receiver.waitForCode(5000);
    const res = await fetch(`${receiver.redirectUri}?code=abc&state=xyz`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Authorization complete");

    const { code, state } = await waiting;
    expect(code).toBe("abc");
    expect(state).toBe("xyz");

    await receiver.close();
    // Idempotent close.
    await receiver.close();
    // After close the port no longer accepts connections.
    await expect(fetch(receiver.redirectUri)).rejects.toBeDefined();
  });

  test("uses a fixed port when provided", async () => {
    const receiver = startLoopbackReceiver({ port: 0 });
    expect(receiver.redirectUri).toContain("127.0.0.1");
    await receiver.close();
  });

  test("captures a code that arrives before waitForCode is called", async () => {
    const receiver = startLoopbackReceiver();
    await fetch(`${receiver.redirectUri}?code=early&state=s1`);
    // Give the handler a tick to record it.
    await Bun.sleep(20);
    const { code } = await receiver.waitForCode(5000);
    expect(code).toBe("early");
    await receiver.close();
  });

  test("rejects on an ?error= redirect (live)", async () => {
    const receiver = startLoopbackReceiver();
    const waiting = receiver.waitForCode(5000).catch((e: Error) => e);
    await fetch(`${receiver.redirectUri}?error=access_denied&error_description=nope`);
    const err = await waiting;
    expect((err as Error).message).toMatch(/access_denied — nope/);
    await receiver.close();
  });

  test("rejects on an ?error= redirect that arrives before waitForCode", async () => {
    const receiver = startLoopbackReceiver();
    await fetch(`${receiver.redirectUri}?error=server_error`);
    await Bun.sleep(20);
    await expect(receiver.waitForCode(5000)).rejects.toThrow(/server_error/);
    await receiver.close();
  });

  test("shows an error page and does not resolve when the callback lacks a code", async () => {
    const receiver = startLoopbackReceiver();
    const res = await fetch(`${receiver.redirectUri}?state=only`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("missing code");
    await receiver.close();
  });

  test("returns 404 for a non-/callback path", async () => {
    const receiver = startLoopbackReceiver();
    const res = await fetch(`http://127.0.0.1:${new URL(receiver.redirectUri).port}/other`);
    expect(res.status).toBe(404);
    await receiver.close();
  });

  test("times out with LoopbackTimeoutError when no callback arrives", async () => {
    const receiver = startLoopbackReceiver();
    await expect(receiver.waitForCode(50)).rejects.toBeInstanceOf(LoopbackTimeoutError);
    await receiver.close();
  });
});
