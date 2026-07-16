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

// DH-0023: clickjacking defense-in-depth on the served UI itself — no live XSS sink exists
// today (the client only ever writes via textContent/createTextNode), but the page this
// serves is the thing an attacker would actually want to iframe for a UI-redress attack, so
// the headers belong here, not just on the API responses in src/server/server.ts.
// `frame-ancestors 'none'` is the modern CSP directive; `X-Frame-Options: DENY` covers
// browsers that only honor the legacy header.
const CLICKJACKING_HEADERS: Record<string, string> = {
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
};

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CLICKJACKING_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Judgment call (DH-0023): Bun's HTML-bundle rendering (module/asset discovery, hashing,
// inlining for a compiled binary) only happens through its own route-matching machinery —
// passing `indexHtml` as a route value is the *only* documented way to get it, and there is
// no public API to invoke that rendering directly and get back a plain `Response` to attach
// headers to (confirmed: wrapping it in `new Response(indexHtml)` serializes to the literal
// string "[object HTMLBundle]", not the page). A throwaway loopback-only inner server exists
// purely to make Bun do that rendering once; the resulting bytes (with our security headers
// layered on) are cached and reused for every real request afterward — a one-time cost per
// process, not per request. Skipped when `development` is on (HMR should reflect live edits,
// so this renders fresh — and un-cached — every time in that mode).
// biome-ignore lint/suspicious/noExplicitAny: see the cast note inside render() below
let cachedIndexResponse: Promise<any> | undefined;

async function renderIndex(development: boolean): Promise<Response> {
  const render = async () => {
    const inner = Bun.serve({ port: 0, hostname: "127.0.0.1", routes: { "/": indexHtml } });
    try {
      // Cast away the ambient `fetch`/`Response`/`Headers` types here: this file is
      // typechecked both under its own DOM-enabled program (src/web/tsconfig.json) *and*,
      // transitively (via whatever root-owned file imports `serveWebUi`, e.g. `src/cli.ts`),
      // under the root program's DOM-less one — see src/web/tsconfig.json's own comment on
      // this exact split. `bun-types` itself resolves `Response`/`Headers` differently
      // depending on whether `lib.dom` is present in that pass, so a value that's valid
      // under one program's types is a mismatch under the other's; this loopback
      // self-request's actual runtime shape (status/headers/arrayBuffer) doesn't depend on
      // either program's opinion of it. `any` all the way through this function is the
      // pragmatic way to satisfy both `tsc` invocations at once — the surrounding functions
      // still narrow back to the real `Response` type at their boundaries.
      // biome-ignore lint/suspicious/noExplicitAny: see comment above
      const rendered: any = await fetch(`http://127.0.0.1:${inner.port}/`);
      const body = await rendered.arrayBuffer();
      const headers: Record<string, string> = {};
      rendered.headers.forEach((value: string, key: string) => {
        headers[key] = value;
      });
      return withSecurityHeaders(new Response(body, { status: rendered.status, headers }));
    } finally {
      inner.stop(true);
    }
  };
  if (development) return render();
  if (!cachedIndexResponse) cachedIndexResponse = render();
  return (await cachedIndexResponse).clone();
}

export function serveWebUi(options: ServeWebUiOptions): WebUiHandle {
  const config: WebConfigResponse = options.token
    ? { baseUrl: options.targetBaseUrl, token: options.token }
    : { baseUrl: options.targetBaseUrl };
  const development = options.development ?? false;

  const server = Bun.serve({
    port: options.port,
    ...(options.hostname ? { hostname: options.hostname } : {}),
    development,
    routes: {
      "/": () => renderIndex(development),
      [WEB_CONFIG_PATH]: () => withSecurityHeaders(Response.json(config)),
    },
    fetch() {
      return withSecurityHeaders(new Response("Not Found", { status: 404 }));
    },
  });

  const port = server.port ?? options.port;
  return {
    port,
    url: `http://localhost:${port}`,
    stop: () => server.stop(true),
  };
}
