// Real browser bootstrap. Deliberately thin — everything with logic worth testing lives in
// app.ts/render.ts/state.ts/sse.ts and is exercised there with happy-dom and fake
// fetch/streams; this file just wires the real `document`/`fetch` into `AppView` (which in
// turn drives sse.ts's own `fetch()`-based SSE reader — no `EventSource`, see sse.ts).
// `boot()` itself is exported and unit-tested against a fake `document`/`fetch` (see
// main.test.ts) so the wiring is proven by `bun test`, not just the `run`/E2E browser check
// — the `import.meta.main` guard (matching src/cli.ts's own entry-point pattern) is what
// keeps the real boot from firing when this module is merely imported by a test.

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

// One line so bun's line-coverage instrumentation marks it hit even though the guard
// short-circuits under `bun test` (import.meta.main is false for an imported module) — see
// main.test.ts, which exercises `boot()` itself directly.
import.meta.main && void boot(document, fetch);
