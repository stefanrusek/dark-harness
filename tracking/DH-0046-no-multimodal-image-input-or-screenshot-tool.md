---
spile: ticket
id: DH-0046
type: feature
status: draft
owner: stefan
resolution:
blocked_by: ["deferred (owner decision 2026-07-16): cutting for now, real feature wanted later — GitHub issue #8 created to gauge demand"]
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0046: No image/multimodal input, and no screenshot tool — blocks visual web-testing/verification workflows

## Summary

`ProviderContentBlock`/`ProviderMessage` have no image block type, and no tool in `ALL_TOOLS`
captures or attaches a screenshot/image to the conversation. This blocks a category of workflow
(e.g. "take a screenshot and check the layout") that comparable harnesses support via multimodal
messages — relevant for a coding-agent harness where the agent may need to visually verify web UI
changes it makes.

## User Stories

### As an agent verifying a web UI change, I want to capture and reason about a screenshot

- Given a running web app under test, when the agent needs visual verification, then a
  screenshot-capture tool exists and images can be attached to the conversation as a content block
  the model can see.

## Design (architect pass, Fable, 2026-07-15)

Grounded against the installed SDKs: Anthropic `ImageBlockParam` is
`{ type: "image", source: { type: "base64", data, media_type } }` with `media_type` one of
`image/jpeg | image/png | image/gif | image/webp`, and `ToolResultBlockParam.content` accepts
`string | Array<TextBlockParam | ImageBlockParam | ...>`. Bedrock Converse `ImageBlock` is
`{ format: "png" | "jpeg" | "gif" | "webp", source: { bytes: Uint8Array } }`, and
`ToolResultContentBlock` has an `ImageMember`. Same four formats on both providers — images
attach cleanly **inside tool results**, which is exactly where a Read/Screenshot tool needs
them. No new npm dependency is required for any part of this design.

### FR-1: `ProviderContentBlock` image variant (Core — `src/agent/providers/types.ts`)

```ts
export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type ProviderContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: ImageMediaType; data: string } // base64, no data:-URI prefix
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolUseId: string;
      content: string | Array<{ type: "text"; text: string } | { type: "image"; mediaType: ImageMediaType; data: string }>;
      isError?: boolean;
    };
```

The `tool_result.content` widening is backward compatible — `string` remains valid, every
existing construction site compiles unchanged. `fromAnthropicContent`/`fromBedrockContent`
need no image handling (models emit text/tool_use, never images).

New module `src/agent/images.ts` (Core), the single source of image truth:
- `detectImageType(bytes: Uint8Array): ImageMediaType | null` — magic-byte sniffing:
  PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, GIF `GIF87a`/`GIF89a`,
  WebP `RIFF????WEBP`. Extension is never trusted; magic bytes are authoritative.
- `MAX_IMAGE_BYTES = 3_932_160` (3.75 MB — Bedrock Converse's per-image limit, the stricter
  of the two providers; Anthropic allows 5 MB. One cap that works everywhere beats a
  per-provider cap that makes a task pass on one provider and fail on the other.)
- `imageBlockFromBytes(bytes, mediaType)` — base64-encodes and constructs the block.

`ToolResult` (`src/agent/tools/types.ts`) gains an optional attachment channel:

```ts
export interface ToolResult {
  output: string;
  isError: boolean;
  images?: Array<{ mediaType: ImageMediaType; data: string }>;
}
```

`loop.ts` `runToolCalls`: when `result.images` is non-empty, the tool_result block's content
becomes `[{ type: "text", text: output }, ...images]`; otherwise it stays the plain string
(zero change to the existing path).

### FR-2: Read tool image support (Core — `src/agent/tools/read.ts`)

Mirrors real Claude Code's Read: reading an image file returns the image to the model
instead of a binary-refusal error.

- Detection runs on the existing 8 KB sniff prefix, **before** the `looksBinary` NUL check:
  `detectImageType(prefix)` → if it matches one of the four formats, take the image path.
- Image path: enforce `MAX_IMAGE_BYTES` from file metadata (same pattern as DH-0014's cap —
  no read before the check); read the file, return
  `{ output: "Read image: <abs path> (<mediaType>, <n> bytes)", images: [block] }`;
  call `recordRead` as usual (an image read still satisfies the read-before-Edit/Write guard).
- Oversized image: actionable error — state the size, the cap, and suggest downscaling via
  Bash (`sips` on macOS, ImageMagick/`convert` elsewhere). **No in-process resizing**: Bun has
  no built-in image codec and every real resize library (sharp et al.) is a native dependency
  that fights the single-compiled-binary posture. The error is the guardrail.
- `offset`/`limit` are ignored for image files (documented in the tool description).
- Non-image binaries (BMP/TIFF/etc.) keep today's binary refusal; its message now names the
  supported image formats. SVG is text and continues to read as text.

### FR-3: Screenshot tool (Core — new `src/agent/tools/screenshot.ts`, added to `ALL_TOOLS`)

**Name:** `Screenshot`. **Scope:** navigate to a URL in a headless browser, let it settle,
capture a **viewport** screenshot as PNG, return it as an image attachment.

Input schema:
- `url` (required) — `http(s)://` or `file://`.
- `width`, `height` — viewport, default **1280×800**, clamped to [320, 3000]. (Anthropic
  downscales anything over ~1568 px server-side, so huge viewports only waste tokens; the
  description says so.)
- `wait_ms` — settle budget after navigation, default 2000, max 15000.
- `output_path` (optional) — also keep the PNG here; otherwise it is written under
  `os.tmpdir()/dh-screenshots/<uuid>.png`. The path is always reported in `output` so the
  agent or a human can re-inspect it.

**Mechanism: shell out to a system-installed Chromium-family browser** — zero new
dependencies:

```
<browser> --headless=new --disable-gpu --hide-scrollbars \
  --window-size=<w>x<h> --virtual-time-budget=<wait_ms> \
  --screenshot=<file> <url>
```

Browser discovery order: (1) `options.browserPath` in `dh.json` (new **optional** field —
minimal additive extension per invariant §4.6, sign-off given here; no restructure, no ADR
needed); (2) well-known per-platform locations (macOS app-bundle paths for Chrome, Edge,
Chromium; `google-chrome`/`chromium`/`chromium-browser`/`msedge` on PATH for Linux;
standard Program Files paths on Windows). If nothing is found: clear tool error naming
`options.browserPath` and suggesting a Chrome/Chromium install.

**Why not Playwright as a runtime dep** (the DH-0002 comparison): `@modelcontextprotocol/sdk`
was accepted because it is pure TS, bundles into `bun build --compile`, and is
protocol-critical. A browser cannot be bundled into a single binary at all — Playwright as a
runtime dependency means a post-install multi-hundred-MB browser download, breaking both the
single-binary invariant (§4.1) and the air-gapped posture (§4.3). Reusing whatever browser
the host already has is the only posture-consistent option, and it degrades gracefully (clear
error) on hosts without one. E2E already installs Playwright's Chromium in CI; the e2e test
for this tool points `options.browserPath` at `chromium.executablePath()` from the existing
devDependency — no new CI infrastructure.

**Explicit scope cuts** (follow-up tickets if demand appears): no full-page capture (needs
CDP, not a headless flag), no cookies/auth/headers, no element-level screenshots, no
interaction before capture.

Guardrail: a captured PNG over `MAX_IMAGE_BYTES` returns an error suggesting a smaller
viewport — but the file stays on disk and its path is reported, so the capture isn't lost.

### FR-4: Provider adapter mapping (Core — both adapters)

`anthropic.ts` `toAnthropicContent`:
- `image` → `{ type: "image", source: { type: "base64", media_type: block.mediaType, data: block.data } }`.
- `tool_result` — string content passes through unchanged; array content maps element-wise
  (text → `TextBlockParam`, image → `ImageBlockParam` as above).

`bedrock.ts` `toBedrockContent`:
- media-type→format map: `image/png`→`"png"`, `image/jpeg`→`"jpeg"`, `image/gif`→`"gif"`,
  `image/webp`→`"webp"`.
- `image` → `{ image: { format, source: { bytes: <base64-decoded Uint8Array> } } }`.
- `tool_result` — string content keeps today's `[{ text }]`; array content maps element-wise
  (text → `{ text }`, image → `{ image: ... }` as above).

Response-side mapping in both adapters: unchanged.

### FR-5: Size/token-cost guardrails

- One cap, `MAX_IMAGE_BYTES` (3.75 MB), enforced at both construction sites (Read,
  Screenshot) with actionable errors. No silent resizing anywhere.
- Screenshot's default 1280×800 viewport ≈ 1,365 tokens per image (≈ w×h/750); both tool
  descriptions state the token-cost heuristic so the model can budget.
- Mock provider (`e2e/support/mock-provider.ts` / `mock-bedrock-provider.ts`) must accept
  image blocks in requests — verify, and extend if it validates content shapes strictly.

### FR-6: JSONL/SSE/display (kept deliberately lightweight)

- **Contracts** (`src/contracts/log.ts`, the one wire-truth touch — architect-reviewed here):
  `LogToolResultEvent` gains optional `images?: Array<{ mediaType: string; sizeBytes: number }>`.
  `output` remains the text summary. **Raw base64 is never written to the JSONL log** — a
  screenshot-heavy session must not bloat its log by megabytes per capture; the on-disk PNG
  path in `output` is the durable artifact.
- **SSE:** no change. Tool results are not streamed today (`agent_output` is text-only) and
  stay that way.
- **TUI/Web:** no changes this ticket — neither renders tool results today. If a log viewer
  later wants thumbnails/markers, that is a follow-up ticket, not this one.

### FR-7: Domain assignment

| Domain | Work |
| --- | --- |
| **Core (Grace)** — the bulk | `types.ts` image variant + `tool_result` widening; new `src/agent/images.ts`; `ToolResult.images`; `loop.ts` `runToolCalls` mapping; `read.ts` image path; new `screenshot.ts` + `ALL_TOOLS` registration; both adapter mappings; `dh.json` loader support for optional `options.browserPath`. |
| **Contracts** | The one-line `LogToolResultEvent.images` addition (implemented by Core; this design is the §6-trigger-2 sign-off). |
| **Prompt (Iris)** | System prompt + README: Screenshot tool exists, Read handles images, token-cost note, downscale-via-Bash advice in the cli-tools skill. |
| **E2E (Hedy)** | Read-an-image e2e with a tiny fixture PNG through the mock provider; Screenshot e2e using `chromium.executablePath()` as `options.browserPath`; mock-provider image-block acceptance. |
| **TUI/Web** | Nothing — display deferred to a follow-up ticket if wanted. |

## Notes

> [!NOTE]
> Source: Competitive-differentiation sweep finding #10.

> [!NOTE]
> Owner decision (2026-07-15): queue now — real capability gap for verifying web UI changes,
> not speculative. Needs an architect pass (new content-block type, screenshot tool design).

> [!NOTE]
> Architect pass complete (2026-07-15, Fable): design above; status moved to ready.
