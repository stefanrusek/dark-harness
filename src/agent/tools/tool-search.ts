// ToolSearch tool (DH-0002): the real deferred-tool discovery grammar, matching real Claude
// Code's convention — `select:Name1,Name2` exact selection + activation, `+term` required-
// token filtering, keyword ranking (name weighted over description), `max_results`. The
// corpus is every built-in tool (always "active") plus every MCP-discovered tool across
// configured mcpServers (deferred until selected) — assembled by the runtime
// (src/agent/runtime.ts's buildToolContext) and handed to the pure functions below, which
// contain the entire grammar and are unit-testable without any MCP/runtime plumbing.

import type { JsonSchema, Tool, ToolContext, ToolResult } from "./types.ts";

export const DEFAULT_MAX_RESULTS = 5;

/** One descriptor in the searchable corpus — a built-in tool (`deferred` absent) or an
 * MCP-discovered tool (`deferred: true`, `serverName` set). */
export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  deferred?: boolean;
  serverName?: string;
}

export interface ToolSearchOutcome {
  results: ToolDescriptor[];
  notFound?: string[];
}

/** `select:Name1,Name2` — exact, comma-separated name selection. Returns exactly the
 * matched descriptors (uncapped — `max_results` is ignored for `select:`), plus the list of
 * requested names that matched nothing. */
function runSelect(corpus: ToolDescriptor[], namesRaw: string): ToolSearchOutcome {
  const names = namesRaw
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  const byName = new Map(corpus.map((d) => [d.name, d]));
  const results: ToolDescriptor[] = [];
  const notFound: string[] = [];
  for (const name of names) {
    const found = byName.get(name);
    if (found) results.push(found);
    else notFound.push(name);
  }
  return notFound.length > 0 ? { results, notFound } : { results };
}

/** Keyword-ranked search: `+term` tokens are required (a descriptor must contain every
 * `+term`, case-insensitive, in its name or description, or it's dropped); the remaining
 * tokens rank survivors by score — a name hit is weighted higher (3 points) than a
 * description hit (1 point per matching token), ties broken alphabetically by name.
 * `maxResults` is applied after ranking. */
function runKeywordSearch(
  corpus: ToolDescriptor[],
  query: string,
  maxResults: number,
): ToolSearchOutcome {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const requiredTerms = tokens
    .filter((t) => t.startsWith("+") && t.length > 1)
    .map((t) => t.slice(1).toLowerCase());
  const rankTerms = tokens.filter((t) => !t.startsWith("+")).map((t) => t.toLowerCase());

  const survivors = corpus.filter((d) => {
    const haystack = `${d.name} ${d.description}`.toLowerCase();
    return requiredTerms.every((term) => haystack.includes(term));
  });

  const scored = survivors.map((d) => {
    const nameLower = d.name.toLowerCase();
    const descLower = d.description.toLowerCase();
    let score = 0;
    for (const term of rankTerms) {
      if (nameLower.includes(term)) score += 3;
      if (descLower.includes(term)) score += 1;
    }
    return { descriptor: d, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.descriptor.name.localeCompare(b.descriptor.name);
  });

  return { results: scored.slice(0, maxResults).map((s) => s.descriptor) };
}

/** Entry point for the whole grammar: dispatches to `runSelect` or `runKeywordSearch`
 * depending on whether `query` starts with the `select:` prefix. Pure — no MCP/runtime
 * dependency, fully unit-testable against a synthetic corpus. */
export function runToolSearch(
  corpus: ToolDescriptor[],
  query: string,
  maxResults: number = DEFAULT_MAX_RESULTS,
): ToolSearchOutcome {
  if (query.startsWith("select:")) {
    return runSelect(corpus, query.slice("select:".length));
  }
  return runKeywordSearch(corpus, query, maxResults);
}

function formatResult(d: ToolDescriptor): string {
  const activationNote = d.deferred
    ? ` (from MCP server "${d.serverName}"; now activated for this agent)`
    : " (built-in; already loaded/active)";
  return `${d.name}${activationNote}: ${d.description}\ninputSchema: ${JSON.stringify(d.inputSchema)}`;
}

export const toolSearchTool: Tool = {
  name: "ToolSearch",
  description:
    "Search for deferred tools (from configured MCP servers) and built-in tools by keyword. " +
    'Grammar: "select:Name1,Name2" exactly selects (and activates) named tools; "+term" ' +
    "requires that term in the name/description; remaining words rank matches by keyword " +
    'score (name weighted over description). "max_results" (default 5) caps ranked results; ' +
    'it is ignored by "select:" queries.',
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      max_results: { type: "integer" },
    },
    required: ["query"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const query = input.query;
    if (typeof query !== "string") {
      return { output: "ToolSearch tool error: 'query' must be a string.", isError: true };
    }
    let maxResults: number | undefined;
    if (input.max_results !== undefined) {
      if (typeof input.max_results !== "number" || !Number.isInteger(input.max_results)) {
        return {
          output: "ToolSearch tool error: 'max_results' must be an integer.",
          isError: true,
        };
      }
      maxResults = input.max_results;
    }

    const { results, notFound, unreachableServers } = await ctx.searchDeferredTools(query, {
      ...(maxResults !== undefined ? { maxResults } : {}),
    });

    const lines: string[] = [];
    if (results.length === 0) {
      lines.push(`No tools matched "${query}".`);
    } else {
      lines.push(...results.map(formatResult));
    }
    if (notFound && notFound.length > 0) {
      lines.push(`not found: ${notFound.join(", ")}`);
    }
    if (unreachableServers && unreachableServers.length > 0) {
      lines.push(
        `Unreachable MCP servers (their tools are not in this list): ${unreachableServers
          .map((s) => `${s.name} (${s.error})`)
          .join("; ")}`,
      );
    }
    return { output: lines.join("\n\n"), isError: false };
  },
};
