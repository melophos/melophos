// the diagnostic view: the scoring self-check, the press to frame figures and a frame stress run for the lane.
// it measures the browser and this machine only. a key switch, a screen and a Bluetooth link add delay that only a
// camera and the real hardware can show.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { follow, scorePassage, type FollowResult, type Note } from "@melophos/core";
import { KeyboardView } from "../../instrument/keyboard-view";
import { Lane } from "../../instrument/lane";
import { frameStats, type FrameStats } from "../../latency";
import { loadScoring, scoringFailure, scoringStatus } from "../../scoring";
import type { TimedNote } from "../../piece";
import { DEFAULT_PROFILE } from "../../profile";
import { probe } from "../runtime";
import { Icon } from "../ui";

// a small fixture with known results: eight notes at 500 ms, played with small errors and one wrong press
const EXPECTED: Note[] = Array.from({ length: 8 }, (_, i) => ({ tMs: i * 500, note: 60 + i }));
const PLAYED: Note[] = [...EXPECTED.slice(0, 4).map((n, i) => ({ tMs: n.tMs + 10 + i, note: n.note })), { tMs: 1750, note: 99 }, ...EXPECTED.slice(4).map((n) => ({ tMs: n.tMs + 15, note: n.note }))];

declare global {
  interface Window {
    // set while this view is open, so a browser test can score a real fixture through the loaded module
    __melophos?: { follow: typeof follow; scorePassage: typeof scorePassage };
  }
}

export function Diagnostics(): ReactNode {
  const [engine, setEngine] = useState(scoringStatus());
  const [check, setCheck] = useState<string>("");
  const [stats, setStats] = useState(probe.stats());
  const [frames, setFrames] = useState<FrameStats | null>(null);
  const [running, setRunning] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const laneHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadScoring().then(
      () => {
        setEngine("ready");
        window.__melophos = { follow, scorePassage };
      },
      () => setEngine("failed"),
    );
    return () => {
      delete window.__melophos;
    };
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const kb = new KeyboardView(el, {
      lowest: 48,
      highest: 84,
      names: { naming: "english", octave: "c4", accidental: "sharp" },
      labels: "c",
      onKey: (note, on, timeStamp) => {
        kb.setHeld(note, on);
        // the frame that follows this handler is where the change is drawn
        if (on) {
          requestAnimationFrame((frameTime) => {
            probe.record(timeStamp, frameTime);
            setStats(probe.stats());
          });
        }
      },
    });
    return () => kb.destroy();
  }, []);

  const runCheck = (): void => {
    try {
      const result: FollowResult = follow(EXPECTED, PLAYED);
      const plain = scorePassage(EXPECTED, PLAYED);
      setCheck(`Followed ${PLAYED.length} presses: ${result.summary.hits} hits, ${result.summary.wrong} wrong, accuracy ${(result.summary.accuracy * 100).toFixed(1)}%. Fixed window: ${plain.hits} hits.`);
    } catch (error) {
      setCheck(error instanceof Error ? error.message : "The check failed.");
    }
  };

  // 1000 notes at 10 a second, with the lane scrolling at the pace of the notes, for a stated time
  const stress = (seconds: number): void => {
    const slot = laneHost.current;
    if (!slot || running) return;
    setRunning(true);
    setFrames(null);
    const notes: TimedNote[] = Array.from({ length: 1000 }, (_, i) => ({ index: i, note: 36 + ((i * 7) % 61), hand: i % 3 === 0 ? "left" : "right", startBeat: i * 0.1, beats: 0.08 }));
    const lane = new Lane(slot, { lowest: DEFAULT_PROFILE.lowest, highest: DEFAULT_PROFILE.highest, lookBeats: 4 });
    lane.setNotes(notes, 4);
    const times: number[] = [];
    let origin = 0;
    const tick = (ts: number): void => {
      if (origin === 0) origin = ts;
      const elapsed = (ts - origin) / 1000;
      times.push(ts);
      lane.draw(elapsed);
      if (elapsed < seconds) {
        requestAnimationFrame(tick);
      } else {
        lane.destroy();
        setFrames(frameStats(times));
        setRunning(false);
      }
    };
    requestAnimationFrame(tick);
  };

  return (
    <>
      <h1>Diagnostics</h1>
      <p className="muted">These figures measure the browser on this machine. A key switch, a screen and a Bluetooth link add delay that only real hardware and a camera can show.</p>

      <section className="panel" aria-labelledby="d-score" data-testid="diag-scoring">
        <h2 id="d-score">Scoring engine</h2>
        <p data-testid="engine-status">{engine === "ready" ? "Loaded from WebAssembly." : engine === "failed" ? `Failed to load. ${scoringFailure()}` : "Loading."}</p>
        <button type="button" onClick={runCheck} disabled={engine !== "ready"} data-testid="run-check">
          <Icon name="tick" />
          Run the self-check
        </button>
        <p data-testid="check-result">{check}</p>
      </section>

      <section className="panel" aria-labelledby="d-lat" data-testid="diag-latency">
        <h2 id="d-lat">Press to frame</h2>
        <p>Press the keys below or type A to K on your keyboard. Each press is timed from the event's own timestamp to the start of the frame that draws it.</p>
        <div ref={host} />
        <table>
          <tbody>
            <tr>
              <th scope="row">Presses measured</th>
              <td data-testid="lat-count">{stats.count}</td>
            </tr>
            <tr>
              <th scope="row">Median</th>
              <td data-testid="lat-median">{stats.medianMs.toFixed(1)} ms</td>
            </tr>
            <tr>
              <th scope="row">95th percentile</th>
              <td data-testid="lat-p95">{stats.p95Ms.toFixed(1)} ms</td>
            </tr>
            <tr>
              <th scope="row">Slowest</th>
              <td>{stats.maxMs.toFixed(1)} ms</td>
            </tr>
          </tbody>
        </table>
        <button
          type="button"
          onClick={() => {
            probe.reset();
            setStats(probe.stats());
          }}
        >
          Clear the figures
        </button>
      </section>

      <section className="panel" aria-labelledby="d-frame" data-testid="diag-frames">
        <h2 id="d-frame">Lane frame time</h2>
        <p>Scrolls 1000 notes at ten a second and records every frame.</p>
        <div className="actions">
          <button type="button" onClick={() => stress(10)} disabled={running} data-testid="stress-10">
            Run for 10 seconds
          </button>
          <button type="button" onClick={() => stress(60)} disabled={running}>
            Run for 60 seconds
          </button>
        </div>
        <div ref={laneHost} className="stress-lane" />
        {running ? <p>Running.</p> : null}
        {frames ? (
          <p data-testid="frame-result">
            {frames.frames} frames. 95th percentile {frames.p95Ms.toFixed(1)} ms, 99th percentile {frames.p99Ms.toFixed(1)} ms, slowest {frames.maxMs.toFixed(1)} ms.
          </p>
        ) : null}
      </section>
    </>
  );
}
