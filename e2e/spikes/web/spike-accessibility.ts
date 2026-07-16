// DH-0061 spike 3 (DH-0029): accessibility — keyboard reachability of the agent list with a
// visible focus state, ARIA roles/live regions (verified via the accessibility tree, not just
// visually), and a "stopped" status color distinct from "failed".
//
// Run from the repo root:   bun e2e/spikes/web/spike-accessibility.ts

import { artifactPath, createReport, launchWebUi, sendMessage } from "./support.ts";

const report = createReport("spike-accessibility");
const session = await launchWebUi([{ text: "accessibility check turn", stopReason: "end_turn" }]);
const { page } = session;

try {
  // Populate the UI: one sent message so the root agent row and transcript exist.
  await sendMessage(page, "wake up for the accessibility sweep");
  await page.waitForFunction(
    "document.querySelectorAll('.agent-transcript .turn-assistant').length >= 1",
    undefined,
    { timeout: 15_000 },
  );

  // ARIA structure of the agent list (DH-0029 #38): listbox with labeled, selectable options.
  const tree = page.locator(".agent-tree");
  report.check(
    "agent list is an ARIA listbox labeled 'Agents'",
    (await tree.getAttribute("role")) === "listbox" &&
      (await tree.getAttribute("aria-label")) === "Agents",
    `role = ${await tree.getAttribute("role")}, aria-label = ${await tree.getAttribute("aria-label")}`,
  );
  const row = page.locator(".agent-row").first();
  report.check(
    "agent rows are keyboard-focusable ARIA options",
    (await row.getAttribute("role")) === "option" &&
      (await row.getAttribute("tabindex")) === "0" &&
      (await row.getAttribute("aria-selected")) !== null,
    `role = ${await row.getAttribute("role")}, tabindex = ${await row.getAttribute("tabindex")}, aria-selected = ${await row.getAttribute("aria-selected")}`,
  );
  const rowLabel = await row.getAttribute("aria-label");
  report.check(
    "agent row announces its status in its accessible name (not color alone)",
    /status: /.test(rowLabel ?? ""),
    `aria-label = ${rowLabel}`,
  );

  // Live regions (DH-0029 #39): connection pill and transcript announce changes.
  const pill = page.locator(".connection-pill");
  report.check(
    "connection pill is a polite live status region",
    (await pill.getAttribute("role")) === "status" &&
      (await pill.getAttribute("aria-live")) === "polite",
    `role = ${await pill.getAttribute("role")}, aria-live = ${await pill.getAttribute("aria-live")}`,
  );
  const transcript = page.locator(".agent-transcript");
  report.check(
    "transcript is a polite live log region",
    (await transcript.getAttribute("role")) === "log" &&
      (await transcript.getAttribute("aria-live")) === "polite",
    `role = ${await transcript.getAttribute("role")}, aria-live = ${await transcript.getAttribute("aria-live")}`,
  );

  // Accessibility-tree snapshot (not just DOM attributes): the listbox and its option must
  // appear in the computed tree — this is what a screen reader actually receives.
  const ariaSnapshot = await page.locator(".sidebar").ariaSnapshot();
  report.check(
    "computed accessibility tree exposes the Agents listbox with an option",
    ariaSnapshot.includes('listbox "Agents"') && ariaSnapshot.includes("option"),
    `sidebar aria snapshot:\n${ariaSnapshot}`,
  );

  // Keyboard reachability: Tab from the page body must reach an agent row, and the focused
  // row must show a visible focus indicator (outline or box-shadow, per :focus-visible CSS).
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  let reached = false;
  for (let i = 0; i < 15 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = Boolean(
      await page.evaluate("document.activeElement?.classList?.contains('agent-row') ?? false"),
    );
  }
  report.check("agent row is reachable by Tab alone", reached, "reached within 15 tabs");
  if (reached) {
    const focusStyle = String(
      await page.evaluate(
        "(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle + '|' + s.boxShadow; })()",
      ),
    );
    const [outline, shadow] = focusStyle.split("|");
    report.check(
      "focused agent row has a visible focus indicator",
      outline !== "none" || (shadow !== undefined && shadow !== "none"),
      `outline-style = ${outline}, box-shadow = ${shadow}`,
    );
    // Keyboard activation: Enter selects the focused row. Selection triggers a sidebar
    // re-render that REPLACES the row's DOM node (so the row must be re-queried, not read
    // via the now-stale document.activeElement — the first draft of this spike did that and
    // found keyboard focus is genuinely lost on re-render; noted in DH-0061 as a DH-0029
    // follow-up observation, but selection state itself is what this check asserts).
    await page.keyboard.press("Enter");
    const selected = await page.locator(".agent-row").first().getAttribute("aria-selected");
    report.check(
      "row is selected after Enter on the focused row",
      selected === "true",
      `re-queried aria-selected = ${selected}`,
    );
  }

  // Distinct status colors (DH-0029 #37): 'stopped' must not reuse 'failed' (or 'done').
  // Rendered synthetically against the real stylesheet — driving a real agent into both
  // terminal states in one run is the full suite's job; the color contract is checkable now.
  const colors = String(
    await page.evaluate(
      "(() => { const mk = (cls) => { const s = document.createElement('span'); s.className = 'status-dot ' + cls; document.body.appendChild(s); const c = getComputedStyle(s).backgroundColor; s.remove(); return c; }; return [mk('status-stopped'), mk('status-failed'), mk('status-done')].join('|'); })()",
    ),
  );
  const [stoppedColor, failedColor, doneColor] = colors.split("|");
  report.check(
    "'stopped' status color is distinct from 'failed' and 'done'",
    stoppedColor !== failedColor && stoppedColor !== doneColor,
    `stopped = ${stoppedColor}, failed = ${failedColor}, done = ${doneColor}`,
  );

  // Persistent error history (DH-0029 #34): the reviewable error log panel exists in the DOM
  // (hidden while empty — errors persist there instead of vanishing with the banner).
  const panelPresent = (await page.locator(".error-log-panel").count()) === 1;
  report.check(
    "persistent error-log panel exists in the DOM",
    panelPresent,
    `.error-log-panel count = ${await page.locator(".error-log-panel").count()}`,
  );

  const screenshot = artifactPath("spike-accessibility.png");
  await page.screenshot({ path: screenshot, fullPage: true });
  await session.stop();
  report.finish({ screenshot });
} catch (err) {
  const screenshot = artifactPath("spike-accessibility-error.png");
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
  await session.stop();
  report.check("script completed without an unexpected error", false, String(err));
  report.finish({ screenshot });
}
