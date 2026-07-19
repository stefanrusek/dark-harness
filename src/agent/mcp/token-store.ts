// DH-0057: on-disk persistence for one MCP server's OAuth 2.1 state. One file per
// `mcpServers` key under `~/.dh/mcp-auth/<sanitized-server>.json`, dir 0700, file 0600.
// The root is `process.env.DH_HOME ?? ~/.dh` — DH_HOME exists primarily for hermetic test
// isolation (point it at a tmp dir), secondarily for operators who relocate state.
//
// Tokens are per-user secrets, distinct from `dh.json` project config — they never belong in
// `dh.json` and must never be written back into it. Secrets (client_secret, tokens, code
// verifier) live only in this file and are never logged (same rule as `security.token`,
// ADR 0004).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/** dh-added epoch-ms stamp on stored tokens so expiry math doesn't depend on a bare
 * `expires_in` with no acquisition time. */
export interface StoredOAuthTokens extends OAuthTokens {
  /** epoch ms at which these tokens were obtained/persisted. */
  obtained_at?: number;
}

/** The full on-disk shape (`version: 1`). */
export interface StoredMcpAuth {
  version: 1;
  serverName: string;
  serverUrl: string;
  /** From RFC 7591 DCR, or static from config. */
  clientInformation?: OAuthClientInformationFull;
  tokens?: StoredOAuthTokens;
  /** Transient PKCE verifier: present only between `begin` and `complete`. */
  codeVerifier?: string;
  resourceMetadataUrl?: string;
  updatedAt: number;
}

/** Resolves dh's per-user state root: `$DH_HOME` or `~/.dh`. */
export function dhHome(): string {
  return process.env.DH_HOME ?? join(homedir(), ".dh");
}

/** The `mcpServers` key with any non-`[A-Za-z0-9_.-]` char replaced by `_`, so it is a safe
 * single path segment. */
export function sanitizeServerName(serverName: string): string {
  return serverName.replace(/[^A-Za-z0-9_.-]/g, "_");
}

/** Per-server token store wrapping `~/.dh/mcp-auth/<sanitized-server>.json`. Reads and writes
 * are synchronous — the files are tiny and touched only during auth/refresh, not per call. */
export class McpTokenStore {
  readonly serverName: string;
  private readonly dir: string;
  private readonly file: string;

  constructor(serverName: string, home: string = dhHome()) {
    this.serverName = serverName;
    this.dir = join(home, "mcp-auth");
    this.file = join(this.dir, `${sanitizeServerName(serverName)}.json`);
  }

  /** Absolute path to this server's token file (exposed for tests asserting mode/isolation). */
  get filePath(): string {
    return this.file;
  }

  /** Reads and parses the file, or `undefined` if it does not exist. Throws a clear error on
   * a corrupt/unparseable file rather than silently discarding tokens. */
  read(): StoredMcpAuth | undefined {
    if (!existsSync(this.file)) return undefined;
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (err) {
      throw new Error(
        `MCP auth token file for "${this.serverName}" could not be read: ${(err as Error).message}`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `MCP auth token file for "${this.serverName}" is corrupt (invalid JSON): ${this.file}`,
      );
    }
    if (typeof parsed !== "object" || parsed === null || (parsed as StoredMcpAuth).version !== 1) {
      throw new Error(
        `MCP auth token file for "${this.serverName}" is corrupt (unexpected shape): ${this.file}`,
      );
    }
    return parsed as StoredMcpAuth;
  }

  /** Writes the record, creating the dir 0700 and the file 0600 (secrets on disk). Stamps
   * `updatedAt`. */
  write(record: Omit<StoredMcpAuth, "version" | "updatedAt">): StoredMcpAuth {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const full: StoredMcpAuth = { version: 1, ...record, updatedAt: Date.now() };
    writeFileSync(this.file, `${JSON.stringify(full, null, 2)}\n`, { mode: 0o600 });
    return full;
  }

  /** Reads, applies `mutate`, and writes back. Seeds an empty record when none exists. */
  update(mutate: (current: StoredMcpAuth) => void): StoredMcpAuth {
    const current: StoredMcpAuth = this.read() ?? {
      version: 1,
      serverName: this.serverName,
      serverUrl: "",
      updatedAt: 0,
    };
    mutate(current);
    const { version: _v, updatedAt: _u, ...rest } = current;
    return this.write(rest);
  }
}
