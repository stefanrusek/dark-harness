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

import type { HeaderInfo } from "../header-info.ts";
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
  /** DH-0122: app name/version/build identity + `dh.json` config-status summary, built by
   * the caller (src/cli.ts, which has the real `DhConfig`/`BuildInfo`) via
   * `buildHeaderInfo` (header-info.ts) — forwarded verbatim to the browser over
   * `WEB_CONFIG_PATH` for `<AppHeader>` to render. */
  headerInfo?: HeaderInfo;
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
const CLICKJACKING_HEADERS: Record<string, string> = Object.freeze({
  "x-frame-options": "DENY",
  "content-security-policy": "frame-ancestors 'none'",
});

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

// Judgment call (DH-0023, revised DH-0110): Bun's HTML-bundle rendering (module/asset
// discovery, hashing, inlining for a compiled binary) only happens through its own
// route-matching machinery — passing `indexHtml` as a route value is the *only* documented
// way to get it, and there is no public API to invoke that rendering directly and get back a
// plain `Response` to attach headers to (confirmed: wrapping it in `new Response(indexHtml)`
// serializes to the literal string "[object HTMLBundle]", not the page).
//
// DH-0023's original fix span up a throwaway loopback-only inner server *just* to render `/`
// once, then tore it down — which quietly broke every asset chunk the rendered HTML
// references (`/chunk-*.js`, `/chunk-*.css`): those only ever existed as routes on that
// now-dead inner server, so every real request for them hit the outer server's catch-all
// `fetch()` and 404'd (DH-0110). `.dh-app` never rendered because its own JS never loaded.
//
// DH-0110's fix: keep the inner server running for the lifetime of the process (module-level,
// lazily started, shared across every `serveWebUi()` call — the bundled asset content is
// process-wide static, not per-instance) and have the *outer* server proxy any unmatched
// request straight through to it over loopback, layering the same security headers on the
// proxied response. Content-hashed asset paths (Bun names them `<name>-<hash>.js`) never
// change during a process's lifetime, so successful asset responses are cached by path after
// the first hit — same one-time-cost-per-process shape DH-0023 already established for `/`.
// Skipped entirely in `development` mode (HMR should reflect live edits, so everything is
// fetched fresh, uncached, every time).
interface InnerServerHandle {
  port: number;
  stop(): void;
}

// Genuine lazy-singleton state, not a constant -- starts undefined and is reassigned exactly
// once by getInnerServer() below, on first use. Object.freeze() doesn't apply (nothing to
// freeze until it's set, and freezing would defeat the lazy-init purpose); this is
// module-scope mutable state by design, not an oversight.
// biome-ignore lint/plugin/no-module-scope-side-effects: lazy-singleton, see comment above
let innerServer: InnerServerHandle | undefined;

function getInnerServer(): InnerServerHandle {
  if (!innerServer) {
    // `Bun.serve`'s route-value typing differs across this file's two typecheck passes (see
    // the comment inside proxyToInner() below for the full explanation of the split).
    innerServer = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      routes: { "/": indexHtml },
      // biome-ignore lint/suspicious/noExplicitAny: see comment above
    }) as any as InnerServerHandle;
  }
  return innerServer;
}

// A `Response` cached under one typecheck pass mismatches the other's ambient type — same
// DOM-vs-DOM-less split as proxyToInner() below.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
const assetCache = Object.freeze(new Map<string, any>());

async function proxyToInner(path: string, development: boolean): Promise<Response> {
  if (!development) {
    const cached = assetCache.get(path);
    if (cached) return cached.clone();
  }
  const inner = getInnerServer();
  // Cast away the ambient `fetch`/`Response`/`Headers` types here: this file is typechecked
  // both under its own DOM-enabled program (src/web/tsconfig.json) *and*, transitively (via
  // whatever root-owned file imports `serveWebUi`, e.g. `src/cli.ts`), under the root
  // program's DOM-less one — see src/web/tsconfig.json's own comment on this exact split.
  // `bun-types` itself resolves `Response`/`Headers` differently depending on whether
  // `lib.dom` is present in that pass, so a value that's valid under one program's types is a
  // mismatch under the other's; this loopback self-request's actual runtime shape
  // (status/headers/arrayBuffer) doesn't depend on either program's opinion of it. `any` all
  // the way through this function is the pragmatic way to satisfy both `tsc` invocations at
  // once — the surrounding functions still narrow back to the real `Response` type at their
  // boundaries.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const rendered: any = await fetch(`http://127.0.0.1:${inner.port}${path}`);
  const body = await rendered.arrayBuffer();
  const headers: Record<string, string> = {};
  rendered.headers.forEach((value: string, key: string) => {
    headers[key] = value;
  });
  const response = withSecurityHeaders(new Response(body, { status: rendered.status, headers }));
  if (!development && rendered.status === 200) {
    assetCache.set(path, response.clone());
  }
  return response;
}

async function renderIndex(development: boolean): Promise<Response> {
  return proxyToInner("/", development);
}

// DH-0128: `targetBaseUrl` in the common `dh --web` (non-`--connect`) case is always built
// by the caller (src/cli.ts) as `http://localhost:<boundPort>` — correct only when the
// browser loading this UI happens to be on the *same* machine as the dh process. Bun.serve
// binds all interfaces by default (DH-0022), so a browser on a different machine on the LAN
// loads the page (proxied assets don't care about host) but then dials `dh-config.json`'s
// literal `baseUrl`, which points at *its own* loopback — nothing listens there, so the SSE
// stream never connects and the pill sticks on "Reconnecting...". Fix: when the configured
// target host is loopback, re-resolve it per-request against the Host the browser actually
// used to reach this server, keeping the configured scheme/port. `--connect <host>`'s
// `targetBaseUrl` already names a real, non-loopback remote host (or an operator-chosen
// non-loopback address) and is passed through untouched — only a loopback host is ever
// rewritten, so this can't redirect traffic to an address the caller didn't already trust.
function resolveConfig(
  targetBaseUrl: string,
  token: string | undefined,
  headerInfo: HeaderInfo | undefined,
  req: Request,
): WebConfigResponse {
  const target = new URL(targetBaseUrl);
  if (target.hostname === "localhost" || target.hostname === "127.0.0.1") {
    target.hostname = new URL(req.url).hostname;
  }
  const baseUrl = target.toString().replace(/\/$/, "");
  return {
    baseUrl,
    ...(token ? { token } : {}),
    ...(headerInfo ? { headerInfo } : {}),
  };
}

export function serveWebUi(options: ServeWebUiOptions): WebUiHandle {
  const development = options.development ?? false;

  const server = Bun.serve({
    port: options.port,
    ...(options.hostname ? { hostname: options.hostname } : {}),
    development,
    routes: {
      "/": () => renderIndex(development),
      [WEB_CONFIG_PATH]: (req: Request) =>
        withSecurityHeaders(
          Response.json(
            resolveConfig(options.targetBaseUrl, options.token, options.headerInfo, req),
          ),
        ),
    },
    // DH-0110: everything Bun's HTML-bundler generated for `/` (asset chunks, source maps,
    // etc.) but didn't register as an explicit outer route lands here — proxy it to the inner
    // server (see `proxyToInner` above) instead of a flat 404. A genuinely unknown path still
    // ends up 404 because the inner server's own catch-all returns 404 for it too; the
    // security headers still land either way since `proxyToInner` always applies them.
    fetch(req) {
      const url = new URL(req.url);
      return proxyToInner(url.pathname, development);
    },
  });

  const port = server.port ?? options.port;
  return {
    port,
    url: `http://localhost:${port}`,
    stop: () => server.stop(true),
  };
}
