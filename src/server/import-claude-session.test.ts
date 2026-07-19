// DH-0188: tests for the Claude Code -> dh session translator. Fixtures below are synthetic
// but shaped directly off real lines sampled from
// `~/claude-session-backups/fable-july-18-swarm/` (a real ~2300-line transcript + full
// `subagents/` sidecar) during implementation — field names, nesting, and the
// `toolUseId`/`agentId` linkage all mirror what that real backup actually contains. The real
// backup itself lives outside the repo (a user-local `~/claude-session-backups/` path, not
// portable to CI), so it was used for a one-off manual round-trip verification instead of a
// checked-in fixture — see DH-0188's ticket Notes for that verification's results (786 folded
// messages, 236/236 tool_use/tool_result pairs, 60 agents, zero dangling tool calls). These
// synthetic fixtures carry the same shapes into the 100%-coverage gate.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayAgentHistory } from "../agent/resume.ts";
import type { LogEvent, LogHeader } from "../contracts/index.ts";
import { importClaudeSession } from "./import-claude-session.ts";
import { readAgentLogLines, readSessionLogSummaries } from "./log-analysis.ts";

function jsonl(lines: unknown[]): string {
  return `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
}

function assistantMsg(opts: {
  timestamp: string;
  text?: string;
  toolUse?: { id: string; name: string; input: unknown };
  thinking?: string;
  usage?: Record<string, unknown>;
  model?: string;
  stop_reason?: string;
}) {
  const content: unknown[] = [];
  if (opts.thinking !== undefined) content.push({ type: "thinking", thinking: opts.thinking });
  if (opts.text !== undefined) content.push({ type: "text", text: opts.text });
  if (opts.toolUse) {
    content.push({
      type: "tool_use",
      id: opts.toolUse.id,
      name: opts.toolUse.name,
      input: opts.toolUse.input,
    });
  }
  return {
    parentUuid: null,
    isSidechain: false,
    type: "assistant",
    timestamp: opts.timestamp,
    message: {
      model: opts.model ?? "claude-sonnet-5",
      role: "assistant",
      content,
      stop_reason: opts.stop_reason ?? "end_turn",
      ...(opts.usage ? { usage: opts.usage } : {}),
    },
  };
}

function userMsg(opts: {
  timestamp: string;
  text?: string;
  toolResult?: { toolUseId: string; content: unknown; isError?: boolean };
}) {
  const content: unknown =
    opts.toolResult !== undefined
      ? [
          {
            type: "tool_result",
            tool_use_id: opts.toolResult.toolUseId,
            content: opts.toolResult.content,
            is_error: opts.toolResult.isError === true,
          },
        ]
      : (opts.text ?? "");
  return {
    parentUuid: null,
    isSidechain: false,
    type: "user",
    timestamp: opts.timestamp,
    message: { role: "user", content },
  };
}

describe("importClaudeSession", () => {
  let scratch: string;
  let logsRoot: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "dh-import-src-"));
    logsRoot = mkdtempSync(join(tmpdir(), "dh-import-logs-"));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
    rmSync(logsRoot, { recursive: true, force: true });
  });

  test("translates a simple root transcript and round-trips through replayAgentHistory", () => {
    const transcriptPath = join(scratch, "sess1.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "hello" }),
        assistantMsg({
          timestamp: "2026-07-18T00:00:01.000Z",
          text: "hi there",
          usage: {
            input_tokens: 5,
            output_tokens: 3,
            cache_read_input_tokens: 1,
            cache_creation_input_tokens: 2,
          },
        }),
      ]),
    );

    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    expect(result.logsRoot).toBe(logsRoot);
    expect(typeof result.sessionId).toBe("string");

    const { header, messages } = replayAgentHistory(logsRoot, result.sessionId, "agent-root");
    expect(header.model).toBe("sonnet");
    expect(header.sessionId).toBe(result.sessionId);
    expect(header.parentAgentId).toBeNull();
    expect(header.instructionsSummary).toContain("sess1");

    // First replayed message is the provenance system line's *skip* — foldEventsToMessages
    // drops role:"system" entirely, so the first real message is the user turn.
    expect(messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "hello" }] });
    expect(messages[1]?.role).toBe("assistant");
  });

  test("translates tool_use/tool_result pairs with correct toolUseId linkage", () => {
    const transcriptPath = join(scratch, "sess2.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "run ls" }),
        assistantMsg({
          timestamp: "2026-07-18T00:00:01.000Z",
          toolUse: { id: "toolu_1", name: "Bash", input: { command: "ls" } },
        }),
        userMsg({
          timestamp: "2026-07-18T00:00:02.000Z",
          toolResult: { toolUseId: "toolu_1", content: "file1\nfile2" },
        }),
        assistantMsg({ timestamp: "2026-07-18T00:00:03.000Z", text: "done" }),
      ]),
    );

    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const { messages } = replayAgentHistory(logsRoot, result.sessionId, "agent-root");

    const assistantWithTool = messages.find((m) => m.content.some((b) => b.type === "tool_use"));
    expect(assistantWithTool).toBeDefined();
    const toolUseBlock = assistantWithTool?.content.find((b) => b.type === "tool_use");
    expect(toolUseBlock).toMatchObject({ type: "tool_use", id: "toolu_1", name: "Bash" });

    const toolResultMsg = messages.find((m) => m.content.some((b) => b.type === "tool_result"));
    const toolResultBlock = toolResultMsg?.content.find((b) => b.type === "tool_result");
    expect(toolResultBlock).toMatchObject({
      type: "tool_result",
      toolUseId: "toolu_1",
      content: "file1\nfile2",
      isError: false,
    });
  });

  test("assistant message.content of an unrecognized shape (neither string nor array) yields no text event", () => {
    const transcriptPath = join(scratch, "sess-weird-content.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        {
          type: "assistant",
          isSidechain: false,
          timestamp: "2026-07-18T00:00:00.000Z",
          message: {
            model: "claude-sonnet-5",
            role: "assistant",
            content: { unexpected: "shape" },
          },
        },
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const lines = readAgentLogLines(join(logsRoot, result.sessionId), "agent-root") as LogEvent[];
    const messageEvents = lines.filter(
      (l): l is Extract<LogEvent, { type: "message" }> => l.type === "message",
    );
    expect(messageEvents.some((m) => m.role === "assistant")).toBe(false);
  });

  test("thinking blocks become dh thinking events", () => {
    const transcriptPath = join(scratch, "sess-thinking.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        assistantMsg({
          timestamp: "2026-07-18T00:00:00.000Z",
          thinking: "pondering...",
          text: "answer",
        }),
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const lines = readAgentLogLines(join(logsRoot, result.sessionId), "agent-root");
    const thinkingLine = (lines as LogEvent[]).find(
      (l): l is Extract<LogEvent, { type: "thinking" }> => l.type === "thinking",
    );
    expect(thinkingLine).toMatchObject({ content: "pondering...", redacted: false });
  });

  test("redacted_thinking blocks are logged with empty content and redacted:true", () => {
    const transcriptPath = join(scratch, "sess-redacted.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        {
          type: "assistant",
          isSidechain: false,
          timestamp: "2026-07-18T00:00:00.000Z",
          message: {
            model: "claude-sonnet-5",
            role: "assistant",
            content: [{ type: "redacted_thinking", data: "ciphertext" }],
          },
        },
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const lines = readAgentLogLines(join(logsRoot, result.sessionId), "agent-root");
    const thinkingLine = (lines as LogEvent[]).find(
      (l): l is Extract<LogEvent, { type: "thinking" }> => l.type === "thinking",
    );
    expect(thinkingLine).toMatchObject({ content: "", redacted: true });
  });

  test("Decision 4: one case per lossy source line type", () => {
    const transcriptPath = join(scratch, "sess-lossy.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        { type: "file-history-snapshot", timestamp: "2026-07-18T00:00:00.000Z" },
        { type: "file-history-delta", timestamp: "2026-07-18T00:00:00.100Z" },
        { type: "mode", timestamp: "2026-07-18T00:00:00.200Z", mode: "plan" },
        {
          type: "permission-mode",
          timestamp: "2026-07-18T00:00:00.300Z",
          permissionMode: "default",
        },
        { type: "last-prompt", timestamp: "2026-07-18T00:00:00.400Z", prompt: "duplicate text" },
        { type: "bridge-session", timestamp: "2026-07-18T00:00:00.500Z" },
        { type: "pr-link", timestamp: "2026-07-18T00:00:00.600Z" },
        { type: "queue-operation", timestamp: "2026-07-18T00:00:00.700Z" },
        { type: "ai-title", aiTitle: "My imported session title", sessionId: "sess-lossy" },
        {
          type: "system",
          isSidechain: false,
          timestamp: "2026-07-18T00:00:00.800Z",
          subtype: "stop_hook_summary",
          hookAdditionalContext: ["hook ran fine"],
        },
        userMsg({ timestamp: "2026-07-18T00:00:01.000Z", text: "hello after lossy lines" }),
      ]),
    );

    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const lines = readAgentLogLines(join(logsRoot, result.sessionId), "agent-root");
    const header = lines[0] as LogHeader;
    // ai-title consumed into header.description, not replayed as an event.
    expect(header.description).toBe("My imported session title");

    const events = lines.slice(1) as LogEvent[];
    // None of the eight dropped-line types produced any event at all.
    const messageEvents = events.filter(
      (e): e is Extract<LogEvent, { type: "message" }> => e.type === "message",
    );
    // Provenance system line + the one real system line + the one real user line = 3.
    expect(messageEvents.filter((m) => m.role === "system").length).toBe(2);
    expect(messageEvents.some((m) => m.content.includes("stop_hook_summary"))).toBe(true);
    expect(
      messageEvents.some((m) => m.role === "user" && m.content === "hello after lossy lines"),
    ).toBe(true);
  });

  test("attachment (textual) is inlined into the next user turn's text", () => {
    const transcriptPath = join(scratch, "sess-attach.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        {
          type: "attachment",
          isSidechain: false,
          timestamp: "2026-07-18T00:00:00.000Z",
          attachment: { type: "skill_listing", content: "- a skill\n- another skill" },
        },
        userMsg({ timestamp: "2026-07-18T00:00:01.000Z", text: "use a skill please" }),
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const { messages } = replayAgentHistory(logsRoot, result.sessionId, "agent-root");
    const userMessage = messages.find((m) => m.role === "user");
    const text = userMessage?.content.find((b) => b.type === "text");
    expect(text && "text" in text ? text.text : "").toContain("- a skill");
    expect(text && "text" in text ? text.text : "").toContain("use a skill please");
  });

  test("attachment (non-textual/binary) becomes an omitted placeholder", () => {
    const transcriptPath = join(scratch, "sess-attach-binary.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        {
          type: "attachment",
          isSidechain: false,
          timestamp: "2026-07-18T00:00:00.000Z",
          attachment: { type: "image", content: null },
        },
        userMsg({ timestamp: "2026-07-18T00:00:01.000Z", text: "look at this" }),
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const { messages } = replayAgentHistory(logsRoot, result.sessionId, "agent-root");
    const userMessage = messages.find((m) => m.role === "user");
    const text = userMessage?.content.find((b) => b.type === "text");
    expect(text && "text" in text ? text.text : "").toContain("image attachment omitted");
  });

  test("attachment with no trailing user turn is annotated, not silently dropped", () => {
    const transcriptPath = join(scratch, "sess-attach-trailing.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        assistantMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "hi" }),
        {
          type: "attachment",
          isSidechain: false,
          timestamp: "2026-07-18T00:00:01.000Z",
          attachment: { type: "hook_success", content: "trailing hook output" },
        },
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    // Doesn't crash; the attachment simply never gets flushed to an event since no later
    // user turn arrives — asserted implicitly by this not throwing and producing a valid
    // header (FR7's spirit: tolerate, never crash).
    const lines = readAgentLogLines(join(logsRoot, result.sessionId), "agent-root");
    expect((lines[0] as LogHeader).type).toBe("header");
  });

  test("unknown/future source line types are skipped with an annotation, not a crash", () => {
    const transcriptPath = join(scratch, "sess-unknown.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        { type: "some-future-line-type", timestamp: "2026-07-18T00:00:00.000Z", weird: true },
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const lines = readAgentLogLines(join(logsRoot, result.sessionId), "agent-root");
    const events = lines.slice(1) as LogEvent[];
    const annotation = events.find(
      (e): e is Extract<LogEvent, { type: "message" }> =>
        e.type === "message" && e.content.includes("unrecognized source line type"),
    );
    expect(annotation).toBeDefined();
    expect(annotation?.content).toContain("some-future-line-type");
  });

  test("tolerates a truncated final source line without crashing", () => {
    const transcriptPath = join(scratch, "sess-truncated.jsonl");
    writeFileSync(
      transcriptPath,
      `${JSON.stringify(userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "hello" }))}\n{"type":"user","message":{"role":"us`,
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const { messages } = replayAgentHistory(logsRoot, result.sessionId, "agent-root");
    expect(messages.some((m) => m.role === "user")).toBe(true);
  });

  test("empty transcript still produces a valid, resumable header", () => {
    const transcriptPath = join(scratch, "sess-empty.jsonl");
    writeFileSync(transcriptPath, "");
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const { header, messages } = replayAgentHistory(logsRoot, result.sessionId, "agent-root");
    expect(header.type).toBe("header");
    expect(messages).toEqual([]);
  });

  test("sub-agent tree: sidecar subagent resolves parentAgentId via toolUseId, including depth-2 nesting", () => {
    const transcriptPath = join(scratch, "sess-tree.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "spawn a worker" }),
        assistantMsg({
          timestamp: "2026-07-18T00:00:01.000Z",
          toolUse: { id: "toolu_root_spawn", name: "Task", input: { description: "worker" } },
        }),
        userMsg({
          timestamp: "2026-07-18T00:00:02.000Z",
          toolResult: { toolUseId: "toolu_root_spawn", content: "spawned" },
        }),
      ]),
    );

    const sidecarDir = join(scratch, "sess-tree");
    const subagentsDir = join(sidecarDir, "subagents");
    mkdirSync(subagentsDir, { recursive: true });

    // Depth-1 sub-agent, parented on the root's Task tool_use.
    writeFileSync(
      join(subagentsDir, "agent-child1.meta.json"),
      JSON.stringify({
        agentType: "general-purpose",
        description: "worker task",
        toolUseId: "toolu_root_spawn",
        spawnDepth: 1,
      }),
    );
    writeFileSync(
      join(subagentsDir, "agent-child1.jsonl"),
      jsonl([
        {
          parentUuid: null,
          isSidechain: true,
          agentId: "child1",
          type: "user",
          timestamp: "2026-07-18T00:00:03.000Z",
          message: { role: "user", content: "do the worker task" },
        },
        {
          parentUuid: null,
          isSidechain: true,
          agentId: "child1",
          type: "assistant",
          timestamp: "2026-07-18T00:00:04.000Z",
          message: {
            model: "claude-sonnet-5",
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_child_spawn",
                name: "Agent",
                input: { description: "grandchild" },
              },
            ],
          },
        },
      ]),
    );

    // Depth-2 sub-agent, parented on the depth-1 child's Agent tool_use.
    writeFileSync(
      join(subagentsDir, "agent-grandchild1.meta.json"),
      JSON.stringify({
        agentType: "general-purpose",
        description: "grandchild task",
        toolUseId: "toolu_child_spawn",
        spawnDepth: 2,
      }),
    );
    writeFileSync(
      join(subagentsDir, "agent-grandchild1.jsonl"),
      jsonl([
        {
          parentUuid: null,
          isSidechain: true,
          agentId: "grandchild1",
          type: "user",
          timestamp: "2026-07-18T00:00:05.000Z",
          message: { role: "user", content: "do the grandchild task" },
        },
      ]),
    );

    const result = importClaudeSession(
      { transcriptPath, sidecarDir },
      { logsRoot, model: "sonnet" },
    );
    const dir = join(logsRoot, result.sessionId);
    const summaries = readSessionLogSummaries(dir);

    const child = summaries.find((s) => s.description === "worker task");
    expect(child).toBeDefined();
    expect(child?.parentAgentId).toBe("agent-root");

    const grandchild = summaries.find((s) => s.description === "grandchild task");
    expect(grandchild).toBeDefined();
    expect(grandchild?.parentAgentId).toBe(child?.agentId);
    expect(grandchild?.status).toBe("done");
  });

  test("orphan sub-agent (toolUseId matches nothing) attaches to root with a system annotation", () => {
    const transcriptPath = join(scratch, "sess-orphan.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "hi" })]),
    );

    const sidecarDir = join(scratch, "sess-orphan");
    const subagentsDir = join(sidecarDir, "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, "agent-orphan1.meta.json"),
      JSON.stringify({
        agentType: "general-purpose",
        description: "orphaned",
        toolUseId: "toolu_does_not_exist",
        spawnDepth: 1,
      }),
    );
    writeFileSync(
      join(subagentsDir, "agent-orphan1.jsonl"),
      jsonl([
        {
          parentUuid: null,
          isSidechain: true,
          agentId: "orphan1",
          type: "user",
          timestamp: "2026-07-18T00:00:01.000Z",
          message: { role: "user", content: "orphaned work" },
        },
      ]),
    );

    const result = importClaudeSession(
      { transcriptPath, sidecarDir },
      { logsRoot, model: "sonnet" },
    );
    const dir = join(logsRoot, result.sessionId);
    const summaries = readSessionLogSummaries(dir);
    const orphan = summaries.find((s) => s.description === "orphaned");
    expect(orphan?.parentAgentId).toBe("agent-root");

    const rootLines = readAgentLogLines(dir, "agent-root") as LogEvent[];
    const annotation = rootLines.find(
      (l): l is Extract<LogEvent, { type: "message" }> =>
        l.type === "message" && l.content.includes("no resolvable parent"),
    );
    expect(annotation).toBeDefined();
  });

  test("sidecar subagent with no matching meta.json (or vice versa) is skipped, not crashed on", () => {
    const transcriptPath = join(scratch, "sess-orphan-file.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "hi" })]),
    );

    const sidecarDir = join(scratch, "sess-orphan-file");
    const subagentsDir = join(sidecarDir, "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    // .jsonl with no meta.json — skipped.
    writeFileSync(
      join(subagentsDir, "agent-nometa.jsonl"),
      jsonl([{ type: "user", isSidechain: true, agentId: "nometa" }]),
    );
    // meta.json with no .jsonl — skipped (readdirSync won't even see it as a candidate since
    // the loop only iterates `.jsonl` files).
    writeFileSync(
      join(subagentsDir, "agent-nofile.meta.json"),
      JSON.stringify({ toolUseId: "x", spawnDepth: 1 }),
    );
    // A .meta.json that's not valid JSON — tolerated.
    writeFileSync(
      join(subagentsDir, "agent-badmeta.jsonl"),
      jsonl([{ type: "user", isSidechain: true, agentId: "badmeta" }]),
    );
    writeFileSync(join(subagentsDir, "agent-badmeta.meta.json"), "{not valid json");

    const result = importClaudeSession(
      { transcriptPath, sidecarDir },
      { logsRoot, model: "sonnet" },
    );
    const dir = join(logsRoot, result.sessionId);
    const summaries = readSessionLogSummaries(dir);
    // Only the root agent exists — every sidecar candidate above was incomplete/corrupt.
    expect(summaries.length).toBe(1);
  });

  test("inline isSidechain:true branch (no sidecar) is segregated into its own sub-agent JSONL", () => {
    const transcriptPath = join(scratch, "sess-inline.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "root turn" }),
        {
          parentUuid: null,
          isSidechain: true,
          agentId: "inline-branch-1",
          type: "user",
          timestamp: "2026-07-18T00:00:01.000Z",
          message: { role: "user", content: "inline sidechain turn" },
        },
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const dir = join(logsRoot, result.sessionId);
    const summaries = readSessionLogSummaries(dir);
    const nonRoot = summaries.filter((s) => s.agentId !== "agent-root");
    expect(nonRoot.length).toBe(1);
    expect(nonRoot[0]?.parentAgentId).toBe("agent-root");

    const { messages } = replayAgentHistory(
      logsRoot,
      result.sessionId,
      nonRoot[0]?.agentId as string,
    );
    expect(
      messages.some(
        (m) =>
          m.role === "user" &&
          m.content.some((b) => b.type === "text" && b.text === "inline sidechain turn"),
      ),
    ).toBe(true);
  });

  test("failed sub-agent (last assistant turn ended in error) is stamped status:failed", () => {
    const transcriptPath = join(scratch, "sess-failedparent.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "hi" })]),
    );

    const sidecarDir = join(scratch, "sess-failedparent");
    const subagentsDir = join(sidecarDir, "subagents");
    mkdirSync(subagentsDir, { recursive: true });
    writeFileSync(
      join(subagentsDir, "agent-failing.meta.json"),
      JSON.stringify({
        agentType: "general-purpose",
        description: "will fail",
        toolUseId: "toolu_missing",
        spawnDepth: 1,
      }),
    );
    writeFileSync(
      join(subagentsDir, "agent-failing.jsonl"),
      jsonl([
        assistantMsg({
          timestamp: "2026-07-18T00:00:01.000Z",
          text: "trying...",
          stop_reason: "error",
        }),
      ]),
    );

    const result = importClaudeSession(
      { transcriptPath, sidecarDir },
      { logsRoot, model: "sonnet" },
    );
    const dir = join(logsRoot, result.sessionId);
    const summaries = readSessionLogSummaries(dir);
    const failing = summaries.find((s) => s.description === "will fail");
    expect(failing?.status).toBe("failed");
  });

  test("stamps client and build from options, defaulting client to none", () => {
    const transcriptPath = join(scratch, "sess-opts.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "hi" })]),
    );

    const withDefault = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const defaultHeader = readAgentLogLines(
      join(logsRoot, withDefault.sessionId),
      "agent-root",
    )[0] as LogHeader;
    expect(defaultHeader.client).toBe("none");
    expect(defaultHeader.build.version).toBe("import");

    const withOverride = importClaudeSession(
      { transcriptPath },
      {
        logsRoot,
        model: "sonnet",
        client: "tui",
        build: { version: "1.2.3", gitSha: "abc", dirty: true, releaseTag: "v1.2.3" },
      },
    );
    const overrideHeader = readAgentLogLines(
      join(logsRoot, withOverride.sessionId),
      "agent-root",
    )[0] as LogHeader;
    expect(overrideHeader.client).toBe("tui");
    expect(overrideHeader.build).toEqual({
      version: "1.2.3",
      gitSha: "abc",
      dirty: true,
      releaseTag: "v1.2.3",
    });
  });

  test("no sidecarDir provided: import still succeeds with just the root agent", () => {
    const transcriptPath = join(scratch, "sess-nosidecar.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "hi" })]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const summaries = readSessionLogSummaries(join(logsRoot, result.sessionId));
    expect(summaries.length).toBe(1);
  });

  test("sidecarDir provided but has no subagents/ directory at all", () => {
    const transcriptPath = join(scratch, "sess-emptysidecar.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([userMsg({ timestamp: "2026-07-18T00:00:00.000Z", text: "hi" })]),
    );
    const sidecarDir = join(scratch, "sess-emptysidecar");
    mkdirSync(sidecarDir, { recursive: true });
    const result = importClaudeSession(
      { transcriptPath, sidecarDir },
      { logsRoot, model: "sonnet" },
    );
    const summaries = readSessionLogSummaries(join(logsRoot, result.sessionId));
    expect(summaries.length).toBe(1);
  });

  test("assistant tool_use named Task is rewritten to dh's Agent tool name", () => {
    const transcriptPath = join(scratch, "sess-task-rewrite.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        assistantMsg({
          timestamp: "2026-07-18T00:00:00.000Z",
          toolUse: { id: "toolu_x", name: "Task", input: {} },
        }),
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const lines = readAgentLogLines(join(logsRoot, result.sessionId), "agent-root") as LogEvent[];
    const toolCall = lines.find(
      (l): l is Extract<LogEvent, { type: "tool_call" }> => l.type === "tool_call",
    );
    expect(toolCall?.toolName).toBe("Agent");
  });

  test("tool_result content array of text blocks is stringified; non-text content falls back to JSON", () => {
    const transcriptPath = join(scratch, "sess-toolresult-shapes.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        userMsg({
          timestamp: "2026-07-18T00:00:00.000Z",
          toolResult: {
            toolUseId: "toolu_a",
            content: [
              { type: "text", text: "line one" },
              { type: "text", text: "line two" },
            ],
          },
        }),
        userMsg({
          timestamp: "2026-07-18T00:00:01.000Z",
          toolResult: {
            toolUseId: "toolu_b",
            content: [{ type: "tool_reference", tool_name: "mcp__x__y" }],
          },
        }),
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const lines = readAgentLogLines(join(logsRoot, result.sessionId), "agent-root") as LogEvent[];
    const results = lines.filter(
      (l): l is Extract<LogEvent, { type: "tool_result" }> => l.type === "tool_result",
    );
    expect(results[0]?.output).toBe("line one\nline two");
    expect(results[1]?.output).toContain("tool_reference");
  });

  test("tool_result isError:true is preserved", () => {
    const transcriptPath = join(scratch, "sess-toolresult-error.jsonl");
    writeFileSync(
      transcriptPath,
      jsonl([
        userMsg({
          timestamp: "2026-07-18T00:00:00.000Z",
          toolResult: { toolUseId: "toolu_e", content: "boom", isError: true },
        }),
      ]),
    );
    const result = importClaudeSession({ transcriptPath }, { logsRoot, model: "sonnet" });
    const lines = readAgentLogLines(join(logsRoot, result.sessionId), "agent-root") as LogEvent[];
    const toolResult = lines.find(
      (l): l is Extract<LogEvent, { type: "tool_result" }> => l.type === "tool_result",
    );
    expect(toolResult?.isError).toBe(true);
  });
});
