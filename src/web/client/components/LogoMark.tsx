// DH-0219/DH-0198: the actual brand mark (uppercase "D H" monogram, docs/media/logo.svg),
// inlined as JSX rather than fetched via <img src>. Inlining avoids adding any new static-
// asset-serving surface to src/web/server.ts (the web client today ships only index.html +
// styles.css + the bundled script, per the existing favicon's own inline-data-URI precedent
// in index.html) and lets the mark inherit currentColor-independent gradient styling. This
// closes DH-0198 (the web header never actually rendered the brand mark, only the bare "◆ "
// CSS pseudo-element) — this component is that render, mounted in the sidebar `.brand` row.
//
// Geometry mirrors docs/media/logo.svg exactly (D stem x=46, bowl
// `M46 64 H82 A44 64 0 0 1 82 192 H46`; H stems x=146/x=210, crossbar y=128) — keep the two
// in sync if the mark's geometry ever changes.
import type { ReactElement } from "react";

export interface LogoMarkProps {
  className?: string;
}

export function LogoMark({ className }: LogoMarkProps): ReactElement {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      role="img"
      aria-label="DH — Dark Harness"
    >
      <defs>
        {/* userSpaceOnUse, not the objectBoundingBox default: a purely vertical stroke (the
            D's stem, both H stems) has a zero-width geometric bounding box, which makes
            objectBoundingBox gradients degenerate and silently fail to paint. */}
        <linearGradient
          id="dhLogoGradient"
          gradientUnits="userSpaceOnUse"
          x1="39"
          y1="57"
          x2="217"
          y2="199"
        >
          <stop offset="0%" stopColor="#9ECE6A" />
          <stop offset="100%" stopColor="#7DCFFF" />
        </linearGradient>
      </defs>
      <g
        fill="none"
        stroke="url(#dhLogoGradient)"
        strokeWidth={14}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M46 64 L46 192" />
        <path d="M46 64 H82 A44 64 0 0 1 82 192 H46" />
        <path d="M146 64 L146 192" />
        <path d="M210 64 L210 192" />
        <path d="M146 128 L210 128" />
      </g>
    </svg>
  );
}
