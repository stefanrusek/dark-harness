// Public surface of the Server domain (src/server/, CLAUDE.md §3). src/cli.ts (Core)
// composes against this module.

export type {
  AgentLoopEventListener,
  AgentLoopHandle,
  AgentLoopLogListener,
  Unsubscribe,
} from "./agent-loop.ts";
export { DhServer, type DhServerOptions } from "./server.ts";
export { waitForExitCode } from "./exit.ts";
export { EventBuffer } from "./event-buffer.ts";
export { SessionLogger } from "./logger.ts";
export { formatSseEvent } from "./sse.ts";
export { constantTimeEqual, extractBearerToken, isAuthorized } from "./auth.ts";
export { buildTar, type TarEntry } from "./tar.ts";
export { handleCommand, type CommandContext, type CommandResult } from "./commands.ts";
export { collectConfigSecrets, redactSecrets } from "./redact.ts";
export { pruneLogDirectories, type PruneResult } from "./log-retention.ts";
export {
  buildAgentLogTree,
  formatSessionList,
  formatSessionLogTree,
  listSessionDirectories,
  readAgentLogLines,
  readSessionLogSummaries,
  type AgentLogSummary,
  type AgentLogTreeNode,
  type FormatSessionLogTreeOptions,
  type SessionListEntry,
} from "./log-analysis.ts";
export { buildSessionSummary, writeSessionSummary, type SessionSummary } from "./summary.ts";
// Test fixture, not production code — see fake-agent-loop.ts's own doc comment. Exported
// so other domains (TUI/Web/E2E) can develop against a fake before Core lands.
export { FakeAgentLoop } from "./fake-agent-loop.ts";
