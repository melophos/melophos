import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";

type Kind = "note" | "tip" | "important" | "warning" | "caution";
const LABELS: Record<Kind, string> = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };

export function Callout({ kind = "note", children }: { kind?: Kind; children: ReactNode }) {
  return (
    <div className="callout" data-kind={kind}>
      <p className="callout-title">
        <Icon name={kind === "warning" || kind === "caution" ? "warning" : "info"} />
        {LABELS[kind]}
      </p>
      {children}
    </div>
  );
}
