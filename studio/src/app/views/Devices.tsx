// the connection flow with every state, an activity light and input calibration.
// the browser's permission prompt only appears when the player presses the button, after a plain sentence that says what
// will be asked and why.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Synth } from "../../audio";
import { medianOffset } from "../../calibration";
import { explain } from "../../midi-connection";
import { noteLabel } from "../../notes";
import { midi, useMidiState } from "../runtime";
import { updateSettings, useSettings } from "../settings";
import { Confirm, Icon, Link, formatDateTime } from "../ui";
import { hubNotices, type HubStatus } from "../../hub";
import { listDevices, normaliseCode, pairHub, removeDevice, type HubRow } from "../server";
import { signedIn, useLink } from "../serverLink";

const synth = new Synth();
const CLICKS = 8;
const GAP_MS = 750;

export function Devices(): ReactNode {
  const state = useMidiState();
  const settings = useSettings();
  const [active, setActive] = useState(false);
  const [lastNote, setLastNote] = useState<string | null>(null);
  const firefox = /firefox/i.test(navigator.userAgent);
  const e = explain(state, { firefox });

  useEffect(() => {
    midi.onActivity = setActive;
    midi.onNote = (n) => {
      if (n.on) setLastNote(noteLabel(n.note, { naming: settings.naming, octave: settings.octave, accidental: settings.accidental }));
    };
    return () => {
      midi.onActivity = null;
      midi.onNote = null;
    };
  }, [settings.naming, settings.octave, settings.accidental]);

  return (
    <>
      <h1>Devices</h1>
      <section className="panel" aria-labelledby="conn" data-testid="connection">
        <h2 id="conn">MIDI keyboard</h2>
        <p className="state-line" data-kind={e.problem ? "problem" : "ok"} data-state={state.kind}>
          <Icon name={e.problem ? "warning" : state.kind === "connected" ? "tick" : "usb"} />
          <strong>{e.headline}</strong>
        </p>
        <p>{e.detail}</p>
        {e.action ? (
          <button type="button" className="button-primary" onClick={() => void midi.connect()} disabled={state.kind === "asking"}>
            <Icon name="usb" />
            {e.action}
          </button>
        ) : null}
        <p className="activity" data-active={active ? "true" : "false"}>
          <span className="activity-light" aria-hidden="true" />
          <span>{active ? "A note is held" : "Idle"}</span>
        </p>
        {state.kind === "connected" && state.names.length > 1 ? (
          <label className="stack-label">
            <span className="field-label">Listen to</span>
            <select value={settings.midiInput} onChange={(e) => updateSettings({ midiInput: e.target.value })} data-testid="midi-input">
              <option value="">Every connected keyboard</option>
              {state.names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {state.kind === "connected" ? <p>{lastNote ? `Last key: ${lastNote}.` : "Press any key to check it."}</p> : null}
      </section>
      <Calibration />
      <PairHub />
      <HubStatusPanel status={null} />
      <section className="panel" aria-labelledby="ipad">
        <h2 id="ipad">If this browser has no MIDI</h2>
        <p>The on-screen keys and your computer keyboard work in every browser. A hub connected to your keyboard will reach the Studio in a later release.</p>
      </section>
      {settings.calibrationMs === null ? null : <p className="muted">Saved calibration: {settings.calibrationMs} ms.</p>}
    </>
  );
}

// tap along with eight clicks. the clicks are placed on the audio clock ahead of time, so no timer is involved
function Calibration(): ReactNode {
  const settings = useSettings();
  const [phase, setPhase] = useState<"idle" | "running" | "done" | "failed">("idle");
  const [result, setResult] = useState<number | null>(null);
  const clicks = useRef<number[]>([]);
  const taps = useRef<number[]>([]);
  const finishAt = useRef(0);

  useEffect(() => {
    if (phase !== "running") return;
    let frame = 0;
    const onTap = (t: number): void => {
      taps.current.push(t);
    };
    const key = (ev: KeyboardEvent): void => {
      if (!ev.repeat && (ev.code.startsWith("Key") || ev.code === "Space" || ev.code === "Enter")) onTap(ev.timeStamp);
    };
    window.addEventListener("keydown", key);
    midi.onNote = (n) => {
      if (n.on) onTap(n.atMs);
    };
    const watch = (ts: number): void => {
      if (ts > finishAt.current) {
        const m = medianOffset(taps.current, clicks.current);
        setResult(m);
        setPhase(m === null ? "failed" : "done");
        return;
      }
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", key);
      midi.onNote = null;
    };
  }, [phase]);

  const begin = async (): Promise<void> => {
    if (!(await synth.unlock())) {
      setPhase("failed");
      return;
    }
    const now = performance.now();
    taps.current = [];
    clicks.current = Array.from({ length: CLICKS }, (_, i) => now + 1200 + i * GAP_MS);
    for (const t of clicks.current) synth.click(synth.at(t, now), false);
    finishAt.current = (clicks.current.at(-1) ?? now) + 600;
    setResult(null);
    setPhase("running");
  };

  return (
    <section className="panel" aria-labelledby="cal" data-testid="calibration">
      <h2 id="cal">Input calibration</h2>
      <p>Tap along with eight clicks on any key of your keyboard, on the computer keyboard or on the button. The Studio takes the average gap off every note you play from then on, so the timing it reports is yours and not your equipment's.</p>
      <div className="actions">
        <button type="button" onClick={() => void begin()} disabled={phase === "running"}>
          <Icon name="metronome" />
          {phase === "running" ? "Listening for your taps" : "Start calibration"}
        </button>
        <button
          type="button"
          className="tap"
          disabled={phase !== "running"}
          onPointerDown={(e) => {
            taps.current.push(e.timeStamp);
          }}
        >
          Tap here
        </button>
      </div>
      {phase === "done" && result !== null ? (
        <p>
          Measured a gap of {result} ms.{" "}
          <button type="button" onClick={() => updateSettings({ calibrationMs: result })}>
            Save it
          </button>
        </p>
      ) : null}
      {phase === "failed" ? <p className="note">That did not work. Either the browser has no sound or fewer than five taps landed near a click. Try again.</p> : null}
      {settings.calibrationMs !== null ? (
        <p>
          A calibration of {settings.calibrationMs} ms is saved.{" "}
          <button type="button" onClick={() => updateSettings({ calibrationMs: null })}>
            Remove it
          </button>
        </p>
      ) : (
        <p className="muted">Without a calibration the Studio shows no timing figure.</p>
      )}
    </section>
  );
}

// typing the code the hub shows. it appears only when a server is linked, because pairing is a call to the player's own
// server. it is built from the server's API document and has not run against a real hub
function PairHub(): ReactNode {
  const link = useLink();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [hubs, setHubs] = useState<HubRow[] | null>(null);
  const [hubsError, setHubsError] = useState<string | null>(null);
  const refresh = async (): Promise<void> => {
    if (!link) return;
    const r = await listDevices(link);
    setHubsError(r.ok ? null : r.reason);
    if (r.ok) setHubs(r.value);
  };
  useEffect(() => {
    if (link?.token) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.token, link?.base]);
  if (!link) return null;
  const pair = async (): Promise<void> => {
    setBusy(true);
    const r = await pairHub(link, code, name || null);
    setBusy(false);
    if (r.ok) {
      setCode("");
      setMessage(`Paired. Your server now lists ${r.value.name}, claimed by the account you are signed in with.`);
      void refresh();
    } else setMessage(r.reason);
  };
  return (
    <section className="panel" aria-labelledby="pair" data-testid="pair">
      <h2 id="pair">Pair a hub</h2>
      <p>A new hub shows a code of 8 characters on its lights. Type it here to add the hub to your own server. The code is sent only to your server at {link.base}.</p>
      {signedIn(link) ? (
        <>
          <label className="stack-label">
            <span className="field-label">Code from the hub</span>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} data-testid="pair-code" />
          </label>
          <label className="stack-label">
            <span className="field-label">Name for the hub (optional)</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="off" />
          </label>
          <button type="button" onClick={() => void pair()} disabled={busy || normaliseCode(code).length < 4} data-testid="pair-button">
            Pair this hub
          </button>
        </>
      ) : (
        <p>
          You need to be signed in to your server first. <Link to={["settings", "server"]}>Sign in</Link>
        </p>
      )}
      {hubsError ? (
        <div className="note" role="alert" data-testid="hubs-failed">
          <p>
            <Icon name="warning" /> The list of hubs on your account could not be loaded. {hubsError}
          </p>
          <button type="button" onClick={() => void refresh()}>
            Try again
          </button>
        </div>
      ) : null}
      {hubs && hubs.length > 0 ? (
        <>
          <h3>Hubs on your account</h3>
          <p>If you see a hub here that you did not pair, remove it at once. Removing a hub takes it off your account and deletes its sessions. The hub itself also shows who claimed it and can undo a claim within 15 minutes.</p>
          <ul className="rows" data-testid="hub-list">
            {hubs.map((h) => (
              <li key={h.id}>
                <div className="row">
                  <span className="row-main">
                    <span className="row-title">{h.name}</span>
                    <span className="muted">{h.pairedAt ? `Claimed by your account on ${formatDateTime(h.pairedAt)}` : "Not yet claimed"}</span>
                  </span>
                  <Confirm
                    trigger={`Remove ${h.name}`}
                    confirm="Yes, remove this hub"
                    what={`This takes ${h.name} off your account and deletes every practice session it stored on your server. The hub will need to pair again.`}
                    onConfirm={async () => {
                      const r = await removeDevice(link, h.id);
                      setMessage(r.ok ? `Removed ${h.name}.` : r.reason);
                      await refresh();
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p role="status" data-testid="pair-message">
        {message}
      </p>
      <p className="muted">Not yet tried with a real hub.</p>
    </section>
  );
}

// the place a hub's own report appears. no hub talks to the Studio yet, so the status is always empty today and the panel
// shows nothing. built from firmware/docs and untested with hardware
function HubStatusPanel({ status }: { status: HubStatus | null }): ReactNode {
  const notices = hubNotices(status);
  if (notices.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="hub-status" data-testid="hub-status">
      <h2 id="hub-status">Hub</h2>
      {notices.map((n) => (
        <div key={n.headline}>
          <p className="state-line" data-kind={n.problem ? "problem" : "ok"}>
            <Icon name="warning" />
            <strong>{n.headline}</strong>
          </p>
          <p>{n.detail}</p>
        </div>
      ))}
    </section>
  );
}
