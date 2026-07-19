// DH-0174 (Core, extracted from cli.ts): `--import <path>`'s source-location detection.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { ConfigError } from "../config/index.ts";
import type { ImportClaudeSessionSource } from "../server/index.ts";

/** DH-0189: `--import <path>`'s source-location detection (DH-0187 Decision 1) — the only
 * path-kind sniffing the importer's own module (DH-0188, `src/server/import-claude-session
 * .ts`) explicitly says is Core's job, not its own (it only ever receives already-resolved
 * filesystem paths). Two accepted shapes, disambiguated purely by what `path` is on disk:
 *
 * - A **directory**: "archive mode". Preferred: a `manifest.json` naming the session's `id`
 *   (the `session-backup` skill's own output shape), transcript at `<path>/<id>.jsonl`.
 *   Fallback (no `manifest.json`): exactly one `*.jsonl` file directly inside `path`, whose
 *   basename (minus `.jsonl`) is taken as `id`. Zero or multiple candidates is a clean error
 *   — never a silent guess.
 * - A **file ending `.jsonl`**: "live mode" (e.g.
 *   `~/.claude/projects/<slug>/<id>.jsonl`). `id` is the file's own basename minus `.jsonl`.
 *
 * Either way, an optional sub-agent sidecar directory at the sibling `<id>/` path (relative
 * to the archive dir, or the live file's own directory) is picked up if present. A bare live
 * project-slug directory (many sessions, ambiguous) is deliberately rejected — Decision 1's
 * explicit "name the specific .jsonl" call — which falls out naturally here since such a
 * directory has neither a `manifest.json` nor exactly one `*.jsonl` at its top level. */
export function resolveImportSource(path: string): ImportClaudeSessionSource {
  if (!existsSync(path)) {
    throw new ConfigError(`--import path not found: ${path}`);
  }
  const stat = statSync(path);
  if (stat.isDirectory()) {
    const manifestPath = join(path, "manifest.json");
    let id: string;
    if (existsSync(manifestPath)) {
      let manifest: unknown;
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      } catch (err) {
        throw new ConfigError(
          `--import: could not parse "${manifestPath}": ${(err as Error).message}`,
        );
      }
      const manifestId = (manifest as { id?: unknown } | null)?.id;
      if (typeof manifestId !== "string" || manifestId === "") {
        throw new ConfigError(`--import: "${manifestPath}" has no string "id" field`);
      }
      id = manifestId;
    } else {
      const jsonlFiles = readdirSync(path).filter((name) => name.endsWith(".jsonl"));
      if (jsonlFiles.length === 0) {
        throw new ConfigError(
          `--import: "${path}" has no manifest.json and no "*.jsonl" transcript file`,
        );
      }
      if (jsonlFiles.length > 1) {
        throw new ConfigError(
          `--import: "${path}" has no manifest.json and multiple "*.jsonl" files (` +
            `${jsonlFiles.join(", ")}) — ambiguous which one to import; either add a ` +
            "manifest.json or point --import directly at the one .jsonl file",
        );
      }
      id = basename(jsonlFiles[0] as string, ".jsonl");
    }
    const transcriptPath = join(path, `${id}.jsonl`);
    if (!existsSync(transcriptPath)) {
      throw new ConfigError(`--import: expected transcript not found: ${transcriptPath}`);
    }
    const sidecarDir = join(path, id);
    return existsSync(sidecarDir) ? { transcriptPath, sidecarDir } : { transcriptPath };
  }
  if (!path.endsWith(".jsonl")) {
    throw new ConfigError(
      `--import path "${path}" is neither a directory nor a ".jsonl" file. A bare live ` +
        'Claude Code project-slug directory (e.g. "~/.claude/projects/<slug>/") is not ' +
        "accepted — it can hold many sessions; name the specific .jsonl file instead.",
    );
  }
  const id = basename(path, ".jsonl");
  const sidecarDir = join(dirname(path), id);
  return existsSync(sidecarDir) ? { transcriptPath: path, sidecarDir } : { transcriptPath: path };
}
