// Read tool — reads a file from disk, cat -n style (line numbers), with optional
// offset/limit. Mirrors Claude Code's Read tool semantics.
//
// DH-0014 fix (tracking/DH-0014-read-tool-unbounded-memory-for-large-files.md): the previous
// implementation called `new Uint8Array(await file.arrayBuffer())` — reading and decoding the
// WHOLE file into memory — before the binary-sniff check or any offset/limit slicing ran. A
// multi-GB file an agent stumbles into (a log, a build artifact) got fully buffered regardless
// of what `limit` was requested. Fixed two ways: (1) a hard size cap, checked from file
// metadata alone (no read at all) before anything else, refuses pathologically large files
// outright with an actionable error; (2) for files under the cap, line content is streamed and
// only the requested [offset, offset+limit) window is ever held in memory — lines outside the
// window are counted (for the truncation notice's exact remaining-line count) but never
// buffered. Binary sniffing reads only a small prefix via `file.slice()`, not the whole file.

import { isAbsolute, resolve } from "node:path";
import { getDocumentProxy } from "unpdf";
import { recordRead } from "./read-guard.ts";
import type { Tool, ToolContext, ToolResult } from "./types.ts";

const DEFAULT_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
// Round 13 (docs/handoffs/core.md, P1 item 7): sampled prefix for binary detection — large
// enough to catch binary formats' headers/magic bytes without reading (and decoding) an
// entire large file just to reject it.
const BINARY_SNIFF_BYTES = 8_000;
// DH-0079 (tracking/DH-0079-*.md): real Claude Code's Read hard-errors a whole-file read (no
// offset/limit given) once the file exceeds ~256KB — an all-or-nothing byte cap, not a soft
// line-count truncation. This is the PRIMARY, Claude-Code-matched behavior for the common
// "just read this file" call. Named distinctly from `MAX_READABLE_BYTES` below: this cap can
// be bypassed by supplying `offset`/`limit` (an explicit request for a bounded slice), the
// absolute ceiling below cannot.
const PRIMARY_WHOLE_FILE_BYTE_CAP = 256 * 1024;
// DH-0014: an absolute ceiling — checked from `Bun.file(...).size` (filesystem metadata only,
// before any byte of the file is read) — that applies unconditionally, even to offset/limit
// windowed reads, because `streamLines` below still has to walk the entire file byte-by-byte
// to count lines outside the requested window; without this ceiling a single `offset`/`limit`
// call against a multi-GB file would still take O(file size) time. DH-0079 shrunk the
// *whole-file* cap (`PRIMARY_WHOLE_FILE_BYTE_CAP` above) to match real Claude Code, but left
// this larger absolute ceiling in place for that reason — see this ticket's Notes for the
// audit of DH-0014's original rationale before reusing this constant's old, larger value here.
const MAX_READABLE_BYTES = 256 * 1024 * 1024;

/** Human-readable size for error messages, matching real Claude Code's observed format
 * (`256KB`, `3.2MB` — no space between number and unit, one decimal place above 1KB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)}KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)}MB`;
}

function resolvePath(filePath: string, cwd: string): string {
  return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

// DH-0073 (tracking/DH-0073-read-tool-has-no-jupyter-notebook-or-pdf-awareness...): Jupyter
// notebooks are well-specified JSON — detect `.ipynb` by extension and render cells/outputs
// readably instead of dumping raw notebook JSON as undifferentiated text. Image outputs are
// placeholdered pending DH-0046 (image-channel support); PDF support is out of scope here
// (split to DH-0081).

export interface NotebookOutput {
  output_type: "stream" | "execute_result" | "display_data" | "error";
  text?: string | string[];
  data?: Record<string, string | string[]>;
  name?: string;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

export interface NotebookCell {
  cell_type: "code" | "markdown" | "raw" | string;
  source: string | string[];
  outputs?: NotebookOutput[];
  execution_count?: number | null;
  id?: string;
}

export interface NotebookJson {
  cells: NotebookCell[];
  nbformat?: number;
  nbformat_minor?: number;
}

export function joinSource(source: string | string[] | undefined): string {
  if (source === undefined) return "";
  return Array.isArray(source) ? source.join("") : source;
}

const IMAGE_MIME_PREFIX = "image/";

/** Renders a single cell output. Text/stream outputs are shown verbatim; image outputs (e.g.
 * matplotlib plots) get a placeholder per DH-0073's assumption that full image-channel support
 * depends on DH-0046 landing separately. */
function renderOutput(output: NotebookOutput, index: number): string {
  if (output.output_type === "stream") {
    return joinSource(output.text);
  }
  if (output.output_type === "error") {
    const traceback = (output.traceback ?? []).join("\n");
    return `${output.ename ?? "Error"}: ${output.evalue ?? ""}${traceback ? `\n${traceback}` : ""}`;
  }
  // execute_result / display_data: `data` maps MIME type -> content.
  const data = output.data ?? {};
  const mimeTypes = Object.keys(data);
  const textMime = mimeTypes.find((mime) => !mime.startsWith(IMAGE_MIME_PREFIX));
  if (textMime) {
    return joinSource(data[textMime]);
  }
  const imageMime = mimeTypes.find((mime) => mime.startsWith(IMAGE_MIME_PREFIX));
  if (imageMime) {
    const raw = data[imageMime];
    const b64 = Array.isArray(raw) ? raw.join("") : (raw ?? "");
    // Base64 length -> approximate decoded byte count (4 base64 chars encode 3 bytes).
    const approxBytes = Math.floor((b64.length * 3) / 4);
    return `[image output, ${approxBytes} bytes, not yet displayable — see DH-0046]`;
  }
  return `[output ${index}: no renderable content]`;
}

export function renderNotebook(notebook: NotebookJson): string {
  const cells = notebook.cells ?? [];
  const sections = cells.map((cell, i) => {
    const header = `--- Cell ${i} (${cell.cell_type}${cell.id ? `, id=${cell.id}` : ""}) ---`;
    const source = joinSource(cell.source);
    const parts = [header, source];
    if (cell.outputs && cell.outputs.length > 0) {
      const rendered = cell.outputs
        .map((output, oi) => renderOutput(output, oi))
        .filter((text) => text.length > 0)
        .join("\n");
      if (rendered.length > 0) {
        parts.push("Output:", rendered);
      }
    }
    return parts.join("\n");
  });
  return sections.join("\n\n");
}

export function isNotebookPath(path: string): boolean {
  return path.toLowerCase().endsWith(".ipynb");
}

// DH-0081 (tracking/DH-0081-read-tool-has-no-pdf-support-at-all-needs-text-extraction-added-then-pagination.md):
// PDFs are detected by the `%PDF-` magic bytes at file offset 0, not by extension — matching
// how the binary-vs-text sniff below already works structurally. `unpdf` is the only one of
// three candidate PDF-parsing libraries (see the ticket's evaluation table) that survives
// `bun build --compile` into a standalone binary; the other two pull in a native canvas
// dependency that crashes with `DOMMatrix is not defined` once compiled.
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const MAX_PDF_PAGE_SPAN = 20;
const PDF_PAGES_REQUIRED_ABOVE = 10;

/** Detects the `%PDF-` magic prefix in an already-sniffed byte buffer. Must be checked before
 * `looksBinary` below — PDFs legitimately contain NUL bytes in their binary streams and would
 * otherwise be incorrectly refused as binary files. */
function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (bytes[i] !== PDF_MAGIC[i]) return false;
  }
  return true;
}

/** Parsed, validated page range: 1-based, inclusive on both ends. */
interface PageRange {
  start: number;
  end: number;
}

/** Parses and validates the `pages` parameter's `"N"` / `"N-M"` string form against the
 * document's actual page count. Returns an error message string on any invalid input
 * (malformed syntax, out-of-range, or a span over `MAX_PDF_PAGE_SPAN`), or the parsed range. */
function parsePageRange(pages: string, totalPages: number): PageRange | string {
  const match = /^(\d+)(?:-(\d+))?$/.exec(pages.trim());
  if (!match) {
    return `Read tool error: invalid 'pages' value ${JSON.stringify(pages)}. Accepted forms are a single page ("3") or an inclusive range ("1-5").`;
  }
  const start = Number.parseInt(match[1] as string, 10);
  const end = match[2] !== undefined ? Number.parseInt(match[2], 10) : start;
  if (start < 1 || end < start) {
    return `Read tool error: invalid 'pages' range ${JSON.stringify(pages)} — start must be >= 1 and the range must not go backwards.`;
  }
  if (end > totalPages) {
    return `Read tool error: 'pages' range ${JSON.stringify(pages)} exceeds this document's page count (${totalPages}).`;
  }
  const span = end - start + 1;
  if (span > MAX_PDF_PAGE_SPAN) {
    return `Read tool error: 'pages' range ${JSON.stringify(pages)} spans ${span} pages, exceeding the ${MAX_PDF_PAGE_SPAN}-page maximum per request.`;
  }
  return { start, end };
}

/** Extracts and renders text for the given inclusive page range from an already-loaded
 * `unpdf` document proxy. Each page gets a `--- Page N ---` header; pages with no extractable
 * text (image-only/scanned pages) get an explicit notice instead of silently rendering empty. */
async function renderPdfPages(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  range: PageRange,
): Promise<string> {
  const sections: string[] = [];
  for (let pageNum = range.start; pageNum <= range.end; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str;
      if ("hasEOL" in item && item.hasEOL) text += "\n";
      else text += " ";
    }
    text = text.trim();
    sections.push(
      `--- Page ${pageNum} ---\n${text.length > 0 ? text : `[Page ${pageNum}: no extractable text — likely image-only/scanned]`}`,
    );
  }
  return sections.join("\n\n");
}

/** Round 13: a NUL byte anywhere in the sampled prefix is a reliable binary signal — no valid
 * UTF-8 text file legitimately contains one. Cheap and doesn't require a full decode attempt. */
function looksBinary(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

interface StreamedLines {
  /** Lines within [startIndex, endIndex), in order. */
  lines: string[];
  /** Exact count of lines in the file beyond `endIndex` — computed by counting newlines
   * without retaining their content, so this stays O(1) additional memory regardless of how
   * far past the window the file continues. */
  remaining: number;
}

/** Streams `path`'s text content line-by-line, retaining only lines within
 * `[startIndex, endIndex)`. Every other line is counted, not buffered — memory use is bounded
 * by the window size (`endIndex - startIndex`) plus at most one in-flight line, never by the
 * file's total size. */
async function streamLines(
  path: string,
  startIndex: number,
  endIndex: number,
): Promise<StreamedLines> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const lines: string[] = [];
  let lineIndex = 0;
  let carry = "";

  const reader = Bun.file(path).stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        // Mirrors `text.split("\n")`'s behavior: the final segment after the last newline
        // (possibly empty, if the file ends with a trailing newline) is still a "line".
        if (lineIndex >= startIndex && lineIndex < endIndex) {
          lines.push(carry);
        }
        lineIndex += 1;
        break;
      }
      carry += decoder.decode(value, { stream: true });
      let nlIndex = carry.indexOf("\n");
      while (nlIndex !== -1) {
        const line = carry.slice(0, nlIndex);
        carry = carry.slice(nlIndex + 1);
        if (lineIndex >= startIndex && lineIndex < endIndex) {
          lines.push(line);
        }
        lineIndex += 1;
        nlIndex = carry.indexOf("\n");
      }
    }
  } finally {
    reader.releaseLock();
  }

  const remaining = Math.max(0, lineIndex - endIndex);
  return { lines, remaining };
}

export const readTool: Tool = {
  name: "Read",
  description:
    "Read a file from the local filesystem, returned with cat -n style line numbers. " +
    "Whole-file reads (no 'offset'/'limit') are read in full, but hard-refuse above a ~256KB " +
    "size cap — pass 'offset'/'limit' to page through a larger file in bounded slices instead " +
    "(each windowed read defaults to 2000 lines unless 'limit' says otherwise, with a notice " +
    "stating how many lines remain). Refuses binary files, and files above an absolute size " +
    "ceiling even when windowed, with a clear error instead of returning decoded garbage or " +
    "exhausting memory. PDFs are detected automatically and have real text extracted per page " +
    "(not line-numbered, unlike regular text files); use the 'pages' parameter (e.g. \"3\" or " +
    '"1-5", max 20 pages per request) to select which pages to read — required for PDFs over ' +
    "10 pages, and not applicable to 'offset'/'limit' or to non-PDF files.",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "Absolute or cwd-relative path to read." },
      offset: { type: "number", description: "1-based line number to start reading from." },
      limit: { type: "number", description: "Maximum number of lines to read." },
      pages: {
        type: "string",
        description:
          'Page range for PDF files (e.g. "1-5", "3"). Only applicable to PDFs. Max 20 ' +
          "pages per request; required for PDFs over 10 pages.",
      },
    },
    required: ["file_path"],
    additionalProperties: false,
  },

  async execute(input, ctx: ToolContext): Promise<ToolResult> {
    const filePath = input.file_path;
    if (typeof filePath !== "string" || filePath.length === 0) {
      return { output: "Read tool error: 'file_path' must be a non-empty string.", isError: true };
    }

    const offset = input.offset;
    if (offset !== undefined && (typeof offset !== "number" || offset < 1)) {
      return {
        output: "Read tool error: 'offset' must be a 1-based positive number.",
        isError: true,
      };
    }
    const limit = input.limit;
    if (limit !== undefined && (typeof limit !== "number" || limit < 1)) {
      return { output: "Read tool error: 'limit' must be a positive number.", isError: true };
    }
    const pages = input.pages;
    if (pages !== undefined && typeof pages !== "string") {
      return { output: "Read tool error: 'pages' must be a string.", isError: true };
    }

    const absPath = resolvePath(filePath, ctx.cwd);
    const file = Bun.file(absPath);
    if (!(await file.exists())) {
      return { output: `Read tool error: file does not exist: ${absPath}`, isError: true };
    }

    // DH-0014: absolute ceiling enforced from metadata alone, before any byte is read — applies
    // unconditionally, even to offset/limit windowed reads (see the constant's doc comment).
    if (file.size > MAX_READABLE_BYTES) {
      return {
        output: `Read tool error: file is ${file.size} bytes, exceeding the ${MAX_READABLE_BYTES}-byte readable limit. Use 'offset'/'limit' to read a smaller window, or search it with Bash (e.g. grep) instead of reading it whole.`,
        isError: true,
      };
    }

    // DH-0073: `.ipynb` notebooks are JSON, not line-oriented text — render cells/outputs
    // instead of running them through the byte-cap/binary-sniff/line-window pipeline below.
    // Offset/limit aren't meaningful for cell-level rendering, so they're ignored for
    // notebooks (same as real Claude Code's Read tool). The absolute ceiling check above still
    // applies (already ran), so an oversized .ipynb is refused there.
    if (isNotebookPath(absPath)) {
      const raw = await file.text();
      let notebook: NotebookJson;
      try {
        notebook = JSON.parse(raw) as NotebookJson;
      } catch (err) {
        await recordRead(ctx, absPath);
        return {
          output: `Read tool error: ${absPath} has a .ipynb extension but is not valid JSON: ${(err as Error).message}`,
          isError: true,
        };
      }
      if (!notebook || !Array.isArray(notebook.cells)) {
        await recordRead(ctx, absPath);
        return {
          output: `Read tool error: ${absPath} does not look like a notebook (missing a 'cells' array).`,
          isError: true,
        };
      }
      await recordRead(ctx, absPath);
      return { output: renderNotebook(notebook), isError: false };
    }

    // DH-0081: sniff the same prefix used for binary detection to also check for the `%PDF-`
    // magic bytes, ahead of both the whole-file byte cap and the NUL-byte binary refusal below
    // — a PDF legitimately contains NUL bytes in its binary streams and would otherwise be
    // incorrectly refused as binary, and a PDF's whole-file size has no bearing on how much
    // text a bounded page range actually extracts.
    const sniffSize = Math.min(file.size, BINARY_SNIFF_BYTES);
    const sniffBytes = new Uint8Array(await file.slice(0, sniffSize).arrayBuffer());

    if (looksLikePdf(sniffBytes)) {
      if (offset !== undefined || limit !== undefined) {
        return {
          output:
            "Read tool error: 'offset'/'limit' are not applicable to PDF files — use 'pages' instead.",
          isError: true,
        };
      }

      let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        pdf = await getDocumentProxy(data);
      } catch (err) {
        await recordRead(ctx, absPath);
        return {
          output: `Read tool error: ${absPath} could not be parsed as a PDF: ${(err as Error).message}`,
          isError: true,
        };
      }

      const totalPages = pdf.numPages;
      let range: PageRange;
      if (pages !== undefined) {
        const parsed = parsePageRange(pages, totalPages);
        if (typeof parsed === "string") {
          await recordRead(ctx, absPath);
          return { output: parsed, isError: true };
        }
        range = parsed;
      } else if (totalPages > PDF_PAGES_REQUIRED_ABOVE) {
        await recordRead(ctx, absPath);
        return {
          output: `Read tool error: ${absPath} has ${totalPages} pages, exceeding the ${PDF_PAGES_REQUIRED_ABOVE}-page threshold above which a 'pages' range is required (max ${MAX_PDF_PAGE_SPAN} pages per request).`,
          isError: true,
        };
      } else {
        range = { start: 1, end: totalPages };
      }

      const body = await renderPdfPages(pdf, range);
      await recordRead(ctx, absPath);

      if (range.end < totalPages) {
        const nextStart = range.end + 1;
        const nextEnd = Math.min(totalPages, nextStart + MAX_PDF_PAGE_SPAN - 1);
        return {
          output: `${body}\n\n<system-reminder>PDF has ${totalPages} pages; showing ${range.start}-${range.end}. Pass pages="${nextStart}-${nextEnd}" to continue reading.</system-reminder>`,
          isError: false,
        };
      }
      return { output: body, isError: false };
    }

    if (pages !== undefined) {
      return {
        output: "Read tool error: 'pages' only applies to PDF files.",
        isError: true,
      };
    }

    // DH-0079: a whole-file read (no offset/limit given) additionally hard-errors past a much
    // smaller ~256KB cap, matching real Claude Code's observed behavior — no soft line-count
    // truncation below this. Supplying `offset`/`limit` is treated as an explicit request for a
    // bounded slice, so it bypasses this whole-file check entirely (still subject to the
    // absolute ceiling above); the requested slice itself stays memory-bounded regardless of
    // file size because `streamLines` below never buffers outside `[startIndex, endIndex)`.
    if (offset === undefined && limit === undefined && file.size > PRIMARY_WHOLE_FILE_BYTE_CAP) {
      return {
        output: `Read tool error: File content (${formatBytes(file.size)}) exceeds maximum allowed size (${formatBytes(PRIMARY_WHOLE_FILE_BYTE_CAP)}). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`,
        isError: true,
      };
    }

    if (file.size === 0) {
      // Round 13: record the read regardless of outcome below — the model genuinely did read
      // this path at this point in time, which is what Edit/Write's read-before-write guard
      // (read-guard.ts) needs to know.
      await recordRead(ctx, absPath);
      return {
        output:
          "<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>",
        isError: false,
      };
    }

    if (looksBinary(sniffBytes)) {
      await recordRead(ctx, absPath);
      return {
        output: `Read tool error: binary file, ${file.size} bytes. Refusing to decode as text.`,
        isError: true,
      };
    }

    const startIndex = offset !== undefined ? offset - 1 : 0;
    // DH-0079: a true whole-file read (neither offset nor limit given) has already passed the
    // 256KB whole-file byte cap above, so it's safe to read every line with no further
    // line-count truncation — matching real Claude Code, which doesn't truncate below its byte
    // cap. `DEFAULT_LIMIT` only kicks in once the caller has opted into windowed paging by
    // supplying `offset` and/or `limit` explicitly.
    const windowed = offset !== undefined || limit !== undefined;
    const maxLines =
      limit !== undefined ? limit : windowed ? DEFAULT_LIMIT : Number.POSITIVE_INFINITY;
    const endIndex = startIndex + maxLines;

    const { lines: slice, remaining } = await streamLines(absPath, startIndex, endIndex);
    await recordRead(ctx, absPath);

    const formatted = slice
      .map((line, i) => {
        const lineNo = startIndex + i + 1;
        const truncated =
          line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line;
        return `${String(lineNo).padStart(6, " ")}\t${truncated}`;
      })
      .join("\n");

    if (remaining > 0) {
      return {
        output: `${formatted}\n\n<system-reminder>File truncated: ${remaining} more line${remaining === 1 ? "" : "s"} not shown. Pass a larger 'limit' or a later 'offset' to continue reading.</system-reminder>`,
        isError: false,
      };
    }

    return { output: formatted, isError: false };
  },
};
