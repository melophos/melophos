import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readRepo } from "./repo.ts";
import { OWN_PAGE, WITHHELD } from "../data/docs.config.ts";
import { renderMarkdown, type Rendered } from "./markdown.ts";
import { sourceUrl } from "../site.config.ts";

export interface Doc {
  file: string; // docs/overview.md
  name: string; // overview.md
  slug: string; // overview
  title: string;
  summary: string;
  group: string;
  route: string;
}

const titleOf = (source: string, fallback: string): string => /^#\s+(.+)$/m.exec(source)?.[1]?.trim() ?? fallback;

// the order and the one-line summaries come from docs/README.md, so the index is the repository's own index
function indexRows(): { name: string; summary: string; group: string }[] {
  const rows: { name: string; summary: string; group: string }[] = [];
  let group = "Documents";
  for (const line of readRepo("docs/README.md").split("\n")) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h?.[1]) group = h[1].trim();
    const m = /^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.+?)\s*\|$/.exec(line);
    if (m?.[2] && m[3] && m[2].endsWith(".md") && !m[2].startsWith("..")) rows.push({ name: m[2], summary: m[3], group });
  }
  return rows;
}

export function allDocs(): Doc[] {
  const ordered = indexRows();
  const onDisk = readdirSync(join(ROOT, "docs")).filter((f) => f.endsWith(".md") && f !== "README.md");
  const known = new Set(ordered.map((r) => r.name));
  const extra = onDisk.filter((f) => !known.has(f)).map((name) => ({ name, summary: "", group: "More" }));
  return [...ordered, ...extra]
    .filter((r) => onDisk.includes(r.name) && !(r.name in WITHHELD))
    .map((r) => {
      const file = `docs/${r.name}`;
      const slug = r.name.replace(/\.md$/, "");
      // the slug is a file name read from disk, so it is percent-encoded before it becomes part of an address
      const route = `/docs/${encodeURIComponent(slug)}/`;
      return { file, name: r.name, slug, title: titleOf(readRepo(file), slug), summary: r.summary, group: r.group, route };
    });
}

export function docRoutes(): Record<string, string> {
  return { ...Object.fromEntries(allDocs().map((d) => [d.file, d.route])), ...OWN_PAGE };
}

export function renderDoc(doc: Doc): Rendered {
  return renderMarkdown(readRepo(doc.file), { file: doc.file, routes: docRoutes(), dropFirstH1: true });
}

export const editUrl = (doc: Doc): string => sourceUrl(doc.file, "edit");
