// renders the repository's Markdown at build time. no script reaches the browser and no colour is added:
// code stays in the text colour, so every pairing on the page is one that the contrast test has measured.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import GithubSlugger from "github-slugger";
import type { Root as MdRoot, Blockquote } from "mdast";
import type { Root as HastRoot, Element, ElementContent, Properties } from "hast";
import { isDirectory, repoExists, resolveFrom } from "./repo.ts";
import { mermaidToHast } from "./mermaid.ts";
import { SITE_URL, sourceUrl } from "../site.config.ts";
import { iconMarkup } from "../../../studio/src/icons/index.ts";

export interface Heading {
  depth: number;
  text: string;
  id: string;
}

export interface Rendered {
  html: string;
  headings: Heading[];
}

export interface RenderOptions {
  // the repository path of the file, so relative links can be resolved
  file: string;
  // published documents by file name, mapped to their address on the site
  routes?: Record<string, string>;
  // the first heading is the page title and is shown by the layout
  dropFirstH1?: boolean;
  // headings are pushed down this many levels, so a page never has two H1 elements
  shift?: number;
  // put before every heading id, so two renders on one page never repeat an id
  idPrefix?: string;
}

const CALLOUTS: Record<string, { label: string; icon: "info" | "warning" }> = {
  NOTE: { label: "Note", icon: "info" },
  TIP: { label: "Tip", icon: "info" },
  IMPORTANT: { label: "Important", icon: "info" },
  WARNING: { label: "Warning", icon: "warning" },
  CAUTION: { label: "Caution", icon: "warning" },
};

const el = (tagName: string, properties: Properties, children: ElementContent[] = []): Element => ({
  type: "element",
  tagName,
  properties,
  children,
});
const text = (value: string): ElementContent => ({ type: "text", value });

// the text of the first column heading, which names a table well enough to tell two on one page apart
function firstHeader(table: Element): string {
  const find = (n: ElementContent): ElementContent | undefined =>
    n.type === "element" ? (n.tagName === "th" ? n : n.children.map(find).find(Boolean)) : undefined;
  const th = table.children.map(find).find(Boolean);
  return th ? plain(th).trim() : "";
}

function plain(node: ElementContent): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(plain).join("");
  return "";
}

// "> [!NOTE]" becomes a callout that carries its word, as GitHub shows it
function remarkCallouts() {
  return (tree: MdRoot) => {
    const visit = (node: { children?: unknown[] }) => {
      for (const child of node.children ?? []) {
        const c = child as Blockquote & { children?: unknown[] };
        if (c.type === "blockquote") {
          const first = c.children[0];
          const firstText = first?.type === "paragraph" ? first.children[0] : undefined;
          const match = firstText?.type === "text" ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/.exec(firstText.value) : null;
          if (match?.[1] && firstText?.type === "text") {
            firstText.value = firstText.value.slice(match[0].length);
            if (firstText.value === "") first?.type === "paragraph" && first.children.shift();
            c.data = { ...c.data, hName: "div", hProperties: { className: ["callout"], dataKind: match[1].toLowerCase() } };
          }
        }
        visit(child as { children?: unknown[] });
      }
    };
    visit(tree);
  };
}

function rehypeSite(options: RenderOptions, headings: Heading[]) {
  return (tree: HastRoot) => {
    const slugger = new GithubSlugger();
    let seenH1 = false;
    let tables = 0;
    const shift = options.shift ?? 0;

    const walk = (parent: Element | HastRoot): void => {
      const next: ElementContent[] = [];
      for (const node of parent.children as ElementContent[]) {
        if (node.type !== "element") {
          next.push(node);
          continue;
        }
        const kind = node.properties["dataKind"];
        const classes = (node.properties["className"] ?? []) as string[];

        if (node.tagName === "pre") {
          const code = node.children.find((c): c is Element => c.type === "element" && c.tagName === "code");
          const lang = ((code?.properties["className"] ?? []) as string[]).find((c) => c.startsWith("language-"));
          if (lang === "language-mermaid" && code) {
            next.push(mermaidToHast(plain(code)));
            continue;
          }
          // a code block can be wider than the page, so it is a focusable region that scrolls on its own
          node.properties = { ...node.properties, tabIndex: 0 };
        }

        // a task list box is a form control with no label: show the state as words instead
        if (node.tagName === "input" && node.properties["type"] === "checkbox") {
          next.push(text(node.properties["checked"] ? "Done: " : "Not done: "));
          continue;
        }

        if (node.tagName === "table") {
          next.push(el("div", { className: ["table-scroll"], tabIndex: 0, role: "region", "aria-label": `Table ${++tables}${firstHeader(node) ? ` (${firstHeader(node)})` : ""}, scrolls sideways` }, [node]));
          walk(node);
          continue;
        }

        if (classes.includes("callout") && typeof kind === "string") {
          const info = CALLOUTS[kind.toUpperCase()];
          if (info) {
            node.children = [
              el("p", { className: ["callout-title"] }, [
                el("span", { className: ["callout-mark"], dataIcon: info.icon }),
                text(info.label),
              ]),
              ...node.children.filter((c) => !(c.type === "text" && c.value.trim() === "")),
            ];
          }
        }

        if (/^h[1-6]$/.test(node.tagName)) {
          const depth = Number(node.tagName[1]);
          if (depth === 1 && options.dropFirstH1 && !seenH1) {
            seenH1 = true;
            continue;
          }
          const level = Math.min(6, depth + shift);
          const label = plain(node);
          const id = `${options.idPrefix ?? ""}${slugger.slug(label)}`;
          node.tagName = `h${level}`;
          node.properties["id"] = id;
          node.children.push(
            el("a", { className: ["anchor"], href: `#${id}` }, [
              el("span", { className: ["visually-hidden"] }, [text(`Link to the section ${label}`)]),
              el("span", { "aria-hidden": "true" }, [text("#")]),
            ]),
          );
          headings.push({ depth: level, text: label, id });
        }

        if (node.tagName === "a" && typeof node.properties["href"] === "string") {
          const href = rewriteHref(node.properties["href"], options);
          node.properties["href"] = href;
          if (leavesSite(href)) {
            node.properties["rel"] = ["noopener"];
            node.children.push(el("span", { className: ["ext-mark"] }, []));
            node.children.push(el("span", { className: ["visually-hidden"] }, [text(" (opens another site)")]));
          }
        }

        walk(node);
        next.push(node);
      }
      parent.children = next as never;
    };
    walk(tree);
  };
}

const SITE_HOST = new URL(SITE_URL).hostname;

// the host is compared whole after parsing, so an address such as https://melophos.com.example.org is still marked
// as leaving the site. a relative link stays on the site and a web address that does not parse is treated as leaving it
export function leavesSite(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    return new URL(href).hostname !== SITE_HOST;
  } catch {
    return true;
  }
}

// a link written for the repository becomes a link on the site when its target is a published page
// and a link to the file on GitHub otherwise
export function rewriteHref(href: string, options: RenderOptions): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const [pathPart = "", hash = ""] = href.split("#");
  if (pathPart === "") return href;
  const target = resolveFrom(options.file, pathPart);
  const tail = hash ? `#${hash}` : "";
  const route = options.routes?.[target];
  if (route) return `${route}${tail}`;
  if (!repoExists(target)) return `${sourceUrl(target)}${tail}`;
  return `${sourceUrl(target, isDirectory(target) ? "tree" : "blob")}${tail}`;
}

export function renderMarkdown(source: string, options: RenderOptions): Rendered {
  const headings: Heading[] = [];
  const out = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCallouts)
    .use(remarkRehype)
    .use(rehypeSite, options, headings)
    .use(rehypeStringify)
    .processSync(source);
  let html = String(out);
  // the marks are drawn from the shared icon set, so a callout and an external link look as they do in the app
  html = html.replaceAll('<span class="ext-mark"></span>', iconMarkup("external"));
  html = html.replace(/<span class="callout-mark" data-icon="(info|warning)"><\/span>/g, (_m, name: "info" | "warning") => iconMarkup(name));
  return { html, headings };
}

// a short piece of Markdown that sits inside a line: no paragraph around it
export function renderInline(source: string, options: RenderOptions): string {
  return renderMarkdown(source, options).html.replace(/^<p>/, "").replace(/<\/p>\s*$/, "").trim();
}
