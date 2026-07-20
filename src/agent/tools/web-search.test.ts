// Unit tests for WebSearch (DH-0074). Mocks `globalThis.fetch` to stand in for the Brave
// Search API — never touches the real network.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { WebSearchConfig } from "../../contracts/index.ts";
import { makeToolContext } from "./test-helpers.ts";
import { webSearchTool } from "./web-search.ts";

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function ctxWithSearchConfig(searchConfig: WebSearchConfig | undefined) {
  return makeToolContext({
    config: {
      options: { defaultModel: "sonnet" },
      models: [{ name: "sonnet", provider: "anthropic", model: "sonnet-5" }],
      provider: [{ name: "anthropic", type: "anthropic" }],
      ...(searchConfig ? { web: { search: searchConfig } } : {}),
    },
  });
}

const BASE_SEARCH_CONFIG: WebSearchConfig = { provider: "brave", apiKey: "test-brave-key" };

describe("WebSearch input validation", () => {
  test("rejects a missing query", async () => {
    const result = await webSearchTool.execute({}, ctxWithSearchConfig(BASE_SEARCH_CONFIG));
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'query' must be a string");
  });

  test("rejects a too-short query", async () => {
    const result = await webSearchTool.execute(
      { query: "a" },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.isError).toBe(true);
  });

  test("rejects a non-array allowed_domains", async () => {
    const result = await webSearchTool.execute(
      { query: "bun test", allowed_domains: "not-an-array" },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'allowed_domains' must be an array of strings");
  });

  test("rejects a non-array blocked_domains", async () => {
    const result = await webSearchTool.execute(
      { query: "bun test", blocked_domains: [1, 2] },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("'blocked_domains' must be an array of strings");
  });
});

describe("WebSearch absent-when-unconfigured behavior", () => {
  test("execute defensively errors if web.search is somehow missing at call time", async () => {
    const result = await webSearchTool.execute(
      { query: "bun test" },
      ctxWithSearchConfig(undefined),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("web.search is not configured");
  });
});

describe("WebSearch backend calls (Brave)", () => {
  test("returns formatted results on success", async () => {
    globalThis.fetch = (async (input: string | URL) => {
      const url = new URL(input);
      expect(url.hostname).toBe("api.search.brave.com");
      expect(url.searchParams.get("q")).toBe("bun test");
      return Response.json({
        web: {
          results: [
            { title: "Bun Docs", url: "https://bun.sh/docs", description: "The Bun docs." },
            { title: "Other", url: "https://example.com/x", description: "Something else." },
          ],
        },
      });
    }) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test" },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Bun Docs");
    expect(result.output).toContain("https://bun.sh/docs");
    expect(result.output).toContain("The Bun docs.");
    expect(result.output).toContain("Other");
  });

  test("sends the API key via X-Subscription-Token header, never in the URL", async () => {
    const seen: { header: string | null } = { header: null };
    globalThis.fetch = (async (_input: unknown, init: RequestInit | undefined) => {
      const headers = init?.headers as Record<string, string> | undefined;
      seen.header = headers?.["X-Subscription-Token"] ?? null;
      return Response.json({ web: { results: [] } });
    }) as unknown as typeof fetch;
    await webSearchTool.execute({ query: "bun test" }, ctxWithSearchConfig(BASE_SEARCH_CONFIG));
    expect(seen.header).toBe("test-brave-key");
  });

  test("applies allowed_domains as a post-filter", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        web: {
          results: [
            { title: "A", url: "https://docs.example.com/a" },
            { title: "B", url: "https://other.org/b" },
          ],
        },
      })) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test", allowed_domains: ["example.com"] },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.output).toContain("A");
    expect(result.output).not.toContain("https://other.org/b");
  });

  test("applies blocked_domains as a post-filter", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        web: {
          results: [
            { title: "A", url: "https://docs.example.com/a" },
            { title: "B", url: "https://other.org/b" },
          ],
        },
      })) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test", blocked_domains: ["example.com"] },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.output).not.toContain("https://docs.example.com/a");
    expect(result.output).toContain("B");
  });

  test("a result with an unparsable url is excluded by a domain filter", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        web: { results: [{ title: "Bad", url: "not a url" }] },
      })) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test", allowed_domains: ["example.com"] },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.output).toContain("No results found");
  });

  test("caps results at the hard maximum of 20 even if configured/backend higher", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        web: {
          results: Array.from({ length: 30 }, (_, i) => ({
            title: `Result ${i}`,
            url: `https://example.com/${i}`,
          })),
        },
      })) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test" },
      ctxWithSearchConfig({ ...BASE_SEARCH_CONFIG, maxResults: 999 }),
    );
    const matches = result.output.match(/Result \d+/g) ?? [];
    expect(matches.length).toBe(20);
  });

  test("no results found produces a clean message, not an error", async () => {
    globalThis.fetch = (async () =>
      Response.json({ web: { results: [] } })) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test" },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.isError).toBe(false);
    expect(result.output).toContain("No results found");
  });

  test("a result missing title/description still renders with fallbacks", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        web: { results: [{ url: "https://example.com/x" }] },
      })) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test" },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.output).toContain("(untitled)");
  });

  test("a result missing url renders with a fallback", async () => {
    globalThis.fetch = (async () =>
      Response.json({ web: { results: [{ title: "No URL" }] } })) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test" },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.output).toContain("(no url)");
  });
});

describe("WebSearch backend error handling", () => {
  test("a network-level failure is a tool error", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test" },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("connection refused");
  });

  test("a non-ok HTTP response is a tool error with the api key redacted from the body", async () => {
    globalThis.fetch = (async () =>
      new Response("bad key: test-brave-key", { status: 401 })) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test" },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("HTTP 401");
    expect(result.output).not.toContain("test-brave-key");
    expect(result.output).toContain("[REDACTED:web-search-api-key]");
  });

  test("invalid JSON in a successful response is a tool error", async () => {
    globalThis.fetch = (async () => new Response("not json")) as unknown as typeof fetch;
    const result = await webSearchTool.execute(
      { query: "bun test" },
      ctxWithSearchConfig(BASE_SEARCH_CONFIG),
    );
    expect(result.isError).toBe(true);
    expect(result.output).toContain("invalid JSON");
  });
});
