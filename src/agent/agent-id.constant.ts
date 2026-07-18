/** The root agent's fixed identifier — used both as the loop's own `agentId` (its SSE
 * events/log lines) and as the "agentId" `AgentLoopHandle`'s wire-facing operations
 * (sendMessage/stopAgent/the tree) address it by, exactly like every sub-agent's task id
 * (see AgentRuntime.spawnAgent()'s doc comment for why those two id spaces are now unified). */
export const ROOT_AGENT_ID = "agent-root";
