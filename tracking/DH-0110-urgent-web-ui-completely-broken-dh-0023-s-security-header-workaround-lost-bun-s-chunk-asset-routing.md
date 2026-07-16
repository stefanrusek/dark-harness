---
spile: ticket
id: DH-0110
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0023]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0110: URGENT: Web UI completely broken -- DH-0023's security-header workaround lost Bun's chunk-asset routing

## Summary

src/web/server.ts's outer Bun.serve only registers routes for / (via renderIndex, a wrapper needed to attach security headers to Bun's HTMLBundle route) and the config endpoint -- it has no routes for the JS/CSS asset chunks Bun's HTML-import bundler generates and references in the rendered page (chunk-*.js, chunk-*.css). Those chunk routes only exist on the throwaway inner server DH-0023's renderIndex creates to force Bun to render the HTMLBundle, and that inner server is torn down immediately after rendering. Every real request for a chunk file hits the outer server's catch-all fetch() handler and gets a plain 404. Confirmed live via real headless Chromium (freshly available in this sandbox): the served HTML correctly references /chunk-*.js and /chunk-*.css, both 404, browser console shows the failed loads, the page's #root div stays empty forever, .dh-app never renders. This means the Web UI is completely non-functional on main right now -- not a cosmetic bug, the whole product surface is dead. Not caught by DH-0023's own gates (which tested response headers on individual endpoints, not full page load with real asset resolution) or live verification (no headless Chromium was available in that sandbox at the time).

## User Stories

### As an operator running `dh --web`, I want the page to actually load and render

- Given `dh --web` is running and I open the served URL in a real browser, when the page
  loads, then the bundled JS/CSS actually load (200, not 404) and `.dh-app` renders — the
  product is usable, not a blank `<div id="root">`.
- Given the same for `dh --connect <host> --web`, then the connected-client variant works
  identically.

## Functional Requirements

- Fix `src/web/server.ts`'s outer `Bun.serve` so requests for the bundled asset chunk paths
  (`/chunk-*.js`, `/chunk-*.css`, and any other asset Bun's HTML-import bundler generates)
  actually resolve, not 404. Implementer's call on the exact mechanism — options include:
  proxying chunk requests through to the same inner-server-render trick `renderIndex` already
  uses (fetch the asset from a throwaway inner server keyed on the request path, cache
  per-path the same way `cachedIndexResponse` is cached), or finding a way to keep the outer
  server's own route table populated with Bun's auto-generated asset routes directly (e.g.
  registering `indexHtml` in the outer server's own `routes` and layering security headers on
  a per-response basis via a different mechanism than route-value substitution, if Bun
  supports that). Do not regress DH-0023's actual goal (security headers present on every
  response) while fixing this.
- Per Constitution §9: the acceptance criteria above need a real test — specifically, an e2e
  test using a real headless browser (per this repo's now-working Chromium-in-sandbox setup)
  that loads the real served page and asserts `.dh-app` actually renders, not just that HTTP
  headers are correct. This is exactly the class of bug pure header-assertion tests cannot
  catch — the existing `e2e/web.test.ts` should be strengthened or a new test added.
- Verify live against both `dh --web` and `dh --connect --web` (both call `serveWebUi`) —
  don't only fix and verify one code path.

## Assumptions

- This is a pure regression, not a design change — DH-0023's actual intent (security headers
  on responses) stays; only the asset-serving gap gets fixed.

## Risks

- Whatever fix is chosen must not reintroduce the original problem DH-0023's workaround
  solved (no public Bun API to get a plain `Response` from `HTMLBundle` rendering with
  headers attached) — read `src/web/server.ts`'s existing `renderIndex` doc comment in full
  before changing it, it explains exactly what was tried and ruled out.

## Open Questions

## Notes

> [!NOTE]
> Found 2026-07-16 by the coordinator while investigating DH-0061 (Web overnight behavioral
> test suite) — the suite's spikes all timed out waiting for `.dh-app` to appear. Root-caused
> via direct reproduction: real headless Chromium (just installed in this sandbox, previously
> missing) loading the real served page, confirming both asset chunks 404 via
> `page.on("requestfailed")`. This is the first time a real browser has been able to load the
> live Web UI in this sandbox since DH-0023 merged — the regression was invisible until now
> purely because nothing could actually load a real browser against it before.
