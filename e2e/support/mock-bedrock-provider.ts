// A minimal Bedrock-Runtime-Converse-API-compatible local HTTP server (docs/handoffs/e2e.md
// gap 2b). `src/agent/providers/bedrock.ts` (Core) drives any `provider.type: "bedrock"`
// entry through `BedrockRuntimeClient`, whose real AWS endpoint can be overridden with zero
// source changes via the SDK's own standard `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` environment
// variable (AWS SDK v3 "endpoints 2.0" env-var resolution, serviceId "Bedrock Runtime" ->
// `AWS_ENDPOINT_URL_BEDROCK_RUNTIME`; confirmed by reading
// node_modules/@smithy/core/dist-cjs/submodules/endpoints/index.js and
// node_modules/@aws-sdk/client-bedrock-runtime/dist-cjs/index.js's `serviceId: "Bedrock Runtime"`).
// That means the real, unmodified `BedrockProvider` can be driven through the real compiled
// `dh` binary against this mock, exactly like the Anthropic mock provider drives
// `AnthropicProvider` — no client injection, no source change.
//
// Only the one wire call the adapter ever makes is implemented: `POST
// /model/{modelId}/converse` (confirmed from the SDK's operation table:
// `{ [_h]: ["POST", "/model/{modelId}/converse", 200] }`). SigV4 auth headers are accepted
// but never verified — static dummy credentials (any non-empty `AWS_ACCESS_KEY_ID` /
// `AWS_SECRET_ACCESS_KEY`) are enough for the SDK to sign requests locally with no network
// egress to real AWS involved.
//
// One wrinkle vs. the Anthropic mock: `BedrockRuntimeClient` always builds a
// `NodeHttp2Handler` (dist-cjs/index.js: `requestHandler: NodeHttp2Handler.create(...)`),
// even for the non-streaming Converse call — there is no way to make it fall back to plain
// HTTP/1.1 from config. `Bun.serve` only speaks HTTP/1.1 in cleartext, which the SDK's http2
// session rejects outright. So this mock is a cleartext HTTP/2 (h2c) server built on Node's
// `node:http2` module (which Bun's Node-compat layer supports) instead of `Bun.serve`.

import { randomUUID } from "node:crypto";
import http2 from "node:http2";

export interface MockBedrockToolCall {
  toolUseId?: string;
  name: string;
  input: unknown;
}

/** One scripted model turn. Shape mirrors just enough of the Converse API's response to
 * round-trip back through `fromBedrockContent`/`mapStopReason` (bedrock.ts). */
export interface MockBedrockTurn {
  text?: string;
  toolCalls?: MockBedrockToolCall[];
  stopReason?: "end_turn" | "tool_use" | "max_tokens";
  inputTokens?: number;
  outputTokens?: number;
}

export interface MockBedrockProvider {
  /** Set as `AWS_ENDPOINT_URL_BEDROCK_RUNTIME` in a test's `extraEnv` for `spawnDh`. */
  baseURL: string;
  /** Every `/model/{modelId}/converse` request body received so far, in order. */
  requests: Record<string, unknown>[];
  /** The `modelId` path segment captured from each request, in order — lets a test assert
   * the real `ModelConfig.model` (provider-side id) was sent, not the friendly `name`
   * (Core round 11's bug class: `dh` once sent `name` instead of `model` to every provider). */
  modelIds: string[];
  readonly callCount: number;
  stop(): void;
}

function turnToConverseResponse(turn: MockBedrockTurn) {
  const content: Record<string, unknown>[] = [];
  if (turn.text !== undefined && turn.text.length > 0) {
    content.push({ text: turn.text });
  }
  for (const call of turn.toolCalls ?? []) {
    content.push({
      toolUse: {
        toolUseId: call.toolUseId ?? `tu_${randomUUID()}`,
        name: call.name,
        input: call.input,
      },
    });
  }
  const stopReason =
    turn.stopReason ?? ((turn.toolCalls?.length ?? 0) > 0 ? "tool_use" : "end_turn");
  return {
    output: { message: { role: "assistant", content } },
    stopReason,
    usage: {
      inputTokens: turn.inputTokens ?? 10,
      outputTokens: turn.outputTokens ?? 10,
    },
  };
}

/**
 * Starts the mock provider. `turns` is consumed in order, one per `converse` call; once
 * exhausted the last turn repeats (same safety-net convention as `mock-provider.ts`).
 */
export async function startMockBedrockProvider(
  turns: MockBedrockTurn[],
): Promise<MockBedrockProvider> {
  if (turns.length === 0) {
    throw new Error("startMockBedrockProvider requires at least one scripted turn");
  }
  const requests: Record<string, unknown>[] = [];
  const modelIds: string[] = [];
  let callCount = 0;

  const server = http2.createServer((req, res) => {
    const path = req.url ?? "";
    const match = path.match(/^\/model\/(.+)\/converse$/);
    if (!match || req.method !== "POST") {
      res.writeHead(404).end("not found");
      return;
    }
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
    });
    req.on("end", () => {
      modelIds.push(decodeURIComponent(match[1] ?? ""));
      const body = raw.length > 0 ? (JSON.parse(raw) as Record<string, unknown>) : {};
      requests.push(body);
      const index = Math.min(callCount, turns.length - 1);
      callCount += 1;
      // biome-ignore lint/style/noNonNullAssertion: index is clamped into [0, turns.length)
      const turn = turns[index]!;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(turnToConverseResponse(turn)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    baseURL: `http://localhost:${port}`,
    requests,
    modelIds,
    get callCount() {
      return callCount;
    },
    stop: () => server.close(),
  };
}

/** Shorthand for the common case: one final plain-text completion, no tool calls. */
export function successTurn(text: string): MockBedrockTurn {
  return { text, stopReason: "end_turn" };
}

/** A self-reported-failure completion per loop.ts's `TASK_FAILED_MARKER` convention. */
export function taskFailedTurn(text = "Could not complete the task. TASK_FAILED"): MockBedrockTurn {
  return { text, stopReason: "end_turn" };
}

/** Dummy static AWS credentials — enough for the SDK to sign requests locally; the mock
 * server never verifies them and no request ever reaches real AWS (endpoint is overridden). */
export function mockBedrockEnv(baseURL: string, region = "us-east-1"): Record<string, string> {
  return {
    AWS_ENDPOINT_URL_BEDROCK_RUNTIME: baseURL,
    AWS_ACCESS_KEY_ID: "mock-access-key-id",
    AWS_SECRET_ACCESS_KEY: "mock-secret-access-key",
    AWS_REGION: region,
  };
}
