import { readRepo } from "./repo.ts";
import { renderMarkdown } from "./markdown.ts";
import { docRoutes } from "./docs.ts";

// the body of one second-level section of a repository file, rendered. the heading itself is left for the page to write
export function sectionOf(file: string, heading: string): string {
  const source = `\n${readRepo(file)}`;
  const start = source.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`${file} has no section called "${heading}"`);
  const body = source.slice(start + heading.length + 5).split(/\n## /)[0] ?? "";
  return renderMarkdown(body, { file, routes: docRoutes(), idPrefix: `${heading.toLowerCase().replace(/\W+/g, "-")}-` }).html;
}

// the text before the first second-level heading, minus the first heading line
export function introOf(file: string): string {
  const body = readRepo(file).split(/\n## /)[0] ?? "";
  return renderMarkdown(body.replace(/^# .*\n/, ""), { file, routes: docRoutes() }).html;
}
