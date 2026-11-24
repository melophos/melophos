import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// the repository root. the site reads the docs, the Studio's tokens, fonts and icons and the brand files from it
const ROOT = fileURLToPath(new URL("..", import.meta.url));
// the icons are imported from the Studio folder, which has its own node_modules. the alias makes the site use its own
// copy of the same package, so the site builds with only its own install
const PHOSPHOR = fileURLToPath(new URL("./node_modules/@phosphor-icons/core", import.meta.url));

// a static export: plain files any host can serve. no image service, no server and no source maps in the output.
// the webpack build is used because the Studio's icon module imports each svg with "?raw", which it handles directly
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  // no image is imported as a module, so the framework's image loader is off. it would otherwise take the Studio's
  // icons, which are imported as text
  images: { unoptimized: true, disableStaticImages: true },
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  outputFileTracingRoot: ROOT,
  experimental: { externalDir: true },
  // the licence list reads the installed packages at build time with node's own module loader
  serverExternalPackages: ["license-checker-rseidelsohn"],
  webpack(webpack) {
    webpack.module.rules.push({ resourceQuery: /raw/, type: "asset/source" });
    webpack.resolve.alias = { ...webpack.resolve.alias, "@phosphor-icons/core": PHOSPHOR };
    return webpack;
  },
};

export default config;
