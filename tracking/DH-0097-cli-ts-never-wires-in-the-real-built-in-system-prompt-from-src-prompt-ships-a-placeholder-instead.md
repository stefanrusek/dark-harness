---
spile: ticket
id: DH-0097
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0097: cli.ts never wires in the real built-in system prompt from src/prompt -- ships a placeholder instead

## Summary

Critical finding while implementing DH-0094: src/cli.ts has its own DEFAULT_SYSTEM_PROMPT/loadSystemPrompt placeholder (literally: You are Dark Harness (dh), an autonomous coding agent. TODO(prompt domain): replace this placeholder with the real built-in system prompt.) that is what actually ships in the compiled binary whenever dh.json's systemPrompt field is unset -- which is the default, common case. Meanwhile src/prompt/system-prompt.ts has a complete, real buildDefaultSystemPrompt/loadSystemPrompt (REQUIRED_CONTRACT with the TASK_FAILED marker instruction, DH-0056's Markdown-output discipline, skills section, DH-0094's self-info section) that cli.ts never actually calls. This means essentially all of this session's prompt-engineering work (TASK_FAILED reliability, Markdown rendering discipline, tool usage guidance) has never actually reached the model in real dh usage unless an operator manually set systemPrompt to something else -- a critical, silent regression from whenever the real src/prompt/system-prompt.ts was built without cli.ts ever being updated to call it.

## User Stories

### As an operator running dh with no custom systemPrompt, I want the real built-in prompt used, not a placeholder

- Given `dh.json` has no `systemPrompt` field set (the default case), when a session runs,
  then the model receives the real prompt built by `src/prompt/system-prompt.ts`
  (`buildDefaultSystemPrompt`/`loadSystemPrompt` — `REQUIRED_CONTRACT`, skills section,
  self-info section) — not `src/cli.ts`'s placeholder string.
- Given `dh.json` has `systemPrompt` explicitly set to a file path, when a session runs,
  then that override still works exactly as documented (this ticket doesn't change override
  behavior, only the no-override default path).

## Functional Requirements

- `src/cli.ts`: remove the local `DEFAULT_SYSTEM_PROMPT` constant and local `loadSystemPrompt`
  function; call `src/prompt/system-prompt.ts`'s real `loadSystemPrompt`/
  `buildDefaultSystemPrompt` instead.
- Audit every call site of `cli.ts`'s `loadSystemPrompt` (`CliDeps.loadSystemPrompt`) to
  confirm the swap is complete — this is a `CliDeps` injectable, so tests mocking it need
  checking too.
- Verify live against the real compiled binary (build + run + ask the model something that
  should reveal the real prompt is active, e.g. ask it to describe its own tool-use
  discipline or trigger a TASK_FAILED scenario) — this is exactly the kind of thing that
  looks fine in unit tests but needs a real end-to-end check, per this session's own
  established discipline.

## Risks

- This is a meaningful behavior change to what every session's model actually sees — worth
  extra care that nothing in the real prompt content assumes something `cli.ts`'s call site
  was supposed to provide but doesn't (e.g. check for any prompt content referencing
  something CLI-specific that isn't actually available at that call site).

## Notes

> [!NOTE]
> Found 2026-07-16 while implementing DH-0094 (agent self-awareness) — Grace/Iris noticed
> `cli.ts` has its own separate, never-updated placeholder and flagged it rather than
> silently expanding DH-0094's scope. Marked `ready` (not routed to architect) since this is
> a clear, unambiguous bug fix — wire up the real prompt that already exists — not a design
> decision.
