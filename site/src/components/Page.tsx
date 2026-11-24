import type { ReactNode } from "react";
import { APP_URL, REPO_URL } from "../site.config.ts";
import { Enhance } from "./Enhance.tsx";
import { ExtLink } from "./ExtLink.tsx";
import { Icon } from "./Icon.tsx";
import { ThemeToggle } from "./ThemeToggle.tsx";

export type Section = "how-it-works" | "hardware" | "accessibility" | "docs" | "roadmap";

const NAV = [
  { id: "how-it-works", href: "/how-it-works/", label: "How it works" },
  { id: "hardware", href: "/hardware/", label: "Hardware" },
  { id: "accessibility", href: "/accessibility/", label: "Accessibility" },
  { id: "docs", href: "/docs/", label: "Docs" },
  { id: "roadmap", href: "/roadmap/", label: "Roadmap" },
] as const;

const FOOTER = [
  { href: "/about/", label: "About" },
  { href: "/contact/", label: "Contact" },
  { href: "/changelog/", label: "Changelog" },
  { href: "/privacy/", label: "Privacy" },
  { href: "/cookies/", label: "Cookies" },
  { href: "/terms/", label: "Terms of use" },
  { href: "/licences/", label: "Licences" },
] as const;

function NavLinks({ section }: { section: Section | undefined }) {
  return (
    <ul>
      {NAV.map((item) => (
        <li key={item.id}>
          <a href={item.href} aria-current={section === item.id ? "page" : undefined}>
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

// the frame of every page: the skip link, the header with the main navigation, the page itself and the footer.
// a page that sets bleed lays out its own width, so a band can run from edge to edge
export function Page({ path, section, bleed = false, children }: { path: string; section?: Section; bleed?: boolean; children: ReactNode }) {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to the content
      </a>
      <header className="site-header">
        <div className="wrap">
          <a className="brand" href="/">
            <img className="wordmark-light" src="/brand/melophos-wordmark-light.svg" alt="MELOPHOS, home page" width={1522} height={512} />
            <img className="wordmark-dark" src="/brand/melophos-wordmark-dark.svg" alt="MELOPHOS, home page" width={1522} height={512} />
          </a>
          <nav className="site-nav" aria-label="Main">
            <NavLinks section={section} />
          </nav>
          <a className="button button-primary" href="/try">
            <Icon name="play" /> Try it
          </a>
          <details className="menu">
            <summary>
              <Icon name="disclosure" /> Menu
            </summary>
            <nav className="menu-panel" aria-label="Main">
              <NavLinks section={section} />
            </nav>
          </details>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {bleed ? children : <div className="wrap">{children}</div>}
      </main>
      <footer className="site-footer">
        <div className="wrap">
          <ThemeToggle />
          <nav aria-label="Footer">
            <ul>
              {FOOTER.map((item) => (
                <li key={item.href}>
                  <a href={item.href} aria-current={path === item.href ? "page" : undefined}>
                    {item.label}
                  </a>
                </li>
              ))}
              <li>
                <ExtLink href={REPO_URL}>Source code on GitHub</ExtLink>
              </li>
            </ul>
          </nav>
          <p className="fine">
            MELOPHOS is open source. The software is under the AGPL-3.0-or-later licence and the hardware designs are under CERN-OHL-S-2.0. The <ExtLink href={APP_URL}>Studio app</ExtLink> runs on its own address.
          </p>
        </div>
      </footer>
      <Enhance />
    </>
  );
}
