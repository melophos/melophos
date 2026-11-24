// facts about the site in one place. a value the owner has to supply is a placeholder: it reads as a
// plain marked sentence in a development build and fails the production build (scripts/verify-dist.ts).
// there is no postal address on purpose: email reaches us about everything (see the privacy page and the terms).

export const SITE_URL = "https://melophos.com";
export const APP_URL = "https://app.melophos.com";
export const REPO_URL = "https://github.com/melophos/melophos";
export const REPO_BRANCH = "main";
export const CONTACT_EMAIL = "contact@melophos.com";
export const SECURITY_EMAIL = "security@melophos.com";

// the date the site's legal and accessibility text was last reviewed. change it with the text
export const REVIEWED = { iso: "2026-11-22", text: "22 November 2026" } as const;

// every placeholder starts with this marker, so one search finds them all
export const PLACEHOLDER_MARKER = "OWNER TO SUPPLY";

export interface Placeholder {
  id: string;
  what: string;
  // the real value goes here. while it is null the production build fails
  value: string | null;
  // the built pages that must show it (the marked sentence or the value) and the documents that carry the same marker.
  // verify-dist.ts fails the build when a listed page shows neither, so a placeholder row cannot be removed unnoticed
  pages: string[];
  docs: { file: string; text: string }[];
}

export const PLACEHOLDERS: Record<string, Placeholder> = {
  governingLaw: {
    id: "governingLaw",
    what: "the law that governs the terms of use and the courts that hear a dispute, chosen with a lawyer",
    value: "the law of England and Wales",
    pages: ["/terms/"],
    docs: [],
  },
  studioHost: {
    id: "studioHost",
    what: "the name of the host that serves the Studio's files and updates at app.melophos.com, which is not decided yet",
    value: null,
    pages: ["/privacy/"],
    docs: [],
  },
  legalPerson: {
    id: "legalPerson",
    what: "the name of the legal person responsible for the site and the project, as the privacy law requires",
    // the project is run by one person as an individual: there is no company or other organisation
    value: "Isaac Adjei, as an individual",
    pages: ["/privacy/", "/docs/community-privacy/", "/terms/", "/contact/"],
    docs: [],
  },
};

export function placeholder(id: keyof typeof PLACEHOLDERS): string {
  const p = PLACEHOLDERS[id];
  if (!p) throw new Error(`unknown placeholder ${String(id)}`);
  return p.value ?? `[${PLACEHOLDER_MARKER}: ${p.what}]`;
}

export const unfilledPlaceholders = (): Placeholder[] => Object.values(PLACEHOLDERS).filter((p) => p.value === null);

// each part of the path is percent-encoded, so a file name read from disk can only ever be a path on GitHub and
// never change the address it is part of
export const sourceUrl = (path: string, kind: "blob" | "tree" | "edit" = "blob"): string =>
  `${REPO_URL}/${kind}/${REPO_BRANCH}/${path.replace(/^\/+/, "").split("/").map((part) => encodeURIComponent(part)).join("/")}`;
