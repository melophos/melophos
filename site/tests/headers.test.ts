import { describe, expect, it } from "vitest";
import { readRoot, readSite } from "./lib/files.ts";
import { APP_URL } from "../src/site.config.ts";

const headers = readSite("public/_headers");
const csp = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? "";
const directive = (name: string): string[] => (csp.split(";").map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name) ?? []).slice(1);

describe("the hosting headers", () => {
  it("lets nothing load from another origin", () => {
    expect(directive("default-src")).toEqual(["'none'"]);
    for (const name of ["script-src", "style-src", "img-src", "font-src"]) expect(directive(name), name).toEqual(["'self'"]);
    expect(csp).not.toMatch(/https?:|\*|unsafe-inline|unsafe-eval|data:/);
  });
  it("forbids framing, forms and a base address", () => {
    expect(directive("frame-ancestors")).toEqual(["'none'"]);
    expect(directive("form-action")).toEqual(["'none'"]);
    expect(directive("base-uri")).toEqual(["'none'"]);
    expect(directive("connect-src")).toEqual(["'none'"]);
  });
  it("withholds the device permissions from the site", () => {
    for (const p of ["midi", "bluetooth", "serial", "usb", "camera", "microphone"]) expect(headers).toContain(`${p}=()`);
  });
  it("sends the other protective headers", () => {
    for (const h of ["Strict-Transport-Security", "X-Content-Type-Options: nosniff", "Referrer-Policy", "Cross-Origin-Opener-Policy"]) expect(headers).toContain(h);
  });
  it("redirects /try to a route the Studio really has", () => {
    const m = /^\/try\s+(\S+)\s+302/m.exec(readSite("public/_redirects"));
    expect(m?.[1]).toBe(`${APP_URL}/#/try`);
    // the Studio routes on the address hash: "#/try" is the case "try" in its router
    expect(readRoot("studio/src/app/App.tsx")).toContain('case "try":');
  });
});
