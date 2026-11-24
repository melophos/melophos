import type { ReactNode } from "react";
import { Icon } from "./Icon.tsx";

// a link that leaves the site is always a web address. anything else, such as a javascript: link, stops the build
// here instead of reaching a page
function webAddress(href: string): string {
  const { protocol } = new URL(href);
  if (protocol !== "https:" && protocol !== "http:") throw new Error(`an external link must be a web address: ${href}`);
  return href;
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={webAddress(href)} rel="noopener">
      {children}
      <Icon name="external" />
      <span className="visually-hidden"> (opens another site)</span>
    </a>
  );
}
