import type { ReactNode } from "react";

// one light of the rail, drawn on ink with the shape the Studio and the hub use for it. the word beside it is the
// meaning, so the drawing is decoration for a screen reader
const SHAPES: Record<string, ReactNode> = {
  "next-right": <circle className="right" cx="16" cy="16" r="10" />,
  "next-left": <rect className="left" x="6" y="6" width="20" height="20" />,
  "soon-right": <circle className="right-soon" cx="16" cy="16" r="6" />,
  "soon-left": <rect className="left-soon" x="10" y="10" width="12" height="12" />,
  wrong: <path className="wrong" d="M9 9 L23 23 M23 9 L9 23" />,
  played: <rect className="right" x="9" y="6" width="14" height="20" />,
};

export function Signal({ role, children }: { role: string; children: ReactNode }) {
  const shape = SHAPES[role];
  return (
    <span className="signal">
      {shape ? (
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
          <rect className="bed" width="32" height="32" rx="4" />
          {shape}
        </svg>
      ) : null}
      <span>{children}</span>
    </span>
  );
}
