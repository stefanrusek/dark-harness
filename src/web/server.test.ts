import { afterEach, describe, expect, test } from "bun:test";
import { WEB_CONFIG_PATH } from "./protocol.ts";
import { type WebUiHandle, serveWebUi } from "./server.ts";

let handle: WebUiHandle | undefined;

afterEach(() => {
  handle?.stop();
  handle = undefined;
});

describe("serveWebUi", () => {
  test("serves the bundled index page at /", async () => {
    handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
    const res = await fetch(handle.url);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Dark Harness");
    expect(body).toContain('id="root"');
  });

  test("exposes the target base URL (without a token) via the config endpoint", async () => {
    handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
    const res = await fetch(new URL(WEB_CONFIG_PATH, handle.url));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ baseUrl: "http://localhost:4000" });
  });

  test("includes the bearer token in the config endpoint when configured", async () => {
    handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000", token: "secret" });
    const res = await fetch(new URL(WEB_CONFIG_PATH, handle.url));
    const body = await res.json();
    expect(body).toEqual({ baseUrl: "http://localhost:4000", token: "secret" });
  });

  test("returns 404 for unknown paths", async () => {
    handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
    const res = await fetch(new URL("/does-not-exist", handle.url));
    expect(res.status).toBe(404);
  });

  test("returns a live, connectable port distinct across instances", async () => {
    handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
    const second = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4001" });
    try {
      expect(handle.port).toBeGreaterThan(0);
      expect(second.port).toBeGreaterThan(0);
      expect(handle.port).not.toBe(second.port);
    } finally {
      second.stop();
    }
  });
});
