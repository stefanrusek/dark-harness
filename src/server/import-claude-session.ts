// DH-0188 (tracking/DH-0188-import-claude-code-session-translation-jsonl-writer.md):
// Server-owned half of DH-0187's `--import` design (Fable, 2026-07-18 architect design in
// DH-0187 — Decisions 2/3/4 govern everything in this file). A pure translator: reads a real
// Claude Code session (the shape the `session-backup`/`session-restore` skills already
// archive — a root `<id>.jsonl` transcript, optional `<id>/subagents/*.jsonl` +
// `*.meta.json` sidecar) and writes a valid dh `.dh-logs/<sessionId>/` directory (ADR 0004/
// 0005: one JSONL per agent, header first line, then event lines) via `SessionLogger` — the
// same primitive `AgentRuntime` itself uses, so the output is byte-for-byte what a real dh
// run would have produced, not a hand-rolled approximation.
//
// Import never touches the agent runtime or providers (DH-0187's "import writes logs, resume
// replays them" governing insight) — its only contract is producing something
// `src/agent/resume.ts`'s `foldEventsToMessages`/`readAgentLogLines` can fold back into
// `ProviderMessage[]` without modification. `--import`'s CLI wiring (path-kind detection,
// `--model` resolution, launching `--resume` on the produced session id) is Core's job
// (DH-0189) — this module only ever receives already-resolved filesystem paths and an
// already-resolved dh model alias.

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { BuildInfo, LogEvent, LogHeader, SessionClientKind } from "../contracts/index.ts";
import { SessionLogger } from "./logger.ts";

/** Filesystem inputs, already resolved by the caller (Core, DH-0187 Decision 1's path-kind
 * detection) — this module does no path-kind sniffing of its own. */
export interface ImportClaudeSessionSource {
  /** Path to the root `<id>.jsonl` transcript. */
  transcriptPath: string;
  /** Path to the optional `<id>/` sidecar directory (`subagents/`, `tool-results/`).
   * Undefined when the source session never spawned sub-agents. */
  sidecarDir?: string;
}

export interface ImportClaudeSessionOptions {
  /** Root of the `.dh-logs/` tree to write into (mirrors `SessionLogger`'s `logDir` — this
   * is the *parent* of the new session directory, not the session directory itself). */
  logsRoot: string;
  /** A dh.json-resolved model alias (DH-0187 Decision 5 — resolution against `dh.json`, and
   * the default-to-`defaultModel` behavior when `--model` is omitted, are Core's job; this
   * module just stamps whatever valid alias it's given onto every written header). */
  model: string;
  /** `LogHeader.client` to stamp on every written agent (root + sub-agents). Defaults to
   * `"none"` — an imported session has no live client attached at write time; Core may
   * override once it knows which surface (`--resume` under `--web`/TUI/headless) will open
   * it next. */
  client?: SessionClientKind;
  /** `LogHeader.build` to stamp. Defaults to an unstamped placeholder (import is not itself
   * a compiled-binary event) — real callers running from a compiled `dh` may pass the
   * binary's own stamped `BuildInfo` through instead. */
  build?: BuildInfo;
}

export interface ImportClaudeSessionResult {
  /** The freshly-minted dh session id — pass this to `--resume` (or its equivalent) to open
   * the imported conversation. */
  sessionId: string;
  /** `opts.logsRoot`, echoed back for caller convenience (matches the interface DH-0187
   * specifies: `importClaudeSession(source, opts) → { sessionId, logsRoot }`). */
  logsRoot: string;
}

const UNSTAMPED_BUILD: BuildInfo = Object.freeze({
  version: "import",
  gitSha: null,
  dirty: false,
  releaseTag: null,
});

/** Claude Code line shapes are read as loosely-typed records — this module deliberately does
 * not import/depend on any Claude Code type definitions (none exist in this repo; the source
 * format is documented only in DH-0187), and FR7 requires tolerating unknown/future fields
 * and line types without crashing, so a strict type would fight the requirement rather than
 * help it. */
// biome-ignore lint/suspicious/noExplicitAny: source format is intentionally untyped, see above.
type CcLine = Record<string, any>;

interface ParsedTranscript {
  lines: CcLine[];
}

/** Tolerant JSONL parse (FR7): a truncated/corrupt final line (or any line) is skipped, never
 * thrown — mirrors `log-analysis.ts`'s `parseJsonlContent` policy for dh's own logs. */
function parseCcJsonl(content: string): CcLine[] {
  const lines: CcLine[] = [];
  for (const raw of content.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    try {
      lines.push(JSON.parse(trimmed) as CcLine);
    } catch {
      // Truncated final line or otherwise corrupt — skip, don't sink the whole import.
    }
  }
  return lines;
}

function readTranscript(path: string): ParsedTranscript {
  return { lines: parseCcJsonl(readFileSync(path, "utf8")) };
}

/** Extracts human-readable text from a Claude Code `message.content`, which is either a bare
 * string or an array of content blocks (text/tool_use/tool_result/thinking/image/...). Joins
 * every `text`-typed block; ignores everything else (tool_use/tool_result/thinking are
 * translated into their own dedicated events by the caller, not folded into message text). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: string; text: string } => b?.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

/** Stringifies a Claude Code `tool_result` block's `content` for a dh `tool_result` event's
 * `output` — mirrors `resume.ts`'s own `stringifyToolOutput` contract (logged as `unknown`
 * but a string in practice). */
function stringifyToolResultContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((b): b is { type: string; text: string } => b?.type === "text")
      .map((b) => b.text);
    if (texts.length > 0) return texts.join("\n");
  }
  return JSON.stringify(content);
}

/** Best-effort one-line summary of a `system` line (DH-0187 Decision 4: mapped to a
 * `system`-role `message`, kept for diagnostics, never replayed — `foldEventsToMessages`
 * skips `role: "system"` unconditionally). System lines carry a `subtype`-specific shape with
 * no shared `message`/text field, so this is necessarily an approximation, not a lossless
 * transcription. */
function summarizeSystemLine(line: CcLine): string {
  const parts: string[] = [];
  if (typeof line.subtype === "string") parts.push(`subtype=${line.subtype}`);
  if (Array.isArray(line.hookAdditionalContext) && line.hookAdditionalContext.length > 0) {
    parts.push(String(line.hookAdditionalContext.join(" ")));
  }
  if (parts.length === 0) parts.push("(claude code system line, no summary available)");
  return `[claude code import: system] ${parts.join(" ")}`;
}

/** Lossy-content dispositions (DH-0187 Decision 4) that are pure drops — no dh event is ever
 * emitted for these, and they carry no information import needs to consume. */
const DROPPED_LINE_TYPES = Object.freeze(
  new Set([
    "file-history-snapshot",
    "file-history-delta",
    "mode",
    "permission-mode",
    "last-prompt",
    "bridge-session",
    "pr-link",
    "queue-operation",
  ]),
);

/** Result of translating one Claude Code agent transcript (root or sub-agent) into dh
 * `LogEvent`s, plus the bits the tree-builder / provenance-writer need afterward. */
interface TranslatedAgent {
  events: LogEvent[];
  /** Every `Agent`/`Task` `tool_use` id emitted in this agent's own stream, in case a deeper
   * sub-agent's `meta.toolUseId` resolves to *this* agent rather than the root (DH-0187
   * Decision 3: depth-2+ nesting). */
  spawnToolUseIds: Set<string>;
  /** First line's `timestamp`, used as this agent's `spawnedAt` — undefined if the
   * transcript had no parseable timestamped line at all. */
  firstTimestamp?: string;
  /** `ai-title` line's text, if present — used for `header.description` on the root agent
   * only (DH-0187 Decision 4). */
  aiTitle?: string;
  /** True if the last meaningful event suggests the agent's final turn ended in error (best-
   * effort heuristic — Claude Code source transcripts don't carry an explicit terminal
   * success/failure flag the way dh's own `ReportOutcome` does). */
  endedInError: boolean;
  /** Original Claude Code model alias seen on any assistant line, for provenance text. */
  sourceModel?: string;
  /** Inline (`isSidechain:true`, non-sidecar) sub-agent branches found in this stream,
   * bucketed by `agentId` field (or a synthetic per-run key when absent). */
  inlineSidechains: Map<string, CcLine[]>;
}

/** Translates one Claude Code agent's line stream (main transcript, or one `subagents/*.jsonl`
 * file) into dh `LogEvent`s, per DH-0187 Decision 2's mapping table and Decision 4's lossy-
 * content dispositions. Also segregates inline `isSidechain:true` runs (grouped by their
 * `agentId` field, or — when that's absent — by contiguous run, per DH-0187 Decision 3's
 * "must be tolerated even though the sampled backup uses the sidecar mechanism instead")
 * into their own buckets, returned via `inlineSidechains` for the caller to translate
 * recursively exactly like a sidecar subagent. */
function translateAgentLines(lines: CcLine[], ownAgentId?: string): TranslatedAgent {
  const events: LogEvent[] = [];
  const spawnToolUseIds = new Set<string>();
  let firstTimestamp: string | undefined;
  let aiTitle: string | undefined;
  let endedInError = false;
  let sourceModel: string | undefined;
  const inlineSidechains = new Map<string, CcLine[]>();

  // DH-0187 Decision 4's attachment handling: textual (or placeholder, for non-textual)
  // attachment content is buffered and inlined into the *next* user turn's text — the
  // simplest faithful reading of "inline into owning user turn's text" that source order
  // reliably supports without guessing at cross-referencing `parentUuid` chains an
  // attachment line doesn't actually carry a link into.
  let pendingAttachmentText: string[] = [];

  for (const line of lines) {
    const type = typeof line.type === "string" ? line.type : undefined;

    // A bucket produced by an earlier level of this same recursion (sidecar subagent file,
    // or a previously-segregated inline branch) is re-translated with `ownAgentId` set to
    // the id that bucket already belongs to — its lines still carry `isSidechain:true` (that
    // flag is never cleared) so without this check every line would re-bucket itself right
    // back into `inlineSidechains` under its own key forever. Only a line whose `agentId` is
    // both present and different from `ownAgentId` (a genuinely nested deeper branch) gets
    // segregated here; a sidechain line with no `agentId` at all (the older, rarer inline
    // shape DH-0187 flags as "must be tolerated" without a real example to key off of) is
    // folded into whichever stream is currently being translated rather than invented a
    // synthetic grouping for — still preserved, just not further subdivided.
    if (
      line.isSidechain === true &&
      typeof line.agentId === "string" &&
      line.agentId !== ownAgentId
    ) {
      const bucket = inlineSidechains.get(line.agentId) ?? [];
      bucket.push(line);
      inlineSidechains.set(line.agentId, bucket);
      continue;
    }

    if (typeof line.timestamp === "string" && firstTimestamp === undefined) {
      firstTimestamp = line.timestamp;
    }

    if (type === undefined) continue;

    if (type === "ai-title") {
      if (typeof line.aiTitle === "string") aiTitle = line.aiTitle;
      continue;
    }

    if (DROPPED_LINE_TYPES.has(type)) continue;

    if (type === "attachment") {
      const attachment = line.attachment ?? {};
      const content = attachment.content;
      const text =
        typeof content === "string" && content.length > 0
          ? content
          : `[dh import: ${String(attachment.type ?? "unknown")} attachment omitted]`;
      pendingAttachmentText.push(
        `[dh import: attachment ${String(attachment.type ?? "unknown")}]\n${text}`,
      );
      continue;
    }

    if (type === "system") {
      events.push({
        version: 1,
        timestamp: String(line.timestamp ?? new Date().toISOString()),
        type: "message",
        role: "system",
        content: summarizeSystemLine(line),
      });
      continue;
    }

    if (type === "user") {
      const timestamp = String(line.timestamp ?? new Date().toISOString());
      const content = line.message?.content;
      const blocks = Array.isArray(content) ? content : undefined;

      if (blocks) {
        for (const block of blocks) {
          if (block?.type === "tool_result") {
            events.push({
              version: 1,
              timestamp,
              type: "tool_result",
              toolUseId: String(block.tool_use_id ?? ""),
              output: stringifyToolResultContent(block.content),
              isError: block.is_error === true,
            });
          }
        }
      }

      let text = extractText(content);
      if (pendingAttachmentText.length > 0) {
        text = `${pendingAttachmentText.join("\n\n")}${text ? `\n\n${text}` : ""}`;
        pendingAttachmentText = [];
      }
      if (text.length > 0) {
        events.push({ version: 1, timestamp, type: "message", role: "user", content: text });
      }
      continue;
    }

    if (type === "assistant") {
      const timestamp = String(line.timestamp ?? new Date().toISOString());
      const message = line.message ?? {};
      if (typeof message.model === "string") sourceModel = message.model;
      const content = message.content;
      const blocks = Array.isArray(content) ? content : [];

      const text = extractText(content);
      if (text.length > 0) {
        events.push({ version: 1, timestamp, type: "message", role: "assistant", content: text });
      }

      for (const block of blocks) {
        if (block?.type === "tool_use") {
          const toolUseId = String(block.id ?? "");
          const toolName = block.name === "Task" ? "Agent" : String(block.name ?? "unknown");
          if (toolName === "Agent") spawnToolUseIds.add(toolUseId);
          events.push({
            version: 1,
            timestamp,
            type: "tool_call",
            toolName,
            toolUseId,
            input: block.input,
          });
        } else if (block?.type === "thinking") {
          events.push({
            version: 1,
            timestamp,
            type: "thinking",
            content: typeof block.thinking === "string" ? block.thinking : "",
            redacted: false,
          });
        } else if (block?.type === "redacted_thinking") {
          events.push({ version: 1, timestamp, type: "thinking", content: "", redacted: true });
        }
      }

      const usage = message.usage;
      if (usage && typeof usage === "object") {
        events.push({
          version: 1,
          timestamp,
          type: "token_usage",
          inputTokens: Number(usage.input_tokens ?? 0),
          outputTokens: Number(usage.output_tokens ?? 0),
          ...(usage.cache_read_input_tokens !== undefined
            ? { cacheReadTokens: Number(usage.cache_read_input_tokens) }
            : {}),
          ...(usage.cache_creation_input_tokens !== undefined
            ? { cacheWriteTokens: Number(usage.cache_creation_input_tokens) }
            : {}),
        });
      }

      endedInError = message.stop_reason === "error" || message.stop_reason === "refusal";
      continue;
    }

    // Unknown/future line type (FR7): annotate, don't crash and don't silently vanish.
    events.push({
      version: 1,
      timestamp: String(line.timestamp ?? new Date().toISOString()),
      type: "message",
      role: "system",
      content: `[dh import: unrecognized source line type "${type}" skipped]`,
    });
  }

  return {
    events,
    spawnToolUseIds,
    ...(firstTimestamp !== undefined ? { firstTimestamp } : {}),
    ...(aiTitle !== undefined ? { aiTitle } : {}),
    endedInError,
    ...(sourceModel !== undefined ? { sourceModel } : {}),
    inlineSidechains,
  };
}

interface SidecarSubagent {
  ccAgentId: string;
  meta: CcLine;
  lines: CcLine[];
}

/** Reads every `subagents/agent-<ccid>.jsonl` + companion `.meta.json` pair from the sidecar
 * directory, tolerant of a `.jsonl` with no matching `.meta.json` or vice versa (skipped —
 * DH-0187 Decision 3's tree edge only resolves for complete pairs). */
function readSidecarSubagents(sidecarDir: string): SidecarSubagent[] {
  const subagentsDir = join(sidecarDir, "subagents");
  if (!existsSync(subagentsDir)) return [];
  const files = readdirSync(subagentsDir);
  const result: SidecarSubagent[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const ccAgentId = basename(file, ".jsonl");
    const metaPath = join(subagentsDir, `${ccAgentId}.meta.json`);
    if (!existsSync(metaPath)) continue;
    let meta: CcLine;
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8")) as CcLine;
    } catch {
      continue;
    }
    const lines = parseCcJsonl(readFileSync(join(subagentsDir, file), "utf8"));
    result.push({ ccAgentId, meta, lines });
  }
  // DH-0187 Decision 3: build depth-1 agents before depth-2+ so a deeper child's
  // `meta.toolUseId` can resolve against an already-mapped parent's emitted tool_use ids.
  result.sort((a, b) => Number(a.meta.spawnDepth ?? 0) - Number(b.meta.spawnDepth ?? 0));
  return result;
}

let mintCounter = 0;

/** Mints a fresh, filesystem-safe dh agent id for an imported sub-agent, deterministically
 * derived from the Claude Code sub-agent id it came from (readable in logs/diagnostics)
 * while guaranteeing no collision with the root agent id or with itself across a session
 * (the counter suffix only matters for the pathological case of two different source ids
 * colliding after sanitization, which shouldn't happen in practice but costs nothing to
 * guard). */
function mintAgentId(sourceId: string): string {
  const safe = sourceId.replace(/[^a-zA-Z0-9_-]/g, "-");
  mintCounter += 1;
  return `agent-import-${safe}-${mintCounter}`;
}

function lastTimestamp(translated: { events: LogEvent[] }, fallback: string): string {
  return translated.events.at(-1)?.timestamp ?? fallback;
}

const ROOT_AGENT_ID = "agent-root";

/** Writes one already-translated agent's header + events + terminal status/completed(or
 * failed) lines, and recurses into its inline sidechains. Shared by the root agent, sidecar
 * subagents, and inline-sidechain branches — all three are "an agent transcript, a parent id,
 * and provenance text" once translated, so they share one writer instead of three near-
 * duplicate call sites. */
function writeTranslatedAgent(
  logger: SessionLogger,
  agentId: string,
  parentAgentId: string | null,
  translated: TranslatedAgent,
  sessionId: string,
  model: string,
  client: SessionClientKind,
  build: BuildInfo,
  instructionsSummary: string,
  description: string | undefined,
  leadingEvent: LogEvent | undefined,
): string {
  const spawnedAt = translated.firstTimestamp ?? new Date().toISOString();
  const header: LogHeader = {
    type: "header",
    version: 1,
    sessionId,
    agentId,
    parentAgentId,
    spawnedAt,
    model,
    instructionsSummary,
    client,
    build,
    ...(description !== undefined ? { description } : {}),
  };
  logger.append(agentId, header);
  if (leadingEvent) logger.append(agentId, leadingEvent);
  for (const event of translated.events) logger.append(agentId, event);

  const finalTimestamp = lastTimestamp(translated, spawnedAt);
  const finalStatus = translated.endedInError ? "failed" : "done";
  logger.append(agentId, {
    version: 1,
    timestamp: finalTimestamp,
    type: "status_change",
    status: finalStatus,
  });
  if (finalStatus === "failed") {
    logger.append(agentId, {
      version: 1,
      timestamp: finalTimestamp,
      type: "failed",
      reason: "imported agent's source transcript ended on an error turn",
    });
  } else {
    logger.append(agentId, {
      version: 1,
      timestamp: finalTimestamp,
      type: "completed",
      success: true,
    });
  }
  return agentId;
}

/** Writes inline (`isSidechain:true`, non-sidecar) sub-agent branches as their own sub-agent
 * JSONL files, parented under whichever agent's transcript they were embedded in — DH-0187
 * Decision 3's "must be tolerated" clause for the older inline representation. These have no
 * `meta.json` (no `toolUseId`/`agentType`/`description`), so they carry only generic
 * provenance. Recurses for sidechains nested within a sidechain. */
function writeInlineSidechains(
  logger: SessionLogger,
  inlineSidechains: Map<string, CcLine[]>,
  parentAgentId: string,
  sessionId: string,
  model: string,
  client: SessionClientKind,
  build: BuildInfo,
): void {
  for (const [key, lines] of inlineSidechains) {
    const translated = translateAgentLines(lines, key);
    const agentId = mintAgentId(`inline-${key}`);
    writeTranslatedAgent(
      logger,
      agentId,
      parentAgentId,
      translated,
      sessionId,
      model,
      client,
      build,
      `imported inline Claude Code sidechain branch "${key}"`,
      undefined,
      undefined,
    );
    writeInlineSidechains(
      logger,
      translated.inlineSidechains,
      agentId,
      sessionId,
      model,
      client,
      build,
    );
  }
}

/** DH-0188's public interface (DH-0187 FR3): translates a Claude Code session (root
 * transcript + optional sidecar) into a valid dh `.dh-logs/<sessionId>/` directory and
 * returns the minted session id. Writes via `SessionLogger` (FR3: "reuse the existing
 * session-write primitives... rather than hand-rolling JSONL serialization") so the output
 * is exactly what `SessionLogger.append` would have produced for a live run, including its
 * secrets-redaction and structurally-critical-line fsync behavior. */
export function importClaudeSession(
  source: ImportClaudeSessionSource,
  opts: ImportClaudeSessionOptions,
): ImportClaudeSessionResult {
  const sessionId = randomUUID();
  const logger = new SessionLogger(join(opts.logsRoot, sessionId));
  const client: SessionClientKind = opts.client ?? "none";
  const build = opts.build ?? UNSTAMPED_BUILD;

  const originalSessionId = basename(source.transcriptPath, ".jsonl");
  const { lines: rootLines } = readTranscript(source.transcriptPath);
  const root = translateAgentLines(rootLines);

  const provenance =
    `imported from Claude Code session "${originalSessionId}" ` +
    `(source model: ${root.sourceModel ?? "unknown"}), source path: ${source.transcriptPath}`;

  const provenanceEvent: LogEvent = {
    version: 1,
    timestamp: root.firstTimestamp ?? new Date().toISOString(),
    type: "message",
    role: "system",
    content: `[dh import] ${provenance}`,
  };

  writeTranslatedAgent(
    logger,
    ROOT_AGENT_ID,
    null,
    root,
    sessionId,
    opts.model,
    client,
    build,
    provenance,
    root.aiTitle,
    provenanceEvent,
  );

  // Map: Claude Code toolUseId -> dh agentId of whichever agent's `tool_call` stream emitted
  // that Agent/Task tool_use — resolved incrementally as agents are translated (root first,
  // then sidecar subagents in ascending spawnDepth order), so a depth-2 child can resolve
  // against a depth-1 parent that was itself just mapped.
  const toolUseIdToAgentId = new Map<string, string>();
  for (const id of root.spawnToolUseIds) toolUseIdToAgentId.set(id, ROOT_AGENT_ID);

  writeInlineSidechains(
    logger,
    root.inlineSidechains,
    ROOT_AGENT_ID,
    sessionId,
    opts.model,
    client,
    build,
  );

  const sidecarSubagents = source.sidecarDir ? readSidecarSubagents(source.sidecarDir) : [];
  const orphanAnnotations: string[] = [];

  for (const sub of sidecarSubagents) {
    // The sidecar file's own lines carry their bare Claude Code `agentId` (e.g.
    // `a0175126107d8f258`), not the `agent-`-prefixed filename stem (`ccAgentId`) — derive
    // `ownAgentId` from the lines themselves so the "don't re-bucket my own lines" check in
    // `translateAgentLines` actually matches.
    const ownAgentId = sub.lines.find((l) => typeof l.agentId === "string")?.agentId as
      | string
      | undefined;
    const translated = translateAgentLines(sub.lines, ownAgentId);
    const toolUseId = typeof sub.meta.toolUseId === "string" ? sub.meta.toolUseId : undefined;
    const parentAgentId = toolUseId ? toolUseIdToAgentId.get(toolUseId) : undefined;
    const resolvedParentAgentId = parentAgentId ?? ROOT_AGENT_ID;
    if (toolUseId === undefined || parentAgentId === undefined) {
      orphanAnnotations.push(
        `[dh import: sub-agent "${sub.ccAgentId}" had no resolvable parent tool_use ` +
          `(toolUseId "${String(toolUseId)}") — attached to root]`,
      );
    }

    const agentId = mintAgentId(sub.ccAgentId);
    for (const id of translated.spawnToolUseIds) toolUseIdToAgentId.set(id, agentId);

    const description = typeof sub.meta.description === "string" ? sub.meta.description : undefined;
    const agentType = typeof sub.meta.agentType === "string" ? sub.meta.agentType : "unknown";
    const subProvenance =
      `imported Claude Code sub-agent "${sub.ccAgentId}" (agentType: ${agentType}), ` +
      `source model: ${translated.sourceModel ?? "unknown"}`;

    writeTranslatedAgent(
      logger,
      agentId,
      resolvedParentAgentId,
      translated,
      sessionId,
      opts.model,
      client,
      build,
      subProvenance,
      description,
      undefined,
    );

    writeInlineSidechains(
      logger,
      translated.inlineSidechains,
      agentId,
      sessionId,
      opts.model,
      client,
      build,
    );
  }

  if (orphanAnnotations.length > 0) {
    const timestamp = new Date().toISOString();
    for (const text of orphanAnnotations) {
      logger.append(ROOT_AGENT_ID, {
        version: 1,
        timestamp,
        type: "message",
        role: "system",
        content: text,
      });
    }
  }

  return { sessionId, logsRoot: opts.logsRoot };
}
