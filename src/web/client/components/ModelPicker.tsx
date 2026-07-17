// React migration of render.ts's renderModelPicker (DH-0093/DH-0135).
import type { ReactElement } from "react";
import type { WebState } from "../state.ts";

export interface ModelPickerProps {
  state: WebState;
  onSelect: (name: string) => void;
  onClose: () => void;
}

export function ModelPicker({ state, onSelect, onClose }: ModelPickerProps): ReactElement {
  if (!state.modelPickerOpen) {
    return (
      <div
        className="model-picker-overlay hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Select model"
      />
    );
  }

  return (
    <div
      className="model-picker-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Select model"
      onClick={(evt) => {
        if (evt.target === evt.currentTarget) onClose();
      }}
      onKeyDown={(evt) => {
        if (evt.target === evt.currentTarget && evt.key === "Escape") onClose();
      }}
    >
      <div className="model-picker-panel">
        <div className="model-picker-heading">Select model</div>
        {state.models.length === 0 ? (
          <div className="empty-state">No models configured.</div>
        ) : (
          <div className="model-picker-list" role="listbox" tabIndex={-1}>
            {state.models.map((model) => {
              const select = () => onSelect(model.name);
              const tags = [
                model.isActive ? "active" : null,
                model.isDefault ? "default" : null,
              ].filter((t): t is string => t !== null);
              return (
                <div
                  key={model.name}
                  className={`model-picker-row${model.isActive ? " active" : ""}`}
                  role="option"
                  aria-selected={model.isActive}
                  tabIndex={0}
                  onClick={(evt) => {
                    evt.stopPropagation();
                    select();
                  }}
                  onKeyDown={(evt) => {
                    if (evt.key === "Enter" || evt.key === " ") {
                      evt.preventDefault();
                      select();
                    }
                  }}
                >
                  <span className="model-picker-name">{model.name}</span>
                  <span className="model-picker-detail">{`(${model.provider}/${model.model})`}</span>
                  {tags.length > 0 ? (
                    <span className="model-picker-tags">{`[${tags.join(", ")}]`}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          className="btn btn-secondary model-picker-close"
          onClick={(evt) => {
            evt.stopPropagation();
            onClose();
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
