// registers the service worker and tells the interface when a new version is waiting. a new version never takes over by
// itself: the player chooses and the choice is refused while a piece is running. nothing here runs in development.
import { useSyncExternalStore } from "react";

interface State {
  // a new version has installed and is waiting
  waiting: ServiceWorker | null;
  // the app has been saved for offline use by an installed worker
  offlineReady: boolean;
  // a piece is playing or counting in, so an update would break it
  practising: boolean;
  // another tab of the Studio has a piece running. an update restarts every tab, so it waits for that one too
  othersPractising: boolean;
  online: boolean;
}

let state: State = { waiting: null, offlineReady: false, practising: false, othersPractising: false, online: typeof navigator === "undefined" ? true : navigator.onLine };
const listeners = new Set<() => void>();

function set(change: Partial<State>): void {
  state = { ...state, ...change };
  for (const l of listeners) l();
}

export function useAppState(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

// the tabs of the Studio tell each other whether a piece is running, because a new version takes over every one of them
const TAB = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());

// what the other tabs last said. a tab that says "playing" and then vanishes must not block an update for ever, so what it
// said counts only while it keeps saying it: a heartbeat every two seconds and it stops counting after six
export const HEARTBEAT_MS = 2000;
export const PEER_TTL_MS = 6000;

export class PeerTable {
  private readonly seen = new Map<string, { practising: boolean; at: number }>();

  heard(id: string, practising: boolean, now: number): void {
    this.seen.set(id, { practising, at: now });
  }

  forget(id: string): void {
    this.seen.delete(id);
  }

  anyPlaying(now: number): boolean {
    for (const [id, p] of this.seen) {
      if (now - p.at > PEER_TTL_MS) this.seen.delete(id);
      else if (p.practising) return true;
    }
    return false;
  }
}

const peers = new PeerTable();
let channel: BroadcastChannel | null = null;
let reloadPending = false;
// the page reload, replaceable so a test can watch it
let reload: () => void = () => location.reload();
export const __setReload = (fn: () => void): void => {
  reload = fn;
};

function tell(extra: Record<string, unknown> = {}): void {
  channel?.postMessage({ from: TAB, practising: state.practising, ...extra });
}

function recount(): void {
  const playing = peers.anyPlaying(Date.now());
  if (playing !== state.othersPractising) set({ othersPractising: playing });
}

function startTalking(): void {
  if (typeof BroadcastChannel === "undefined" || channel) return;
  channel = new BroadcastChannel("melophos-studio-tabs");
  channel.onmessage = (e: MessageEvent<{ from: string; practising: boolean; hello?: boolean; bye?: boolean }>) => {
    if (!e.data || e.data.from === TAB) return;
    if (e.data.bye) peers.forget(e.data.from);
    else peers.heard(e.data.from, e.data.practising === true, Date.now());
    if (e.data.hello) tell();
    recount();
  };
  channel.postMessage({ from: TAB, practising: state.practising, hello: true });
  // a heartbeat while a piece is running and a sweep that lets go of tabs that have gone quiet
  setInterval(() => {
    if (state.practising) tell();
    recount();
  }, HEARTBEAT_MS);
  // a goodbye when this tab is hidden or closed, so the others do not wait for it
  const bye = (): void => tell({ practising: false, bye: true });
  window.addEventListener("pagehide", bye);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) bye();
    else tell();
  });
}

export const setPractising = (practising: boolean): void => {
  if (state.practising === practising) return;
  set({ practising });
  tell();
  // an update that arrived while this tab was playing waits until the piece stops
  if (!practising && reloadPending) {
    reloadPending = false;
    reload();
  }
};

// a new version has taken over this tab. the page restarts only when no piece is running in it
export function onControllerChange(): void {
  if (state.practising) reloadPending = true;
  else reload();
}

export function register(): void {
  startTalking();
  window.addEventListener("online", () => set({ online: true }));
  window.addEventListener("offline", () => set({ online: false }));
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const had = navigator.serviceWorker.controller !== null;
  void navigator.serviceWorker.register("/sw.js").then((registration) => {
    if (!registration) return;
    const watch = (worker: ServiceWorker | null): void => {
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed") {
          // with no controller this is the first install and the app is now saved. with one it is an update that waits
          if (navigator.serviceWorker.controller) set({ waiting: worker });
          else set({ offlineReady: true });
        }
      });
    };
    if (registration.waiting && navigator.serviceWorker.controller) set({ waiting: registration.waiting });
    else if (registration.active && !registration.installing) set({ offlineReady: true });
    // a new build is looked for each time the app comes back to the front, as well as on every page load
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) void registration.update().catch(() => undefined);
    });
    watch(registration.installing);
    registration.addEventListener("updatefound", () => watch(registration.installing));
  });
  // when the new worker takes over the page is reloaded once, so the old scripts and the new files never mix
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!had || reloading) return;
    reloading = true;
    onControllerChange();
  });
}

// the player asked to update. refused while a piece is running
export function applyUpdate(): boolean {
  if (state.practising || state.othersPractising || !state.waiting) return false;
  state.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}
