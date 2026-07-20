// Unit tests for WebFetch (DH-0074). `node:dns/promises` is mocked module-wide so hostname
// resolution never touches the real network — literal-IP URLs additionally exercise the
// no-DNS-lookup branch directly (resolveAddresses' own fast path).

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WebFetchConfig } from "../../contracts/index.ts";
import { makeToolContext } from "./test-helpers.ts";

let mockedAddresses: Array<{ address: string; family: number }> = [];
let mockLookupError: Error | undefined;

mock.module("node:dns/promises", () => ({
  lookup: async (_host: string, _opts: unknown) => {
    if (mockLookupError) throw mockLookupError;
    return mockedAddresses;
  },
}));

const { webFetchTool } = await import("./web-fetch.ts");

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  mockedAddresses = [{ address: "8.8.8.8", family: 4 }];
  mockLookupError = undefined;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function ctxWithFetchConfig(fetchConfig: WebFetchConfig = {}) {
  return makeToolContext({
    config: {
      options: { defaultModel: "sonnet" },
      models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
      provider: [{ name: "anthropic", type: "anthropic" }],
      web: { fetch: fetchConfig },
    },
  });
}

describe("WebFetch input validation", () => {
  test("rejects a missing url", async () => {
    const result = await webFetchTool.execute({}, ctxWithFetchConfig());
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'url' is required.");
  });

  test("rejects an empty url", async () => {
    const result = await webFetchTool.execute({ url: "" }, ctxWithFetchConfig());
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'url' must be a non-empty string");
  });

  test("rejects a non-string prompt", async () => {
    const result = await webFetchTool.execute(
      { url: "http://8.8.8.8/", prompt: 42 },
      ctxWithFetchConfig(),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'prompt' must be a string");
  });

  test("rejects a malformed URL", async () => {
    const result = await webFetchTool.execute({ url: "not a url" }, ctxWithFetchConfig());
    expect(result.isError).toBe(true);
    expect(result.output).toContain("not a valid URL");
  });

  test("rejects a non-http(s) scheme", async () => {
    const result = await webFetchTool.execute({ url: "ftp://8.8.8.8/x" }, ctxWithFetchConfig());
    expect(result.isError).toBe(true);
    expect(result.output).toContain("unsupported URL scheme");
  });
});

describe("WebFetch SSRF protection", () => {
  test("rejects a literal private-IP URL by default", async () => {
    const result = await webFetchTool.execute(
      { url: "http://127.0.0.1/secret" },
      ctxWithFetchConfig(),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("private/loopback/link-local address");
  });

  test("rejects link-local/cloud-metadata address", async () => {
    const result = await webFetchTool.execute(
      { url: "http://169.254.169.254/latest/meta-data" },
      ctxWithFetchConfig(),
    );
    expect(result.isError).toBe(true);
  });

  test("rejects a hostname that resolves to a private address (DNS path, mocked)", async () => {
    mockedAddresses = [{ address: "10.0.0.5", family: 4 }];
    const result = await webFetchTool.execute(
      { url: "http://internal.example.com/" },
      ctxWithFetchConfig(),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("private/loopback/link-local address");
  });

  test("surfaces a DNS resolution failure as a tool error", async () => {
    mockLookupError = new Error("ENOTFOUND");
    const result = await webFetchTool.execute(
      { url: "http://nowhere.example.com/" },
      ctxWithFetchConfig(),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("failed to resolve host");
  });

  test("allowPrivateNetwork: true bypasses the SSRF check", async () => {
    globalThis.fetch = (async () =>
      new Response("ok", { headers: { "content-type": "text/plain" } })) as unknown as typeof fetch;
    const result = await webFetchTool.execute(
      { url: "http://127.0.0.1/internal" },
      ctxWithFetchConfig({ allowPrivateNetwork: true }),
    );
    expect(result.isError).toBe(false);
    expect(result.output).toBe("ok");
  });

  test("allowedHosts: request to a host not on the list is refused", async () => {
    const result = await webFetchTool.execute(
      { url: "http://8.8.8.8/" },
      ctxWithFetchConfig({ allowedHosts: ["docs.example.com"] }),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("is not in the configured web.fetch.allowedHosts");
  });

  test("allowedHosts: exact-match host is allowed", async () => {
    globalThis.fetch = (async () =>
      new Response("hi", { headers: { "content-type": "text/plain" } })) as unknown as typeof fetch;
    const result = await webFetchTool.execute(
      { url: "http://8.8.8.8/" },
      ctxWithFetchConfig({ allowedHosts: ["8.8.8.8"] }),
    );
    expect(result.isError).toBe(false);
    expect(result.output).toBe("hi");
  });
});

describe("WebFetch redirect handling", () => {
  test("a 3xx response is reported back rather than followed", async () => {
    globalThis.fetch = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://8.8.8.8/new" },
      })) as unknown as typeof fetch;
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/old" }, ctxWithFetchConfig());
    expect(result.isError).toBe(false);
    expect(result.output).toBe("Redirected to http://8.8.8.8/new (HTTP 302)");
  });

  test("a 3xx response with no Location header still reports back cleanly", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 301 })) as unknown as typeof fetch;
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/old" }, ctxWithFetchConfig());
    expect(result.isError).toBe(false);
    expect(result.output).toContain("(no Location header)");
  });
});

describe("WebFetch response handling", () => {
  test("network-level fetch failure is a tool error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/" }, ctxWithFetchConfig());
    expect(result.isError).toBe(true);
    expect(result.output).toContain("connection refused");
  });

  test("a non-2xx, non-3xx response is a tool error", async () => {
    globalThis.fetch = (async () =>
      new Response("nope", {
        status: 500,
        statusText: "Internal Error",
      })) as unknown as typeof fetch;
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/" }, ctxWithFetchConfig());
    expect(result.isError).toBe(true);
    expect(result.output).toContain("HTTP 500");
  });

  test("an unsupported content type is a tool error", async () => {
    globalThis.fetch = (async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "application/octet-stream" },
      })) as unknown as typeof fetch;
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/" }, ctxWithFetchConfig());
    expect(result.isError).toBe(true);
    expect(result.output).toContain("unsupported content type");
  });

  test("text/html is converted to text, dropping script/style content and rendering links", async () => {
    const html =
      "<html><body><script>evil()</script><style>.x{}</style>" +
      '<h1>Hello</h1><p>World <a href="http://8.8.8.8/x">link</a></p></body></html>';
    globalThis.fetch = (async () =>
      new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      })) as unknown as typeof fetch;
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/" }, ctxWithFetchConfig());
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Hello");
    expect(result.output).toContain("World");
    expect(result.output).toContain("link (http://8.8.8.8/x)");
    expect(result.output).not.toContain("evil()");
  });

  test("an anchor with text but no href still contributes its text", async () => {
    const html = "<html><body><a>no href here</a></body></html>";
    globalThis.fetch = (async () =>
      new Response(html, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/" }, ctxWithFetchConfig());
    expect(result.isError).toBe(false);
    expect(result.output).toContain("no href here");
  });

  test("application/json is returned as-is", async () => {
    globalThis.fetch = (async () => jsonResponse({ hello: "world" })) as unknown as typeof fetch;
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/" }, ctxWithFetchConfig());
    expect(result.isError).toBe(false);
    expect(result.output).toContain('"hello"');
  });

  test("a response with no body is handled (empty text)", async () => {
    globalThis.fetch = (async () =>
      new Response(null, { headers: { "content-type": "text/plain" } })) as unknown as typeof fetch;
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/" }, ctxWithFetchConfig());
    expect(result.isError).toBe(false);
    expect(result.output).toBe("");
  });

  test("output is truncated to maxOutputChars with a notice", async () => {
    globalThis.fetch = (async () =>
      new Response("x".repeat(100), {
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof fetch;
    const result = await webFetchTool.execute(
      { url: "http://8.8.8.8/" },
      ctxWithFetchConfig({ maxOutputChars: 10 }),
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("x".repeat(10));
    expect(result.output).toContain("truncated");
  });

  test("response body is capped at maxResponseBytes and notes truncation", async () => {
    const bigBody = "y".repeat(1000);
    globalThis.fetch = (async () =>
      new Response(bigBody, {
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof fetch;
    const result = await webFetchTool.execute(
      { url: "http://8.8.8.8/" },
      ctxWithFetchConfig({ maxResponseBytes: 100, maxOutputChars: 10_000 }),
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Response body truncated at 100 bytes");
    // Only the first 100 bytes of "y" should have been kept, plus the notice.
    expect(result.output.startsWith("y".repeat(100))).toBe(true);
  });

  test("a response whose body stream ends exactly without exceeding the cap is not marked truncated", async () => {
    globalThis.fetch = (async () =>
      new Response("short", {
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof fetch;
    const result = await webFetchTool.execute(
      { url: "http://8.8.8.8/" },
      ctxWithFetchConfig({ maxResponseBytes: 1000 }),
    );
    expect(result.output).not.toContain("truncated at");
  });
});

describe("WebFetch extraction-model step", () => {
  test("prompt given but no extractionModel configured -> returns raw content with a note", async () => {
    globalThis.fetch = (async () =>
      new Response("raw content", {
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof fetch;
    const result = await webFetchTool.execute(
      { url: "http://8.8.8.8/", prompt: "what is this?" },
      ctxWithFetchConfig(),
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("No web.fetch.extractionModel configured");
    expect(result.output).toContain("raw content");
  });

  test("prompt + extractionModel configured -> calls ctx.completeWithModel and returns its answer", async () => {
    globalThis.fetch = (async () =>
      new Response("page content", {
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof fetch;
    let calledWith: { modelName: string; hasPrompt: boolean } | undefined;
    const ctx = makeToolContext({
      config: {
        options: { defaultModel: "sonnet" },
        models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
        provider: [{ name: "anthropic", type: "anthropic" }],
        web: { fetch: { extractionModel: "haiku" } },
      },
      completeWithModel: async (modelName, request) => {
        const userText =
          request.messages[0]?.content[0]?.type === "text"
            ? request.messages[0].content[0].text
            : "";
        calledWith = { modelName, hasPrompt: userText.includes("summarize this") };
        return {
          stopReason: "end_turn",
          content: [{ type: "text", text: "the extracted answer" }],
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      },
    });
    const result = await webFetchTool.execute(
      { url: "http://8.8.8.8/", prompt: "summarize this" },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(result.output).toBe("the extracted answer");
    expect(calledWith).toEqual({ modelName: "haiku", hasPrompt: true });
  });

  test("extraction model returning no text content falls back to a placeholder", async () => {
    globalThis.fetch = (async () =>
      new Response("page content", {
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof fetch;
    const ctx = makeToolContext({
      config: {
        options: { defaultModel: "sonnet" },
        models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
        provider: [{ name: "anthropic", type: "anthropic" }],
        web: { fetch: { extractionModel: "haiku" } },
      },
      completeWithModel: async () => ({
        stopReason: "end_turn",
        content: [],
        usage: { inputTokens: 1, outputTokens: 0 },
      }),
    });
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/", prompt: "x" }, ctx);
    expect(result.output).toBe("(extraction model returned no text)");
  });

  test("extraction-model call failure is a tool error", async () => {
    globalThis.fetch = (async () =>
      new Response("page content", {
        headers: { "content-type": "text/plain" },
      })) as unknown as typeof fetch;
    const ctx = makeToolContext({
      config: {
        options: { defaultModel: "sonnet" },
        models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
        provider: [{ name: "anthropic", type: "anthropic" }],
        web: { fetch: { extractionModel: "haiku" } },
      },
      completeWithModel: async () => {
        throw new Error("provider unreachable");
      },
    });
    const result = await webFetchTool.execute({ url: "http://8.8.8.8/", prompt: "x" }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("provider unreachable");
  });
});
