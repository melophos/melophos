// the brand files the pages use, served from assets/brand at build time so the site keeps no copy
import { readFileSync } from "node:fs";
import { inRepo } from "../../../lib/repo.ts";

export const dynamic = "force-static";
export const dynamicParams = false;

const TYPES: Record<string, string> = {
  "melophos-mark.svg": "image/svg+xml",
  "melophos-wordmark-light.svg": "image/svg+xml",
  "melophos-wordmark-dark.svg": "image/svg+xml",
  "melophos-social-preview.png": "image/png",
};

export function generateStaticParams() {
  return Object.keys(TYPES).map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const type = TYPES[file];
  if (!type) return new Response("not found", { status: 404 });
  return new Response(readFileSync(inRepo(`assets/brand/${file}`)), { headers: { "Content-Type": type } });
}
