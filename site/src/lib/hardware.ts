import { readRepo } from "./repo.ts";
import { renderMarkdown } from "./markdown.ts";

export interface BomRow {
  reference: string;
  quantity: string;
  part: string;
  value: string;
  purpose: string;
}

// a small reader for the one CSV the repository holds: commas inside double quotes belong to the field
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const fields: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = !quoted;
      } else if (c === "," && !quoted) {
        fields.push(cur);
        cur = "";
      } else cur += c;
    }
    fields.push(cur);
    rows.push(fields);
  }
  return rows;
}

export function bom(): BomRow[] {
  const [head, ...rows] = parseCsv(readRepo("hardware/bom/hub-rev-a.csv"));
  if (head?.join(",") !== "reference,quantity,part,value_or_package,purpose") throw new Error("the bill of materials columns changed: update site/src/lib/hardware.ts");
  return rows.map(([reference = "", quantity = "", part = "", value = "", purpose = ""]) => ({ reference, quantity, part, value, purpose }));
}

// the table that opens hardware/README.md: board, what it is and its status
export function boardTable(): string {
  const lines = readRepo("hardware/README.md").split("\n");
  const first = lines.findIndex((l) => l.startsWith("| Folder"));
  const block: string[] = [];
  for (let i = first; i < lines.length && lines[i]?.startsWith("|"); i++) block.push(lines[i] ?? "");
  return renderMarkdown(block.join("\n"), { file: "hardware/README.md" }).html;
}
