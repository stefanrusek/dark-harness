// React migration of render.ts's showGapBanner/hideGapBanner (DH-0024/DH-0135).
import type { ReactElement } from "react";

export interface GapBannerProps {
  visible: boolean;
  onDismiss: () => void;
}

export function GapBanner({ visible, onDismiss }: GapBannerProps): ReactElement {
  return (
    <output className={`gap-banner${visible ? "" : " hidden"}`} aria-live="polite">
      {visible ? (
        <>
          <span>Reconnected — history may be incomplete.</span>
          <button type="button" className="gap-banner-dismiss" onClick={onDismiss}>
            Dismiss
          </button>
        </>
      ) : null}
    </output>
  );
}
