import { useEffect, useRef, useState, type ReactNode } from "react";
import { Synth } from "../../audio";
import { availability, sentenceFor, speak, voices } from "../../speech";
import { noteLabel, spokenName } from "../../notes";
import { MAX_IMPORT_BYTES, exportJson, parseExport, persistenceStatus, requestPersistence, wipeEverything } from "../store";
import { checkBase, readServerSessions } from "../api-source";
import { accountUsage, check, deleteAccount, signIn, signOutEverywhere, usageSentence } from "../server";
import { forgetServer, setToken, useLink } from "../serverLink";
import { forgetSettings, resetSettings, updateSettings, useSettings } from "../settings";
import { forgetLibrary, readBests, useSessions } from "../runtime";
import { Confirm, Icon, Link, Range, Segmented, Toggle } from "../ui";
import { serverStore } from "./serverStore";

const synth = new Synth();

const SECTIONS = [
  { id: "display", label: "Display" },
  { id: "notes", label: "Notes" },
  { id: "sound", label: "Sound" },
  { id: "input", label: "Input" },
  { id: "data", label: "Data" },
  { id: "server", label: "Your server" },
] as const;

export function Settings({ section }: { section: string }): ReactNode {
  const current = SECTIONS.find((s) => s.id === section)?.id ?? "display";
  return (
    <>
      <h1>Settings</h1>
      <nav aria-label="Settings sections" className="subnav">
        <ul>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <Link to={["settings", s.id]} current={s.id === current}>
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {current === "display" ? <Display /> : null}
      {current === "notes" ? <Notes /> : null}
      {current === "sound" ? <Sound /> : null}
      {current === "input" ? <Input /> : null}
      {current === "data" ? <Data /> : null}
      {current === "server" ? <ServerSettings /> : null}
    </>
  );
}

function Display(): ReactNode {
  const s = useSettings();
  return (
    <section className="stack" aria-label="Display">
      <Segmented
        label="Theme"
        value={s.theme}
        onChange={(theme) => updateSettings({ theme })}
        options={[
          { value: "system", label: "System", icon: "system" },
          { value: "light", label: "Light", icon: "sun" },
          { value: "dark", label: "Dark", icon: "moon" },
        ]}
      />
      <Segmented label="Contrast" value={s.contrast} onChange={(contrast) => updateSettings({ contrast })} options={[{ value: "standard", label: "Standard" }, { value: "more", label: "More" }]} />
      <div className="panel">
        <Segmented label="Distance" value={s.distance} onChange={(distance) => updateSettings({ distance })} options={[{ value: "near", label: "Near" }, { value: "stand", label: "Stand" }, { value: "far", label: "Far" }]} />
        <p>Near suits a laptop within reach. Stand suits a tablet on a music stand. Far suits a screen across the room. It scales the text, the lights and the buttons in the practice view together.</p>
        <p className="distance-sample" data-testid="distance-sample">
          Sit where you play. Can you read this note?
          <span className="distance-note">C4</span>
        </p>
      </div>
      <Segmented label="Controls on the" value={s.controls} onChange={(controls) => updateSettings({ controls })} options={[{ value: "right", label: "Right" }, { value: "left", label: "Left" }]} />
      <Segmented label="Motion" value={s.motion} onChange={(motion) => updateSettings({ motion })} options={[{ value: "system", label: "Follow the device" }, { value: "reduce", label: "Reduce" }]} />
      <p className="muted">With less motion the falling notes become a still page for each phrase and nothing slides or fades.</p>
      <Toggle label="Show the beat indicator" isSelected={s.beatIndicator} onChange={(beatIndicator) => updateSettings({ beatIndicator })} hint="Four boxes with the current beat filled. It never flashes faster than two and a half beats a second." />
      <Toggle label="Light sensitivity" isSelected={s.lightSensitivity} onChange={(lightSensitivity) => updateSettings({ lightSensitivity })} hint="Keeps every light steady and turns off any end of piece movement." />
      <button type="button" onClick={() => resetSettings()}>
        Reset every setting
      </button>
    </section>
  );
}

function Notes(): ReactNode {
  const s = useSettings();
  const o = { naming: s.naming, octave: s.octave, accidental: s.accidental };
  return (
    <section className="stack" aria-label="Notes">
      <Segmented label="Note names" value={s.naming} onChange={(naming) => updateSettings({ naming })} options={[{ value: "english", label: "C D E" }, { value: "german", label: "C D E with H" }, { value: "solfege", label: "Do Re Mi" }]} />
      <Segmented label="Middle C is" value={s.octave} onChange={(octave) => updateSettings({ octave })} options={[{ value: "c4", label: "C4" }, { value: "c3", label: "C3" }]} />
      <Segmented label="Black keys when a piece does not say" value={s.accidental} onChange={(accidental) => updateSettings({ accidental })} options={[{ value: "sharp", label: "Sharps" }, { value: "flat", label: "Flats" }]} />
      <Segmented label="Labels on the keys" value={s.labels} onChange={(labels) => updateSettings({ labels })} options={[{ value: "c", label: "C keys" }, { value: "white", label: "White keys" }, { value: "none", label: "None" }]} />
      <div className="panel">
        <h2>How it reads</h2>
        <p data-testid="naming-sample">
          Middle C is <strong>{noteLabel(60, o)}</strong>. The black key above it is <strong>{noteLabel(61, o)}</strong>. A screen reader says &quot;{spokenName(61, o)}&quot;.
        </p>
      </div>
    </section>
  );
}

// the voices the browser has. they arrive late in some browsers, so the list follows the browser's own announcement
function useVoiceList(): SpeechSynthesisVoice[] | null {
  const [list, setList] = useState(() => voices());
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const update = (): void => setList(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener("voiceschanged", update);
    update();
    return () => window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return list;
}

function Sound(): ReactNode {
  const s = useSettings();
  return (
    <section className="stack" aria-label="Sound">
      <Range label="Volume" value={Math.round(s.volume * 100)} onChange={(v) => updateSettings({ volume: v / 100 })} min={0} max={100} step={5} unit="%" />
      <Toggle label="Tone for on-screen and computer keys" isSelected={s.keySound} onChange={(keySound) => updateSettings({ keySound })} hint="A MIDI keyboard makes its own sound, so it never gets this tone." />
      <Toggle label="Metronome click" isSelected={s.metronome} onChange={(metronome) => updateSettings({ metronome })} hint="The first beat of the bar is higher." />
      <Toggle label="Sound for a wrong note" isSelected={s.wrongSound} onChange={(wrongSound) => updateSettings({ wrongSound })} hint="A short soft low tone. It is off by default because your instrument is already making sound." />
      <Toggle label="Speak the next note" isSelected={s.spoken} onChange={(spoken) => updateSettings({ spoken, speechOffered: true })} hint="Melody mode says each next note aloud, for example C sharp 4." />
      <p data-testid="voice-status">{sentenceFor(availability(useVoiceList(), s.onlineVoice))}</p>
      <Toggle label="Use an online voice" isSelected={s.onlineVoice} onChange={(onlineVoice) => updateSettings({ onlineVoice })} hint="Some voices work over the internet. With this on the words you hear spoken, which are note names, go to your browser's speech service. Off, only a voice on this device is used." />
      <button
        type="button"
        onClick={() => {
          void synth.unlock().then(() => {
            synth.setVolume(s.volume);
            synth.tone(69, synth.now(), 0.5);
            if (s.spoken) speak(spokenName(61, { naming: s.naming, octave: s.octave, accidental: s.accidental }), s.onlineVoice);
          });
        }}
      >
        <Icon name="volume" />
        Play a test tone
      </button>
    </section>
  );
}

function Input(): ReactNode {
  const s = useSettings();
  return (
    <section className="stack" aria-label="Input">
      <p>
        Keyboard connection and calibration are on <Link to={["devices"]}>Devices</Link>.
      </p>
      <Segmented label="Sustain pedal does" value={s.pedal} onChange={(pedal) => updateSettings({ pedal })} options={[{ value: "repeat", label: "Repeat the phrase" }, { value: "next", label: "Go to the next phrase" }]} />
      <div className="panel">
        <h2>Keys that work in the practice view</h2>
        <ul>
          <li>Space starts and pauses.</li>
          <li>Page Down or Right arrow goes to the next phrase. Page Up or Left arrow repeats this one. A Bluetooth page turner sends these.</li>
          <li>A to K, with W E T Y U above, play the notes. Z and X move the octave.</li>
          <li>On the on-screen keys the arrow keys move between keys and Space or Enter plays one.</li>
        </ul>
      </div>
    </section>
  );
}

function Data(): ReactNode {
  const { records, store, durable, reload } = useSessions();
  const fileInput = useRef<HTMLInputElement>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void persistenceStatus().then(setPersisted);
  }, []);

  const exportNow = async (): Promise<void> => {
    const blob = new Blob([exportJson(records, new Date(), await readBests())], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "melophos-studio-export.json";
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage(`Exported ${records.length} ${records.length === 1 ? "session" : "sessions"}.`);
  };

  const importFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setMessage("That file is larger than 20 MB, which is more than a Studio export holds.");
      return;
    }
    const parsed = parseExport(await file.text());
    if (!parsed.ok) {
      setMessage(parsed.reason);
      return;
    }
    try {
      // one transaction: it all goes in or none of it does, so a full disk cannot lose the record that is already here
      await store?.addMany(parsed.sessions, parsed.bests);
    } catch {
      setMessage("The record could not be saved, so nothing was changed. The browser may be out of space.");
      return;
    }
    reload();
    setMessage(`Imported ${parsed.sessions.length} ${parsed.sessions.length === 1 ? "session" : "sessions"}.${parsed.skipped ? ` ${parsed.skipped} could not be read and were skipped.` : ""}`);
  };

  const wipe = async (): Promise<void> => {
    setMessage("Deleting.");
    const report = await wipeEverything();
    forgetLibrary();
    forgetSettings();
    reload();
    setMessage(
      report.ok
        ? "Everything the Studio kept in this browser has been deleted and checked: the record, your pieces, your settings and the saved copy of the app. Reload the page to save the app for offline use again."
        : `Not everything could be deleted. ${report.remaining.join(" ")}`,
    );
  };

  return (
    <section className="stack" aria-label="Data">
      <div className="panel">
        <h2>Where your data is</h2>
        <p>
          Your practice record and settings are kept in this browser only. Nothing is sent anywhere. You hold {records.length} {records.length === 1 ? "session" : "sessions"}.
        </p>
        <p data-testid="persistence">
          {!durable ? "This browser blocked storage, so the record lasts until you close this tab. Export it to keep it." : persisted === true ? "The browser has promised to keep this data." : persisted === false ? "The browser may clear this data when space is short. Ask it to keep the data or export a copy." : "This browser cannot say whether it will keep the data. Export a copy now and then."}
        </p>
        {persisted === false ? (
          <button type="button" onClick={() => void requestPersistence().then(setPersisted)}>
            Ask the browser to keep my data
          </button>
        ) : null}
      </div>
      <div className="panel">
        <h2>Export and import</h2>
        <div className="actions">
          <button type="button" onClick={() => void exportNow()} disabled={records.length === 0}>
            <Icon name="download" />
            Export every session
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" />
            Import an export
          </button>
          <input ref={fileInput} type="file" accept="application/json,.json" hidden tabIndex={-1} onChange={(e) => void importFile(e.target.files?.[0])} />
        </div>
      </div>
      <div className="panel" data-kind="danger">
        <h2>Delete everything</h2>
        <Confirm
          trigger="Delete everything"
          confirm="Yes, delete everything"
          testId="delete-everything"
          what={`This deletes ${records.length} ${records.length === 1 ? "session" : "sessions"}, every imported piece, every setting, your calibration and the saved copy of the app from this browser. Export first if you want a copy.`}
          onConfirm={() => wipe()}
        />
      </div>
      <p role="status" data-testid="data-message">
        {message}
      </p>
    </section>
  );
}

// the optional link to the player's own server. nothing here is needed to use the Studio
function ServerSettings(): ReactNode {
  const s = useSettings();
  const link = useLink();
  const [address, setAddress] = useState(s.serverUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState("");
  const parsed = address.trim() === "" ? null : checkBase(address);
  const [usage, setUsage] = useState("");
  useEffect(() => {
    let live = true;
    setUsage("");
    if (link?.token) {
      void accountUsage(link).then((r) => {
        if (live) setUsage(r.ok ? usageSentence(r.value) : r.reason);
      });
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link?.token, link?.base]);

  const save = (): void => {
    if (address.trim() === "") {
      updateSettings({ serverUrl: "" });
      forgetServer();
      serverStore.set([]);
      setMessage("The Studio is not linked to any server.");
      return;
    }
    if (!parsed || !parsed.ok) {
      setMessage(parsed && !parsed.ok ? parsed.reason : "");
      return;
    }
    // a different server never gets the token of the old one and nothing read from the old one stays on screen
    if (parsed.base !== s.serverUrl) {
      forgetServer();
      serverStore.set([]);
    }
    updateSettings({ serverUrl: parsed.base });
    setAddress(parsed.base);
    setMessage(`Saved ${parsed.base}. Nothing has been sent to it yet.`);
  };

  const test = async (): Promise<void> => {
    if (!link) return;
    setMessage("Asking the server.");
    const r = await check(link);
    setMessage(r.ok ? "The server answered." : r.reason);
  };

  const login = async (): Promise<void> => {
    if (!link) return;
    setMessage("Signing in.");
    const r = await signIn(link, email, password);
    setPassword("");
    if (r.ok) {
      setToken(r.value, link.base);
      setMessage("Signed in. The sign-in token is kept in this page only and is forgotten when you leave.");
    } else setMessage(r.reason);
  };

  const readSessions = async (): Promise<void> => {
    if (!link) return;
    setMessage("Reading your sessions.");
    const r = await readServerSessions(link.base, link.token);
    if (!r.ok) {
      setMessage(r.reason);
      return;
    }
    serverStore.set(r.sessions);
    setMessage(`Read ${r.sessions.length} sessions${r.truncated ? " (the first pages only)" : ""}. They show on the Progress page for this visit and are not stored. Sessions the server has not scored yet show as pending.`);
  };

  return (
    <section className="stack" aria-label="Your server" data-testid="server-settings">
      <p>
        The Studio works fully with no server. If you run your own MELOPHOS server you can link it here to pair a hub, read the sessions your hub stored and send a corrected split of the hands to it. Nothing is sent until you press a button on the page that needs it.
      </p>
      <label className="stack-label">
        <span className="field-label">Server address</span>
        <input type="url" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="https://melophos.example.net" autoComplete="off" data-testid="server-address" />
        <span className="muted">An https address. A plain http address only works for a server on this machine, because the browser blocks the rest.</span>
      </label>
      <div className="actions">
        <button type="button" onClick={save} data-testid="server-save">
          Save the address
        </button>
        <button type="button" onClick={() => void test()} disabled={!link}>
          Check the server
        </button>
      </div>
      {link ? (
        <div className="panel">
          <h2>Sign in</h2>
          <p>{link.token ? "You are signed in for this visit." : "Pairing, sending a piece and reading sessions need you to be signed in to your server."}</p>
          {link.token ? (
            <button type="button" onClick={() => setToken(null)}>
              Forget the sign-in
            </button>
          ) : (
            <>
              <label className="stack-label">
                <span className="field-label">Email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
              </label>
              <label className="stack-label">
                <span className="field-label">Password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              </label>
              <button type="button" onClick={() => void login()} disabled={!email || !password}>
                Sign in
              </button>
              <label className="stack-label">
                <span className="field-label">Or paste a token</span>
                <input type="password" value={pasted} onChange={(e) => setPasted(e.target.value)} autoComplete="off" />
              </label>
              <button
                type="button"
                onClick={() => {
                  setToken(pasted, link.base);
                  setPasted("");
                }}
                disabled={!pasted}
              >
                Use this token
              </button>
            </>
          )}
          <h2>Sessions</h2>
          {usage ? <p data-testid="server-usage">{usage}</p> : null}
          <button type="button" onClick={() => void readSessions()} disabled={!link.token}>
            Read my sessions from the server
          </button>
        </div>
      ) : null}
      {link ? (
        <section className="panel" data-kind="danger" aria-labelledby="server-delete" id="delete" data-testid="server-delete">
          <h2 id="server-delete">Delete your data on the server</h2>
          <p>Your practice record may be a child&apos;s. These remove it from your own server. They do not touch what is kept in this browser, which you delete under Data.</p>
          {link.token ? (
            <div className="stack">
              <Confirm
                trigger="Sign out everywhere"
                testId="signout-all"
                confirm="Yes, sign out everywhere"
                what="This ends every sign-in on every device, including this one. Any webhook endpoints on your server are switched off until you confirm them again."
                onConfirm={async () => {
                  const r = await signOutEverywhere(link);
                  if (r.ok) {
                    setToken(null);
                    setMessage("Signed out everywhere. Sign in again to carry on.");
                  } else setMessage(r.reason);
                }}
              />
              <Confirm
                trigger="Delete my account and all its data"
                testId="delete-account"
                confirm="Yes, delete my account"
                password
                what="This deletes your account on the server with all its hubs, practice sessions, note events, songs, webhook endpoints and sign-ins, for good."
                onConfirm={async (password) => {
                  const r = await deleteAccount(link, password);
                  if (r.ok) {
                    setToken(null);
                    setMessage("Your account and everything in it have been deleted from the server.");
                  } else setMessage(r.reason);
                }}
              />
              <p className="muted">One practice session can be deleted from the Progress page, next to the session.</p>
            </div>
          ) : (
            <p>Sign in above to use these.</p>
          )}
        </section>
      ) : null}
      <p role="status" data-testid="server-message">
        {message}
      </p>
    </section>
  );
}
