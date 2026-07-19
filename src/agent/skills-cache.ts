// DH-0173: extracted from AgentRuntime — DH-0093's eager skills scan. Behavior-preserving:
// same "start with builtin only, replace once discoverSkills() resolves" timing as before,
// just packaged as its own small class instead of a bare field + inline .then() in the
// constructor.

import { type Skill, discoverSkills } from "../prompt/skills.ts";
import { BUILTIN_CLI_TOOLS_SKILL, loadSkillFromPaths } from "./skills.ts";

/** DH-0093: one eager `discoverSkills()` scan at construction time (not re-scanned per
 * `list()` call) — same fire-and-forget-eagerly pattern as `McpManager.connectAll()`.
 * Starts with just the builtin `cli-tools` entry so `list()` never has a gap before the
 * on-disk scan resolves; `discoverSkills()`'s own results are prepended by (never shadow) it
 * once ready. */
export class SkillsCache {
  private cache: Skill[] = [BUILTIN_CLI_TOOLS_SKILL];
  /** DH-0165: resolves once the eager `discoverSkills()` scan above has populated `cache`
   * with the real on-disk results — `list()` awaits this before reading the cache. Without
   * it, a `list_skills` command that lands before the scan resolves (a real, CI-reproduced
   * race: TUI/Web fire `list_skills` once at startup, right after the "ready" banner, which
   * can beat an async `readdir`-based scan on a loaded/slow-disk CI runner) sees only the
   * builtin `cli-tools` entry — every on-disk skill (e.g. an operator's own `/greet`) looks
   * "unknown" to the client's local skills cache, which never even attempts the wire
   * round-trip that would otherwise re-check the server (src/tui/state.ts's
   * `handleSlashCommand`). Invisible locally, where the scan resolves in well under a
   * millisecond. */
  readonly ready: Promise<void>;

  constructor(skillPaths: string[] | undefined) {
    // discoverSkills() never throws (per-directory failures are swallowed internally), so
    // this can't produce an unhandled rejection; list() just sees the builtin-only cache
    // until this resolves.
    this.ready = discoverSkills(skillPaths).then((discovered) => {
      this.cache = [BUILTIN_CLI_TOOLS_SKILL, ...discovered];
    });
  }

  list(): Skill[] {
    return this.cache;
  }

  /** Thin re-export so callers that already hold a `SkillsCache` don't need a second import
   * for the by-name lookup `invokeSkill()`/the `Skill` tool both use — this isn't itself
   * cached (skill *content*, unlike the name/description listing, is loaded fresh per call). */
  static loadByName(name: string, skillPaths: string[] | undefined) {
    return loadSkillFromPaths(name, skillPaths ?? []);
  }
}
