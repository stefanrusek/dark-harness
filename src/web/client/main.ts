// Real browser bootstrap. Deliberately thin — everything with logic worth testing lives in
// app.ts/render.ts/state.ts/sse.ts and is exercised there with happy-dom and fake
// fetch/streams; this file just wires the real `document`/`fetch` into `AppView` (which in
// turn drives sse.ts's own `fetch()`-based SSE reader — no `EventSource`, see sse.ts).
// `boot()` itself is exported and unit-tested against a fake `document`/`fetch` (see
// main.test.ts) so the wiring is proven by `bun test`, not just the `run`/E2E browser check.
//
// DH-0165: this file used to also be the actual `<script src>` entry, self-invoking `boot()`
// behind an `import.meta.main` guard (matching src/cli.ts's own entry-point pattern). That
// pattern is correct for a real Bun-compiled binary (a genuine "which module was `bun run`
// invoked on" question) but silently wrong for Bun's *browser* HTML-import bundler
// (`index.html`'s `<script type="module">` -> this file, bundled via `Bun.serve({ routes: {
// "/": html } })` in src/web/server.ts): there is no "main module" concept in a browser
// bundle, so Bun's bundler statically folds `import.meta.main` to the literal `false` for
// every browser-bundled file and dead-code-eliminates the guarded call — `boot()` was never
// actually invoked in any real browser, ever, and `.dh-app` never rendered (e2e's web/browser
// suite only started actually running, past an earlier install-blocking CI issue, once DH-0164
// landed, which is what first surfaced this). Fixed by moving the unconditional self-invoke
// into its own file (bootstrap.ts) that `index.html` now points `<script src>` at instead —
// this file goes back to exporting `boot` only, importable by main.test.ts with no
// self-invoking side effect to guard against.

import { WEB_CONFIG_PATH, type WebConfigResponse } from "../protocol.ts";
import { AppView } from "./app.ts";
import { domDownloadEnv } from "./download.ts";

export async function boot(doc: Document, fetchImpl: typeof fetch): Promise<void> {
  const root = doc.getElementById("root");
  if (!root) throw new Error("Dark Harness web UI: #root element not found");

  const config = (await fetchImpl(WEB_CONFIG_PATH).then((res) => res.json())) as WebConfigResponse;

  const app = new AppView(root, {
    doc,
    target: { baseUrl: config.baseUrl, token: config.token },
    downloadEnv: domDownloadEnv(doc),
    ...(config.headerInfo ? { headerInfo: config.headerInfo } : {}),
  });
  app.start();
}
