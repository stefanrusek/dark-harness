// DH-0057: transient loopback-only receiver for the OAuth authorization_code redirect.
//
// This is NOT a `dh` run mode and NOT the `--server` HTTP+SSE server (ADR 0001). It is a
// one-shot `Bun.serve` bound to 127.0.0.1 ONLY (never 0.0.0.0 / the configured host),
// serving exactly one route `/callback`, alive only for the duration of one McpAuth
// interactive flow and torn down immediately after — architecturally the same class of
// transient as the Bash tool spawning a child process. It adds no externally-reachable
// network surface (loopback bind, ADR 0003).

/** A running loopback redirect receiver. */
export interface LoopbackReceiver {
  /** e.g. "http://127.0.0.1:49812/callback" — the OAuth redirect_uri. */
  readonly redirectUri: string;
  /** Resolves when the browser redirect lands; rejects on timeout or a `?error=` redirect. */
  waitForCode(timeoutMs: number): Promise<{ code: string; state: string }>;
  /** Idempotent teardown of the transient server. */
  close(): Promise<void>;
}

const LOOPBACK_HOST = "127.0.0.1";

/** Minimal HTML shown in the operator's browser after the redirect lands. */
function completePage(message: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>dh — MCP authorization</title></head>` +
      `<body style="font-family:system-ui,sans-serif;padding:2rem"><h1>${message}</h1>` +
      `<p>You can close this tab and return to dh.</p></body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

/** Starts a transient loopback receiver on 127.0.0.1 (ephemeral port by default, or
 * `opts.port`), serving only `/callback`. On the redirect it captures `code`+`state` (or an
 * OAuth `error`), shows a minimal completion page, and resolves/rejects `waitForCode`. */
export function startLoopbackReceiver(opts?: { port?: number }): LoopbackReceiver {
  let resolveCode: ((v: { code: string; state: string }) => void) | undefined;
  let rejectCode: ((err: Error) => void) | undefined;
  let settled = false;
  // Buffer a result that arrives before waitForCode() is called (the redirect could land
  // between `begin` returning and the agent invoking `complete`).
  let pending: { code: string; state: string } | undefined;
  let pendingError: Error | undefined;

  const server = Bun.serve({
    hostname: LOOPBACK_HOST,
    port: opts?.port ?? 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/callback") {
        return new Response("Not found", { status: 404 });
      }
      const error = url.searchParams.get("error");
      if (error) {
        const description = url.searchParams.get("error_description") ?? "";
        const err = new Error(
          `authorization failed: ${error}${description ? ` — ${description}` : ""}`,
        );
        if (resolveCode || rejectCode) {
          settled = true;
          rejectCode?.(err);
        } else {
          pendingError = err;
        }
        return completePage("Authorization failed");
      }
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state") ?? "";
      if (!code) {
        return completePage("Authorization callback missing code");
      }
      const result = { code, state };
      if (resolveCode) {
        settled = true;
        resolveCode(result);
      } else {
        pending = result;
      }
      return completePage("Authorization complete");
    },
  });

  const redirectUri = `http://${LOOPBACK_HOST}:${server.port}/callback`;

  return {
    redirectUri,
    waitForCode(timeoutMs: number): Promise<{ code: string; state: string }> {
      if (pending) return Promise.resolve(pending);
      if (pendingError) return Promise.reject(pendingError);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new LoopbackTimeoutError(timeoutMs));
        }, timeoutMs);
        resolveCode = (v) => {
          clearTimeout(timer);
          resolve(v);
        };
        rejectCode = (err) => {
          clearTimeout(timer);
          reject(err);
        };
      });
    },
    async close(): Promise<void> {
      await server.stop(true);
    },
  };
}

/** Thrown by `waitForCode` when no callback arrives within the timeout — the tool maps this
 * to an actionable "still waiting" pending result (isError:false), not a harness failure. */
export class LoopbackTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`no authorization callback received within ${timeoutMs}ms`);
    this.name = "LoopbackTimeoutError";
  }
}
