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
// /model/{modelId}/converse-stream` (confirmed from the SDK's operation table:
// `{ [_h]: ["POST", "/model/{modelId}/converse-stream", 200] }`). SigV4 auth headers are
// accepted but never verified — static dummy credentials (any non-empty
// `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) are enough for the SDK to sign requests
// locally with no network egress to real AWS involved.
//
// DH-0044: `BedrockProvider.complete()` now issues `ConverseStreamCommand`, not
// `ConverseCommand` — the response body is no longer a single JSON object but AWS's binary
// `application/vnd.amazon.eventstream` framing (length-prefixed messages with CRC32
// checksums, headers carrying `:event-type`/`:message-type`/`:content-type`, and a JSON
// payload per frame). This mock builds real frames via `@smithy/core/event-streams`'
// `EventStreamCodec` (the same codec the SDK itself uses to decode them) rather than
// hand-rolling the binary format — see `encodeEvent` below. Wire field names inside each
// frame's JSON payload (`delta`, `contentBlockIndex`, `stopReason`, `usage`, ...) were
// confirmed by reading the generated schema tables in
// node_modules/@aws-sdk/client-bedrock-runtime/dist-cjs/index.js (e.g. `_d = "delta"`,
// `_cBI = "contentBlockIndex"`) — this client generation has no `jsonName` trait overrides,
// so each frame's JSON field name equals the SDK's own camelCase TS property name.
//
// One wrinkle vs. the Anthropic mock: `BedrockRuntimeClient` always builds a
// `NodeHttp2Handler` (dist-cjs/index.js: `requestHandler: NodeHttp2Handler.create(...)`),
// even for the non-streaming Converse call — there is no way to make it fall back to plain
// HTTP/1.1 from config. `Bun.serve` only speaks HTTP/1.1 in cleartext, which the SDK's http2
// session rejects outright. So this mock is a cleartext HTTP/2 (h2c) server built on Node's
// `node:http2` module (which Bun's Node-compat layer supports) instead of `Bun.serve`.

import { randomUUID } from "node:crypto";
import http2 from "node:http2";
// `@smithy/core` isn't a direct dependency of this project — it's a transitive dependency of
// `@aws-sdk/client-bedrock-runtime`, reused here so this mock builds real AWS event-stream
// binary frames with the exact same codec the SDK itself uses to decode them, rather than
// hand-rolling the framing/CRC32 logic a second time.
import { EventStreamCodec } from "@smithy/core/event-streams";
import { fromUtf8, toUtf8 } from "@smithy/core/serde";
import {
  chunkText,
  clampTurnIndex,
  jobSuccessTurn as sharedJobSuccessTurn,
  jobTaskFailedTurn as sharedJobTaskFailedTurn,
  requireTurns,
  successTurn as sharedSuccessTurn,
  taskFailedTurn as sharedTaskFailedTurn,
  TEXT_DELTA_CHUNK_SIZE,
} from "./mock-scaffolding";

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

/** Builds the ordered sequence of `ConverseStreamOutput` union-member payloads (event-type ->
 * JSON body) for a scripted turn — one per Bedrock Converse stream event, matching the
 * accumulation loop in `consumeBedrockStream` (src/agent/providers/bedrock.ts). */
function turnToStreamEvents(turn: MockBedrockTurn): Array<{ eventType: string; payload: unknown }> {
  const events: Array<{ eventType: string; payload: unknown }> = [
    { eventType: "messageStart", payload: { role: "assistant" } },
  ];

  let index = 0;
  if (turn.text !== undefined && turn.text.length > 0) {
    // Bedrock has no explicit text block-start (bedrock.ts's `consumeBedrockStream` opens the
    // accumulator on the first delta) — only start events for tool_use are emitted below.
    for (const chunk of chunkText(turn.text, TEXT_DELTA_CHUNK_SIZE)) {
      events.push({
        eventType: "contentBlockDelta",
        payload: { contentBlockIndex: index, delta: { text: chunk } },
      });
    }
    events.push({ eventType: "contentBlockStop", payload: { contentBlockIndex: index } });
    index += 1;
  }
  for (const call of turn.toolCalls ?? []) {
    const toolUseId = call.toolUseId ?? `tu_${randomUUID()}`;
    events.push({
      eventType: "contentBlockStart",
      payload: { contentBlockIndex: index, start: { toolUse: { toolUseId, name: call.name } } },
    });
    events.push({
      eventType: "contentBlockDelta",
      payload: {
        contentBlockIndex: index,
        delta: { toolUse: { input: JSON.stringify(call.input ?? {}) } },
      },
    });
    events.push({ eventType: "contentBlockStop", payload: { contentBlockIndex: index } });
    index += 1;
  }

  const stopReason =
    turn.stopReason ?? ((turn.toolCalls?.length ?? 0) > 0 ? "tool_use" : "end_turn");
  events.push({ eventType: "messageStop", payload: { stopReason } });
  events.push({
    eventType: "metadata",
    payload: {
      usage: { inputTokens: turn.inputTokens ?? 10, outputTokens: turn.outputTokens ?? 10 },
    },
  });

  return events;
}

const eventStreamCodec = new EventStreamCodec(toUtf8, fromUtf8);

/** Encodes one `ConverseStreamOutput` union member as a real AWS event-stream binary frame —
 * `:message-type: event`, `:event-type: <member name>`, `:content-type: application/json`,
 * JSON-encoded body — using the same codec the SDK uses to decode it. */
function encodeEvent(eventType: string, payload: unknown): Uint8Array {
  return eventStreamCodec.encode({
    headers: {
      ":message-type": { type: "string", value: "event" },
      ":event-type": { type: "string", value: eventType },
      ":content-type": { type: "string", value: "application/json" },
    },
    body: new TextEncoder().encode(JSON.stringify(payload)),
  });
}

/**
 * Starts the mock provider. `turns` is consumed in order, one per `converse` call; once
 * exhausted the last turn repeats (same safety-net convention as `mock-provider.ts`).
 */
export async function startMockBedrockProvider(
  turns: MockBedrockTurn[],
): Promise<MockBedrockProvider> {
  requireTurns(turns, "startMockBedrockProvider");
  const requests: Record<string, unknown>[] = [];
  const modelIds: string[] = [];
  let callCount = 0;

  const server = http2.createServer((req, res) => {
    const path = req.url ?? "";
    const match = path.match(/^\/model\/(.+)\/converse-stream$/);
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
      const index = clampTurnIndex(callCount, turns.length);
      callCount += 1;
      // biome-ignore lint/style/noNonNullAssertion: index is clamped into [0, turns.length)
      const turn = turns[index]!;
      res.writeHead(200, { "content-type": "application/vnd.amazon.eventstream" });
      for (const { eventType, payload } of turnToStreamEvents(turn)) {
        res.write(Buffer.from(encodeEvent(eventType, payload)));
      }
      res.end();
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

/** Shorthand for the common case: one final plain-text completion, no tool calls. Use only
 * for interactive (server/TUI/Web) scripted turns — see `mock-provider.ts`'s identical
 * caveat. For non-interactive (`--job`/sub-agent) turns, use `jobSuccessTurn` instead. */
export function successTurn(text: string): MockBedrockTurn {
  return sharedSuccessTurn<MockBedrockTurn>(text);
}

/** A self-reported-failure completion per loop.ts's `TASK_FAILED_MARKER` convention. Same
 * interactive-only caveat as `successTurn` — use `jobTaskFailedTurn` for non-interactive
 * runs. */
export function taskFailedTurn(text = "Could not complete the task. TASK_FAILED"): MockBedrockTurn {
  return sharedTaskFailedTurn<MockBedrockTurn>(text);
}

/** DH-0115: non-interactive (`--job`/sub-agent) equivalent of `successTurn` — emits an
 * authoritative `ReportOutcome(status: "success")` tool call alongside the text so the turn
 * resolves in exactly one provider call (DH-0050 tier 1), instead of triggering the harness's
 * missed-call nudge turn. Do not use for interactive scripted turns. */
export function jobSuccessTurn(text: string): MockBedrockTurn {
  return sharedJobSuccessTurn<MockBedrockTurn>(text);
}

/** Non-interactive equivalent of `taskFailedTurn` — same rationale as `jobSuccessTurn`. */
export function jobTaskFailedTurn(
  text = "Could not complete the task. TASK_FAILED",
): MockBedrockTurn {
  return sharedJobTaskFailedTurn<MockBedrockTurn>(text);
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
