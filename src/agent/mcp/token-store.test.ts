// DH-0057: McpTokenStore — per-server on-disk OAuth state with 0600/0700 modes and DH_HOME
// isolation.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dhHome, McpTokenStore, sanitizeServerName } from "./token-store.ts";

let home: string;
const prevDhHome = process.env.DH_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "dh-tokenstore-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  if (prevDhHome === undefined) delete process.env.DH_HOME;
  else process.env.DH_HOME = prevDhHome;
});

describe("McpTokenStore", () => {
  test("writes 0600 per-server file, redacts secrets", () => {
    const store = new McpTokenStore("acme", home);
    const written = store.write({
      serverName: "acme",
      serverUrl: "https://mcp.acme.example/v1",
      clientInformation: {
        client_id: "cid",
        client_secret: "shh-secret",
        redirect_uris: ["http://127.0.0.1:1/callback"],
      },
      tokens: {
        access_token: "at-secret",
        token_type: "Bearer",
        refresh_token: "rt-secret",
        expires_in: 3600,
        obtained_at: Date.now(),
      },
    });
    expect(written.version).toBe(1);
    expect(written.updatedAt).toBeGreaterThan(0);

    // File mode is 0600, directory mode 0700.
    const fileMode = statSync(store.filePath).mode & 0o777;
    expect(fileMode).toBe(0o600);
    const dirMode = statSync(join(home, "mcp-auth")).mode & 0o777;
    expect(dirMode).toBe(0o700);

    // Round-trips.
    const read = store.read();
    expect(read?.tokens?.access_token).toBe("at-secret");
    expect(read?.clientInformation?.client_secret).toBe("shh-secret");

    // Secrets never surface in the store's own toString / no leak surface: the store never
    // exposes a stringify path that includes secrets beyond the explicit file, so a redaction
    // check is that JSON.stringify(store) does not carry them.
    expect(JSON.stringify(store)).not.toContain("shh-secret");
    expect(JSON.stringify(store)).not.toContain("at-secret");
  });

  test("read returns undefined when no file exists", () => {
    const store = new McpTokenStore("absent", home);
    expect(store.read()).toBeUndefined();
  });

  test("read throws on corrupt JSON", () => {
    const store = new McpTokenStore("bad", home);
    // Force the file into place with invalid JSON.
    store.write({ serverName: "bad", serverUrl: "x" });
    writeFileSync(store.filePath, "{ not json", { mode: 0o600 });
    expect(() => store.read()).toThrow(/corrupt \(invalid JSON\)/);
  });

  test("read throws on unexpected shape (wrong version)", () => {
    const store = new McpTokenStore("shape", home);
    store.write({ serverName: "shape", serverUrl: "x" });
    writeFileSync(store.filePath, JSON.stringify({ version: 99 }), { mode: 0o600 });
    expect(() => store.read()).toThrow(/corrupt \(unexpected shape\)/);
    writeFileSync(store.filePath, "null", { mode: 0o600 });
    expect(() => store.read()).toThrow(/corrupt \(unexpected shape\)/);
  });

  test("update seeds an empty record when none exists, then mutates", () => {
    const store = new McpTokenStore("seed", home);
    const first = store.update((current) => {
      current.serverName = "seed";
      current.serverUrl = "https://x";
      current.codeVerifier = "verifier-1";
    });
    expect(first.codeVerifier).toBe("verifier-1");
    const second = store.update((current) => {
      current.codeVerifier = "verifier-2";
    });
    expect(second.codeVerifier).toBe("verifier-2");
    expect(second.serverUrl).toBe("https://x");
  });

  test("per-server isolation: two servers have independent files", () => {
    const a = new McpTokenStore("alpha", home);
    const b = new McpTokenStore("beta", home);
    a.write({ serverName: "alpha", serverUrl: "a" });
    b.write({ serverName: "beta", serverUrl: "b" });
    expect(a.filePath).not.toBe(b.filePath);
    expect(a.read()?.serverUrl).toBe("a");
    expect(b.read()?.serverUrl).toBe("b");
  });
});

describe("sanitizeServerName", () => {
  test("replaces unsafe characters", () => {
    expect(sanitizeServerName("acme/prod:v1")).toBe("acme_prod_v1");
    expect(sanitizeServerName("plain.name-9_x")).toBe("plain.name-9_x");
  });
});

describe("dhHome", () => {
  test("honors DH_HOME override", () => {
    process.env.DH_HOME = "/custom/dh/home";
    expect(dhHome()).toBe("/custom/dh/home");
  });

  test("falls back to ~/.dh", () => {
    delete process.env.DH_HOME;
    expect(dhHome()).toMatch(/\.dh$/);
  });
});
