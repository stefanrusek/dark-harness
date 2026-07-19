---
spile: ticket
id: DH-0198
type: bug
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: [DH-0192]
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0198: Web UI header never actually renders the brand mark/logo asset

## Summary

Owner observation (2026-07-19), while reviewing logo redesign concepts: docs/media/logo.svg has never appeared in the actual dh web app -- confirmed by grep, zero references to logo.svg anywhere in src/web/. The web header currently only shows the .brand::before CSS pseudo-element (a bare '◆ ' text glyph, styles.css) plus the 'Dark Harness' text, never the real SVG mark. This means the owner had never actually seen docs/media/logo.svg rendered until it was shown out-of-band as flat markup during a design review -- it's effectively a dead asset outside the README. Web domain (Susan). Scope: render the actual brand mark (final form pending DH-0192's resolution) in the web app's header/chrome, not just the bare glyph pseudo-element. Depends on DH-0192 landing first since the final mark geometry isn't settled yet.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
