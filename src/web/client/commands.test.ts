import { describe, expect, test } from "bun:test";
import type { AgentTreeResponse, CommandAck } from "../../contracts/index.ts";
import type { ServerTarget } from "../protocol.ts";
import {
  buildCancelQueuedMessageCommand,
  buildDownloadLogsCommand,
  buildInvokeSkillCommand,
  buildListModelsCommand,
  buildListSkillsCommand,
  buildRequestAgentTreeCommand,
  buildSendMessageCommand,
  buildStopAgentCommand,
  buildSwitchModelCommand,
  CommandError,
  cancelQueuedMessage,
  invokeSkill,
  listModels,
  listSkills,
  requestAgentTree,
  requestLogDownload,
  sendCommand,
  sendMessage,
  stopAgent,
  switchModel,
} from "./commands.ts";

const target: ServerTarget = { baseUrl: "http://localhost:4000" };
const targetWithToken: ServerTarget = { baseUrl: "http://localhost:4000", token: "shh" };

describe("command builders", () => {
  test("buildSendMessageCommand", () => {
    expect(buildSendMessageCommand("a1", "hello")).toEqual({
      type: "send_message",
      agentId: "a1",
      message: "hello",
    });
  });

  test("buildRequestAgentTreeCommand", () => {
    expect(buildRequestAgentTreeCommand()).toEqual({ type: "request_agent_tree" });
  });

  test("buildDownloadLogsCommand with an agentId", () => {
    expect(buildDownloadLogsCommand("a1")).toEqual({ type: "download_logs", agentId: "a1" });
  });

  test("buildDownloadLogsCommand without an agentId (full bundle)", () => {
    expect(buildDownloadLogsCommand()).toEqual({ type: "download_logs" });
  });

  test("buildStopAgentCommand", () => {
    expect(buildStopAgentCommand("a1")).toEqual({ type: "stop_agent", agentId: "a1" });
  });

  // DH-0207/DH-0208
  test("buildCancelQueuedMessageCommand", () => {
    expect(buildCancelQueuedMessageCommand("a1", "msg-1")).toEqual({
      type: "cancel_queued_message",
      agentId: "a1",
      messageId: "msg-1",
    });
  });

  // DH-0093: slash-command backend builders.
  test("buildListModelsCommand", () => {
    expect(buildListModelsCommand()).toEqual({ type: "list_models" });
  });

  test("buildSwitchModelCommand", () => {
    expect(buildSwitchModelCommand("root-1", "sonnet")).toEqual({
      type: "switch_model",
      agentId: "root-1",
      model: "sonnet",
    });
  });

  test("buildListSkillsCommand", () => {
    expect(buildListSkillsCommand()).toEqual({ type: "list_skills" });
  });

  test("buildInvokeSkillCommand with args", () => {
    expect(buildInvokeSkillCommand("root-1", "sm", "write a doc")).toEqual({
      type: "invoke_skill",
      agentId: "root-1",
      skill: "sm",
      args: "write a doc",
    });
  });

  test("buildInvokeSkillCommand without args", () => {
    expect(buildInvokeSkillCommand("root-1", "sm")).toEqual({
      type: "invoke_skill",
      agentId: "root-1",
      skill: "sm",
    });
  });
});

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(status: number, body: unknown): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

describe("sendCommand", () => {
  test("POSTs the command JSON to the command endpoint", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(200, { ok: true } satisfies CommandAck);
    await sendCommand(target, buildStopAgentCommand("a1"), fetchImpl);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:4000/api/commands");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      type: "stop_agent",
      agentId: "a1",
    });
  });

  test("adds an Authorization header when a token is configured", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(200, { ok: true });
    await sendCommand(targetWithToken, buildRequestAgentTreeCommand(), fetchImpl);
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer shh");
  });

  test("omits Authorization when no token is configured", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(200, { ok: true });
    await sendCommand(target, buildRequestAgentTreeCommand(), fetchImpl);
    const headers = new Headers(calls[0]?.init?.headers);
    expect(headers.has("Authorization")).toBe(false);
  });

  test("throws CommandError on a non-ok HTTP status", async () => {
    const { fetch: fetchImpl } = fakeFetch(401, { ok: false, error: "unauthorized" });
    await expect(sendCommand(target, buildRequestAgentTreeCommand(), fetchImpl)).rejects.toThrow(
      CommandError,
    );
  });

  test("throws CommandError when the ack body reports ok: false", async () => {
    const { fetch: fetchImpl } = fakeFetch(200, { ok: false, error: "agent not found" });
    await expect(sendCommand(target, buildStopAgentCommand("missing"), fetchImpl)).rejects.toThrow(
      "agent not found",
    );
  });

  test("resolves with the parsed body on success", async () => {
    const tree: AgentTreeResponse = { ok: true, tree: [] };
    const { fetch: fetchImpl } = fakeFetch(200, tree);
    const result = await sendCommand<AgentTreeResponse>(
      target,
      buildRequestAgentTreeCommand(),
      fetchImpl,
    );
    expect(result).toEqual(tree);
  });

  test("DH-0029 (#37): reports a timeout instead of hanging forever on a hung send", async () => {
    // A fetch double that never resolves — simulates a server that accepted the connection
    // but never responded, the exact case a command timeout exists to give feedback for.
    const hungFetch = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const timeoutCalls: Array<() => void> = [];
    const setTimeoutImpl = ((fn: () => void) => {
      timeoutCalls.push(fn);
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    const clearTimeoutImpl = (() => {}) as typeof clearTimeout;

    const pending = sendCommand(target, buildRequestAgentTreeCommand(), hungFetch, {
      timeoutMs: 5000,
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    expect(timeoutCalls).toHaveLength(1);
    timeoutCalls[0]?.();

    await expect(pending).rejects.toThrow("No response after 5s — the server may be unresponsive.");
  });

  test("clears its timeout timer once the fetch resolves", async () => {
    const { fetch: fetchImpl } = fakeFetch(200, { ok: true });
    let cleared = false;
    const setTimeoutImpl = ((fn: () => void) =>
      setTimeout(fn, 100_000)) as unknown as typeof setTimeout;
    const clearTimeoutImpl = ((id: unknown) => {
      cleared = true;
      clearTimeout(id as ReturnType<typeof setTimeout>);
    }) as typeof clearTimeout;

    await sendCommand(target, buildRequestAgentTreeCommand(), fetchImpl, {
      setTimeoutImpl,
      clearTimeoutImpl,
    });
    expect(cleared).toBe(true);
  });
});

describe("sendMessage / requestAgentTree / stopAgent", () => {
  test("sendMessage delegates to sendCommand with a send_message command", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(200, { ok: true });
    await sendMessage(target, "root-1", "hi", fetchImpl);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      type: "send_message",
      agentId: "root-1",
      message: "hi",
    });
  });

  test("requestAgentTree returns the tree response", async () => {
    const tree: AgentTreeResponse = { ok: true, tree: [] };
    const { fetch: fetchImpl } = fakeFetch(200, tree);
    expect(await requestAgentTree(target, fetchImpl)).toEqual(tree);
  });

  test("stopAgent posts a stop_agent command", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(200, { ok: true });
    await stopAgent(target, "a1", fetchImpl);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      type: "stop_agent",
      agentId: "a1",
    });
  });

  // DH-0207/DH-0208
  test("cancelQueuedMessage posts a cancel_queued_message command", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(200, { ok: true });
    await cancelQueuedMessage(target, "a1", "msg-1", fetchImpl);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      type: "cancel_queued_message",
      agentId: "a1",
      messageId: "msg-1",
    });
  });
});

describe("listModels / switchModel / listSkills / invokeSkill (DH-0093)", () => {
  test("listModels returns the models response", async () => {
    const response = { ok: true, models: [] };
    const { fetch: fetchImpl } = fakeFetch(200, response);
    expect(await listModels(target, fetchImpl)).toEqual(response);
  });

  test("switchModel posts a switch_model command", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(200, { ok: true });
    await switchModel(target, "root-1", "sonnet", fetchImpl);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      type: "switch_model",
      agentId: "root-1",
      model: "sonnet",
    });
  });

  test("listSkills returns the skills response", async () => {
    const response = { ok: true, skills: [{ name: "sm", description: "Sugar Maple" }] };
    const { fetch: fetchImpl } = fakeFetch(200, response);
    expect(await listSkills(target, fetchImpl)).toEqual(response);
  });

  test("invokeSkill posts an invoke_skill command with args", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(200, { ok: true });
    await invokeSkill(target, "root-1", "sm", "write a doc", fetchImpl);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      type: "invoke_skill",
      agentId: "root-1",
      skill: "sm",
      args: "write a doc",
    });
  });

  test("invokeSkill posts without args when omitted", async () => {
    const { fetch: fetchImpl, calls } = fakeFetch(200, { ok: true });
    await invokeSkill(target, "root-1", "sm", undefined, fetchImpl);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      type: "invoke_skill",
      agentId: "root-1",
      skill: "sm",
    });
  });
});

describe("requestLogDownload", () => {
  test("returns the raw Response on success without parsing it as JSON", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response("jsonl-bytes", { status: 200 });
    }) as unknown as typeof fetch;

    const res = await requestLogDownload(target, "a1", fetchImpl);
    expect(await res.text()).toBe("jsonl-bytes");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      type: "download_logs",
      agentId: "a1",
    });
  });

  test("omits agentId in the body for a full-bundle download", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response("bundle-bytes", { status: 200 });
    }) as unknown as typeof fetch;

    await requestLogDownload(target, undefined, fetchImpl);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ type: "download_logs" });
  });

  test("throws CommandError with the server's JSON error detail on failure", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: false, error: "no such agent" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(requestLogDownload(target, "missing", fetchImpl)).rejects.toThrow("no such agent");
  });

  test("throws CommandError with a bare status when the error body isn't JSON", async () => {
    const fetchImpl = (async () =>
      new Response("plain text error", { status: 500 })) as unknown as typeof fetch;

    await expect(requestLogDownload(target, "a1", fetchImpl)).rejects.toThrow(
      "Log download failed with status 500",
    );
  });
});

describe("CommandError", () => {
  test("carries an optional HTTP status", () => {
    const err = new CommandError("bad", 400);
    expect(err.message).toBe("bad");
    expect(err.status).toBe(400);
    expect(err.name).toBe("CommandError");
  });
});
