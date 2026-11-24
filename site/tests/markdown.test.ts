import { describe, expect, it } from "vitest";
import { renderMarkdown, rewriteHref } from "../src/lib/markdown.ts";
import { parseFlowchart, parseSequence } from "../src/lib/mermaid.ts";
import { parseCsv } from "../src/lib/hardware.ts";

const options = { file: "docs/overview.md", routes: { "docs/protocol.md": "/docs/protocol/" } };

describe("links", () => {
  it("point a published document at its page", () => expect(rewriteHref("protocol.md#note-event", options)).toBe("/docs/protocol/#note-event"));
  it("point other repository files at GitHub", () => expect(rewriteHref("../firmware/README.md", options)).toBe("https://github.com/melophos/melophos/blob/main/firmware/README.md"));
  it("leave addresses and fragments alone", () => {
    expect(rewriteHref("https://example.com", options)).toBe("https://example.com");
    expect(rewriteHref("#top", options)).toBe("#top");
  });
});

describe("rendering", () => {
  it("gives a callout its word", () => {
    const { html } = renderMarkdown("> [!WARNING]\n> Careful.", options);
    expect(html).toContain("callout");
    expect(html).toContain("Warning");
  });
  it("marks an external link and says so", () => {
    const { html } = renderMarkdown("[x](https://example.com)", options);
    expect(html).toContain("opens another site");
  });
  it("puts a table in its own scrolling region", () => {
    expect(renderMarkdown("| a | b |\n| - | - |\n| 1 | 2 |", options).html).toContain("table-scroll");
  });
  it("gives every heading an id and a link", () => {
    const { headings, html } = renderMarkdown("## Two words", options);
    expect(headings[0]?.id).toBe("two-words");
    expect(html).toContain('href="#two-words"');
  });
  it("adds no colour to code", () => expect(renderMarkdown("```ts\nconst a = 1;\n```", options).html).not.toContain("style="));
  it("shows a diagram as text", () => {
    const { html } = renderMarkdown("```mermaid\nflowchart LR\n    A[\"One\"] -- \"MQTT\" --> B[\"Two\"]\n```", options);
    expect(html).toContain("<table>");
    expect(html).toContain("MQTT");
  });
});

describe("diagram text", () => {
  it("reads flowchart edges with labels", () => {
    const { nodes, edges } = parseFlowchart('flowchart LR\n  A["One<br/>x"] -- "via" --> B[("Two")]\n  B --> C["Three"]');
    expect(edges).toEqual([
      { from: "A", to: "B", label: "via" },
      { from: "B", to: "C", label: "" },
    ]);
    expect(nodes.get("A")).toBe("One x");
    expect(nodes.get("B")).toBe("Two");
  });
  it("reads sequence steps", () => {
    const { steps } = parseSequence("sequenceDiagram\n participant I as Instrument\n participant H as Hub\n I->>H: Note on\n Note over H: Wait");
    expect(steps[0]).toEqual({ kind: "message", from: "Instrument", to: "Hub", text: "Note on" });
    expect(steps[1]?.kind).toBe("note");
  });
});

describe("the bill of materials reader", () => {
  it("keeps commas inside quotes", () => expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]));
});
