import { registerDomGlobals } from "../test-dom.ts";
registerDomGlobals();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createInitialState, setModelsAndOpenPicker } from "../state.ts";
import { ModelPicker } from "./ModelPicker.tsx";

afterEach(cleanup);

describe("ModelPicker", () => {
  test("hidden overlay when the picker is closed", () => {
    const { container } = render(
      <ModelPicker state={createInitialState()} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(container.querySelector(".model-picker-overlay")?.classList.contains("hidden")).toBe(
      true,
    );
  });

  test("shows an empty state with no models configured", () => {
    const state = setModelsAndOpenPicker(createInitialState(), []);
    const { container } = render(
      <ModelPicker state={state} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(container.querySelector(".empty-state")?.textContent).toBe("No models configured.");
  });

  test("lists models with tags and selects on click", () => {
    const state = setModelsAndOpenPicker(createInitialState(), [
      {
        name: "sonnet",
        provider: "anthropic",
        model: "claude-sonnet",
        isDefault: true,
        isActive: true,
      },
      {
        name: "haiku",
        provider: "anthropic",
        model: "claude-haiku",
        isDefault: false,
        isActive: false,
      },
    ]);
    const selected: string[] = [];
    const { container } = render(
      <ModelPicker state={state} onSelect={(name) => selected.push(name)} onClose={() => {}} />,
    );
    const rows = container.querySelectorAll(".model-picker-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.classList.contains("active")).toBe(true);
    expect(rows[0]?.querySelector(".model-picker-tags")?.textContent).toBe("[active, default]");
    fireEvent.click(rows[1] as HTMLElement);
    expect(selected).toEqual(["haiku"]);
  });

  test("Enter/Space on a row selects it", () => {
    const state = setModelsAndOpenPicker(createInitialState(), [
      {
        name: "sonnet",
        provider: "anthropic",
        model: "claude-sonnet",
        isDefault: true,
        isActive: true,
      },
    ]);
    const selected: string[] = [];
    const { container } = render(
      <ModelPicker state={state} onSelect={(name) => selected.push(name)} onClose={() => {}} />,
    );
    fireEvent.keyDown(container.querySelector(".model-picker-row") as HTMLElement, {
      key: "Enter",
    });
    expect(selected).toEqual(["sonnet"]);
  });

  test("backdrop click and Cancel button both close", () => {
    const state = setModelsAndOpenPicker(createInitialState(), []);
    let closed = 0;
    const { container } = render(
      <ModelPicker state={state} onSelect={() => {}} onClose={() => closed++} />,
    );
    fireEvent.click(container.querySelector(".model-picker-overlay") as HTMLElement);
    fireEvent.click(container.querySelector(".model-picker-close") as HTMLElement);
    expect(closed).toBe(2);
  });

  test("clicking inside the panel does not close it", () => {
    const state = setModelsAndOpenPicker(createInitialState(), []);
    let closed = 0;
    const { container } = render(
      <ModelPicker state={state} onSelect={() => {}} onClose={() => closed++} />,
    );
    fireEvent.click(container.querySelector(".model-picker-panel") as HTMLElement);
    expect(closed).toBe(0);
  });
});
