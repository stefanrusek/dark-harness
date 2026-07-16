// DH-0061 spike 2 (DH-0056): assistant Markdown renders as real sanitized DOM — headings,
// bold, inline code, fenced blocks, lists, safe links — never raw Markdown syntax characters,
// never live HTML from model output, and hostile link schemes are rejected.
//
// Run from the repo root:   bun e2e/spikes/web/spike-markdown.ts

import { artifactPath, createReport, launchWebUi, sendMessage } from "./support.ts";

// One turn exercising the DH-0056 element mapping plus two hostile payloads: raw HTML that
// must stay inert, and a javascript: link that must render as plain text, not an anchor.
const MARKDOWN_REPLY = [
  "## Deploy summary",
  "",
  "The build is **ready** and `dh --web` passed.",
  "",
  "- first item",
  "- second item",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "See [the docs](https://example.com/docs) and [do not click](javascript:alert(1)).",
  "",
  '<script>alert("xss")</script> raw HTML must stay inert.',
].join("\n");

const report = createReport("spike-markdown");
const session = await launchWebUi([{ text: MARKDOWN_REPLY, stopReason: "end_turn" }]);
const { page } = session;

try {
  await sendMessage(page, "render this markdown");
  await page.waitForFunction(
    "document.querySelectorAll('.agent-transcript .turn-assistant').length >= 1",
    undefined,
    { timeout: 15_000 },
  );

  const turn = page.locator(".agent-transcript .turn-assistant .turn-text");

  // Positive structure: each Markdown construct became its real element.
  const h2 = await turn.locator("h2").textContent();
  report.check("heading renders as <h2>", h2 === "Deploy summary", `h2 = ${h2}`);
  const strong = await turn.locator("strong").textContent();
  report.check("bold renders as <strong>", strong === "ready", `strong = ${strong}`);
  const inlineCode = await turn.locator("p code").first().textContent();
  report.check("inline code renders as <code>", inlineCode === "dh --web", `code = ${inlineCode}`);
  const fenced = await turn.locator("pre code").textContent();
  report.check(
    "fenced block renders as <pre><code> with the language class",
    fenced === "const x = 1;" &&
      (await turn.locator("pre code").getAttribute("class")) === "language-ts",
    `pre code = ${JSON.stringify(fenced)}, class = ${await turn.locator("pre code").getAttribute("class")}`,
  );
  const listItems = await turn.locator("ul li").allTextContents();
  report.check(
    "list renders as <ul><li>",
    listItems.length === 2 && listItems[0] === "first item",
    `items = ${JSON.stringify(listItems)}`,
  );

  // Safe link: real anchor, hardened attributes.
  const anchor = turn.locator("a");
  const anchorCount = await anchor.count();
  const href = anchorCount > 0 ? await anchor.first().getAttribute("href") : null;
  const rel = anchorCount > 0 ? await anchor.first().getAttribute("rel") : null;
  const target = anchorCount > 0 ? await anchor.first().getAttribute("target") : null;
  report.check(
    "https link renders as a hardened anchor",
    anchorCount === 1 &&
      href === "https://example.com/docs" &&
      rel === "noopener noreferrer" &&
      target === "_blank",
    `anchors = ${anchorCount}, href = ${href}, rel = ${rel}, target = ${target}`,
  );

  // Hostile link scheme: rejected — its text survives as plain text, but as no anchor
  // (anchorCount === 1 above already proves the javascript: link produced no second <a>).
  const turnText = (await turn.textContent()) ?? "";
  report.check(
    "javascript: link is rendered as plain text, not an anchor",
    turnText.includes("do not click"),
    `link text present = ${turnText.includes("do not click")}, total anchors = ${anchorCount}`,
  );

  // Raw HTML from the model: inert text, never a live element.
  const scriptCount = await turn.locator("script").count();
  report.check(
    "model-authored <script> is never a live element",
    scriptCount === 0,
    `script elements inside the turn = ${scriptCount}`,
  );
  report.check(
    "model-authored <script> survives as visible inert text",
    turnText.includes('<script>alert("xss")</script>'),
    "the tag text is displayed, proving it was text-node-escaped rather than dropped silently",
  );

  // Negative: no raw Markdown syntax characters leak into the rendered text.
  report.check(
    "no raw '##' heading markers in rendered text",
    !turnText.includes("##"),
    `rendered text contains '##' = ${turnText.includes("##")}`,
  );
  report.check(
    "no raw '**' bold markers in rendered text",
    !turnText.includes("**"),
    `rendered text contains '**' = ${turnText.includes("**")}`,
  );

  const screenshot = artifactPath("spike-markdown.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await session.stop();
  report.finish({ screenshot });
} catch (err) {
  const screenshot = artifactPath("spike-markdown-error.png");
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  await session.stop();
  report.check("script completed without an unexpected error", false, String(err));
  report.finish({ screenshot });
}
