// Public surface of the Server domain (src/server/, CLAUDE.md §3). src/cli.ts (Core)
// composes against this module.

export type {
  AgentLoopEventListener,
  AgentLoopHandle,
  AgentLoopLogListener,
  Unsubscribe,
} from "./agent-loop.type.ts";
export { constantTimeEqual, extractBearerToken, isAuthorized } from "./auth.ts";
export { type CommandContext, type CommandResult, handleCommand } from "./commands.ts";
export { EventBuffer } from "./event-buffer.ts";
export { waitForExitCode } from "./exit.ts";
export {
  type AgentLogSummary,
  type AgentLogTreeNode,
  buildAgentLogTree,
  type FormatSessionLogTreeOptions,
  formatSessionList,
  formatSessionLogTree,
  listSessionDirectories,
  readAgentLogLines,
  readSessionLogSummaries,
  type SessionListEntry,
} from "./log-analysis.ts";
export { type PruneResult, pruneLogDirectories } from "./log-retention.ts";
export { SessionLogger } from "./logger.ts";
export { collectConfigSecrets, redactSecrets } from "./redact.ts";
export { DhServer, type DhServerOptions } from "./server.ts";
export { formatSseEvent } from "./sse.ts";
export { buildSessionSummary, type SessionSummary, writeSessionSummary } from "./summary.ts";
export { buildTar, type TarEntry } from "./tar.ts";
