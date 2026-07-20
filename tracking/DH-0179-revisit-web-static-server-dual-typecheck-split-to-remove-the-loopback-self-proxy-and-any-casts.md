---
spile: ticket
id: DH-0179
type: bug
status: closed
owner: stefan
resolution: done
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

- Given `src/web/server.ts` typechecked under both `tsc --noEmit` (root) and
  `tsc --noEmit -p src/web`, when the file contains no `any` casts, then both invocations
  pass with zero errors. Proven by `bun run typecheck` (both `tsc` invocations exit 0) — no
  dedicated unit test needed for a compile-time property; verified locally and is itself part
  of the CLAUDE.md §5 gate run on every PR going forward.
- Given the existing `src/web/server.test.ts` suite (loopback proxy, asset caching, security
  headers, index render), when the `any`-cast code paths are replaced with typed
  equivalents, then behavior is unchanged and coverage stays at 100% for `src/web/server.ts`
  — proven by `bun run test:coverage`'s per-file coverage table (`src/web/server.ts` at
  100.00/100.00).
- Given `e2e`'s real-binary web-UI tests, when the static server's index/asset serving path
  runs through the changed code, then it still serves correctly — proven by `bun run e2e`
  (38 pass / 0 fail).

## Notes

Filed by Fable during refactoring round DH-0169.

`src/web/server.ts:88-148` runs a module-level lazy-singleton loopback self-proxy
(`innerServer`, `assetCache`, `proxyToInner`) solely because Bun's HTML-bundle rendering
has no direct API, and casts every value `any` (biome-ignores at 97/108/116/136) because
the file is typechecked under two programs (DOM vs DOM-less, `src/web/tsconfig.json` split)
with incompatible `Response`/`Headers` types. The heavy prose comments acknowledge the
workaround stack. Revisit whether the DOM/DOM-less tsconfig split can be resolved so the
`any` casts and the self-proxy indirection go away.

### 2026-07-18 — investigated and partially resolved

Investigated empirically rather than by re-reading the prose comments' claims at face value:
removed every `any` cast and re-ran both `tsc --noEmit` invocations (root and
`src/web/tsconfig.json`) to see what actually broke.

**Findings — the DOM/DOM-less split was not the real cause of the `any` casts:**

1. `InnerServerHandle` was a hand-rolled interface (`{ port: number; stop(): void }`) that
   didn't structurally match `Bun.serve()`'s actual return type — fixed by using
   `ReturnType<typeof Bun.serve>` instead. No DOM-related error appeared under either
   program once this was fixed.
2. `fetch()`'s declared return type and `Response.prototype.clone()`'s declared return type
   both resolve to `undici-types`' `Response`, not bun-types' own augmented
   (`BunHeadersOverride`-backed) `Response` class that every other `Response`-typed value in
   the file uses — and these two are not structurally assignable (`Headers` is missing
   `toJSON`/`count`/`getAll`). This reproduces **identically under the root (DOM-less)
   program alone** — it is a bun-types internal inconsistency between its own APIs, wholly
   unrelated to the DOM/DOM-less split.

**What changed:** all three `any` casts and their `biome-ignore lint/suspicious/noExplicitAny`
suppressions are gone. In their place: `InnerServerHandle` is now
`ReturnType<typeof Bun.serve>` (no cast), and two narrow, documented `as unknown as Response`
casts remain — one for `fetch()`'s return, one wrapped in a small `cloneResponse()` helper for
`Response.clone()`'s return — both scoped to the one bun-types quirk above, not the file-wide
"any all the way through" posture the old code had.

**What did NOT change, and why (re-verified, not assumed away):**

- The loopback self-proxy (`innerServer`, `assetCache`, `proxyToInner`) stays. Confirmed
  against the file's own "Judgment call (DH-0023, revised DH-0110)" comment: Bun's
  HTML-bundle rendering (asset discovery/hashing/inlining) is only reachable through
  `Bun.serve`'s own route-matching machinery — there is still no public API to invoke it
  directly and get a plain `Response` back. This constraint is independent of typechecking
  and this ticket doesn't touch it.
- `src/web/tsconfig.json`'s DOM-enabled split from the root program stays. Its own comment
  explains the real reason: loading `bun-types` and DOM lib in one shared `tsc` program
  previously broke a typecheck-clean call in `src/server/server.ts` (outside this domain) by
  changing global `Response`/`BodyInit` resolution project-wide. That reason has nothing to
  do with `src/web/server.ts` specifically and isn't touched by anything in this ticket.

**Net result:** the ticket's proposed simplification ("drop the `any`-casts") was safely
achievable; the two things its title also named (the self-proxy, the dual-tsconfig split)
turned out to be load-bearing for reasons unrelated to why the `any` casts existed, and were
kept as-is after re-verifying their justifying comments against current behavior.

Verification: `bun run typecheck`, `bun run lint`, `bun run test:coverage` (100% on
`src/web/server.ts`, full suite green), `bun run e2e` (38 pass / 0 fail) — all green locally.

