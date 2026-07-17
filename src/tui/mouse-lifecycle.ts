// DH-0126: mouse-mode lifecycle — the thin stdout wiring around mouse.ts's pure
// MOUSE_ENABLE/MOUSE_DISABLE strings, ported from privateer's `mouse-lifecycle.ts`.
//
// THE critical invariant: mouse reporting modes must be hard-disabled whenever the TUI exits
// (normal quit, session-ended auto-quit) so escape sequences never leak into the user's shell
// afterward. `tearDown()` is idempotent so app.ts's normal cleanup path can call it
// unconditionally without worrying about double-writing the disable sequence.
import { MOUSE_DISABLE, MOUSE_ENABLE } from "./mouse.ts";

/** Test seam: where mode strings are written (app.ts passes the real stdout's `write`). */
export type MouseWriter = (s: string) => void;

/**
 * Owns the mouse-mode lifecycle for one TUI session. `enable()` turns reporting on;
 * `tearDown()` turns every mode off and is idempotent — a second call after teardown is a
 * no-op until `enable()` runs again.
 */
export class MouseLifecycle {
  private enabled = false;
  private tornDown = false;

  constructor(private readonly write: MouseWriter) {}

  /** Turn on click + button-motion + SGR reporting (any-motion stays off). */
  enable(): void {
    this.tornDown = false;
    if (this.enabled) return;
    this.enabled = true;
    this.write(MOUSE_ENABLE);
  }

  /** Hard-disable every mouse mode. Idempotent. */
  tearDown(): void {
    if (this.tornDown) return;
    this.tornDown = true;
    this.enabled = false;
    this.write(MOUSE_DISABLE);
  }
}
