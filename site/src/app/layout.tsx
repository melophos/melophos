import "../../../studio/src/styles/fonts/fonts.css";
import "../../../studio/src/styles/tokens.css";
import "../../../studio/src/styles/base.css";
import "../styles/site.css";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Viewport } from "next";
import type { ReactNode } from "react";
import { parseTokens } from "../../../studio/src/styles/tokens-model.ts";
import { ROOT } from "../lib/repo.ts";

// the browser's address bar colour follows the canvas of each theme, read from the same tokens
const tokens = parseTokens(readFileSync(join(ROOT, "studio/src/styles/tokens.css"), "utf8"));

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: tokens.sets.light["--canvas"] ?? "" },
    { media: "(prefers-color-scheme: dark)", color: tokens.sets.dark["--canvas"] ?? "" },
  ],
};

// the theme script runs before the page paints, so a saved choice never flashes the other theme. it may set
// data-theme on the root before the page is hydrated, which is why the root does not warn about that attribute
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <script src="/theme-init.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
