import { readRepo } from "./repo.ts";
import { renderMarkdown } from "./markdown.ts";
import { docRoutes } from "./docs.ts";
import { OMITTED_CHANGELOG_LINES } from "../data/changelog.config.ts";

export interface Release {
  title: string; // Unreleased or 0.1.0
  // the stable address of the release on the page and in the feed: it does not change when a newer release is added
  slug: string;
  date: string | null; // 22 November 2026
  iso: string | null; // 2026-11-22
  html: string;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// dates in British form, with the month written out, whatever form the file uses
export function britishDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m?.[1] || !m[2] || !m[3]) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export const slugOf = (title: string): string => title.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "") || "release";

export function intro(): string {
  const text = readRepo("CHANGELOG.md");
  const body = text.split(/^## /m)[0] ?? "";
  return renderMarkdown(body.replace(/^# .*$/m, ""), { file: "CHANGELOG.md", routes: docRoutes() }).html;
}

export function releases(): Release[] {
  const source = readRepo("CHANGELOG.md")
    .split("\n")
    .filter((line) => !OMITTED_CHANGELOG_LINES.some((o) => line.includes(o.contains)))
    .join("\n");
  const parts = source.split(/^## /m).slice(1);
  return parts.map((part) => {
    const [head = "", ...rest] = part.split("\n");
    const m = /^\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/.exec(head);
    const title = m?.[1] ?? head.trim();
    const slug = slugOf(title);
    const html = renderMarkdown(rest.join("\n"), { file: "CHANGELOG.md", routes: docRoutes(), idPrefix: `${slug}-` }).html;
    return { title, slug, date: m?.[2] ? britishDate(m[2]) : null, iso: m?.[2] ?? null, html };
  });
}
