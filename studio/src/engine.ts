// which build of the scoring engine this is. see scripts/engine-version.ts
export const ENGINE_VERSION: string = typeof __ENGINE_VERSION__ === "string" ? __ENGINE_VERSION__ : "unknown";
