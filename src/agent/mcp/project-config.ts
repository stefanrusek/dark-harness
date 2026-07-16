// DH-0091: reads a project's own `.mcp.json` (if present in the working directory) so
// `AgentRuntime` can merge its `mcpServers` alongside whatever `dh.json`'s own `mcpServers`
// field already defines — mirroring real Claude Code's auto-pickup of a project's
// `.mcp.json`, and the same "single-file, working-directory-root-only, silent no-op when
// absent" scoping DH-0055 assumes for CLAUDE.md auto-injection (no nested/parent-directory
// search).
//
// Precedence on a name collision: dh.json's own `mcpServers` entry wins. Rationale: dh.json
// is the operator's explicit harness config, applied deliberately; `.mcp.json` is the
// project's own (often committed, less trusted) declaration picked up automatically. An
// operator who wants to override a project's server definition (different command, added
// auth headers, etc.) should not have that override silently clobbered by the project file.
// The precedence itself is enforced by `McpManager.addServers()` (runtime.ts's call site),
// which skips any name already configured from `dh.json` — this module only loads and
// validates the project file, it doesn't decide precedence.

import { ConfigError } from "../../config/errors.ts";
import { validateMcpServers } from "../../config/validate.ts";
import type { McpServerConfig } from "../../contracts/index.ts";

export const PROJECT_MCP_CONFIG_FILENAME = ".mcp.json";

/** Reads `<cwd>/.mcp.json` and returns its validated `mcpServers` map, or `undefined` if the
 * file doesn't exist. Throws `ConfigError` (the same harness-error class dh.json's own
 * loader uses, per ADR 0006) on malformed JSON or a `mcpServers` shape that fails the exact
 * same validation `dh.json` itself is held to. */
export async function loadProjectMcpServers(
  cwd: string,
): Promise<Record<string, McpServerConfig> | undefined> {
  const path = `${cwd}/${PROJECT_MCP_CONFIG_FILENAME}`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return undefined;
  }

  let raw: unknown;
  try {
    const text = await file.text();
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(
      `failed to read ${PROJECT_MCP_CONFIG_FILENAME}: ${(err as Error).message}`,
    );
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`${PROJECT_MCP_CONFIG_FILENAME} must be a JSON object`);
  }

  try {
    return validateMcpServers((raw as Record<string, unknown>).mcpServers);
  } catch (err) {
    throw new ConfigError(`${PROJECT_MCP_CONFIG_FILENAME}: ${(err as Error).message}`);
  }
}
