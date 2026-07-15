import { describe, expect, test } from "bun:test";
import type { ServerTarget } from "../protocol.ts";
import { type DownloadEnv, domDownloadEnv, downloadLogs } from "./download.ts";
import { createTestDom } from "./test-dom.ts";

const target: ServerTarget = { baseUrl: "http://localhost:4000" };

function fakeEnv(): {
  env: DownloadEnv;
  created: string[];
  revoked: string[];
  clicks: Array<{ url: string; filename: string }>;
} {
  const created: string[] = [];
  const revoked: string[] = [];
  const clicks: Array<{ url: string; filename: string }> = [];
  let counter = 0;
  const env: DownloadEnv = {
    createObjectURL: () => {
      const url = `blob:fake-${counter++}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url) => revoked.push(url),
    triggerAnchorDownload: (url, filename) => clicks.push({ url, filename }),
  };
  return { env, created, revoked, clicks };
}

describe("downloadLogs", () => {
  test("downloads a single agent's log and names the file after its content-disposition header", async () => {
    const { env, created, revoked, clicks } = fakeEnv();
    const fetchImpl = (async () =>
      new Response("jsonl-bytes", {
        status: 200,
        headers: { "Content-Disposition": 'attachment; filename="agent-a1.jsonl"' },
      })) as unknown as typeof fetch;

    await downloadLogs(target, "a1", env, fetchImpl);

    expect(created).toHaveLength(1);
    expect(clicks).toEqual([{ url: created[0] as string, filename: "agent-a1.jsonl" }]);
    expect(revoked).toEqual(created);
  });

  test("falls back to a generated filename when content-disposition is absent", async () => {
    const { env, clicks } = fakeEnv();
    const fetchImpl = (async () =>
      new Response("bytes", { status: 200 })) as unknown as typeof fetch;

    await downloadLogs(target, "a1", env, fetchImpl);
    expect(clicks[0]?.filename).toBe("a1.jsonl");
  });

  test("uses the session-bundle filename when agentId is omitted", async () => {
    const { env, clicks } = fakeEnv();
    const fetchImpl = (async () =>
      new Response("bytes", { status: 200 })) as unknown as typeof fetch;

    await downloadLogs(target, undefined, env, fetchImpl);
    expect(clicks[0]?.filename).toBe("dh-session-logs.tar.gz");
  });

  test("revokes the object URL even if triggerAnchorDownload throws", async () => {
    const { env, created, revoked } = fakeEnv();
    env.triggerAnchorDownload = () => {
      throw new Error("boom");
    };
    const fetchImpl = (async () =>
      new Response("bytes", { status: 200 })) as unknown as typeof fetch;

    await expect(downloadLogs(target, "a1", env, fetchImpl)).rejects.toThrow("boom");
    expect(revoked).toEqual(created);
  });

  test("propagates a CommandError when the download request fails", async () => {
    const { env } = fakeEnv();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: false, error: "not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(downloadLogs(target, "missing", env, fetchImpl)).rejects.toThrow("not found");
  });
});

describe("domDownloadEnv", () => {
  test("creates a hidden anchor, appends it to the body, clicks it, and removes it", () => {
    const { document } = createTestDom();
    const env = domDownloadEnv(document);

    let clicked = false;
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = ((tag: string) => {
      const node = originalCreateElement(tag);
      if (tag === "a") {
        node.addEventListener("click", () => {
          clicked = true;
        });
      }
      return node;
    }) as typeof document.createElement;

    const bodyChildrenBefore = document.body.children.length;
    env.triggerAnchorDownload("blob:xyz", "out.jsonl");

    expect(clicked).toBe(true);
    expect(document.body.children.length).toBe(bodyChildrenBefore);
  });

  test("createObjectURL/revokeObjectURL delegate to the real URL API", () => {
    const { document } = createTestDom();
    const env = domDownloadEnv(document);

    const url = env.createObjectURL(new Blob(["hello"]));
    expect(url).toMatch(/^blob:/);
    expect(() => env.revokeObjectURL(url)).not.toThrow();
  });
});
