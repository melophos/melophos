// the version of the scoring engine as this build carries it: a short hash of the WebAssembly module itself. the package's
// own version number has not moved while the engine's judgement changed several times, the bytes cannot lie. personal bests
// are kept with this and are compared only with others from the same one
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

export function engineVersion(root: string): string {
  const path = `${root}/node_modules/@melophos/core/pkg/melophos_core_wasm_bg.wasm`;
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12) : "unknown";
}
