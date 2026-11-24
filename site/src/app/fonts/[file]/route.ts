// the font licence texts, served from the Studio's font folder at build time so the site keeps no copy
import { readRepo } from "../../../lib/repo.ts";

export const dynamic = "force-static";
export const dynamicParams = false;

const FONT_LICENCES = ["OFL-AtkinsonHyperlegibleNext.txt", "OFL-AtkinsonHyperlegibleMono.txt", "OFL-MelophosMusicSigns-from-Bravura.txt"] as const;

export function generateStaticParams() {
  return FONT_LICENCES.map((file) => ({ file }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!(FONT_LICENCES as readonly string[]).includes(file)) return new Response("not found", { status: 404 });
  return new Response(readRepo(`studio/src/styles/fonts/${file}`), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
