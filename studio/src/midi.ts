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

export interface ControlMessage {
  controller: number;
  value: number;
  channel: number;
}

// the sustain pedal is controller 64. a value of 64 or more is down
export const SUSTAIN_CONTROLLER = 64;

export function parseControlMessage(data: Uint8Array): ControlMessage | null {
  if (data.length < 3) return null;
  const [status = 0, controller = 0, value = 0] = data;
  if ((status & 0xf0) !== 0xb0) return null;
  return { controller, value, channel: status & 0x0f };
}

export async function connectMidi(onNote: (message: NoteMessage) => void): Promise<string[]> {
  if (!("requestMIDIAccess" in navigator)) {
    throw new Error("This browser cannot reach MIDI devices. Use Chrome, Edge or desktop Firefox.");
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
