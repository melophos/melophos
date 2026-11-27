// names that must never appear are kept as SHA-256 hashes of their lowercase form, so the list that keeps them out of the
// site does not publish them itself. text is split into words and every word, its parts and every pair of neighbouring
// words is hashed and looked up. a hit reports the words it found, which are already in the text being checked.
import { createHash } from "node:crypto";

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

// the names no published page, document or feed may contain: private repositories, other organisations, personal
// accounts and domains and internal planning files
export const PRIVATE_NAME_HASHES: ReadonlySet<string> = new Set([
  "9cfda032d16414327f90ab587d42324d1b072288974ee4098d44cfa13599f7a6",
  "e14994b85f3525c608a7f3b991d37f00356e32e2ff1bad93a87adcd800d2f3f3",
  "26ba4d9eaa8130c6a22c4d454e18f9b83b63017c031d94011ac7e906f3190323",
  "65fee06c9f32c351a65550f204e829dbef3f2e77afe30f2f7652dbd92e6ae449",
  "3fe368e275072e8404d24c74133a4a5e2d1ec6b9879237ef7210f1f807034109",
  "6f0f5465b6324686737693d8e507bba30afb1d9fa8e7ab07506c3f8aafa22d08",
  "0bbe5bc4573bcf1caa8ba13b58efe7c468bb397ddfe2f5a83f9c76ba92cec5b4",
  "2cd1a3db8217e10f678f7c0e9ef3fa4a4689380c1b85ab5c2c9f71e04962a02d",
]);

// the names the site's own code and tests may not contain: a repository that is not public and notes about how others
// work on the project, which have no place in a site that builds from this repository alone
export const HERMETIC_NAME_HASHES: ReadonlySet<string> = new Set([
  "9cfda032d16414327f90ab587d42324d1b072288974ee4098d44cfa13599f7a6",
  "6f0f5465b6324686737693d8e507bba30afb1d9fa8e7ab07506c3f8aafa22d08",
  "675519febc20e416510452d8f731298bd439d655a2f4a0070dc309856c6c5ead",
  "82925b236487c944b40df6c3104bd5f5e1f88f9bfa9b90a37bb8ac58bbfecb0a",
  "303e812215eb28266bb925635d7cd716d7e6f2fbb10fd8bcb8b8db83389e37b8",
  "ccc2913077ccf4953c382add148df61c9983da3642e1cbd9f53d04345d3a4980",
  "aa0608f7bccbf446f64b8ee0edef4adbf0ca17957b8e8b4b79be124b7d7cc4aa",
]);

const trimEdges = (w: string): string => w.replace(/^[.'/-]+|[.'/-]+$/g, "");

// every string a name could hide in: each word, its "/" parts and their neighbouring joins (so a path segment pair such
// as a folder and its file is caught), each "." part (so a domain's first label is caught) and each pair of words
export function candidates(text: string): Set<string> {
  const out = new Set<string>();
  const words = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9./'-]+/)
    .map(trimEdges)
    .filter(Boolean);
  for (const word of words) {
    out.add(word);
    const parts = word.split("/").map(trimEdges).filter(Boolean);
    parts.forEach((part, i) => {
      out.add(part);
      for (const label of part.split(".").map(trimEdges).filter(Boolean)) out.add(label);
      const next = parts[i + 1];
      if (next) out.add(`${part}/${next}`);
    });
  }
  for (let i = 0; i + 1 < words.length; i++) out.add(`${words[i]} ${words[i + 1]}`);
  return out;
}

// the candidates whose hash is in the set, in the order they were found
export function hashedHits(text: string, hashes: ReadonlySet<string>): string[] {
  return [...candidates(text)].filter((c) => hashes.has(sha256(c)));
}

export const hashOf = sha256;
