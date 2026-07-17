// React migration of render.ts's showError/hideError (DH-0135).
import type { ReactElement } from "react";

export interface ErrorBannerProps {
  message: string | null;
}

export function ErrorBanner({ message }: ErrorBannerProps): ReactElement {
  return (
    <div className={`error-banner${message ? "" : " hidden"}`} role="alert">
      {message ?? ""}
    </div>
  );
}
