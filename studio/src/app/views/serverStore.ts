// sessions read from the player's own server live for this visit only and are never written to storage
import { useSyncExternalStore } from "react";
import type { ServerSession } from "../api-source";
import { SERVER_CHANGED } from "../settings";

let current: ServerSession[] = [];
const listeners = new Set<() => void>();

export const serverStore = {
  set(sessions: ServerSession[]): void {
    current = sessions;
    for (const l of listeners) l();
  },
  remove(id: string): void {
    current = current.filter((x) => x.id !== id);
    for (const l of listeners) l();
  },
  get: (): ServerSession[] => current,
};

export function useServerSessions(): ServerSession[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    serverStore.get,
    serverStore.get,
  );
}

if (typeof window !== "undefined") window.addEventListener(SERVER_CHANGED, () => serverStore.set([]));
