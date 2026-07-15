import { describe, expect, test } from "bun:test";
import type { AgentTreeResponse, CommandAck } from "../contracts/index.ts";
import { COMMAND_PATH, sendCommand } from "./http-client.ts";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** Bun's `fetch` type carries extra static members (e.g. `preconnect`) that a plain fake
 * function doesn't have; cast through `unknown` rather than widen the fakes below. */
function asFetch(
  fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
): typeof fetch {
  return fn as unknown as typeof fetch;
}

describe("sendCommand", () => {
  test("POSTs to {baseUrl}{COMMAND_PATH} with a JSON body", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = asFetch(async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return jsonResponse({ ok: true } satisfies CommandAck);
    });

    const result = await sendCommand(
      "http://localhost:4000",
      { type: "request_agent_tree" },
      { fetchImpl },
    );

    expect(capturedUrl).toBe(`http://localhost:4000${COMMAND_PATH}`);
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({ type: "request_agent_tree" });
    expect(result).toEqual({ ok: true });
  });

  test("merges custom headers with content-type", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const fetchImpl = asFetch(async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse({ ok: true } satisfies CommandAck);
    });

    await sendCommand(
      "http://localhost:4000",
      { type: "request_agent_tree" },
      { fetchImpl, headers: { authorization: "Bearer t" } },
    );

    expect(capturedHeaders?.authorization).toBe("Bearer t");
    expect(capturedHeaders?.["content-type"]).toBe("application/json");
  });

  test("returns the AgentTreeResponse shape for request_agent_tree", async () => {
    const response: AgentTreeResponse = { ok: true, tree: [] };
    const fetchImpl = asFetch(async () => jsonResponse(response));
    const result = await sendCommand("http://x", { type: "request_agent_tree" }, { fetchImpl });
    expect(result).toEqual(response);
  });

  test("throws with the server's error message on a non-ok response with a CommandAck body", async () => {
    const fetchImpl = asFetch(async () =>
      jsonResponse({ ok: false, error: "agent not found" }, { status: 404 }),
    );
    await expect(
      sendCommand("http://x", { type: "stop_agent", agentId: "missing" }, { fetchImpl }),
    ).rejects.toThrow("agent not found");
  });

  test("throws a generic HTTP status message when the error body has no error field", async () => {
    const fetchImpl = asFetch(async () => jsonResponse({ ok: false }, { status: 500 }));
    await expect(
      sendCommand("http://x", { type: "request_agent_tree" }, { fetchImpl }),
    ).rejects.toThrow("HTTP 500");
  });

  test("throws when the network request itself fails", async () => {
    const fetchImpl = asFetch(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(
      sendCommand("http://x", { type: "request_agent_tree" }, { fetchImpl }),
    ).rejects.toThrow("request failed: ECONNREFUSED");
  });

  test("throws when the response body is not valid JSON", async () => {
    const fetchImpl = asFetch(async () => new Response("not json", { status: 200 }));
    await expect(
      sendCommand("http://x", { type: "request_agent_tree" }, { fetchImpl }),
    ).rejects.toThrow(/non-JSON/);
  });

  test("throws when the response body doesn't look like a CommandAck", async () => {
    const fetchImpl = asFetch(async () => jsonResponse({ nope: true }));
    await expect(
      sendCommand("http://x", { type: "request_agent_tree" }, { fetchImpl }),
    ).rejects.toThrow(/unexpected response shape/);
  });

  test("defaults to the global fetch when no fetchImpl is provided", async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    // biome-ignore lint/suspicious/noExplicitAny: stubbing the global for this one test
    (globalThis as any).fetch = async () => {
      called = true;
      return jsonResponse({ ok: true } satisfies CommandAck);
    };
    try {
      const result = await sendCommand("http://x", { type: "request_agent_tree" });
      expect(called).toBe(true);
      expect(result).toEqual({ ok: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
