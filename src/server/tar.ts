// Chosen archive format for the download_logs full-session bundle (docs/handoffs/server.md:
// "pick one archive format and document it"): an uncompressed POSIX ustar tar archive,
// hand-built in-process. Rationale: no dependency on a system `tar`/`zip` binary (not
// guaranteed present at runtime, especially on the windows-x64 release target per
// HANDOFF.md §11) and no third-party package — keeps `dh` a true single dependency-free
// binary. The format is simple enough to implement correctly in ~100 lines.

import { createHash } from "node:crypto";

const BLOCK_SIZE = 512;
const MAX_NAME_BYTES = 100;
// Entry name for the manifest that records original -> renamed entries (DH-0021). Kept
// well under MAX_NAME_BYTES and chosen to sort before any hash-prefixed renamed entry, so
// it always turns up first when a bundle is inspected with a plain `tar tf`.
const MANIFEST_NAME = "00-RENAMED-ENTRIES.txt";

function writeString(block: Uint8Array, offset: number, value: string, maxLen: number): void {
  const bytes = new TextEncoder().encode(value);
  const len = Math.min(bytes.length, maxLen);
  block.set(bytes.subarray(0, len), offset);
}

function writeOctal(block: Uint8Array, offset: number, value: number, fieldLen: number): void {
  // The field holds fieldLen-1 zero-padded octal digits, then a trailing NUL.
  const octal = value.toString(8).padStart(fieldLen - 1, "0");
  writeString(block, offset, octal, fieldLen - 1);
  block[offset + fieldLen - 1] = 0;
}

/** Exported only for direct unit-testing of the defensive bounds check below — every
 * real call path goes through `buildTar`, which always sanitizes names via
 * `safeEntryName` first, so a caller reaching this throw would indicate a bug in that
 * sanitization rather than a normal, reachable-in-production condition. */
export function buildHeader(name: string, size: number, mtimeSeconds: number): Uint8Array {
  // Callers of buildHeader always go through `safeEntryName` first (see `buildTar`), which
  // guarantees every name fits the 100-byte ustar field — this is a defensive invariant
  // check, not expected to trigger in normal operation.
  if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) {
    throw new RangeError(`tar entry name exceeds ${MAX_NAME_BYTES} bytes: ${name}`);
  }
  const header = new Uint8Array(BLOCK_SIZE);
  writeString(header, 0, name, 100); // name
  writeOctal(header, 100, 0o644, 8); // mode
  writeOctal(header, 108, 0, 8); // uid
  writeOctal(header, 116, 0, 8); // gid
  writeOctal(header, 124, size, 12); // size
  writeOctal(header, 136, mtimeSeconds, 12); // mtime
  header.fill(0x20, 148, 156); // chksum placeholder: 8 ASCII spaces, per the spec
  header[156] = "0".charCodeAt(0); // typeflag: regular file
  writeString(header, 257, "ustar\0", 6); // magic
  writeString(header, 263, "00", 2); // version
  writeString(header, 265, "root", 32); // uname
  writeString(header, 297, "root", 32); // gname

  let checksum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    checksum += header[i] as number;
  }
  // 6 octal digits, then NUL, then a trailing space — the standard chksum field encoding.
  writeString(header, 148, checksum.toString(8).padStart(6, "0"), 6);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

export interface TarEntry {
  name: string;
  data: Uint8Array;
  /** Per-entry modification time. Defaults to "now" (build time) when omitted — see
   * DH-0021: previously every entry silently got the archive's build time regardless of
   * the source file's real mtime, losing diagnostic value in the exported bundle. */
  mtimeSeconds?: number;
}

/**
 * Renders a name that is guaranteed to fit the 100-byte ustar name field. Names within the
 * limit pass through unchanged (the overwhelmingly common case — short agent-id-derived
 * filenames). A name that doesn't fit is replaced with a short, content-derived,
 * collision-resistant stand-in (a hex hash of the original name, plus its extension when
 * one is present) — the mapping back to the original name is recorded by the caller in the
 * bundle's manifest entry, so nothing is silently lost (DH-0021: a single oversized name
 * used to throw and abort the *entire* multi-agent bundle).
 */
function safeEntryName(name: string, usedNames: Set<string>): string {
  if (new TextEncoder().encode(name).length <= MAX_NAME_BYTES) return name;

  const extMatch = /\.[^./]{1,20}$/.exec(name);
  const ext = extMatch ? extMatch[0] : "";
  const hash = createHash("sha256").update(name, "utf8").digest("hex").slice(0, 16);
  let candidate = `${hash}${ext}`;
  let suffix = 0;
  // Collisions are astronomically unlikely (16 hex chars of sha256), but two different
  // oversized names could theoretically hash-collide after extension truncation — fall
  // back to a numeric disambiguator rather than silently overwriting one entry with another.
  while (usedNames.has(candidate)) {
    suffix++;
    candidate = `${hash}-${suffix}${ext}`;
  }
  return candidate;
}

/** Builds a minimal uncompressed POSIX ustar archive from in-memory entries. Any entry
 * whose name doesn't fit the 100-byte ustar name field is transparently renamed to a short
 * hash-derived stand-in rather than throwing (DH-0021); a manifest entry
 * (`00-RENAMED-ENTRIES.txt`) is appended to the archive recording the original name for
 * every renamed entry, so the mapping is always recoverable from the bundle itself. */
export function buildTar(entries: TarEntry[]): Uint8Array {
  const buildTimeSeconds = Math.floor(Date.now() / 1000);
  const usedNames = new Set<string>(
    entries.map((e) => e.name).filter((n) => n.length <= MAX_NAME_BYTES),
  );
  const renamed: Array<{ original: string; archived: string }> = [];

  const resolved = entries.map((entry) => {
    const archivedName = safeEntryName(entry.name, usedNames);
    usedNames.add(archivedName);
    if (archivedName !== entry.name) renamed.push({ original: entry.name, archived: archivedName });
    return {
      name: archivedName,
      data: entry.data,
      mtimeSeconds: entry.mtimeSeconds ?? buildTimeSeconds,
    };
  });

  if (renamed.length > 0) {
    const manifestBody = renamed
      .map(
        (r) => `${r.archived}	${r.original}
`,
      )
      .join("");
    resolved.push({
      name: MANIFEST_NAME,
      data: new TextEncoder().encode(manifestBody),
      mtimeSeconds: buildTimeSeconds,
    });
  }

  const chunks: Uint8Array[] = [];
  for (const entry of resolved) {
    chunks.push(buildHeader(entry.name, entry.data.length, entry.mtimeSeconds));
    chunks.push(entry.data);
    const padding = (BLOCK_SIZE - (entry.data.length % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding > 0) chunks.push(new Uint8Array(padding));
  }
  chunks.push(new Uint8Array(BLOCK_SIZE * 2)); // two zero blocks terminate the archive

  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
