import "./style.css";
import { Keyboard } from "./keyboard";
import { connectMidi } from "./midi";
import { noteName } from "./notes";
import { DEFAULT_PROFILE } from "./profile";

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`missing #${id}`);
  return found;
}

const status = element("status");
const lastNote = element("last-note");
const keyboard = new Keyboard(element("keyboard"), DEFAULT_PROFILE.lowest, DEFAULT_PROFILE.highest);

element("connect").addEventListener("click", async () => {
  try {
    const inputs = await connectMidi(({ note, velocity }) => {
      keyboard.setPressed(note, velocity > 0);
      if (velocity > 0) lastNote.textContent = `${noteName(note)} (velocity ${velocity})`;
    });
    status.textContent = inputs.length ? `Connected: ${inputs.join(", ")}` : "No MIDI inputs found";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
  }
});
