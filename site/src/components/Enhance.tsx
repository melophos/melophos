"use client";

import { useEffect } from "react";

// the two small scripts of the site: the theme choice and the keyboard figure's Play button. each one looks for its
// own markup and does nothing when the page has none. they load after the page is drawn, so every page reads
// without them
export function Enhance() {
  useEffect(() => {
    void import("../client/theme.ts");
    void import("../client/figure.ts");
  }, []);
  return null;
}
