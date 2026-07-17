// DH-0040: the Bash tool inherits the harness process's full environment (including any
// provider API key or DH_TOKEN referenced via $(VAR) in dh.json). That's intentional (parity
// with real Claude Code's Bash tool), but the specific exfiltration risk it creates in a
// non-air-gapped deployment was previously undocumented. This test guards against that
// documentation regressing silently: it asserts both the README's security section and
// ADR 0004 explicitly name process.env / credential exfiltration via Bash as a risk.
import { describe, expect, test } from "bun:test";

const README_SOURCE = await Bun.file(new URL("../../README.md", import.meta.url)).text();
const ADR_SOURCE = await Bun.file(
  new URL("../../docs/adr/0004-security-posture.md", import.meta.url),
).text();

describe("security posture docs state the Bash env-exfiltration risk plainly", () => {
  test("README security section mentions process.env exfiltration via Bash", () => {
    expect(README_SOURCE).toContain("process.env");
    expect(README_SOURCE).toContain("exfiltrate");
  });

  test("ADR 0004 mentions process.env exfiltration via Bash", () => {
    expect(ADR_SOURCE).toContain("process.env");
    expect(ADR_SOURCE).toContain("exfiltrate");
  });
});
