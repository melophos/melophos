// a small router over the address hash, so the built app is plain static files that any host can serve with no rewrite
// rules. the mode, hand, loop bars and speed live in the address, so a practice setup can be bookmarked and shared.
import { useSyncExternalStore } from "react";

export interface Route {
  // the path split into parts, with no empty parts: "#/practise/twinkle?mode=rhythm" gives ["practise", "twinkle"]
  parts: string[];
  query: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path = "", search = ""] = raw.split("?", 2) as [string, string?];
  const parts = path.split("/").filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  return { parts, query: new URLSearchParams(search) };
}

export function hrefFor(parts: string[], query?: Record<string, string | number | null | undefined>): string {
  const path = `/${parts.map(encodeURIComponent).join("/")}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
  const search = q.toString();
  return `#${path}${search ? `?${search}` : ""}`;
}

export function navigate(parts: string[], query?: Record<string, string | number | null | undefined>, replace = false): void {
  const href = hrefFor(parts, query);
  if (replace) history.replaceState(null, "", href);
  else location.hash = href;
  // replaceState does not raise hashchange, so tell the listeners
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
}

let cached: { hash: string; route: Route } | null = null;
function snapshot(): Route {
  if (!cached || cached.hash !== location.hash) cached = { hash: location.hash, route: parseHash(location.hash) };
  return cached.route;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener("hashchange", l);
      return () => window.removeEventListener("hashchange", l);
    },
    snapshot,
    snapshot,
  );
}

// a whole number from the address within bounds or the fallback
export function intParam(query: URLSearchParams, key: string, min: number, max: number): number | null {
  const raw = query.get(key);
  if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}
