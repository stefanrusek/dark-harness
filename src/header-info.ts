// DH-0122: shared, framework-independent app-header content builder. Every surface (CLI
// startup blocks incl. `dh doctor`, TUI's `<Header>`, Web's `<AppHeader>`) sources the same
// name/logo/version/config-status data from here instead of independently re-deriving it and
// drifting apart — same "root-level src/ shared module" precedent as design-tokens.ts
// (status colors) and format.ts (number/cost formatters). Pure functions only, no DOM/node/
// process/ANSI here — TTY color/glyph decisions and DOM/Ink rendering stay in each surface.
import type { BuildInfo, DhConfig } from "./contracts/index.ts";
import { DH_ASCII_LOGO, DH_ASCII_LOGO_COMPACT } from "./prompt/banner.constant.ts";

/**
 * A summary of `dh.json`'s status relevant to an operator connecting from another
 * process/machine (ticket DH-0122): whether it exists, how many models it configures, and
 * the security-relevant knobs (`bind`/`token`/`tls`) that matter when reaching this process
 * remotely. Never includes the token value itself (ADR 0003: never logged).
 */
export interface ConfigStatusSummary {
  exists: boolean;
  /** Path the config was (or would be) loaded from, e.g. "dh.json". */
  path: string;
  modelCount: number;
  /** `security.hostname` (DH-0022), when set — the bind address a remote operator needs. */
  hostname?: string;
  hasToken: boolean;
  hasTls: boolean;
}

export interface HeaderInfo {
  name: string;
  logoFull: string;
  logoCompact: string;
  build: BuildInfo;
  config: ConfigStatusSummary;
}

/** `config` is `null` when it failed to load/doesn't exist yet (e.g. a future `dh init`
 * degenerate case) — every other call site today only builds a `HeaderInfo` after a
 * successful `loadConfig`, so `exists` is `true` in practice, but the shape supports the
 * missing case without a separate type. */
export function buildConfigStatusSummary(
  config: DhConfig | null,
  path: string,
): ConfigStatusSummary {
  if (!config) {
    return { exists: false, path, modelCount: 0, hasToken: false, hasTls: false };
  }
  return {
    exists: true,
    path,
    modelCount: config.models.length,
    ...(config.security?.hostname ? { hostname: config.security.hostname } : {}),
    hasToken: Boolean(config.security?.token),
    hasTls: Boolean(config.security?.tls),
  };
}

export function buildHeaderInfo(
  config: DhConfig | null,
  configPath: string,
  build: BuildInfo,
): HeaderInfo {
  return {
    name: "dh",
    logoFull: DH_ASCII_LOGO,
    logoCompact: DH_ASCII_LOGO_COMPACT,
    build,
    config: buildConfigStatusSummary(config, configPath),
  };
}

/** Round 8 (moved here from cli.ts for DH-0122): "which build produced this?" shouldn't
 * require digging through a log directory. Format: `dh <version> (<sha|unstamped>[
 * dirty][, <releaseTag>])`. */
export function formatVersionString(build: BuildInfo): string {
  let inner = build.gitSha ?? "unstamped";
  if (build.dirty) inner += " dirty";
  if (build.releaseTag) inner += `, ${build.releaseTag}`;
  return `dh ${build.version} (${inner})`;
}

/** Plain-text (no ANSI) one-liner summarizing `dh.json`'s status — the piece an operator
 * connecting from another machine cares about: model count and how this process is
 * reachable (bind address, whether a bearer token/TLS is required). */
export function formatConfigStatusLine(summary: ConfigStatusSummary): string {
  if (!summary.exists) {
    return `config: not found (${summary.path})`;
  }
  const bits = [`${summary.modelCount} model${summary.modelCount === 1 ? "" : "s"}`];
  bits.push(`bind ${summary.hostname ?? "all interfaces"}`);
  bits.push(summary.hasToken ? "token required" : "no token");
  if (summary.hasTls) bits.push("tls on");
  return `config: ${summary.path} — ${bits.join(", ")}`;
}

/** Plain-text (no ANSI) header block: full logo (unless `compact`) + version line + config
 * status line. Callers on a TTY may re-wrap individual lines in color/bold; this is the
 * shared byte content underneath every such rendering. */
export function formatHeaderLines(info: HeaderInfo, opts: { compact?: boolean } = {}): string[] {
  const lines: string[] = [];
  if (!opts.compact) lines.push(...info.logoFull.split("\n"));
  lines.push(formatVersionString(info.build));
  lines.push(formatConfigStatusLine(info.config));
  return lines;
}

/** DH-0124: the lighter empty-state variant — compact logo + version identity only, no
 * config-status line. Used before the operator's first message, when a full header (with its
 * `dh.json` model-count/bind/token summary) would be noise: nothing about that config is
 * relevant yet, and — for a TUI `--connect`ed to a remote server — isn't even known locally
 * (see Header.tsx's header comment). */
export function formatEmptyStateLines(info: HeaderInfo): string[] {
  return [info.logoCompact, formatVersionString(info.build)];
}
