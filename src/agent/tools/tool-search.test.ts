import { describe, expect, test } from "bun:test";
import { makeToolContext } from "./test-helpers.ts";
import {
  DEFAULT_MAX_RESULTS,
  runToolSearch,
  type ToolDescriptor,
  toolSearchTool,
} from "./tool-search.ts";

const BUILTIN_SCHEMA = { type: "object" as const, properties: {} };

const CORPUS: ToolDescriptor[] = [
  { name: "Bash", description: "Run a shell command.", inputSchema: BUILTIN_SCHEMA },
  { name: "Read", description: "Read a file from disk.", inputSchema: BUILTIN_SCHEMA },
  {
    name: "mcp__github__create_issue",
    description: "Create a GitHub issue.",
    inputSchema: BUILTIN_SCHEMA,
    deferred: true,
    serverName: "github",
  },
  {
    name: "mcp__github__list_issues",
    description: "List GitHub issues in a repo.",
    inputSchema: BUILTIN_SCHEMA,
    deferred: true,
    serverName: "github",
  },
  {
    name: "mcp__slack__post_message",
    description: "Post a message to a Slack channel.",
    inputSchema: BUILTIN_SCHEMA,
    deferred: true,
    serverName: "slack",
  },
];

describe("runToolSearch: select: grammar", () => {
  test("returns exact matches by name, comma-separated, whitespace-trimmed", () => {
    const result = runToolSearch(CORPUS, "select: Bash , mcp__github__create_issue ");
    expect(result.results.map((r) => r.name)).toEqual(["Bash", "mcp__github__create_issue"]);
    expect(result.notFound).toBeUndefined();
  });

  test("reports not-found names explicitly", () => {
    const result = runToolSearch(CORPUS, "select:Bash,DoesNotExist");
    expect(result.results.map((r) => r.name)).toEqual(["Bash"]);
    expect(result.notFound).toEqual(["DoesNotExist"]);
  });

  test("ignores max_results — returns exactly what was selected, uncapped", () => {
    const result = runToolSearch(
      CORPUS,
      "select:Bash,Read,mcp__github__create_issue,mcp__github__list_issues,mcp__slack__post_message",
      1,
    );
    expect(result.results).toHaveLength(5);
  });
});

describe("runToolSearch: +term required-token filtering", () => {
  test("keeps only descriptors matching every +term (case-insensitive)", () => {
    const result = runToolSearch(CORPUS, "+github +issue");
    expect(result.results.map((r) => r.name).sort()).toEqual([
      "mcp__github__create_issue",
      "mcp__github__list_issues",
    ]);
  });

  test("drops everything when a +term matches nothing", () => {
    const result = runToolSearch(CORPUS, "+nonexistentterm");
    expect(result.results).toEqual([]);
  });
});

describe("runToolSearch: keyword ranking", () => {
  test("weighs a name hit above a description-only hit", () => {
    const result = runToolSearch(CORPUS, "github", 10);
    const names = result.results.map((r) => r.name);
    expect(names[0]).toBe("mcp__github__create_issue");
    expect(names).toContain("mcp__github__list_issues");
  });

  test("tiebreaks equal scores alphabetically by name", () => {
    const result = runToolSearch(CORPUS, "issue", 10);
    const issueTools = result.results.filter((r) => r.name.startsWith("mcp__github"));
    expect(issueTools.map((r) => r.name)).toEqual([
      "mcp__github__create_issue",
      "mcp__github__list_issues",
    ]);
  });

  test("default max_results caps ranked output at 5", () => {
    const bigCorpus: ToolDescriptor[] = Array.from({ length: 10 }, (_, i) => ({
      name: `tool${i}`,
      description: "match",
      inputSchema: BUILTIN_SCHEMA,
    }));
    const result = runToolSearch(bigCorpus, "match");
    expect(result.results).toHaveLength(DEFAULT_MAX_RESULTS);
  });

  test("explicit max_results overrides the default", () => {
    const bigCorpus: ToolDescriptor[] = Array.from({ length: 10 }, (_, i) => ({
      name: `tool${i}`,
      description: "match",
      inputSchema: BUILTIN_SCHEMA,
    }));
    const result = runToolSearch(bigCorpus, "match", 2);
    expect(result.results).toHaveLength(2);
  });

  test("empty query returns the whole corpus, alphabetically, capped by max_results", () => {
    const result = runToolSearch(CORPUS, "", 100);
    expect(result.results).toHaveLength(CORPUS.length);
    const names = result.results.map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe("ToolSearch tool", () => {
  test("formats results with description and inputSchema JSON", async () => {
    const ctx = makeToolContext({
      searchDeferredTools: async () => ({
        results: [
          { name: "Bash", description: "Run a shell command.", inputSchema: BUILTIN_SCHEMA },
        ],
      }),
    });
    const result = await toolSearchTool.execute({ query: "bash" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain("Bash");
    expect(result.output).toContain("Run a shell command.");
    expect(result.output).toContain(JSON.stringify(BUILTIN_SCHEMA));
  });

  test("reports no matches clearly", async () => {
    const ctx = makeToolContext({ searchDeferredTools: async () => ({ results: [] }) });
    const result = await toolSearchTool.execute({ query: "nonexistent" }, ctx);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('No tools matched "nonexistent"');
  });

  test("surfaces not-found names from select: queries", async () => {
    const ctx = makeToolContext({
      searchDeferredTools: async () => ({ results: [], notFound: ["Nope"] }),
    });
    const result = await toolSearchTool.execute({ query: "select:Nope" }, ctx);
    expect(result.output).toContain("not found: Nope");
  });

  test("surfaces unreachable-server footer without dropping it", async () => {
    const ctx = makeToolContext({
      searchDeferredTools: async () => ({
        results: [],
        unreachableServers: [{ name: "github", error: "connect ECONNREFUSED" }],
      }),
    });
    const result = await toolSearchTool.execute({ query: "anything" }, ctx);
    expect(result.output).toContain("github");
    expect(result.output).toContain("connect ECONNREFUSED");
  });

  test("passes max_results through to searchDeferredTools", async () => {
    let receivedOptions: { maxResults?: number } | undefined;
    const ctx = makeToolContext({
      searchDeferredTools: async (_query, options) => {
        receivedOptions = options;
        return { results: [] };
      },
    });
    await toolSearchTool.execute({ query: "x", max_results: 3 }, ctx);
    expect(receivedOptions).toEqual({ maxResults: 3 });
  });

  test("rejects a non-integer max_results", async () => {
    const ctx = makeToolContext();
    const result = await toolSearchTool.execute({ query: "x", max_results: 1.5 }, ctx);
    expect(result.isError).toBe(true);
  });

  test("rejects a non-string query", async () => {
    const ctx = makeToolContext();
    const result = await toolSearchTool.execute({ query: 5 }, ctx);
    expect(result.isError).toBe(true);
  });
});
