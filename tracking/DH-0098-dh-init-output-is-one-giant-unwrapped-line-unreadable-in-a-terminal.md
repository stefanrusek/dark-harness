---
spile: ticket
id: DH-0098
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0098: dh init output is one giant unwrapped line, unreadable in a terminal

## Summary

The dh init stdout message (runInit in src/cli.ts) is a single long template-literal string with no line breaks, so it renders as one unbroken wall of text in any terminal width, unlike the wrapped/colorized formatting the rest of the CLI (dh doctor, --help) already has. Needs to be reformatted into short wrapped lines/paragraphs so the model-catalog guidance is actually readable.

## User Stories

### As an operator running `dh init`, I want the printed guidance to be readable in my terminal

- Given a terminal of any reasonable width, when `dh init` finishes writing `dh.json`, then
  the printed message is broken into short lines/paragraphs a human can actually read, not
  one continuous run-on line relying on terminal soft-wrap.
- Given the message references multiple distinct facts (what was written, how to trim the
  model menu, the region-specific caveat on Bedrock ids, the next step), then those read as
  visually distinct lines/paragraphs, not one paragraph.

## Functional Requirements

- `runInit` in `src/cli.ts`: replace the single-line template literal with a message split
  across multiple `io.stdout(...)` calls or embedded `\n`s, breaking at natural sentence/
  topic boundaries (what was written; the model menu is broad, trim it; the "dh doctor"/
  "--check" probes every configured model; Bedrock ids are `us-east-1`-verified, re-verify
  elsewhere; edit + run `dh` to start).
- Match the CLI's existing formatting conventions elsewhere (`dh doctor`'s PASS/FAIL output,
  `--help`) rather than inventing a new style — check `formatVersionString`/doctor output in
  `src/cli.ts` for the established look (colorization where TTY, plain otherwise).
- No content change needed — this is purely a formatting/line-break fix; the actual guidance
  text (DH-0096) is correct and should be preserved, just reformatted.

## Assumptions

- This only affects `dh init`'s stdout message; `dh doctor`/`--help`/`--version` output was
  independently verified live in this pass and is already properly formatted — no changes
  needed there.

## Risks

- Low risk — pure output formatting, no behavior change. Existing `cli.test.ts` assertions
  on the exact init message string will need updating to match the new multi-line format.

## Notes

> [!NOTE]
> Found 2026-07-16 via a live screenshot showing `dh init`'s real terminal output as one
> unbroken wall of text. Verified live: `dh doctor --env <file>` and its pretty PASS/FAIL
> formatting both work correctly already — the operator's separate "dh doctor --env seems
> broken" report turned out to be expected behavior (dh doctor hard-fails on any configured
> model with an unresolved `$(VAR)` interpolation, including ones the operator isn't using
> yet) that `dh init`'s own message explains — but that explanation was unreadable because
> of this exact bug, so it looked like two bugs instead of one.
