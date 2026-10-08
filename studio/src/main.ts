import "./style.css";
import { playDemo, type DemoHandle } from "./demo";
import { Keyboard } from "./keyboard";
import { connectMidi } from "./midi";
import { noteName } from "./notes";
import { Practice } from "./practice";
import { DEFAULT_PROFILE } from "./profile";
import { SONGS, type Song } from "./songs";

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found as T;
}

const keyboard = new Keyboard(element("keyboard"), DEFAULT_PROFILE.lowest, DEFAULT_PROFILE.highest);
const songSelect = element<HTMLSelectElement>("song");
const demoButton = element<HTMLButtonElement>("demo");
let practice = new Practice(SONGS[0]!);
let demo: DemoHandle | null = null;

for (const song of SONGS) songSelect.append(new Option(song.title, song.id));

function render(): void {
  const next = practice.upcoming(3);
  keyboard.guide(next);
  element("next-note").textContent = next[0] === undefined ? "Done" : noteName(next[0]);
  element("progress").textContent = `Note ${Math.min(practice.position + 1, practice.song.notes.length)} of ${practice.song.notes.length}`;
}

function start(song: Song): void {
  demo?.stop();
  demo = null;
  demoButton.disabled = false;
  practice = new Practice(song);
  element("song-title").textContent = song.title;
  element("composer").textContent = `${song.composer} · ${song.tempo} beats a minute`;
  element("summary").hidden = true;
  element("feedback").textContent = "The amber light shows the next note to play.";
  render();
}

function finish(): void {
  const s = practice.summary();
  element("s-accuracy").textContent = `${Math.round(s.accuracy * 100)}%`;
  element("s-notes").textContent = `${s.correct} of ${s.notes} right`;
  element("s-timing").textContent = `${s.meanOffsetMs} ms from the beat`;
  element("s-streak").textContent = `${s.bestStreak} notes`;
  element("summary").hidden = false;
  demoButton.disabled = false;
}

function onNote(note: number, on: boolean): void {
  if (!on) {
    keyboard.setPressed(note, false);
    return;
  }
  const result = practice.play(note, performance.now());
  keyboard.setPressed(note, true, result ? !result.correct : false);
  if (result) {
    element("feedback").textContent = result.correct
      ? `${noteName(note)}: right, ${Math.abs(result.offsetMs)} ms ${result.offsetMs >= 0 ? "late" : "early"}`
      : `${noteName(note)}: wrong note, the light is still on ${noteName(result.expected)}`;
  }
  render();
  if (practice.finished) finish();
}

songSelect.addEventListener("change", () => start(SONGS.find((s) => s.id === songSelect.value) ?? SONGS[0]!));
element("reset").addEventListener("click", () => start(practice.song));
demoButton.addEventListener("click", () => {
  start(practice.song);
  demoButton.disabled = true;
  demo = playDemo(practice.song, onNote, () => { demoButton.disabled = false; });
});

element("connect").addEventListener("click", async () => {
  const status = element("status");
  try {
    const inputs = await connectMidi(({ note, velocity }) => onNote(note, velocity > 0));
    status.textContent = inputs.length ? `Connected: ${inputs.join(", ")}` : "No MIDI inputs found";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});

start(SONGS[0]!);
