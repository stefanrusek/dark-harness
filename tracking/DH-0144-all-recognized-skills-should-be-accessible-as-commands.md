---
spile: ticket
id: DH-0144
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0142, DH-0143]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0144: All recognized skills should be accessible as / commands

## Summary

Owner request 2026-07-17: every skill dh discovers (via skillPaths in dh.json, per src/prompt/'s skill enumeration) should be reachable as a / slash command in both TUI and Web, not just the small set of built-in slash commands that exist today (src/web/client/slash-commands.ts). Likely needs a list-skills tool call / capability the agent loop or UI layer can query at composer-render time, distinct from a UI's own hardcoded slash-command list. If a dedicated list-skills tool is the right shape, that is a separate user story from the UI-wiring work -- keep them as distinct User Stories in this one ticket rather than splitting into more tickets, since they are tightly coupled (the UI wiring has nothing to autocomplete against until the listing mechanism exists). Relates to the autocomplete tickets (DH-0142 TUI, DH-0143 Web) -- skills-as-commands and command-autocomplete are complementary but distinct: autocomplete works for any recognized command including skills once this lands.

**Owner decision (2026-07-19):** structure this ticket around the two capabilities Claude
Code's own skill mechanism needs — **list** and **execute** — matching that schema/split
rather than treating "skills as slash commands" as one undifferentiated feature.

**Status check (2026-07-19):** execute already works — `/skillname [args]` invokes a skill
today (landed under DH-0093, backed by `src/agent/tools/skill.ts`'s `Skill` tool). List
already exists at the wire level too — `ListSkillsCommand`/`ListSkillsResponse`
(`src/contracts/commands.type.ts`, handled in `src/server/commands.ts`'s `list_skills` case,
backed by `AgentLoopHandle.listSkills()`) — but neither TUI nor Web currently calls it. This
ticket's real remaining scope is: **wire the existing `list_skills` command into both UIs**
so the autocomplete dropdown (DH-0142/DH-0143) can show real skills, not just built-ins.

## User Stories

### As a TUI/Web user, I want to list available skills, so the composer can show them as autocomplete candidates

- Given the client is connected, when it queries `list_skills` (once per session/on
  reconnect, not per-keystroke — matching the existing local-resolution pattern `/help` and
  `/<skillname>` already use), then it receives the current skill catalog (name +
  description) and merges it into the same command list DH-0142/DH-0143's dropdown filters
  against.

### As a TUI/Web user, I want to execute a skill via `/skillname [args]`

- Given a recognized skill name typed as `/skillname args...`, when submitted, then the
  skill is invoked with `args` passed through — **already implemented** (DH-0093); this
  story exists here only to state explicitly that execute is in scope/covered, not to
  re-implement it.

## Functional Requirements

- TUI and Web both call `list_skills` (existing command, no contract change needed) at
  connect/reconnect time and cache the result for autocomplete purposes.
- Merge skill entries into the same command-list data structure DH-0142/DH-0143 establish in
  `src/client-core/`, so autocomplete doesn't need two separate code paths for built-ins vs.
  skills.
- No changes needed to `Skill` tool execution — already correct.

## Assumptions

- `list_skills`'s existing response shape (name + description) is sufficient for autocomplete
  display — no new fields needed.

## Risks

- Low — wiring an already-working command into UIs that don't call it yet; no new server-side
  behavior.

## Open Questions

## Notes
