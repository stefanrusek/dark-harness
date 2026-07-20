import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "../../config/errors.ts";
import { loadProjectMcpServers, PROJECT_MCP_CONFIG_FILENAME } from "./project-config.ts";

describe("loadProjectMcpServers (DH-0091)", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  async function makeDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dh-mcp-test-"));
    dirs.push(dir);
    return dir;
  }

  test("returns undefined when no .mcp.json exists in cwd — unchanged behavior", async () => {
    const dir = await makeDir();
    expect(await loadProjectMcpServers(dir)).toBeUndefined();
  });

  test("parses and validates a present .mcp.json's mcpServers, same shape as dh.json's own", async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, PROJECT_MCP_CONFIG_FILENAME),
      JSON.stringify({ mcpServers: { docs: { url: "https://example.com/mcp" } } }),
    );
    const servers = await loadProjectMcpServers(dir);
    expect(servers).toEqual({ docs: { url: "https://example.com/mcp" } });
  });

  test("returns undefined when .mcp.json exists but has no mcpServers key", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, PROJECT_MCP_CONFIG_FILENAME), JSON.stringify({}));
    expect(await loadProjectMcpServers(dir)).toBeUndefined();
  });

  test("throws ConfigError on malformed JSON, not a crash", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, PROJECT_MCP_CONFIG_FILENAME), "{ not valid json");
    await expect(loadProjectMcpServers(dir)).rejects.toThrow(ConfigError);
  });

  test("throws ConfigError when the file's top level isn't a JSON object", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, PROJECT_MCP_CONFIG_FILENAME), JSON.stringify([1, 2, 3]));
    await expect(loadProjectMcpServers(dir)).rejects.toThrow(/\.mcp\.json must be a JSON object/);
  });

  test("throws ConfigError when mcpServers itself fails validation (reuses dh.json's own rules)", async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, PROJECT_MCP_CONFIG_FILENAME),
      JSON.stringify({ mcpServers: { bad: {} } }),
    );
    await expect(loadProjectMcpServers(dir)).rejects.toThrow(
      /must specify either "command" \(stdio\) or "url" \(HTTP\)/,
    );
  });
});
