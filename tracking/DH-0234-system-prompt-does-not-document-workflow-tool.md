---
spile: ticket
id: DH-0234
type: bug
status: ready
owner: iris
resolution:
blocked_by: [DH-0226]
created: 2026-07-19
relations:
  depends_on: [DH-0226]
  relates_to: [DH-0226, DH-0233]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0234: System prompt does not document Workflow tool

## Summary

DH-0226 (Workflow tool MVP: deterministic sub-agent orchestration script) was fully implemented and is currently in "verifying" status. The Workflow tool enables agents to coordinate multiple sub-agents with real control flow (`agent()`, `parallel()`) instead of turn-by-turn decision-making. However, the system prompt (`src/prompt/system-prompt.ts`) does not document or mention the tool at all.

Currently, the system prompt includes an "Available skills" section (for loaded skill packages), but there is no documentation of built-in tools like Workflow, Agent, Monitor, TaskOutput, SendMessage, TaskStop, etc. This creates a critical authorization and discoverability gap: agents have no way to know the Workflow tool exists or how to use it, even though it's fully implemented and available.

## User Stories

### As an agent, I want to know all available tools and how to use them

- Given the system prompt is loaded, when I read it, then it should comprehensively document all built-in tools including Workflow, explaining what each tool does and how to invoke it.
- Given I am designing a task that would benefit from coordinating multiple sub-agents with deterministic control flow, when the system prompt documents the Workflow tool, then I know I can use it instead of spawning agents turn-by-turn through Agent tool calls.

## Functional Requirements

1. Create an "Available tools" section in the system prompt (separate from "Available skills" for loaded skill packages)
2. Document all built-in tools: Bash, Read, Edit, Write, Agent, ToolSearch, Skill, TaskOutput, SendMessage, Monitor, TaskStop, McpAuth, Workflow, Glob, Grep, NotebookEdit, Todo (TodoCreate, TodoGet, TodoList, TodoUpdate)
3. For each tool, provide:
   - Tool name
   - One-line description of what it does
   - When/why an agent would use it (e.g., Workflow for deterministic multi-agent orchestration)
4. For Workflow specifically, include a minimal example showing:
   - A script file structure: `async (wf, input) => any`
   - Using `wf.agent(prompt, options)` to spawn agents
   - Using `wf.parallel([...])` to run agents concurrently
   - Returning a result
5. Cite DH-0226 and link to the implementation for deeper details

## Assumptions

- This is a prompt-documentation task owned by Iris (Prompt domain lead per CLAUDE.md §3)
- The tool implementations and contracts already exist in code; this task is about exposing them to agents via the system prompt
- Some tools (like Workflow) may be complex enough to warrant brief examples; others may just need one-line descriptions

## Risks

- System prompt length may grow significantly if documentation for 15+ tools is too verbose
- Consider grouping tools by category (file I/O, task management, agent orchestration) to keep it scannable
- Mitigated by keeping descriptions concise and linking to implementation for deeper details

## Open Questions

- Should the tool list be auto-generated from tool definitions, or manually maintained in the prompt?
- How detailed should the Workflow example be, or should it just reference DH-0226's ticket/docs?
- Should we document which tools are available only in specific modes (e.g., McpAuth only if MCP servers are configured)?

## Notes

### 2026-07-19 — Manual testing finding

During verification round testing, neither the operator nor I knew the Workflow tool existed or how to use it, despite it being fully implemented and available. Root cause: zero documentation in the system prompt.

This mirrors DH-0233 (colored-span feature authorization gap), but more critical: not knowing a tool exists is worse than not knowing it's authorized. An agent should be able to read the system prompt and see the complete arsenal of available capabilities.

**Escalation:** This is a documentation/discovery gap that should be filled by updating the system prompt to comprehensively list and briefly explain all built-in tools. Iris (Prompt domain) should own this task.

Related: DH-0226 implementation is complete and verifying; Workflow tool implementation is in `src/agent/tools/workflow.ts` and `src/agent/workflow/runner.ts`.

### Broader pattern (DH-0233 + DH-0234)

Both DH-0233 and DH-0234 expose the same root issue: **features exist in code but are invisible to agents because the system prompt doesn't document them.** This creates three failures:

1. **Discovery:** agents don't know what's available
2. **Authorization:** agents don't know they're allowed to use it
3. **Usage:** agents don't know how to use it

Recommendation: after DH-0233 and DH-0234 land, consider a broader audit: what else has been implemented but not documented in the system prompt? This should be a standing part of the Definition of Done for feature tickets — implementation + system prompt documentation are both required.

### Prevention: auto-generation of tool documentation

**This should not regress.** Tools should be defined in such a way that they are **automatically available in the system prompt**, not manually maintained. Suggested approach:

- Each tool definition (in `src/agent/tools/`) should include structured metadata: name, description, usage guidelines, examples
- The system prompt builder (`src/prompt/system-prompt.ts`) should auto-generate the "Available tools" section by reflecting over registered tools and their metadata
- This mirrors the existing "Available skills" auto-generation from `discoverSkills()`
- Benefit: no tool can slip through undocumented; tool docs and implementation stay in sync by default, not by accident
- This shifts the problem from "maintain the prompt" to "define tools properly" — a better invariant

Consider filing a follow-up ticket (post-DH-0234) to implement auto-generation of tool documentation rather than manual maintenance.
