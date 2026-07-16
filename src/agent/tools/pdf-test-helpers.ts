// DH-0081: a minimal, dependency-free PDF builder used only by tests — produces a valid,
// uncompressed multi-page PDF (with a real cross-reference table) so read.ts's PDF-detection
// and text-extraction paths can be exercised against real `unpdf`/pdf.js parsing rather than
// mocks. Pages can carry plain text (rendered via a `BT ... ET` content stream) or be left
// text-free to simulate an image-only/scanned page (no text operators at all).

interface PdfPageSpec {
  /** Text to render on the page, or `undefined` for an image-only (no text) page. */
  text?: string;
}

/** Builds a minimal, valid PDF document (uncompressed content streams, real xref table) with
 * one page per entry in `pages`. Good enough for pdf.js to parse and extract text/page-count
 * from — not a general-purpose PDF writer. */
export function buildTestPdf(pages: PdfPageSpec[]): Uint8Array {
  const objects: string[] = [];
  // 1: Catalog, 2: Pages
  const pageObjNums = pages.map((_, i) => 3 + i * 2);
  const contentObjNums = pages.map((_, i) => 4 + i * 2);
  const fontObjNum = 3 + pages.length * 2;

  objects[1] = "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n";
  objects[2] =
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(" ")}] ` +
    `/Count ${pages.length} >>\nendobj\n`;

  pages.forEach((page, i) => {
    const pageObjNum = pageObjNums[i] as number;
    const contentObjNum = contentObjNums[i] as number;
    objects[pageObjNum] =
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources ` +
      `<< /Font << /F1 ${fontObjNum} 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R >>\nendobj\n`;

    const escaped = (page.text ?? "").replace(/([()\\])/g, "\\$1");
    const stream = page.text !== undefined ? `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET` : ""; // image-only page: no text operators at all
    objects[contentObjNum] =
      `${contentObjNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  });

  objects[fontObjNum] =
    `${fontObjNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;

  const totalObjects = fontObjNum;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = new Array(totalObjects + 1).fill(0);
  for (let n = 1; n <= totalObjects; n++) {
    offsets[n] = pdf.length;
    pdf += objects[n];
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${totalObjects + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let n = 1; n <= totalObjects; n++) {
    pdf += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf);
}

/** A deliberately invalid "PDF" — has the right magic bytes but no parseable structure at all,
 * to exercise the corrupt-PDF error path. */
export function buildCorruptPdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\nthis is not a real pdf structure at all\n%%EOF");
}
