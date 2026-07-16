// Serves the web UI's static bundle from the **client** process (ADR 0003 — never from
// `--server`). Uses Bun's native HTML-import bundling (`Bun.serve({ routes: { "/": html } })`)
// so there's no separate bundler step or dependency: Bun discovers and bundles the
// `<script type="module">`/`<link rel="stylesheet">` referenced from client/index.html,
// both in `bun run` dev mode and inside a `bun build --compile` standalone binary.
//
// Coordination point for Core (src/cli.ts): call `serveWebUi({ port, targetBaseUrl, token })`
// for both the `--web` (local) and `--connect <host> --web` paths — the only difference
// between those two modes is what `targetBaseUrl` points at (loopback vs the remote host).
// The returned `url` is what `--web`'s "open/print the URL" behavior (HANDOFF.md §2) should
// use; this module does not open a browser itself.

import indexHtml from "./client/index.html";
import { WEB_CONFIG_PATH, type WebConfigResponse } from "./protocol.ts";

export interface ServeWebUiOptions {
  /** Port the static web UI itself listens on (distinct from the dh server's port). */
  port: number;
  /** Base URL of the dh server this UI should talk to, e.g. "http://localhost:4000". */
  targetBaseUrl: string;
  /** Bearer token to use when calling the target server, if it requires one. */
  token?: string;
  /** Enables Bun's hot-reload dev mode. Defaults to false. */
  development?: boolean;
  /** DH-0022: opt-in bind address for this static web UI's own `Bun.serve` (e.g.
   * "127.0.0.1" for loopback-only). Omitted means unchanged default behavior — Bun's own
   * default (all interfaces). Sourced from `dh.json`'s `security.hostname`. */
  hostname?: string;
}

export interface WebUiHandle {
  port: number;
  url: string;
  stop(): void;
}

export function serveWebUi(options: ServeWebUiOptions): WebUiHandle {
  const config: WebConfigResponse = options.token
    ? { baseUrl: options.targetBaseUrl, token: options.token }
    : { baseUrl: options.targetBaseUrl };

  const server = Bun.serve({
    port: options.port,
    ...(options.hostname ? { hostname: options.hostname } : {}),
    development: options.development ?? false,
    routes: {
      "/": indexHtml,
      [WEB_CONFIG_PATH]: () => Response.json(config),
    },
    fetch() {
      return new Response("Not Found", { status: 404 });
    },
  });

  const port = server.port ?? options.port;
  return {
    port,
    url: `http://localhost:${port}`,
    stop: () => server.stop(true),
  };
}
