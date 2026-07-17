// DH-0136: `/model` picker view, ported from render.ts's `renderPicker`.
import { Box, Text } from "ink";
import type { TuiState } from "../types.ts";
import { wrapText } from "../width.ts";
import { dim } from "./tokens.ts";

export interface PickerViewProps {
  state: TuiState;
  contentRows: number;
  cols: number;
}

export function PickerView({ state, contentRows, cols }: PickerViewProps) {
  if (state.view.kind !== "picker") return null;
  const { options, selectedIndex } = state.view;
  if (options.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>No models configured.</Text>
        <Text>{dim("[Esc] back")}</Text>
      </Box>
    );
  }
  const rows = options.map((model, index) => {
    const marker = index === selectedIndex ? "> " : "  ";
    const tags = [model.isActive ? "active" : null, model.isDefault ? "default" : null]
      .filter((t): t is string => t !== null)
      .join(", ");
    const tagSuffix = tags ? `  [${tags}]` : "";
    return `${marker}${model.name}  (${model.provider}/${model.model})${tagSuffix}`;
  });
  const wrapped = rows.flatMap((row) => wrapText(row, cols));
  const padded = wrapped.slice(0, contentRows);
  while (padded.length < contentRows) padded.push("");
  return (
    <Box flexDirection="column">
      {padded.map((row, index) => {
        const rowKey = index;
        return row === "" ? <Box key={rowKey} height={1} /> : <Text key={rowKey}>{row}</Text>;
      })}
      <Text>{dim("[↑/↓] navigate   [Enter] switch   [Esc] cancel")}</Text>
    </Box>
  );
}
