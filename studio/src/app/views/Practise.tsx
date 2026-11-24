// the practice view. React draws the words and the buttons. the keyboard, the lights and the lane live outside it, on
// their own loop and talk to this view through the session's small snapshot.
//
// layout, top to bottom: a thin status line, the guidance area, the keyboard with its rail, the transport.
// the transport sits along the bottom edge, nearest the hands and its targets are the largest in the app.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Synth } from "../../audio";
import { COMPUTER_KEYS, OCTAVE_KEYS, computerNote, isTypingTarget } from "../../input";
import { KeyboardView } from "../../instrument/keyboard-view";
import { Lane } from "../../instrument/lane";
import { PracticeSession, describeNext, indicatorByBar, type NextNote, type Snapshot } from "../../instrument/session";
import { barCount, beatsPerBar, type HandChoice } from "../../piece";
import { DEFAULT_PROFILE } from "../../profile";
import { useLibrary } from "../../pieces";
import type { Song } from "../../songs";
import { explain } from "../../midi-connection";
import { loadScoring, scoringStatus } from "../../scoring";
import { MODES, type Mode } from "../types";
import { intParam, navigate } from "../router";
import { midi, probe, rememberSetup, saveSession, useMidiState, useSessions } from "../runtime";
import { reducedMotion, updateSettings, useSettings, type Settings } from "../settings";
import { ButtonLink, EmptyState, Icon, Link, Range, Segmented, Toggle } from "../ui";
import { Summary } from "./Summary";
import { GameResultPanel, announcement, type Finished } from "./GameResult";
import { ENGINE_VERSION } from "../../engine";
import { judge, makeBest, normaliseRange, resultFrom } from "../../game";
import { readBests, saveBest } from "../runtime";
import { setPractising } from "../update";

// one tone generator for the whole app, so the audio context is made once
const synth = new Synth();

function useSnapshot(session: PracticeSession | null): Snapshot | null {
  return useSyncExternalStore(
    (l) => (session ? session.subscribe(l) : () => undefined),
    () => (session ? session.getSnapshot() : null),
    () => null,
  );
}

const HANDS: { value: HandChoice; label: string }[] = [
  { value: "both", label: "Both" },
  { value: "right", label: "Right" },
  { value: "left", label: "Left" },
];

export interface Setup {
  mode: Mode;
  hand: HandChoice;
  from: number | null;
  to: number | null;
  tempo: number;
  loop: boolean;
  view: "steps" | "lane" | null;
}

export function readSetup(query: URLSearchParams, song: Song): Setup {
  const mode = (["melody", "rhythm", "listen"] as const).find((m) => m === query.get("mode")) ?? "melody";
  const hand = (["both", "left", "right"] as const).find((h) => h === query.get("hand")) ?? "both";
  const bars = barCount(song);
  const from = intParam(query, "from", 1, bars);
  const to = intParam(query, "to", from ?? 1, bars);
  const tempo = intParam(query, "tempo", 25, 125) ?? 100;
  const view = query.get("view") === "lane" ? "lane" : query.get("view") === "steps" ? "steps" : null;
  return { mode, hand, from, to, tempo, loop: query.get("loop") === "1", view };
}

const queryOf = (s: Setup, extra: Record<string, string> = {}): Record<string, string> => {
  const q: Record<string, string> = { mode: s.mode, hand: s.hand, tempo: String(s.tempo), ...extra };
  if (s.from !== null) q["from"] = String(s.from);
  if (s.to !== null) q["to"] = String(s.to);
  if (s.loop) q["loop"] = "1";
  if (s.view) q["view"] = s.view;
  return q;
};

export function Practise({ songId, query, trial, game = false }: { songId: string; query: URLSearchParams; trial: boolean; game?: boolean }): ReactNode {
  const library = useLibrary();
  const found = library.songs.find((s) => s.id === songId);
  if (!found) {
    return library.ready ? (
      <EmptyState title="That piece is not in the library" action={<ButtonLink to={["library"]}>Back to the library</ButtonLink>}>
        The address names a piece this Studio does not have. An imported piece is kept in the browser it was imported in.
      </EmptyState>
    ) : (
      <p className="muted">Loading the library.</p>
    );
  }
  return <PractiseRun song={found} query={query} trial={trial} game={game} />;
}

function PractiseRun({ song, query, trial, game }: { song: Song; query: URLSearchParams; trial: boolean; game: boolean }): ReactNode {
  const settings = useSettings();
  // the game is always Rhythm mode with the falling notes, played once through. the player chooses only the difficulty
  const read = readSetup(query, song);
  const setup: Setup = game ? { ...read, mode: "rhythm", loop: false, view: "lane" } : read;
  const midiState = useMidiState();
  const sessions = useSessions();
  const keyboardHost = useRef<HTMLDivElement>(null);
  const keyboardRef = useRef<KeyboardView | null>(null);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [demoRun, setDemoRun] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const snap = useSnapshot(session);
  const reduced = reducedMotion(settings);
  const view = setup.view ?? (settings.guidance === "auto" ? (setup.mode === "melody" ? "steps" : "lane") : settings.guidance);
  const nameOptions = useMemo(() => ({ naming: settings.naming, octave: settings.octave, accidental: settings.accidental, key: song.key }), [settings.naming, settings.octave, settings.accidental, song.key]);
  const nameRef = useRef(nameOptions);
  nameRef.current = nameOptions;
  const settingsRef = useRef<Settings>(settings);
  settingsRef.current = settings;

  const [engine, setEngine] = useState(scoringStatus());
  useEffect(() => {
    loadScoring().then(
      () => setEngine("ready"),
      () => setEngine("failed"),
    );
  }, []);

  // remember the setup so Start can offer to carry on
  useEffect(() => {
    if (!trial && !game) rememberSetup({ pieceId: song.id, query: queryOf(setup) });
  });

  // build the keyboard, the lane and the session. a new setup means a new run: the keys and the lane are made again
  const key = `${game}|${game && settings.gameSound}|${song.id}|${setup.mode}|${setup.hand}|${setup.from}|${setup.to}|${setup.tempo}|${setup.loop}|${view}|${reduced}|${demoRun}`;
  useEffect(() => {
    const host = keyboardHost.current;
    if (!host) return;
    const s = settingsRef.current;
    const keyboard = new KeyboardView(host, {
      lowest: DEFAULT_PROFILE.lowest,
      highest: DEFAULT_PROFILE.highest,
      names: nameRef.current,
      labels: s.labels,
      onKey: (note, on, timeStamp) => {
        if (on) created.stamp(timeStamp);
        created.input(note, on, timeStamp, "screen");
      },
    });
    keyboardRef.current = keyboard;
    const useLane = view === "lane" || setup.mode !== "melody";
    const lane = useLane ? new Lane(keyboard.slot, { lowest: DEFAULT_PROFILE.lowest, highest: DEFAULT_PROFILE.highest }) : null;
    synth.setVolume(s.volume);
    const created = new PracticeSession(
      {
        song,
        mode: setup.mode,
        hand: setup.hand,
        fromBar: setup.from,
        toBar: setup.to,
        speed: setup.tempo / 100,
        loop: setup.loop,
        simulated: demoRun > 0 && !game,
        guidance: view === "lane" ? "lane" : "steps",
        metronome: game ? s.gameSound && s.metronome : s.metronome,
        wrongSound: s.wrongSound,
        keySound: s.keySound,
        // the game makes no sound unless the player has turned sound on for it
        silent: game && !s.gameSound,
        spoken: s.spoken,
        onlineVoice: s.onlineVoice,
        reducedMotion: reduced,
        names: nameRef.current,
        calibrationMs: s.calibrationMs,
        lightSensitivity: s.lightSensitivity,
      },
      { keyboard, lane, synth, probe },
    );
    setSession(created);
    setSaved(null);
    if (demoRun > 0 && !game) created.start();

    // a MIDI keyboard, if one is connected, feeds the same session with the event's own time
    midi.onNote = (n) => {
      if (n.on) created.stamp(n.atMs);
      created.input(n.note, n.on, n.atMs, "midi");
    };
    // a keyboard that drops out pauses the piece and says why
    const unwatch = midi.subscribe((state) => {
      if (state.kind === "lost") created.lose("The keyboard stopped responding, so the piece paused. Check the cable or the Bluetooth link, then press Resume.");
    });
    midi.onPedal = (p) => {
      if (!p.down || game) return;
      if (settingsRef.current.pedal === "next") created.nextPhrase();
      else created.repeatPhrase();
    };
    // the computer keyboard plays one octave and a little more, laid out by position
    let shift = 0;
    const down = new Map<string, number>();
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const inKeys = e.target instanceof Element && e.target.closest(".kb-svg") !== null;
      const onControl = e.target instanceof Element && e.target.closest("button, a, summary, [role=slider], [role=radio], [role=switch]") !== null;
      if (e.code === OCTAVE_KEYS.down || e.code === OCTAVE_KEYS.up) {
        shift = Math.max(-2, Math.min(2, shift + (e.code === OCTAVE_KEYS.up ? 1 : -1)));
        return;
      }
      if (COMPUTER_KEYS.includes(e.code)) {
        if (e.repeat) return;
        const note = computerNote(e.code, shift);
        if (note !== null) {
          down.set(e.code, note);
          created.stamp(e.timeStamp);
          created.input(note, true, e.timeStamp, "computer");
          e.preventDefault();
        }
        return;
      }
      if (inKeys || game) return;
      // hands-free keys: a Bluetooth page turner sends arrows or Page Up and Page Down
      if (e.code === "Space" && !onControl) {
        e.preventDefault();
        created.toggle();
      } else if (e.key === "PageDown" || (e.key === "ArrowRight" && !onControl)) {
        e.preventDefault();
        created.nextPhrase();
      } else if (e.key === "PageUp" || (e.key === "ArrowLeft" && !onControl)) {
        e.preventDefault();
        created.repeatPhrase();
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      const note = down.get(e.code);
      if (note === undefined) return;
      down.delete(e.code);
      created.input(note, false, e.timeStamp, "computer");
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      unwatch();
      midi.onNote = null;
      midi.onPedal = null;
      created.destroy();
      lane?.destroy();
      keyboard.destroy();
      keyboardRef.current = null;
    };
    // the key string stands for every input that rebuilds the run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // names and labels change without losing the place
  useEffect(() => {
    keyboardRef.current?.setNames(nameOptions, settings.labels);
    session?.setNames(nameOptions);
  }, [nameOptions, settings.labels, session]);

  useEffect(() => {
    synth.setVolume(settings.volume);
  }, [settings.volume]);

  // the lane's colours follow the theme, the contrast setting and forced colours
  useEffect(() => {
    if (!session) return;
    const refresh = (): void => session.refreshColours();
    const queries = ["(prefers-color-scheme: dark)", "(prefers-contrast: more)", "(forced-colors: active)"].map((q) => window.matchMedia(q));
    queries.forEach((q) => q.addEventListener("change", refresh));
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-contrast"] });
    refresh();
    return () => {
      queries.forEach((q) => q.removeEventListener("change", refresh));
      observer.disconnect();
    };
  }, [session, settings.theme, settings.contrast]);

  // save a finished run unless the simulator played it and move focus to the summary
  const result = snap?.result ?? null;
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [finished, setFinished] = useState<Finished | null>(null);
  const store = (record: NonNullable<typeof result>): void => {
    void saveSession(record).then((r) => {
      setSaveFailure(r.ok ? null : r.reason);
      if (r.ok) sessions.reload();
    });
  };
  useEffect(() => {
    if (!result || result.id === saved) return;
    setSaved(result.id);
    setSaveFailure(null);
    // a run with nothing played is not a run and a simulated or listening one is never part of the record
    const played = result.total > 0 || result.wrongPresses > 0;
    if (!snap?.simulated && result.mode !== "listen" && played) store(result);
    // the game keeps a best from the engine's figures for this song and these settings and compares with nothing else
    setFinished(null);
    if (game && played) {
      const difficulty = { hand: setup.hand, speedPct: setup.tempo, ...normaliseRange(setup.from, setup.to, bars) };
      const figures = resultFrom(result);
      void (async () => {
        if (!figures) return setFinished({ result: null, outcome: null, difficulty, kept: false });
        const outcome = judge(await readBests(), song.id, difficulty, figures, ENGINE_VERSION);
        let kept = true;
        if (outcome.kind !== "not-best") kept = await saveBest(makeBest(result, difficulty, figures, ENGINE_VERSION));
        setFinished({ result: figures, outcome, difficulty, kept });
        sessions.reload();
      })();
    }
    summaryRef.current?.querySelector<HTMLElement>("h2")?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // the result of a game is read out once, when it is ready and focus goes to it
  useEffect(() => {
    if (finished) summaryRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [finished]);

  const change = (patch: Partial<Setup>): void => {
    const next = { ...setup, ...patch };
    if (patch.mode && patch.mode !== setup.mode && !patch.view) next.view = null;
    navigate(game ? ["game", song.id] : trial ? ["try"] : ["practise", song.id], { ...queryOf(next), ...(trial ? { piece: song.id } : {}) }, true);
    setDemoRun(0);
  };

  const bars = barCount(song);
  const connection = explain(midiState, { firefox: /firefox/i.test(navigator.userAgent) });
  const connected = midiState.kind === "connected" ? `Keyboard connected: ${midiState.names.join(", ")}` : "Using the on-screen keys and your computer keyboard";
  const status = snap?.status ?? "ready";
  // an update is refused while a piece is running
  const running = status === "playing" || status === "counting";
  useEffect(() => {
    setPractising(running);
    return () => setPractising(false);
  }, [running]);
  const showSteps = view === "steps";
  const playLabel = status === "playing" || status === "counting" ? "Pause" : status === "paused" ? "Resume" : status === "finished" ? "Play again" : "Start";
  const bpm = Math.round(song.tempo * (setup.tempo / 100));

  return (
    <div className="practice" data-engine={engine}>
      <header className="practice-top">
        <Link to={trial ? [] : ["piece", song.id]} className="back">
          <Icon name="back" />
          {trial ? "Back to start" : "Back to the piece"}
        </Link>
        <div className="practice-title">
          <h1>{game ? `Rhythm game: ${song.title}` : song.title}</h1>
          <p className="muted">
            {game ? "Rhythm game" : `${MODES.find((m) => m.value === setup.mode)?.label} mode`}, {setup.hand === "both" ? "both hands" : `${setup.hand} hand`}, {setup.tempo}% speed ({bpm} beats a minute). {connected}.
          </p>
        </div>
        {(snap?.simulated || trial) && !game ? (
          <p className="badge" data-kind="simulated">
            Simulated
          </p>
        ) : null}
      </header>

      {snap?.notice ? (
        <p className="banner" role="status">
          <Icon name="warning" />
          {snap.notice}
        </p>
      ) : null}
      {snap && engine === "failed" && setup.mode !== "listen" ? (
        <p className="banner" data-quiet="true">
          <Icon name="info" />
          The scoring module could not load, so there is no accuracy figure and timing is not judged. Each key is still checked as right or wrong against the notes due next.
        </p>
      ) : null}

      <section className="guidance" aria-label="What to play">
        {showSteps ? <StepCards snap={snap} /> : null}
        <p className="next-line" data-testid="next-line">
          {snap ? (status === "finished" ? "Finished." : status === "ready" && setup.mode !== "melody" ? "Press Start. A count-in of one bar comes first." : describeNext(snap.next)) : "Loading."}
        </p>
        <FeedbackLine snap={snap} />
      </section>

      <section className="instrument" aria-label="Keyboard">
        <div ref={keyboardHost} />
        <p className="hint muted">
          Keys on screen, the home row of your computer keyboard (A to K) or a MIDI keyboard all play. Z and X change octave.
        </p>
      </section>

      <section className="statusline" aria-label="Place in the piece">
        <p>
          <strong data-testid="state-word">{stateWord(snap)}</strong>
          {snap && status !== "ready" ? `. Bar ${snap.bar} of ${bars}, beat ${snap.beat}. ${snap.doneNotes} of ${snap.totalNotes} notes done.` : ""}
        </p>
        {settings.beatIndicator && setup.mode !== "melody" && snap ? <BeatIndicator snap={snap} byBar={indicatorByBar(song.tempo, setup.tempo / 100)} /> : null}
      </section>

      <div className="transport" role="group" aria-label="Transport">
        <button type="button" className="button-primary transport-main" onClick={() => session?.toggle()} data-testid="play">
          <Icon name={status === "playing" || status === "counting" ? "pause" : "play"} />
          {playLabel}
        </button>
        <button type="button" onClick={() => session?.restart()}>
          <Icon name="restart" />
          Restart
        </button>
        {game ? null : (
          <>
            <button type="button" onClick={() => session?.repeatPhrase()} disabled={!snap || status === "ready"}>
              <Icon name="loop" />
              Repeat phrase
            </button>
            <button type="button" onClick={() => session?.nextPhrase()} disabled={!snap || status === "ready" || snap.phraseIndex >= snap.phraseCount - 1}>
              <Icon name="next" />
              Next phrase
            </button>
          </>
        )}
        <button type="button" onClick={() => session?.stop()} disabled={status === "ready" || status === "finished"}>
          <Icon name="stop" />
          Finish
        </button>
        <button type="button" onClick={() => session?.whatIsNext()}>
          <Icon name="info" />
          What is next
        </button>
      </div>

      <p role="status" className="visually-hidden" data-testid="announcer">
        {/* each announcement is a new element, so the same words said again are still spoken by a screen reader */}
        <span key={status === "finished" ? `result-${finished ? "game" : "run"}` : (snap?.announcementId ?? 0)}>{status === "finished" && result ? (result.total === 0 ? "Finished. Nothing was played." : game ? (finished ? announcement(finished) : "") : `Finished. ${result.firstTime} of ${result.total} notes right first time.`) : (snap?.announcement ?? "")}</span>
      </p>

      <details className="setup" open={!snap || status === "ready"}>
        <summary>Setup</summary>
        <div className="setup-grid">
          {game ? (
            <p className="muted setup-note">
              The rhythm game plays the piece once through, with the notes falling to the keys. Press Start when you are ready: nothing begins until you do and you can pause at any time.
            </p>
          ) : (
            <>
              <Segmented label="Mode" value={setup.mode} onChange={(mode) => change({ mode })} options={MODES.map((m) => ({ value: m.value, label: m.label }))} />
              <p className="muted setup-note">{MODES.find((m) => m.value === setup.mode)?.summary}</p>
            </>
          )}
          <Segmented label="Hand" value={setup.hand} onChange={(hand) => change({ hand })} options={HANDS} />
          {game ? null : <Segmented label="Guidance" value={view} onChange={(v) => change({ view: v })} options={[{ value: "steps", label: "Steps" }, { value: "lane", label: "Falling notes" }]} />}
          <Range label="Speed" value={setup.tempo} onChange={(tempo) => change({ tempo })} min={25} max={125} step={5} format={(v) => `${v}%, ${Math.round(song.tempo * v / 100)} beats a minute`} />
          <fieldset className="bars">
            <legend>Bars to practise</legend>
            <label>
              From bar
              <input type="number" inputMode="numeric" min={1} max={bars} value={setup.from ?? 1} onChange={(e) => change({ from: Math.max(1, Math.min(bars, Number(e.target.value) || 1)), to: Math.max(setup.to ?? bars, Number(e.target.value) || 1) })} />
            </label>
            <label>
              To bar
              <input type="number" inputMode="numeric" min={1} max={bars} value={setup.to ?? bars} onChange={(e) => change({ to: Math.max(setup.from ?? 1, Math.min(bars, Number(e.target.value) || bars)) })} />
            </label>
            <p className="muted">The piece has {bars} bars of {beatsPerBar(song)} beats.</p>
          </fieldset>
          {game ? null : <Toggle label="Loop these bars" hint={setup.mode === "melody" ? "Melody mode waits for you, so it plays the bars once. Looping is for Rhythm and Listen." : "The bars play round and round."} isSelected={setup.loop} onChange={(loop) => change({ loop })} />}
          {game ? (
            <>
              <Toggle label="Sound in the game" isSelected={settings.gameSound} onChange={(gameSound) => updateSettings({ gameSound })} hint="Off, the game makes no sound at all. On, keys pressed on screen make a tone and the count-in clicks." />
              <p className="muted">Changing the speed, the hand or the bars starts a new game with its own best.</p>
            </>
          ) : (
            <Toggle label="Metronome click" isSelected={settings.metronome} onChange={(metronome) => updateSettings({ metronome })} hint="The first beat of the bar is higher." />
          )}
          <Segmented label="Distance" value={settings.distance} onChange={(distance) => updateSettings({ distance })} options={[{ value: "near", label: "Near" }, { value: "stand", label: "Stand" }, { value: "far", label: "Far" }]} />
          {game ? null : <div className="field">
            <span className="field-label">Simulator</span>
            <button type="button" onClick={() => setDemoRun((n) => n + 1)} data-testid="demo">
              <Icon name="play" />
              Play the demo
            </button>
            <p className="muted">A simulated player runs the piece with one slip. It is never saved.</p>
          </div>}
        </div>
        {midiState.kind !== "connected" ? (
          <p className="muted">
            {connection.headline} <Link to={["devices"]}>Set up a keyboard</Link>
          </p>
        ) : null}
      </details>

      {saveFailure && result ? (
        <div className="banner" role="alert" data-testid="save-failed">
          <Icon name="warning" />
          <span>
            This run could not be saved, so it will not appear in your progress. The browser said: {saveFailure} It may be out of space or blocking storage. You can try again or free some space and then try again.
          </span>
          <button type="button" onClick={() => store(result)}>
            Try saving again
          </button>
        </div>
      ) : null}
      {result ? (
        <div ref={summaryRef}>
          {game && result.total > 0 ? (finished ? <GameResultPanel finished={finished} title={song.title} /> : <p className="muted">Working out your result.</p>) : <Summary record={result} names={nameOptions} simulated={Boolean(snap?.simulated)} />}
          <div className="actions">
            <button type="button" className="button-primary" onClick={() => session?.start()}>
              <Icon name="play" />
              Play it again
            </button>
            {!snap?.simulated ? (
              <Link to={game ? ["bests"] : ["progress", song.id]} className="button">
                {game ? "See your bests" : "See your progress"}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function stateWord(snap: Snapshot | null): string {
  if (!snap) return "Loading";
  switch (snap.status) {
    case "ready":
      return "Ready";
    case "counting":
      return `Count-in, ${snap.countIn ?? ""}`;
    case "playing":
      return snap.waiting ? "Waiting for you" : "Playing";
    case "paused":
      return "Paused";
    case "finished":
      return "Finished";
  }
}

// the next note large with its hand and finger and the two after it smaller. nothing moves while the app waits
function StepCards({ snap }: { snap: Snapshot | null }): ReactNode {
  const now: NextNote[] = snap?.next.filter((n) => n.together) ?? [];
  const later: NextNote[] = snap?.next.filter((n) => !n.together).slice(0, 2) ?? [];
  return (
    <div className="steps" data-testid="steps">
      <div className="step-now" aria-hidden="true">
        {now.length === 0 ? <p className="step-done">{snap?.status === "finished" ? "Done" : "-"}</p> : null}
        {now.map((n) => (
          <div className="step-card step-big" key={n.note} data-hand={n.hand}>
            <span className="step-note">{n.label}</span>
            <span className="hand-badge" data-hand={n.hand}>
              <span className="hand-shape" />
              {n.hand === "right" ? "R" : "L"}
              {n.finger ? `, finger ${n.finger}` : ""}
            </span>
          </div>
        ))}
      </div>
      {later.length > 0 ? (
        <div className="step-later" aria-hidden="true">
          <span className="step-then">Then</span>
          {later.map((n) => (
            <div className="step-card step-small" key={`${n.note}-${n.hand}`} data-hand={n.hand}>
              <span className="step-note">{n.label}</span>
              <span className="hand-badge" data-hand={n.hand}>
                <span className="hand-shape" />
                {n.hand === "right" ? "R" : "L"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// the result of the last press, as words and a mark. it is not a live region: a screen reader reads the text line
function FeedbackLine({ snap }: { snap: Snapshot | null }): ReactNode {
  const e = snap?.lastEvent ?? null;
  return (
    <p className="feedback" data-kind={e?.kind ?? "none"} data-testid="feedback">
      {e?.kind === "wrong" ? (
        <>
          <Icon name="close" />
          Wrong note. You played {e.label}
          {e.expected ? `. The light is still on ${e.expected}.` : "."}
        </>
      ) : e?.kind === "unsure" ? (
        <>
          <Icon name="info" />
          Not judged: {e.label}. The scoring engine was not sure about this key, so it counts neither for you nor against you.
        </>
      ) : e?.kind === "right" ? (
        <>
          <Icon name="tick" />
          Right: {e.label}
        </>
      ) : (
        "The light shows the next note to play."
      )}
    </p>
  );
}

// four boxes with the current beat filled. it changes in steps, never a flash and shows bars when the beat is too quick
function BeatIndicator({ snap, byBar }: { snap: Snapshot; byBar: boolean }): ReactNode {
  if (snap.status === "ready" || snap.status === "finished") return null;
  if (byBar) return <p className="beat-note muted">The beat is quick, so the indicator shows bars. Bar {snap.bar}.</p>;
  return (
    <ol className="beat-indicator" aria-label={`Beat ${snap.beat} of ${snap.beatsPerBar}`}>
      {Array.from({ length: snap.beatsPerBar }, (_, i) => (
        <li key={i} data-active={snap.countIn === null && i + 1 === snap.beat ? "true" : "false"} data-count={snap.countIn !== null && i + 1 === snap.beatsPerBar - snap.countIn + 1 ? "true" : "false"}>
          {i + 1}
        </li>
      ))}
    </ol>
  );
}
