// DH-0135 story 1: the composer, migrated first as its own component, must structurally
// close the DH-0117 focus/text-loss bug (an unrelated state update tearing down the live
// `<textarea>`, destroying focus and unsent text). React Testing Library + happy-dom, per
// DH-0134's verified approach — globals registered before importing RTL so its internals
// (which read ambient `window`/`document`) resolve against a happy-dom realm. Registration
// itself (once, for the whole `bun test` process, never toggled) is `test-dom.ts`'s side
// effect — see its module-level comment for why per-test toggling isn't safe here.
import "../test-dom.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { type WebState, applyEvent, createInitialState } from "../state.ts";
import { Composer } from "./Composer.tsx";

afterEach(cleanup);

function stateWithRootAndChild(): WebState {
  let state = createInitialState();
  state = applyEvent(state, {
    version: 1,
    id: "e1",
    timestamp: "2026-01-01T00:00:00Z",
    type: "agent_spawned",
    agentId: "root-1",
    parentAgentId: null,
    model: "sonnet",
  });
  state = applyEvent(state, {
    version: 1,
    id: "e2",
    timestamp: "2026-01-01T00:00:01Z",
    type: "agent_spawned",
    agentId: "child-1",
    parentAgentId: "root-1",
    model: "haiku",
  });
  return state;
}

describe("Composer", () => {
  test("renders nothing when no agent is selected", () => {
    const { container } = render(<Composer state={createInitialState()} onSend={() => {}} />);
    expect(container.querySelector("form")).toBeNull();
  });

  test("renders nothing when a non-root agent is selected", () => {
    const state = { ...stateWithRootAndChild(), selectedAgentId: "child-1" };
    const { container } = render(<Composer state={state} onSend={() => {}} />);
    expect(container.querySelector("form")).toBeNull();
  });

  test("renders the composer for the root agent and submits trimmed, non-empty text", () => {
    const sent: string[] = [];
    const { container } = render(
      <Composer state={stateWithRootAndChild()} onSend={(msg) => sent.push(msg)} />,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(form).not.toBeNull();

    textarea.value = "  hello there  ";
    fireEvent.submit(form);
    expect(sent).toEqual(["hello there"]);
    expect(textarea.value).toBe("");
  });

  test("does not submit an empty/whitespace-only message", () => {
    const sent: string[] = [];
    const { container } = render(
      <Composer state={stateWithRootAndChild()} onSend={(msg) => sent.push(msg)} />,
    );
    const form = container.querySelector("form") as HTMLFormElement;
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "   ";
    fireEvent.submit(form);
    expect(sent).toEqual([]);
  });

  test("Enter without Shift submits; Shift+Enter does not", () => {
    const sent: string[] = [];
    const { container } = render(
      <Composer state={stateWithRootAndChild()} onSend={(msg) => sent.push(msg)} />,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.focus();

    textarea.value = "shift held";
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(sent).toEqual([]);

    textarea.value = "plain enter";
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    expect(sent).toEqual(["plain enter"]);
  });

  test("DH-0117 regression: focus and unsent text survive an unrelated state update re-render", () => {
    const state = stateWithRootAndChild();
    const { container, rerender } = render(<Composer state={state} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "not yet sent";
    textarea.focus();

    // Simulates renderAll() firing repeatedly (SSE events, the 1s liveness tick) while the
    // user is mid-type — an unrelated field (session totals) changing must not tear down
    // and recreate the composer.
    const rootAgent = state.agents.get("root-1");
    if (!rootAgent) throw new Error("expected root-1 to exist");
    const unrelatedUpdate: WebState = {
      ...state,
      agents: new Map(state.agents).set("root-1", { ...rootAgent, inputTokens: 42 }),
    };
    rerender(<Composer state={unrelatedUpdate} onSend={() => {}} />);
    rerender(<Composer state={unrelatedUpdate} onSend={() => {}} />);

    const textareaAfter = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textareaAfter === textarea).toBe(true);
    expect(textareaAfter.value).toBe("not yet sent");
    expect((document.activeElement as unknown) === (textarea as unknown)).toBe(true);
  });

  test("rebuilds the composer on an actual show/hide transition (root -> non-root -> root)", () => {
    const state = stateWithRootAndChild();
    const { container, rerender } = render(<Composer state={state} onSend={() => {}} />);
    const firstTextarea = container.querySelector("textarea");
    expect(firstTextarea).not.toBeNull();

    rerender(<Composer state={{ ...state, selectedAgentId: "child-1" }} onSend={() => {}} />);
    expect(container.querySelector("form")).toBeNull();

    rerender(<Composer state={{ ...state, selectedAgentId: "root-1" }} onSend={() => {}} />);
    const secondTextarea = container.querySelector("textarea");
    expect(secondTextarea).not.toBeNull();
    expect(secondTextarea).not.toBe(firstTextarea);
  });
});
