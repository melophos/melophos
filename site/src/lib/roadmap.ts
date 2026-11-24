import { readRepo } from "./repo.ts";
import { renderInline } from "./markdown.ts";
import { docRoutes } from "./docs.ts";
import type { Status } from "../data/status.ts";

export interface RoadmapItem {
  status: Status;
  html: string;
}
export interface RoadmapGroup {
  name: string | null;
  items: RoadmapItem[];
}
export interface RoadmapVersion {
  title: string; // v1: works on a real piano
  target: string | null; // target: February 2027
  state: string | null; // done
  groups: RoadmapGroup[];
}

// docs/roadmap.md is the one source. "- [x]" is built and "- [ ]" is planned
export function roadmap(): { versions: RoadmapVersion[]; notes: string[] } {
  const options = { file: "docs/roadmap.md", routes: docRoutes() };
  const versions: RoadmapVersion[] = [];
  const notes: string[] = [];
  let version: RoadmapVersion | null = null;
  let group: RoadmapGroup | null = null;
  for (const line of readRepo("docs/roadmap.md").split("\n")) {
    const v = /^##\s+(.+)$/.exec(line);
    if (v?.[1]) {
      const m = /^(.*?)\s*\((target:\s*[^)]+|done)\)\s*$/.exec(v[1]);
      version = {
        title: (m?.[1] ?? v[1]).trim(),
        target: m?.[2]?.startsWith("target") ? m[2].replace(/^target:\s*/, "") : null,
        state: m?.[2] === "done" ? "done" : null,
        groups: [],
      };
      versions.push(version);
      group = null;
      continue;
    }
    const g = /^###\s+(.+)$/.exec(line);
    if (g?.[1] && version) {
      group = { name: g[1].trim(), items: [] };
      version.groups.push(group);
      continue;
    }
    const item = /^- \[([ xX])\]\s+(.+)$/.exec(line);
    if (item?.[2] && version) {
      if (!group) {
        group = { name: null, items: [] };
        version.groups.push(group);
      }
      // the end of an item says how far it has got. a ticked item with no note is built
      let text = item[2];
      let status: Status = item[1] === " " ? "planned" : "built";
      const note = /\s*\((host-tested, awaits a board|in progress|not yet checked)([^)]*)\)\s*$/.exec(text);
      if (note?.[1]) {
        status = note[1] === "in progress" ? "progress" : note[1] === "not yet checked" ? "unchecked" : "host";
        const extra = (note[2] ?? "").replace(/^[:.]\s*/, "").trim();
        text = text.slice(0, note.index) + (extra ? `. ${extra.charAt(0).toUpperCase()}${extra.slice(1)}` : "");
      }
      group.items.push({ status, html: renderInline(text, options) });
      continue;
    }
    const n = /^>\s*\[!NOTE\]\s*$/.exec(line);
    if (n) continue;
    const quoted = /^>\s+(.+)$/.exec(line);
    if (quoted?.[1]) notes.push(renderInline(quoted[1], options));
  }
  return { versions, notes };
}
