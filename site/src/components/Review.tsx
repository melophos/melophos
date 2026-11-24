import type { ReactNode } from "react";

// a point on a legal page that a lawyer has to read before the site goes live. it is marked in words, so nobody
// takes the page for advice that has been checked
export function Review({ children }: { children: ReactNode }) {
  return (
    <p className="review">
      <strong>For legal review.</strong>
      {children}
    </p>
  );
}
