// the head of every page: title, description, canonical address, the social card and the feed. one function, so no
// page can forget a part of it
import type { Metadata } from "next";
import { SITE_URL } from "../site.config.ts";
import { socialCardFor } from "./social.ts";

export interface PageHead {
  title: string;
  description: string;
  // the page's own address, with the trailing slash the site uses
  path: string;
  // set for pages that should not be listed, such as the not-found page
  noindex?: boolean;
}

export const SOCIAL_IMAGE = "/brand/melophos-social-preview.png";
export const SOCIAL_ALT =
  "The MELOPHOS mark on a dark card: three piano keys with the middle one lit amber and a glowing light above it. Beside it the words MELOPHOS, Song made visible and Open instrument learning platform";

export const fullTitle = (title: string, path: string): string => (path === "/" ? title : `${title} | MELOPHOS`);

export function pageMeta({ title, description, path, noindex = false }: PageHead): Metadata {
  const canonical = new URL(path, SITE_URL).toString();
  const full = fullTitle(title, path);
  // a main page has a card of its own. every other page shares the project's card
  const card = socialCardFor(path);
  const image = card ? { url: new URL(`/social/${card.slug}.png`, SITE_URL).toString(), alt: card.alt } : { url: new URL(SOCIAL_IMAGE, SITE_URL).toString(), alt: SOCIAL_ALT };
  return {
    metadataBase: new URL(SITE_URL),
    title: { absolute: full },
    description,
    ...(noindex ? { robots: { index: false } } : {}),
    alternates: {
      ...(noindex ? {} : { canonical }),
      types: { "application/atom+xml": [{ url: "/changelog.xml", title: "MELOPHOS changelog" }] },
    },
    openGraph: {
      siteName: "MELOPHOS",
      type: "website",
      title: full,
      description,
      ...(noindex ? {} : { url: canonical }),
      images: [{ ...image, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image" },
    icons: { icon: [{ url: "/brand/melophos-mark.svg", type: "image/svg+xml" }] },
  };
}
