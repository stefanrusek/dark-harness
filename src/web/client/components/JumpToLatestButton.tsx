// React migration of render.ts's jump-to-latest button (DH-0135).
import type { ReactElement } from "react";

export interface JumpToLatestButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function JumpToLatestButton({ visible, onClick }: JumpToLatestButtonProps): ReactElement {
  return (
    <button type="button" className={`jump-to-latest${visible ? "" : " hidden"}`} onClick={onClick}>
      ↓ Jump to latest
    </button>
  );
}
