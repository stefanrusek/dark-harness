// WebSearch — DH-0074 (tracking/DH-0074-*.md, architect design Fable 2026-07-16). Only
// registered when `dh.json` has a `web.search` block (see composeTools() in index.ts) —
// dh has no search infrastructure of its own, so this tool doesn't pretend to have a default
// backend; it exists only once the operator configures one. v1 backend is the Brave Search
// API (`provider: "brave"`); the `provider` field is a discriminated string so a self-hosted
// SearXNG backend can be added later without restructuring.
//
// No synthesis step: real Claude Code's WebSearch runs a prose summary on Anthropic's own
// search infrastructure, which dh does not have — the calling agent synthesizes its own
// answer from the raw result blocks returned here.

import type { WebSearchConfig } from "../../contracts/index.ts";
import { hostMatchesSuffix } from "./net-guard.ts";
import type { Tool, ToolContext, ToolResult } from "./types.type.ts";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESULTS = 10;
const HARD_MAX_RESULTS = 20;
const MIN_QUERY_LENGTH = 2;

interface BraveWebResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

/** Redacts an api-key-shaped value that might have been echoed back into an error body — a
 * defense-in-depth belt to DH-0020's log-layer redaction, which already covers this same
 * value via `collectConfigSecrets`, but tool output can reach the model/transcript before it
 * ever hits the log-writing layer. */
function redactApiKey(text: string, apiKey: string): string {
  if (apiKey.length === 0) return text;
  return text.split(apiKey).join("[REDACTED:web-search-api-key]");
}

async function searchBrave(
  config: WebSearchConfig,
  query: string,
  maxResults: number,
): Promise<{ results: BraveWebResult[] } | { error: string }> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", String(maxResults));

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": config.apiKey,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { error: `request to Brave Search API failed: ${(err as Error).message}` };
  }

  if (!response.ok) {
    const body = redactApiKey(await response.text().catch(() => ""), config.apiKey);
    return { error: `Brave Search API responded with HTTP ${response.status}: ${body}` };
  }

  let parsed: BraveSearchResponse;
  try {
    parsed = (await response.json()) as BraveSearchResponse;
  } catch (err) {
    return { error: `Brave Search API returned invalid JSON: ${(err as Error).message}` };
  }
  return { results: parsed.web?.results ?? [] };
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export const webSearchTool: Tool = Object.freeze<Tool>({
  name: "WebSearch",
  description:
    "Searches the web via the operator-configured backend (dh has no search infrastructure " +
    "of its own — this tool only exists when web.search is configured in dh.json) and " +
    "returns raw result blocks (title/url/snippet) for you to synthesize yourself.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query (minimum 2 characters)." },
      allowed_domains: {
        type: "array",
        items: { type: "string" },
        description: "Only include results whose URL host matches one of these domains.",
      },
      blocked_domains: {
        type: "array",
        items: { type: "string" },
        description: "Exclude results whose URL host matches one of these domains.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const query = input.query;
    if (typeof query !== "string" || query.length < MIN_QUERY_LENGTH) {
      return {
        output: `WebSearch tool error: 'query' must be a string of at least ${MIN_QUERY_LENGTH} characters.`,
        isError: true,
      };
    }
    const allowedDomains = input.allowed_domains;
    if (
      allowedDomains !== undefined &&
      (!Array.isArray(allowedDomains) || allowedDomains.some((d) => typeof d !== "string"))
    ) {
      return {
        output: "WebSearch tool error: 'allowed_domains' must be an array of strings.",
        isError: true,
      };
    }
    const blockedDomains = input.blocked_domains;
    if (
      blockedDomains !== undefined &&
      (!Array.isArray(blockedDomains) || blockedDomains.some((d) => typeof d !== "string"))
    ) {
      return {
        output: "WebSearch tool error: 'blocked_domains' must be an array of strings.",
        isError: true,
      };
    }

    const searchConfig = ctx.config.web?.search;
    if (!searchConfig) {
      // Defensive: composeTools() only registers this tool when web.search is configured, so
      // this should be unreachable in practice, but a tool must never assume its own
      // registration precondition still holds by the time it executes.
      return {
        output: "WebSearch tool error: web.search is not configured.",
        isError: true,
      };
    }

    const maxResults = Math.min(searchConfig.maxResults ?? DEFAULT_MAX_RESULTS, HARD_MAX_RESULTS);

    const outcome = await searchBrave(searchConfig, query, maxResults);
    if ("error" in outcome) {
      return { output: `WebSearch tool error: ${outcome.error}`, isError: true };
    }

    let results = outcome.results;
    if (allowedDomains && (allowedDomains as string[]).length > 0) {
      results = results.filter((r) => {
        const host = r.url ? hostOf(r.url) : undefined;
        return (
          host !== undefined && (allowedDomains as string[]).some((d) => hostMatchesSuffix(host, d))
        );
      });
    }
    if (blockedDomains && (blockedDomains as string[]).length > 0) {
      results = results.filter((r) => {
        const host = r.url ? hostOf(r.url) : undefined;
        return !(
          host !== undefined && (blockedDomains as string[]).some((d) => hostMatchesSuffix(host, d))
        );
      });
    }
    results = results.slice(0, maxResults);

    if (results.length === 0) {
      return { output: `No results found for query: ${query}`, isError: false };
    }

    const blocks = results.map((r, i) => {
      const title = r.title ?? "(untitled)";
      const url = r.url ?? "(no url)";
      const snippet = r.description ?? "";
      return `${i + 1}. ${title}\n   ${url}${snippet ? `\n   ${snippet}` : ""}`;
    });

    return {
      output: `Web search results for "${query}":\n\n${blocks.join("\n\n")}`,
      isError: false,
    };
  },
});
