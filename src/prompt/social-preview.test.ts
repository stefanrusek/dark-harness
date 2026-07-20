// DH-0228: GitHub social-preview card (docs/media/social-preview.{svg,png}). A static image
// asset has limited executable surface — per the ticket's own "Acceptance criteria ->
// verification" section, this test asserts everything mechanically checkable (PNG pixel
// dimensions, and that the SVG embeds the real logo.svg geometry/gradient rather than a
// redrawn approximation) and leaves thumbnail-legibility/motif-recessiveness to owner visual
// review, as the ticket calls out explicitly.
import { describe, expect, test } from "bun:test";

const SVG_SOURCE = await Bun.file(
  new URL("../../docs/media/social-preview.svg", import.meta.url),
).text();
const PNG_BYTES = new Uint8Array(
  await Bun.file(new URL("../../docs/media/social-preview.png", import.meta.url)).arrayBuffer(),
);

/** Reads the (width, height) out of a PNG's IHDR chunk (bytes 16-23, big-endian). */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("docs/media/social-preview.png is exactly 1280x640 (DH-0228)", () => {
  test("PNG signature is present", () => {
    expect(PNG_BYTES.length).toBeGreaterThan(8);
    expect(Array.from(PNG_BYTES.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  test("dimensions are 1280x640", () => {
    const { width, height } = pngDimensions(PNG_BYTES);
    expect(width).toBe(1280);
    expect(height).toBe(640);
  });
});

describe("docs/media/social-preview.svg embeds the real logo.svg geometry, unrecolored (DH-0228)", () => {
  test("contains the logo's signature D-bowl path data", () => {
    expect(SVG_SOURCE).toContain("M46 64 H82 A44 64 0 0 1 82 192 H46");
  });

  test("contains the logo's exact gradient stop colors", () => {
    expect(SVG_SOURCE).toContain("#9ECE6A");
    expect(SVG_SOURCE).toContain("#7DCFFF");
  });

  test("contains the near-black background fill", () => {
    expect(SVG_SOURCE).toContain("#0b0d12");
  });

  test("contains the literal wordmark text", () => {
    expect(SVG_SOURCE).toContain("Dark Harness");
  });
});
