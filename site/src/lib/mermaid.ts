// the repository draws its diagrams as Mermaid text. the site shows each one as a table or a numbered list,
// which a screen reader, a magnifier and a browser with scripts off can all read. It also keeps one copy of the facts.
// it understands the two kinds of diagram the documents use: flowcharts and sequence diagrams.

import type { Element, ElementContent, Properties } from "hast";

const el = (tagName: string, properties: Properties, children: ElementContent[] = []): Element => ({
  type: "element",
  tagName,
  properties,
  children,
});
const text = (value: string): ElementContent => ({ type: "text", value });

const clean = (label: string): string =>
  label
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/^["'(\[]+|["')\]]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

export interface Edge {
  from: string;
  to: string;
  label: string;
}

export function parseFlowchart(source: string): { nodes: Map<string, string>; edges: Edge[]; groups: Map<string, string> } {
  const nodes = new Map<string, string>();
  const groups = new Map<string, string>();
  const edges: Edge[] = [];
  const NODE = String.raw`([A-Za-z][A-Za-z0-9_]*)(?:\[\("([^"]*)"\)\]|\["([^"]*)"\]|\("([^"]*)"\)|\{"([^"]*)"\})?`;
  const nodeRe = new RegExp(NODE, "g");
  const rememberNodes = (line: string) => {
    for (const m of line.matchAll(nodeRe)) {
      const id = m[1];
      const label = m[2] ?? m[3] ?? m[4] ?? m[5];
      if (id && label !== undefined && !nodes.has(id)) nodes.set(id, clean(label));
    }
  };
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || /^(flowchart|graph|direction|end\b)/.test(line)) continue;
    const sub = /^subgraph\s+([A-Za-z0-9_]+)\["([^"]*)"\]/.exec(line);
    if (sub?.[1] && sub[2]) {
      groups.set(sub[1], clean(sub[2]));
      continue;
    }
    rememberNodes(line);
    // A -- "text" --> B, A --> B, A <-- "text" --> B, A -. "text" .-> B
    const edgeRe = new RegExp(`${NODE}\\s*(?:<--|--|-\\.)\\s*(?:"([^"]*)")?\\s*(?:-->|\\.->)\\s*${NODE}|${NODE}\\s*-->\\s*${NODE}`);
    const m = edgeRe.exec(line);
    if (m) {
      const from = m[1] ?? m[12];
      const to = m[7] ?? m[17];
      const label = m[6] ?? "";
      if (from && to) edges.push({ from, to, label: clean(label) });
    }
  }
  return { nodes, edges, groups };
}

export interface Step {
  kind: "message" | "note";
  from: string;
  to: string;
  text: string;
}

export function parseSequence(source: string): { steps: Step[] } {
  const names = new Map<string, string>();
  const steps: Step[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    const p = /^participant\s+(\w+)\s+as\s+(.+)$/.exec(line);
    if (p?.[1] && p[2]) {
      names.set(p[1], clean(p[2]));
      continue;
    }
    const msg = /^(\w+)\s*(?:-->>|->>|-->|->)\s*(\w+)\s*:\s*(.+)$/.exec(line);
    if (msg?.[1] && msg[2] && msg[3]) {
      steps.push({ kind: "message", from: names.get(msg[1]) ?? msg[1], to: names.get(msg[2]) ?? msg[2], text: clean(msg[3]) });
      continue;
    }
    const note = /^Note\s+over\s+(\w+)\s*:\s*(.+)$/i.exec(line);
    if (note?.[1] && note[2]) {
      const who = names.get(note[1]) ?? note[1];
      steps.push({ kind: "note", from: who, to: who, text: clean(note[2]) });
    }
  }
  return { steps };
}

export function mermaidToHast(source: string): Element {
  const isSequence = /^\s*sequenceDiagram/.test(source);
  if (isSequence) {
    const { steps } = parseSequence(source);
    return el("figure", { className: ["diagram"] }, [
      el("figcaption", {}, [text("Sequence, in order. The diagram's own text, shown as a list.")]),
      el(
        "ol",
        {},
        steps.map((s) =>
          el("li", {}, [
            s.kind === "note" ? text(`${s.from} (note): ${s.text}`) : s.from === s.to ? text(`${s.from}: ${s.text}`) : text(`${s.from} to ${s.to}: ${s.text}`),
          ]),
        ),
      ),
    ]);
  }
  const { nodes, edges, groups } = parseFlowchart(source);
  const name = (id: string): string => nodes.get(id) ?? groups.get(id) ?? id;
  const rows = edges.map((e) =>
    el("tr", {}, [el("td", {}, [text(name(e.from))]), el("td", {}, [text(e.label || "Passes data to")]), el("td", {}, [text(name(e.to))])]),
  );
  return el("figure", { className: ["diagram"] }, [
    el("figcaption", {}, [text("Connections. The diagram's own text, shown as a table.")]),
    el("div", { className: ["table-scroll"], tabIndex: 0, role: "region", "aria-label": "Diagram connections, scrolls sideways" }, [
      el("table", {}, [
        el("thead", {}, [el("tr", {}, [el("th", { scope: "col" }, [text("From")]), el("th", { scope: "col" }, [text("How")]), el("th", { scope: "col" }, [text("To")])])]),
        el("tbody", {}, rows),
      ]),
    ]),
  ]);
}
