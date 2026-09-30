export interface NoteMessage {
  note: number;
  velocity: number;
  channel: number;
}

export function parseNoteMessage(data: Uint8Array): NoteMessage | null {
  if (data.length < 3) return null;
  const [status = 0, note = 0, velocity = 0] = data;
  const type = status & 0xf0;
  const channel = status & 0x0f;
  if (type === 0x90) return { note, velocity, channel };
  if (type === 0x80) return { note, velocity: 0, channel };
  return null;
}

export async function connectMidi(onNote: (message: NoteMessage) => void): Promise<string[]> {
  if (!("requestMIDIAccess" in navigator)) {
    throw new Error("This browser has no WebMIDI. Use Chrome or Edge.");
  }
  const access = await navigator.requestMIDIAccess();
  const names: string[] = [];
  for (const input of access.inputs.values()) {
    names.push(input.name ?? "MIDI input");
    input.onmidimessage = (event) => {
      if (!event.data) return;
      const message = parseNoteMessage(event.data);
      if (message) onNote(message);
    };
  }
  return names;
}
