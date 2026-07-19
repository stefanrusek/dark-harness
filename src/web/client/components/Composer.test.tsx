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
import { applyEvent, createInitialState, type WebState } from "../state.ts";
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

  // DH-0143: autocomplete dropdown.
  test("shows the dropdown while typing a slash command, filtered live", () => {
    const { container } = render(<Composer state={stateWithRootAndChild()} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/mo";
    fireEvent.input(textarea);
    const items = container.querySelectorAll(".composer-autocomplete li");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("/model");
    expect(items[0]?.textContent).toContain("switch the active model");
  });

  test("bare slash shows every built-in command", () => {
    const { container } = render(<Composer state={stateWithRootAndChild()} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/";
    fireEvent.input(textarea);
    expect(container.querySelectorAll(".composer-autocomplete li")).toHaveLength(3);
  });

  test("plain chat text never shows a dropdown", () => {
    const { container } = render(<Composer state={stateWithRootAndChild()} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "hello";
    fireEvent.input(textarea);
    expect(container.querySelector(".composer-autocomplete")).toBeNull();
  });

  test("a query matching nothing renders no dropdown", () => {
    const { container } = render(<Composer state={stateWithRootAndChild()} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/zzz";
    fireEvent.input(textarea);
    expect(container.querySelector(".composer-autocomplete")).toBeNull();
  });

  test("ArrowDown/ArrowUp move the highlighted entry", () => {
    const { container } = render(<Composer state={stateWithRootAndChild()} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/";
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    let active = container.querySelector(".composer-autocomplete-active");
    expect(active?.textContent).toContain("/help");
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    active = container.querySelector(".composer-autocomplete-active");
    expect(active?.textContent).toContain("/model");
  });

  test("Enter selects the highlighted entry, inserts it, and does not submit a message", () => {
    const sent: string[] = [];
    const { container } = render(
      <Composer state={stateWithRootAndChild()} onSend={(msg) => sent.push(msg)} />,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/mo";
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(textarea.value).toBe("/model ");
    expect(sent).toEqual([]);
    expect(container.querySelector(".composer-autocomplete")).toBeNull();
  });

  test("Tab selects the highlighted entry same as Enter", () => {
    const { container } = render(<Composer state={stateWithRootAndChild()} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/cl";
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "Tab" });
    expect(textarea.value).toBe("/clear ");
  });

  test("clicking an entry selects it", () => {
    const { container } = render(<Composer state={stateWithRootAndChild()} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/";
    fireEvent.input(textarea);
    const helpItem = [...container.querySelectorAll(".composer-autocomplete li")].find((li) =>
      li.textContent?.includes("/help"),
    ) as HTMLLIElement;
    fireEvent.mouseDown(helpItem);
    expect(textarea.value).toBe("/help ");
  });

  test("Escape dismisses the dropdown without clearing the typed text", () => {
    const { container } = render(<Composer state={stateWithRootAndChild()} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/mo";
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(container.querySelector(".composer-autocomplete")).toBeNull();
    expect(textarea.value).toBe("/mo");
  });

  test("clicking outside the composer closes the dropdown", () => {
    const { container } = render(<Composer state={stateWithRootAndChild()} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/mo";
    fireEvent.input(textarea);
    expect(container.querySelector(".composer-autocomplete")).not.toBeNull();
    fireEvent.mouseDown(document.body);
    expect(container.querySelector(".composer-autocomplete")).toBeNull();
  });

  test("a new keystroke after Escape re-opens the dropdown", () => {
    const { container } = render(<Composer state={stateWithRootAndChild()} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/mo";
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(container.querySelector(".composer-autocomplete")).toBeNull();
    textarea.value = "/mod";
    fireEvent.input(textarea);
    expect(container.querySelector(".composer-autocomplete")).not.toBeNull();
  });

  test("merges cached skills into the dropdown alongside built-ins", () => {
    const state = {
      ...stateWithRootAndChild(),
      skills: [{ name: "deploy", description: "deploy the app" }],
    };
    const { container } = render(<Composer state={state} onSend={() => {}} />);
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/dep";
    fireEvent.input(textarea);
    const items = container.querySelectorAll(".composer-autocomplete li");
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain("/deploy");
  });

  test("Enter on an already-fully-typed command name submits rather than re-selecting", () => {
    const sent: string[] = [];
    const { container } = render(
      <Composer state={stateWithRootAndChild()} onSend={(msg) => sent.push(msg)} />,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "/model";
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(sent).toEqual(["/model"]);
    expect(textarea.value).toBe("");
  });

  test("Enter still submits ordinary chat text when no dropdown is showing", () => {
    const sent: string[] = [];
    const { container } = render(
      <Composer state={stateWithRootAndChild()} onSend={(msg) => sent.push(msg)} />,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "hello there";
    fireEvent.input(textarea);
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(sent).toEqual(["hello there"]);
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
