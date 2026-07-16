// WebFetch — DH-0074 (tracking/DH-0074-*.md, architect design Fable 2026-07-16). Only
// registered when `dh.json` has a `web.fetch` block (see composeTools() in index.ts); absent
// entirely otherwise, consistent with the air-gapped-by-default posture (ADR 0003/0004).
//
// SSRF mitigation: resolves the target hostname and rejects any private/loopback/link-local/
// CGNAT address unless `web.fetch.allowPrivateNetwork` is set, plus an optional
// `allowedHosts` allowlist. Redirects are never auto-followed (`redirect: "manual"`) — every
// 3xx is returned to the model as text, which also closes the classic "public URL 302s to
// http://169.254.169.254/" redirect-SSRF hole, since the model's re-call re-runs this same
// check against the new URL.
//
// Known residual risk, documented rather than pretending it's fully closed: this is a
// resolve-then-connect check, and Bun's `fetch` gives no hook to pin the connection to the
// specific address that was checked (no IP-pinning option), so a DNS-rebinding attacker who
// controls the resolver could in principle serve a public address for the check and a
// private one for the actual connection a moment later. Accepted for v1 given the tool is
// opt-in and dh's primary posture is air-gapped; revisit if Bun ever grows such a hook.

import { lookup as dnsLookup } from "node:dns/promises";
import type { WebFetchConfig } from "../../contracts/index.ts";
import { hostMatchesSuffix, isPrivateAddress } from "./net-guard.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_CHARS = 50_000;

/** Renders HTML to plain text via Bun's built-in `HTMLRewriter` — no new dependency. Drops
 * `script`/`style`/`noscript` content entirely, collects the remaining text nodes, and
 * renders anchors as `text (url)` so links survive the conversion in a readable form. */
function htmlToText(html: string): string {
  const textParts: string[] = [];
  let skipDepth = 0;
  let currentHref: string | undefined;
  let currentLinkText = "";

  const rewriter = new HTMLRewriter()
    .on("script, style, noscript", {
      element(el) {
        skipDepth += 1;
        el.onEndTag(() => {
          skipDepth = Math.max(0, skipDepth - 1);
        });
      },
    })
    .on("a", {
      element(el) {
        currentHref = el.getAttribute("href") ?? undefined;
        currentLinkText = "";
        el.onEndTag(() => {
          if (currentHref && currentLinkText.trim().length > 0) {
            textParts.push(`${currentLinkText.trim()} (${currentHref})`);
          } else if (currentLinkText.trim().length > 0) {
            textParts.push(currentLinkText.trim());
          }
          currentHref = undefined;
          currentLinkText = "";
        });
      },
    })
    .on("*", {
      text(chunk) {
        if (skipDepth > 0) return;
        if (currentHref !== undefined) {
          currentLinkText += chunk.text;
          return;
        }
        if (chunk.text.trim().length > 0) {
          textParts.push(chunk.text);
        }
      },
    });

  rewriter.transform(new Response(html));
  return textParts
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n<system-reminder>WebFetch output truncated: ${text.length - maxChars} more character(s) not shown (maxOutputChars=${maxChars}).</system-reminder>`;
}

/** Resolves `hostname` to every address it maps to. A literal IPv4/IPv6 hostname is returned
 * as-is (no DNS lookup attempted); otherwise delegates to `dns.promises.lookup`. */
async function resolveAddresses(hostname: string): Promise<string[]> {
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) {
    return [hostname];
  }
  const results = await dnsLookup(hostname, { all: true });
  return results.map((r) => r.address);
}

/** Streams `response.body` up to `maxBytes`, returning the decoded text and whether the
 * stream was truncated (aborted) before it naturally ended. */
async function readBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) return { text: await response.text(), truncated: false };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          const allowed = value.byteLength - (total - maxBytes);
          if (allowed > 0) chunks.push(value.slice(0, allowed));
          truncated = true;
          break;
        }
        chunks.push(value);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Cancelling an already-finished/aborted stream can throw; nothing further to do.
    }
  }
  const combined = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(combined), truncated };
}

export const webFetchTool: Tool = {
  name: "WebFetch",
  description:
    "Fetches content from a http/https URL. Optionally pass 'prompt' describing what to " +
    "extract — applied only when web.fetch.extractionModel is configured in dh.json, " +
    "otherwise the processed page content is returned directly. Redirects are never " +
    "followed automatically; a 3xx response is reported back so it can be re-requested at " +
    "the new URL.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to fetch (http/https only)." },
      prompt: {
        type: "string",
        description:
          "What to extract from the page; applied only when web.fetch.extractionModel is " +
          "configured, otherwise the processed page content is returned directly.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const url = input.url;
    if (typeof url !== "string" || url.length === 0) {
      return { output: "WebFetch tool error: 'url' must be a non-empty string.", isError: true };
    }
    const prompt = input.prompt;
    if (prompt !== undefined && typeof prompt !== "string") {
      return { output: "WebFetch tool error: 'prompt' must be a string.", isError: true };
    }

    const fetchConfig: WebFetchConfig = ctx.config.web?.fetch ?? {};
    const timeoutMs = fetchConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxResponseBytes = fetchConfig.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    const maxOutputChars = fetchConfig.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { output: `WebFetch tool error: '${url}' is not a valid URL.`, isError: true };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        output: `WebFetch tool error: unsupported URL scheme '${parsed.protocol}' — only http/https are allowed.`,
        isError: true,
      };
    }

    if (fetchConfig.allowedHosts && fetchConfig.allowedHosts.length > 0) {
      const allowed = fetchConfig.allowedHosts.some((h) => hostMatchesSuffix(parsed.hostname, h));
      if (!allowed) {
        return {
          output: `WebFetch tool error: host '${parsed.hostname}' is not in the configured web.fetch.allowedHosts list.`,
          isError: true,
        };
      }
    }

    if (!fetchConfig.allowPrivateNetwork) {
      let addresses: string[];
      try {
        addresses = await resolveAddresses(parsed.hostname);
      } catch (err) {
        return {
          output: `WebFetch tool error: failed to resolve host '${parsed.hostname}': ${(err as Error).message}`,
          isError: true,
        };
      }
      const privateAddress = addresses.find((addr) => isPrivateAddress(addr));
      if (privateAddress) {
        return {
          output: `WebFetch tool error: refusing to fetch '${url}' — host '${parsed.hostname}' resolves to a private/loopback/link-local address (${privateAddress}). Set web.fetch.allowPrivateNetwork: true to allow this deliberately.`,
          isError: true,
        };
      }
    }

    let response: Response;
    try {
      response = await fetch(parsed, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return {
        output: `WebFetch tool error: request to '${url}' failed: ${(err as Error).message}`,
        isError: true,
      };
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "(no Location header)";
      return {
        output: `Redirected to ${location} (HTTP ${response.status})`,
        isError: false,
      };
    }

    if (!response.ok) {
      return {
        output: `WebFetch tool error: '${url}' responded with HTTP ${response.status} ${response.statusText}`,
        isError: true,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text/html");
    const isSupportedText =
      isHtml ||
      contentType.startsWith("text/") ||
      contentType.includes("application/json") ||
      contentType.includes("application/xml");
    if (!isSupportedText) {
      return {
        output: `WebFetch tool error: unsupported content type '${contentType || "(unknown)"}' for '${url}'.`,
        isError: true,
      };
    }

    const { text: rawBody, truncated: bodyTruncated } = await readBodyCapped(
      response,
      maxResponseBytes,
    );
    let processed = isHtml ? htmlToText(rawBody) : rawBody;
    if (bodyTruncated) {
      processed = `${processed}\n\n<system-reminder>Response body truncated at ${maxResponseBytes} bytes (web.fetch.maxResponseBytes).</system-reminder>`;
    }

    if (prompt !== undefined) {
      const extractionModel = fetchConfig.extractionModel;
      if (!extractionModel) {
        return {
          output: `<system-reminder>No web.fetch.extractionModel configured — returning processed page content directly instead of answering 'prompt'.</system-reminder>\n\n${truncate(processed, maxOutputChars)}`,
          isError: false,
        };
      }
      try {
        const result = await ctx.completeWithModel(extractionModel, {
          system: "You answer a question strictly based on the provided web page content.",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Web page content fetched from ${url}:\n\n${truncate(processed, maxOutputChars)}\n\n---\n\n${prompt}`,
                },
              ],
            },
          ],
          tools: [],
        });
        const answer = result.content
          .filter((block): block is { type: "text"; text: string } => block.type === "text")
          .map((block) => block.text)
          .join("\n");
        return {
          output: answer.length > 0 ? answer : "(extraction model returned no text)",
          isError: false,
        };
      } catch (err) {
        return {
          output: `WebFetch tool error: extraction model '${extractionModel}' call failed: ${(err as Error).message}`,
          isError: true,
        };
      }
    }

    return { output: truncate(processed, maxOutputChars), isError: false };
  },
};
