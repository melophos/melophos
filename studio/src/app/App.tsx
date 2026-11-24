import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import { useRoute } from "./router";
import { updateSettings, useSettings } from "./settings";
import { Icon, Link, Segmented } from "./ui";
import { applyUpdate, useAppState } from "./update";
const About = lazy(() => import("./views/About").then((m) => ({ default: m.About })));
const Devices = lazy(() => import("./views/Devices").then((m) => ({ default: m.Devices })));
const Diagnostics = lazy(() => import("./views/Diagnostics").then((m) => ({ default: m.Diagnostics })));
const Library = lazy(() => import("./views/Library").then((m) => ({ default: m.Library })));
const Piece = lazy(() => import("./views/Piece").then((m) => ({ default: m.Piece })));
import { Practise } from "./views/Practise";
import { Progress } from "./views/Progress";
const Bests = lazy(() => import("./views/Bests").then((m) => ({ default: m.Bests })));
const Settings = lazy(() => import("./views/Settings").then((m) => ({ default: m.Settings })));
import { Start } from "./views/Start";
import { SONGS } from "../songs";
import { loadLibrary, midi } from "./runtime";

// one view that fails to load or to draw must not blank the whole app. the header and the menu stay and the player is told
// plainly what happened and given a way on
class ViewBoundary extends Component<{ children: ReactNode; resetKey: string }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidUpdate(previous: { resetKey: string }): void {
    // moving to another view gives it a fresh try
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="panel" role="alert" data-testid="view-failed">
        <h1>This page could not be shown</h1>
        <p>Something went wrong while loading it. This can happen when the connection drops part way through loading. Your record and settings are safe.</p>
        <div className="actions">
          <button type="button" className="button-primary" onClick={() => location.reload()}>
            Reload the Studio
          </button>
          <Link to={[]}>Go to the start</Link>
        </div>
      </section>
    );
  }
}

const NAV = [
  { to: ["library"], label: "Library", key: "library" },
  { to: ["progress"], label: "Progress", key: "progress" },
  { to: ["bests"], label: "Bests", key: "bests" },
  { to: ["devices"], label: "Devices", key: "devices" },
  { to: ["settings"], label: "Settings", key: "settings" },
] as const;

// banners for what the player should know: an update is waiting, the app is saved for offline use or the device is offline.
// each says what is true and what to do and an update never starts by itself
function Banners({ practising }: { practising: boolean }): ReactNode {
  const app = useAppState();
  const [dismissed, setDismissed] = useState(false);
  return (
    <div className="banners">
      {app.waiting ? (
        <p className="banner" role="status" data-testid="update-banner">
          <Icon name="download" />
          <span>
            A new version of the Studio is ready. {app.practising ? "Finish or pause your piece first, then you can update." : app.othersPractising ? "Another tab of the Studio has a piece running. Finish or pause it there first, because updating restarts every tab." : "Updating restarts the app in every tab. Your record and settings stay."}
          </span>
          <button type="button" disabled={app.practising || app.othersPractising} onClick={() => applyUpdate()}>
            Update now
          </button>
        </p>
      ) : null}
      {!app.online ? (
        <p className="banner" role="status" data-testid="offline-banner" data-quiet="true">
          <Icon name="info" />
          You are offline. Practice, the library and your record all work. Reading your own server needs a network.
        </p>
      ) : null}
      {app.offlineReady && !dismissed && !practising ? (
        <p className="banner banner-toast" role="status" data-testid="offline-ready" data-quiet="true">
          <Icon name="tick" />
          <span>The Studio is saved on this device and works with no network.</span>
          <button type="button" onClick={() => setDismissed(true)}>
            Dismiss
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function App(): ReactNode {
  const route = useRoute();
  const settings = useSettings();
  const [first = "", second = ""] = route.parts;
  useEffect(() => {
    void loadLibrary();
  }, []);
  useEffect(() => {
    midi.only = settings.midiInput || null;
  }, [settings.midiInput]);
  const practising = first === "practise" || first === "try" || first === "game";

  // the focus moves to the main region on a change of view
  useEffect(() => {
    document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true });
  }, [first, second]);

  // the page title follows the main heading. a view that loads on demand draws its heading after this component, so
  // the title is set whenever the heading appears or changes and not only when the address changes
  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const name = (): void => {
      const heading = main.querySelector("h1")?.textContent?.trim();
      const title = !heading || heading === "MELOPHOS Studio" ? "MELOPHOS Studio" : `${heading} - MELOPHOS Studio`;
      if (document.title !== title) document.title = title;
    };
    name();
    const watch = new MutationObserver(name);
    watch.observe(main, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, []);

  let view: ReactNode;
  switch (first) {
    case "":
      view = <Start />;
      break;
    case "try":
      view = <Practise songId={route.query.get("piece") ?? SONGS[0]!.id} query={route.query} trial />;
      break;
    case "game":
      view = <Practise songId={second} query={route.query} trial={false} game />;
      break;
    case "bests":
      view = <Bests />;
      break;
    case "practise":
      view = <Practise songId={second} query={route.query} trial={false} />;
      break;
    case "library":
      view = <Library route={route} />;
      break;
    case "piece":
      view = <Piece id={second} />;
      break;
    case "progress":
      view = <Progress pieceId={second || null} />;
      break;
    case "devices":
      view = <Devices />;
      break;
    case "settings":
      view = <Settings section={second} />;
      break;
    case "about":
      view = <About />;
      break;
    case "diagnostics":
      view = <Diagnostics />;
      break;
    default:
      view = (
        <>
          <h1>That page is not here</h1>
          <p>
            <Link to={[]}>Go to the start</Link>
          </p>
        </>
      );
  }

  return (
    <div className={practising ? "shell shell-practice" : "shell"} data-controls={settings.controls}>
      <a className="skip-link" href="#main">
        Skip to the content
      </a>
      <header className="shell-top">
        <Link to={[]} className="brand">
          <img src="/melophos-mark.svg" alt="" width={40} height={40} />
          <span>MELOPHOS Studio</span>
        </Link>
        <Segmented
          label="Theme"
          hideLabel
          value={settings.theme}
          onChange={(theme) => updateSettings({ theme })}
          options={[
            { value: "system", label: "System", icon: "system" },
            { value: "light", label: "Light", icon: "sun" },
            { value: "dark", label: "Dark", icon: "moon" },
          ]}
        />
      </header>
      {practising ? null : (
        <nav className="shell-nav" aria-label="Main">
          <ul>
            {NAV.map((n) => (
              <li key={n.key}>
                <Link to={[...n.to]} current={first === n.key}>
                  {n.key === "settings" ? <Icon name="settings" /> : null}
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <main id="main" tabIndex={-1} className="shell-main">
        <ViewBoundary resetKey={route.parts.join("/")}>
          <Suspense fallback={<p className="muted">Loading.</p>}>{view}</Suspense>
        </ViewBoundary>
      </main>
      <Banners practising={practising} />
      {practising ? null : (
        <footer className="shell-foot">
          <Link to={["about"]}>About and licences</Link>
        </footer>
      )}
    </div>
  );
}
