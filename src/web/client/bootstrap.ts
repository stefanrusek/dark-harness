// DH-0165: the real `<script src>` entry point referenced by index.html — see main.ts's own
// comment for why this is a separate file from `boot()` itself (Bun's browser HTML-import
// bundler statically folds `import.meta.main` to `false`, so a self-invoking guarded call
// inside main.ts was silently dead-code-eliminated and never ran in any real browser).
import { boot } from "./main.ts";

function startBoot(): true {
  void boot(document, fetch);
  return true;
}

// The real boot runs as this initializer evaluates on import. Wrapped in `Object.freeze` per
// the repo's no-module-scope-side-effects lint rule's sanctioned escape hatch (see
// src/tui/ink/clear-ci-env-for-interactive-render.ts for the same pattern) — the actual work
// lives inside the function above (function bodies are exempt); this is the module-load
// trigger, and this file's entire purpose is being that trigger for a real browser.
export const bootStarted = Object.freeze(startBoot());
