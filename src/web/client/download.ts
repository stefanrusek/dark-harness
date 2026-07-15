// Triggers a browser download from a `download_logs` command response. DOM access is
// injected (`DownloadEnv`) so this is unit-testable with happy-dom instead of a real
// browser; production code (main.ts) supplies the real `document`/`URL` globals.

import type { ServerTarget } from "../protocol.ts";
import { requestLogDownload } from "./commands.ts";
import { suggestedLogFilename } from "./format.ts";

export interface DownloadEnv {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  /** Creates a detached anchor and clicks it to start the download. */
  triggerAnchorDownload(url: string, filename: string): void;
}

export function domDownloadEnv(doc: Document): DownloadEnv {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    triggerAnchorDownload: (url, filename) => {
      const anchor = doc.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = "none";
      doc.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
  };
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Downloads either a single agent's JSONL log or the full session bundle (when `agentId`
 * is omitted), then triggers a browser save via a synthetic anchor click.
 */
export async function downloadLogs(
  target: ServerTarget,
  agentId: string | undefined,
  env: DownloadEnv,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const res = await requestLogDownload(target, agentId, fetchImpl);
  const filename =
    filenameFromContentDisposition(res.headers.get("content-disposition")) ??
    suggestedLogFilename(agentId);
  const blob = await res.blob();
  const url = env.createObjectURL(blob);
  try {
    env.triggerAnchorDownload(url, filename);
  } finally {
    env.revokeObjectURL(url);
  }
}
