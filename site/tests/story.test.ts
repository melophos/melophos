import { describe, expect, it } from "vitest";
import { FOUNDER_NOTE, FOUNDER_SIGNATURE, PROJECT_VOICE } from "../src/data/story.ts";
import { readRoot } from "./lib/files.ts";

describe("the origin story is told the same way in three places (D1)", () => {
  const readme = readRoot("README.md");

  it("keeps the fact in the README in the project's voice and links to the About page", () => {
    expect(readme).toContain(PROJECT_VOICE[0]);
    expect(readme).toContain("https://melophos.com/about/");
    expect(readme).toMatch(/monocular vision/);
  });

  it("no longer has the first person paragraph in the README", () => {
    expect(readme).not.toContain("I have monocular vision");
    expect(readme).not.toContain("the tool I wanted");
  });

  it("states the same fact impersonally in ACCESSIBILITY.md", () => {
    expect(readRoot("ACCESSIBILITY.md")).toMatch(/monocular vision/);
  });

  it("keeps the founder's note in the first person with the signature and no other detail", () => {
    expect(FOUNDER_NOTE.startsWith("I have monocular vision")).toBe(true);
    expect(FOUNDER_SIGNATURE).toBe("Isaac Adjei, founder");
    expect(PROJECT_VOICE.join(" ")).not.toMatch(/\b(I|my|me)\b/);
  });
});
