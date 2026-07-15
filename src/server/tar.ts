// Chosen archive format for the download_logs full-session bundle (docs/handoffs/server.md:
// "pick one archive format and document it"): an uncompressed POSIX ustar tar archive,
// hand-built in-process. Rationale: no dependency on a system `tar`/`zip` binary (not
// guaranteed present at runtime, especially on the windows-x64 release target per
// HANDOFF.md §11) and no third-party package — keeps `dh` a true single dependency-free
// binary. The format is simple enough to implement correctly in ~100 lines.

const BLOCK_SIZE = 512;

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

function buildHeader(name: string, size: number, mtimeSeconds: number): Uint8Array {
  if (new TextEncoder().encode(name).length > 100) {
    throw new RangeError(`tar entry name exceeds 100 bytes: ${name}`);
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
}

/** Builds a minimal uncompressed POSIX ustar archive from in-memory entries. */
export function buildTar(entries: TarEntry[]): Uint8Array {
  const mtimeSeconds = Math.floor(Date.now() / 1000);
  const chunks: Uint8Array[] = [];
  for (const entry of entries) {
    chunks.push(buildHeader(entry.name, entry.data.length, mtimeSeconds));
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
