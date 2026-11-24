// the site's statements about the Studio are held to the Studio's own code, so a stale claim cannot ship.
import { describe, expect, it } from "vitest";
import { STUDIO_CLAIMS } from "../src/data/studio-state.ts";
import { isCode, runChecks } from "../src/lib/checks.ts";
import { ROOT } from "./lib/files.ts";

describe("what the site says about the Studio", () => {
  for (const claim of STUDIO_CLAIMS) {
    it(`${claim.id}: the Studio's files still support it`, () => {
      expect(runChecks(claim.checks, ROOT), `read the Studio again and update site/src/data/studio-state.ts`).toEqual([]);
    });
    if (claim.kind === "built") {
      it(`${claim.id}: a built statement rests on code and not only on the README`, () => {
        expect(claim.checks.filter(isCode).length).toBeGreaterThan(0);
      });
      it(`${claim.id}: a built statement names a test that lives in the Studio`, () => {
        expect(claim.checks.some((c) => "test" in c), "name a Studio test or mark the statement Not yet checked").toBe(true);
      });
    }
  }

  it("has statements that are built, not built and not yet checked", () => {
    for (const kind of ["built", "planned", "unchecked"] as const) expect(STUDIO_CLAIMS.some((c) => c.kind === kind), kind).toBe(true);
  });

  it("gives every statement a unique id", () => {
    const ids = STUDIO_CLAIMS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
