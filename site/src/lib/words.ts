// the writing rules, applied to the visible text of a page: no em or en dash, no comma before "and" or "or",
// no mention of the banned terms and none of the phrases that were true of an older draft.

import { STALE_PHRASES } from "../data/docs.config.ts";

export function visibleText(html: string): string {
  return html
    .replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, " ")
    .replace(/<head[\s\S]*?<\/head>/, " ")
    .replace(/<pre[\s\S]*?<\/pre>/g, " ")
    .replace(/<code[\s\S]*?<\/code>/g, "X")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;|&gt;/g, " ")
    // the ampersand is decoded last, so a written "&amp;lt;" stays the text "&lt;" instead of being decoded twice
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

// the changelog is published whole. this one line of it names the organisation's policy file and is shown exactly as
// CHANGELOG.md has it, so it is taken out before the banned-terms check. any other such mention still fails
export const PUBLISHED_AS_WRITTEN: RegExp[] = [
  // the site adds "(opens another site)" after the text of a link that leaves it
  /Community files follow the\s+AI policy\s*(?:\(opens another site\)\s*)?: pull requests declare AI use and issue forms ask whether AI helped\./g,
];

export function textProblems(input: string): string[] {
  const text = PUBLISHED_AS_WRITTEN.reduce((t, line) => t.replace(line, " "), input);
  const out: string[] = [];
  const dash = /[\u2013\u2014]/.exec(text);
  if (dash) out.push(`a dash character near "${text.slice(Math.max(0, dash.index - 20), dash.index + 20)}"`);
  const comma = /,\s+(and|or)\b/.exec(text);
  if (comma) out.push(`a comma before "${comma[1]}" near "${text.slice(Math.max(0, comma.index - 30), comma.index + 20)}"`);
  const ai = /\b(AI|A\.I\.|artificial intelligence|LLM|chatbot)\b/.exec(text);
  if (ai) out.push(`a mention of "${ai[1]}"`);
  for (const phrase of STALE_PHRASES) if (text.includes(phrase)) out.push(`a phrase that is no longer true: "${phrase}"`);
  return out;
}

// the title and the description in the head are read by people too, so they follow the same rules
export function wordProblems(html: string): string[] {
  const meta = [...html.matchAll(/<(?:title>([^<]*)<|meta (?:name|property)="(?:description|og:description|og:title)" content="([^"]*)")/g)].map((m) => m[1] ?? m[2] ?? "").join(" ");
  return textProblems(`${visibleText(html)} ${meta.replace(/&#39;|&#x27;/g, "'")}`);
}

// the prose of a page as sentences. a heading, a paragraph, a list item or a table cell ends a sentence even when it has no
// full stop, so the words of one block are never read as the start of the next. the signed founder's note is the one
// marked region the guards leave out: it is the founder's own account and is first person
export function proseSentences(html: string): string {
  const withoutNote = html.replace(/<figure class="note-signed"[\s\S]*?<\/figure>/g, " ");
  return visibleText(withoutNote.replace(/<\/(p|li|h[1-6]|dd|dt|td|th|tr|figcaption|blockquote|div|section|summary|caption)>/g, ". "))
    .replace(/\s+\./g, ".")
    .replace(/\.(\s*\.)+/g, ".");
}
