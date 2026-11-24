// the link to the player's own server as the interface sees it: the saved address from Settings and a token that lives in
// memory only. the token belongs to the address that issued it. it is never written to storage, it is never sent anywhere
// else and it is dropped the moment the address changes.
import { useSyncExternalStore } from "react";
import type { Link } from "./server";
import { SERVER_CHANGED, useSettings } from "./settings";

let held: { base: string; token: string } | null = null;
const listeners = new Set<() => void>();

// the token for one address or null. a token issued by another address is never handed out
export function tokenFor(base: string): string | null {
  return held && held.base === base ? held.token : null;
}

export function setToken(next: string | null, base: string | null = null): void {
  const token = next?.trim();
  held = token && base ? { base, token } : null;
  for (const l of listeners) l();
}

// called when the saved address changes: the old server's token and everything read from it go
export function forgetServer(): void {
  setToken(null);
}

export function useToken(base: string): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => tokenFor(base),
    () => tokenFor(base),
  );
}

// null while no server is set: every server feature checks this and shows nothing
export function useLink(): Link | null {
  const { serverUrl } = useSettings();
  const token = useToken(serverUrl);
  return serverUrl ? { base: serverUrl, token } : null;
}

export const signedIn = (link: Link | null): boolean => Boolean(link?.token);

if (typeof window !== "undefined") window.addEventListener(SERVER_CHANGED, forgetServer);
