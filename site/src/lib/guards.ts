// phrases that no published page or document may contain. they are written in pieces so that this file and the tests that
// use it do not contain them. a hit fails the build (scripts/verify-dist.ts) and the tests (tests/guards.test.ts).

const join = (...parts: string[]): string => parts.join("");

// private repositories, other organisations' names and anything personal: no page, document or feed may name one.
// the founder's note is signed with a name and carries no link, so it needs no exception
export const PRIVATE_NAMES: { why: string; pattern: RegExp }[] = [
  { why: "a private repository", pattern: new RegExp(join("melophos", "-", "internal"), "i") },
  { why: "another organisation's name", pattern: new RegExp(join("zac", "esshq|ENG", "NERDS"), "i") },
  { why: "a personal domain", pattern: new RegExp(join("isaac", "adjei"), "i") },
  { why: "a personal account", pattern: new RegExp(join("zacc", "esss"), "i") },
  { why: "a personal mail address", pattern: new RegExp(join("@gm", "ail\\.com"), "i") },
  { why: "a personal profile link", pattern: new RegExp(join("linkedin\\.com/", "in/"), "i") },
  { why: "a journal or an internal planning file", pattern: new RegExp(join("docs/", "journal|PLAN", "\\.md|later-", "stages"), "i") },
];

// sentences that would say hardware exists, ships or has been used. today no board has been made, so none is true.
// a line in the roadmap or the founder's note that is about the future is listed in HARDWARE_ALLOWED with its reason
export const HARDWARE_FALSE: RegExp[] = [
  /tested on (a |the )?real (board|hardware|hub|piano|keyboard|instrument)/i,
  /\bworks? on (a |the )?real (board|hardware|hub|piano)/i,
  /\bships?\b|\bshipping\b|\bshipped\b/i,
  /in stock|order now|buy now|pre-?order|for sale|available to (buy|order)/i,
  /\bkits?\b/i,
  /\bnow (available|shipping)\b/i,
  /manufactured and (tested|working)/i,
];

export const HARDWARE_ALLOWED: { phrase: string; where: string; reason: string }[] = [
  { phrase: "pair a hub with the code the hub shows", where: "*", reason: "the Studio's pairing screen, which is built and has run only against a fake server (the claim says so)" },
  { phrase: "It pairs hubs and keeps accounts for the people who run it.", where: "/how-it-works/", reason: "the server, which is built" },
  { phrase: "Anyone can build, modify, manufacture and sell boards made from them.", where: "/hardware/", reason: "what the licence permits, not a statement that a board exists" },
  { phrase: "works on a real piano", where: "/roadmap/", reason: "the title of version 1, which states the goal and is not a claim" },
  { phrase: "works on a real piano", where: "/docs/roadmap/", reason: "the same title in the document" },
  { phrase: "Open hardware certification and a kit", where: "/roadmap/", reason: "an unticked version 3 item: a plan and not a claim" },
  { phrase: "Open hardware certification and a kit", where: "/docs/roadmap/", reason: "the same line in the document" },
];

// the wider rule. a sentence is flagged only when all three hold:
//  1. its subject is the hardware: "the hub" or "hubs", an LED bar, octave bar or light bar, "the bars" or an end bar when the
//     sentence is also about lights or keys, a hub board or circuit board or PCB, a kit or a prototype. a musical bar ("bar 12",
//     "two bars"), a quality bar ("set a bar"), a board in the sense of a budget, a unit of measure and a unit test are none of these
//  2. it has a verb of existing or working in the present or past tense (lights, works, ships, exists, sold, "has been made")
//  3. it has no word that makes it a plan, a design, a condition or a denial (designed, planned, will, not, to and similar)
// so "Our first hubs already light the keys on players' pianos at home" is flagged and "The hub is designed to light the next
// key" is not. the limits: it reads words and not meaning. a false sentence that uses a hedge word, another noun or another verb
// passes and a sentence about hardware in the passive or with the subject far from the verb may pass. it prefers to miss an
// odd sentence than to flag a true one, because a false flag stops the people who write the documents. it is a net and never a
// proof: a person reads every page
const HARDWARE_SUBJECT: RegExp[] = [
  /\b(the|our|a|first|these|those)?\s*hubs?\b/i,
  /\b(LED|octave|light) bars?\b/i,
  /\b(the|our|these) bars\b(?=[^.]*\b(LED|lights?|keys?|keyboards?)\b)|\bend bars?\b(?=[^.]*\b(LED|lights?|keys?|keyboards?)\b)/i,
  /\b(hub|circuit|first|our|printed circuit) boards?\b|\bPCBs?\b/i,
  /\b(kits?|prototypes?)\b/i,
];
// a verb of working counts only straight after the hardware noun (at most one adverb between): "hubs already light", "the bars
// now work". the noun "light" in "the hub's lights" or "light bars" is never a verb. a few phrases count anywhere in the
// sentence: already, currently, sold, installed, "at home", "in homes" and "has been made"
const NOUN = "(?:hubs?|(?:LED|octave|light|end) bars?|the bars|(?:hub|circuit|first|our|printed circuit) boards?|PCBs?|kits?|prototypes?)";
const ADJACENT = new RegExp(`\\b${NOUN}\\s+(?:(?:already|now|currently|also|really|all|even)\\s+)?(light|lights|lit|work|works|worked|run|runs|ran|ship|ships|shipped|exist|exists|existed|play|plays|sit|sits)\\b`, "i");
const ANYWHERE = /\b(already|currently|sold|sells?|installed|in use|in homes?|at home|(has|have) been (made|built|sent|sold|tested|used))\b/i;
const WORKS = { exec: (sentence: string): RegExpExecArray | null => ADJACENT.exec(sentence) ?? ANYWHERE.exec(sentence) };
const HEDGE = /\b(designed|design|designs|planned?|meant|intended|will|would|aims?|goals?|never|not|no|nothing|none|awaits?|draft|requirements?|future|if|when|once|until|unless|can be|could|should|must|needs?|wants?|roadmap|target|host-tested|simulat\w*|tested on a computer|whether)\b|\bto\b|\?/i;

export interface Flag {
  sentence: string;
  subject: string;
  verb: string;
}

export function presentTenseFlags(text: string): Flag[] {
  const out: Flag[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (sentence.length < 12 || HEDGE.test(sentence)) continue;
    const subject = HARDWARE_SUBJECT.map((re) => re.exec(sentence)).find((m) => m !== null);
    const verb = WORKS.exec(sentence);
    if (subject && verb) out.push({ sentence: sentence.trim(), subject: subject[0].trim(), verb: verb[1] ?? verb[0] });
  }
  return out;
}

export function presentTenseProblems(text: string): string[] {
  return presentTenseFlags(text).map(
    (f) => `a sentence that says the hardware works or exists (subject "${f.subject}", verb "${f.verb}"). Reword it with "is designed to" or "is meant to", or add its words to HARDWARE_ALLOWED in src/lib/guards.ts with a reason. The sentence: "${f.sentence}"`,
  );
}

export function hardwareProblems(where: string, text: string): string[] {
  const out: string[] = [];
  let rest = text;
  for (const a of HARDWARE_ALLOWED) if (a.where === where || a.where === "*") rest = rest.replaceAll(a.phrase, " ");
  for (const re of HARDWARE_FALSE) {
    const m = re.exec(rest);
    if (m) out.push(`a sentence that says hardware exists or ships: "${rest.slice(Math.max(0, m.index - 30), m.index + 40).trim()}"`);
  }
  return [...out, ...presentTenseProblems(rest)];
}

export function privateProblems(text: string): string[] {
  const out: string[] = [];
  for (const { why, pattern } of PRIVATE_NAMES) {
    const m = pattern.exec(text);
    if (m) out.push(`${why}: "${text.slice(Math.max(0, m.index - 20), m.index + 30).trim()}"`);
  }
  return out;
}
