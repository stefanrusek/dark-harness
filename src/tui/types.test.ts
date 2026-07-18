import { describe, expect, test } from "bun:test";
import type { ConnectionStatus } from "./types.ts";
import { CONNECTION_STATUSES } from "./types.ts";

// DH-0149: this module is otherwise pure type-only declarations (interfaces/type aliases —
// `Turn`, `AgentInfo`, `TuiState`, `Action`, `Effect`, `ReducerResult`, `ViewState`), and
// every existing consumer (state.ts, sse-client.ts, app.ts, and their tests) only ever does
// `import type {...} from "./types.ts"`. Bun's coverage instrumentation never registers a
// file loaded solely via `import type` — those imports are erased before the module is
// evaluated — and worse, even a value-level namespace import of an all-types module produces
// a zero-line (`LF:0`) lcov record that `scripts/test-isolated.ts`'s `lcov -a --ignore-errors
// empty` merge step silently drops (verified against src/contracts/commands.ts, which has the
// same fate despite src/contracts/index.test.ts's namespace import — see that test's own
// comment). So a smoke import alone is not sufficient here; the file needs at least one real,
// executed line. `CONNECTION_STATUSES` is a small genuinely-useful addition (a canonical,
// iterable list of `ConnectionStatus`'s literals) that gives this module real runtime
// behavior to test.
describe("CONNECTION_STATUSES", () => {
  test("lists every ConnectionStatus literal, in canonical order", () => {
    expect(CONNECTION_STATUSES).toEqual(["connecting", "live", "reconnecting", "disconnected"]);
  });

  test("stays in sync with the ConnectionStatus type (exhaustiveness check)", () => {
    // If a literal is ever added to/removed from `ConnectionStatus` without updating
    // `CONNECTION_STATUSES`, this line fails to typecheck (an extra/missing case in the
    // switch), catching drift at `bun run typecheck` time rather than at runtime.
    for (const status of CONNECTION_STATUSES) {
      const covered: ConnectionStatus = status;
      switch (covered) {
        case "connecting":
        case "live":
        case "reconnecting":
        case "disconnected":
          break;
        default: {
          const exhaustive: never = covered;
          throw new Error(`unhandled ConnectionStatus: ${exhaustive}`);
        }
      }
    }
    expect(CONNECTION_STATUSES.length).toBe(4);
  });
});
