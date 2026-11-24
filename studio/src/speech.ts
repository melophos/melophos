// spoken note names. only a voice the browser marks as local is used, because a voice that is not local sends the words
// to a speech service over the internet. a player can choose an online voice, after being told that and until then
// nothing is spoken when there is no local voice.
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
}

// a British English voice first, then any English one, then any other, among the voices allowed
export function pickVoice<T extends VoiceLike>(voices: readonly T[], allowOnline: boolean): T | null {
  const allowed = voices.filter((v) => allowOnline || v.localService);
  const rank = (v: VoiceLike): number => (/^en[-_]GB/i.test(v.lang) ? 0 : /^en/i.test(v.lang) ? 1 : 2);
  // among equals a voice on this device comes before an online one
  return [...allowed].sort((a, b) => rank(a) - rank(b) || Number(!a.localService) - Number(!b.localService))[0] ?? null;
}

export type Availability = { kind: "ready"; voice: string; online: boolean } | { kind: "no-local-voice" } | { kind: "unsupported" };

export function availability(voices: readonly VoiceLike[] | null, allowOnline: boolean): Availability {
  if (voices === null) return { kind: "unsupported" };
  const v = pickVoice(voices, allowOnline);
  return v ? { kind: "ready", voice: v.name, online: !v.localService } : { kind: "no-local-voice" };
}

export function sentenceFor(a: Availability): string {
  switch (a.kind) {
    case "ready":
      return a.online ? `Speaking with the online voice ${a.voice}. The words go to your browser's speech service.` : `Speaking with the voice ${a.voice}, which runs on this device.`;
    case "no-local-voice":
      return "This browser has no voice that runs on this device, so nothing will be spoken. You can allow an online voice below, which sends the words to your browser's speech service.";
    case "unsupported":
      return "This browser cannot speak, so nothing will be spoken.";
  }
}

export function voices(): SpeechSynthesisVoice[] | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis.getVoices() : null;
}

// says one phrase and cuts off the one before it. it does nothing when no allowed voice exists
export function speak(text: string, allowOnline: boolean): boolean {
  const list = voices();
  if (list === null) return false;
  const voice = pickVoice(list, allowOnline);
  if (!voice) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
  return true;
}
