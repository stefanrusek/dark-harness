// Real browser bootstrap. Deliberately thin — everything with logic worth testing lives in
// app.ts/render.ts/state.ts/sse.ts and is exercised there with happy-dom and fake
// fetch/streams; this file just wires the real `document`/`fetch` into `AppView` (which in
// turn drives sse.ts's own `fetch()`-based SSE reader — no `EventSource`, see sse.ts) and
// is verified by the `run`/E2E browser check instead of `bun test`.

import { WEB_CONFIG_PATH, type WebConfigResponse } from "../protocol.ts";
import { AppView } from "./app.ts";
import { domDownloadEnv } from "./download.ts";

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (!root) throw new Error("Dark Harness web UI: #root element not found");

  const config = (await fetch(WEB_CONFIG_PATH).then((res) => res.json())) as WebConfigResponse;

  const app = new AppView(root, {
    doc: document,
    target: { baseUrl: config.baseUrl, token: config.token },
    downloadEnv: domDownloadEnv(document),
    ...(config.headerInfo ? { headerInfo: config.headerInfo } : {}),
  });
  app.start();
}

void boot();
