// the card shown when a page is shared: its file, the words on it and which key is lit. scripts/social-images.ts draws
// them, the head of each page points to its own and the build check fails when a listed card is missing
export interface SocialCard {
  path: string;
  slug: string;
  title: string;
  lit: number;
  alt: string;
}

const card = (path: string, slug: string, title: string, lit: number): SocialCard => ({
  path,
  slug,
  title,
  lit,
  alt: `The words ${title} in white on black beside the MELOPHOS wordmark, above a row of piano keys with one key and the light above it in amber.`,
});

export const SOCIAL_CARDS: SocialCard[] = [
  card("/", "home", "Song made visible: learn the piano with light", 9),
  card("/how-it-works/", "how-it-works", "How MELOPHOS works", 4),
  card("/hardware/", "hardware", "The MELOPHOS hardware, designed", 12),
  card("/accessibility/", "accessibility", "Accessibility in MELOPHOS", 7),
  card("/roadmap/", "roadmap", "The MELOPHOS roadmap", 15),
  card("/docs/", "docs", "The MELOPHOS documentation", 2),
  card("/about/", "about", "About MELOPHOS", 10),
  card("/contact/", "contact", "Contact MELOPHOS", 6),
];

export const socialCardFor = (path: string): SocialCard | undefined => SOCIAL_CARDS.find((c) => c.path === path);
