import { afterEach, describe, expect, test } from "bun:test";
import { WEB_CONFIG_PATH } from "./protocol.ts";
import { serveWebUi, type WebUiHandle } from "./server.ts";

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

  describe("DH-0110: bundled asset chunks referenced by the rendered page actually resolve", () => {
    test("every asset path referenced in the rendered HTML (script src / link href) resolves 200, not 404", async () => {
      handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
      const indexRes = await fetch(handle.url);
      const body = await indexRes.text();
      const assetPaths = [...body.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)]
        .map((m) => m[1])
        .filter((path): path is string => path !== undefined);
      expect(assetPaths.length).toBeGreaterThan(0);
      for (const path of assetPaths) {
        const res = await fetch(new URL(path, handle.url));
        expect(res.status).toBe(200);
        expect(res.headers.get("x-frame-options")).toBe("DENY");
        expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      }
    });
  });

  describe("DH-0023: clickjacking headers", () => {
    test("X-Frame-Options and CSP frame-ancestors are present on the served page", async () => {
      handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
      const res = await fetch(handle.url);
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    });

    test("present on the config endpoint too", async () => {
      handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
      const res = await fetch(new URL(WEB_CONFIG_PATH, handle.url));
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    });

    test("present on a 404", async () => {
      handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
      const res = await fetch(new URL("/does-not-exist", handle.url));
      expect(res.headers.get("x-frame-options")).toBe("DENY");
      expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    });
  });

  describe("DH-0128: cross-machine config resolution", () => {
    test("rewrites a loopback targetBaseUrl's host to the Host the request actually used, keeping port/scheme", async () => {
      handle = serveWebUi({
        port: 0,
        targetBaseUrl: "http://localhost:4000",
        hostname: "127.0.0.1",
      });
      const res = await fetch(`http://127.0.0.1:${handle.port}${WEB_CONFIG_PATH}`, {
        headers: { host: "192.168.1.238" },
      });
      const body = await res.json();
      expect(body).toEqual({ baseUrl: "http://192.168.1.238:4000" });
    });

    test("leaves a non-loopback targetBaseUrl (e.g. --connect <host>) untouched regardless of request Host", async () => {
      handle = serveWebUi({ port: 0, targetBaseUrl: "http://remote-dh-host:4000" });
      const res = await fetch(new URL(WEB_CONFIG_PATH, handle.url));
      const body = await res.json();
      expect(body).toEqual({ baseUrl: "http://remote-dh-host:4000" });
    });

    test("still resolves to localhost when the request itself came in on localhost (unchanged same-machine behavior)", async () => {
      handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
      const res = await fetch(new URL(WEB_CONFIG_PATH, handle.url));
      const body = await res.json();
      expect(body).toEqual({ baseUrl: "http://localhost:4000" });
    });
  });

  describe("DH-0022: opt-in bind address", () => {
    test("with hostname unset (default), still reachable on loopback (unchanged behavior)", async () => {
      handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
      const res = await fetch(handle.url);
      expect(res.status).toBe(200);
    });

    test("with hostname set to 127.0.0.1, Bun.serve actually receives that hostname option", async () => {
      const originalServe = Bun.serve;
      let capturedHostname: unknown;
      // Spying on the actual Bun.serve options passed is the reliable way to pin this: a
      // real cross-interface reachability check is unreliable/sandbox-dependent in CI, and
      // this module doesn't expose the underlying Bun server object for introspection.
      // biome-ignore lint/suspicious/noExplicitAny: matching Bun.serve's overloaded signature
      (Bun as any).serve = (options: any) => {
        capturedHostname = options.hostname;
        return originalServe(options);
      };
      try {
        handle = serveWebUi({
          port: 0,
          targetBaseUrl: "http://localhost:4000",
          hostname: "127.0.0.1",
        });
      } finally {
        Bun.serve = originalServe;
      }
      expect(capturedHostname).toBe("127.0.0.1");
      const res = await fetch(handle.url);
      expect(res.status).toBe(200);
    });

    test("DH-0167: handle.url reflects the configured hostname, not a hardcoded localhost", async () => {
      handle = serveWebUi({
        port: 0,
        targetBaseUrl: "http://localhost:4000",
        hostname: "127.0.0.1",
      });
      expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);
    });

    test("DH-0167: handle.url falls back to localhost when hostname is unset", async () => {
      handle = serveWebUi({ port: 0, targetBaseUrl: "http://localhost:4000" });
      expect(handle.url).toBe(`http://localhost:${handle.port}`);
    });
  });
});
