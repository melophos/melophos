// the published documents describe only what the code has. each statement is a phrase in the document and each is tied
// to checks on the code, so a document that keeps describing a service that was never built fails here.
import { describe, expect, it } from "vitest";
import { DOC_CLAIMS } from "../src/data/docs-claims.ts";
import { PARTS, STATUS_WORD } from "../src/data/status.ts";
import { runChecks } from "../src/lib/checks.ts";
import { ROOT, readRoot } from "./lib/files.ts";

describe("statements in the documents", () => {
  for (const claim of DOC_CLAIMS) {
    it(`${claim.doc}: "${claim.statement}"`, () => {
      expect(readRoot(claim.doc), "the statement is no longer in the document: remove it here or restore it").toContain(claim.statement);
      expect(claim.checks.length).toBeGreaterThan(0);
      expect(runChecks(claim.checks, ROOT)).toEqual([]);
    });
  }
});

describe("the architecture document", () => {
  const doc = readRoot("docs/architecture.md");
  it("names no service the repository does not have", () => {
    // each of these was described once as part of the system and none exists: the code checks above hold the other side
    for (const word of ["Redis", "MinIO", "WebSocket feed", "Web Bluetooth, the song library"]) expect(doc, word).not.toContain(word);
    expect(readRoot("server/deploy/docker-compose.yml")).not.toMatch(/redis|minio/);
  });
  it("gives each component the status word the home page gives it", () => {
    const rows = doc.split("## What exists today")[1]?.split("\n").filter((l) => l.startsWith("|") && !l.startsWith("| ---") && !l.startsWith("| Component")) ?? [];
    const byName: Record<string, string> = { "Hub firmware": "firmware", "Hub board": "hub-board", "LED bars": "led-bars", Server: "server", "Scoring engine": "scoring", Studio: "studio" };
    let seen = 0;
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      const id = byName[cells[1] ?? ""];
      if (!id) continue;
      seen++;
      const part = PARTS.find((p) => p.id === id);
      expect(cells[2], `${cells[1]} row`).toBe(STATUS_WORD[part?.status ?? "planned"]);
    }
    expect(seen).toBe(Object.keys(byName).length);
  });
});
