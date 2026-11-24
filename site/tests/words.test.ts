import { describe, expect, it } from "vitest";
import { textProblems, visibleText } from "../src/lib/words.ts";

describe("the writing rules", () => {
  it("flags a dash", () => {
    expect(textProblems("a — b").length).toBe(1);
    expect(textProblems("a – b").length).toBe(1);
  });
  it("flags a comma before and or or", () => {
    expect(textProblems("red, and blue").length).toBe(1);
    expect(textProblems("red, or blue").length).toBe(1);
    expect(textProblems("red, green and blue")).toEqual([]);
  });
  it("flags a mention of AI", () => {
    expect(textProblems("an AI policy").length).toBe(1);
    expect(textProblems("a said sentence")).toEqual([]);
  });
  it("lets the one changelog line through as written and nothing like it", () => {
    const line = "Community files follow the AI policy : pull requests declare AI use and issue forms ask whether AI helped.";
    expect(textProblems(`Before. ${line} After.`)).toEqual([]);
    expect(textProblems(line.replace("policy :", "policy (opens another site) :"))).toEqual([]);
    expect(textProblems(`${line} Built with AI.`).length).toBe(1);
    expect(textProblems("Community files follow the AI policy.").length).toBe(1);
  });
  it("reads only the text a visitor sees", () => {
    expect(visibleText("<head><title>x and y</title></head><p>one</p><script>a and b</script>")).toBe(" one ");
  });
});
