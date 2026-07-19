---
spile: ticket
id: DH-0179
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0179: Revisit web static-server dual-typecheck split to remove the loopback self-proxy and any-casts

## Summary

src/web/server.ts runs a module-level lazy-singleton loopback self-proxy with several any-casts as a workaround for the DOM/DOM-less tsconfig split.

## Domain / owner

Web — src/web/server.ts (Susan)

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169.

`src/web/server.ts:88-148` runs a module-level lazy-singleton loopback self-proxy
(`innerServer`, `assetCache`, `proxyToInner`) solely because Bun's HTML-bundle rendering
has no direct API, and casts every value `any` (biome-ignores at 97/108/116/136) because
the file is typechecked under two programs (DOM vs DOM-less, `src/web/tsconfig.json` split)
with incompatible `Response`/`Headers` types. The heavy prose comments acknowledge the
workaround stack. Revisit whether the DOM/DOM-less tsconfig split can be resolved so the
`any` casts and the self-proxy indirection go away.

