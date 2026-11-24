// synthesised tones and the metronome click, on the Web Audio clock. the context is only created from a press, because
// browsers block sound until the player has acted. a tone is a triangle wave with a short attack and a release, which
// is plain and clear and needs no sample files.
import { audioTimeFor } from "./clock";

export interface SoundSettings {
  // 0 to 1
  volume: number;
}

const midiToHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 0.6;
  // called when the sound stops under a piece that is running, for example when headphones are unplugged
  onLost: (() => void) | null = null;
  private expecting = false;

  get available(): boolean {
    return typeof AudioContext !== "undefined";
  }

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  // call from a press or a key. returns false where the browser has no audio
  async unlock(): Promise<boolean> {
    if (!this.available) return false;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
      this.ctx.onstatechange = () => {
        if (this.expecting && this.ctx && this.ctx.state !== "running") this.onLost?.();
      };
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    this.expecting = true;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.setVolume(this.volume);
    return this.ctx.state === "running";
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.master && this.ctx) this.master.gain.setValueAtTime(this.volume, this.ctx.currentTime);
  }

  // the audio time for a moment on the performance clock
  at(performanceMs: number, nowMs: number): number {
    return this.ctx ? audioTimeFor(this.ctx, performanceMs, nowMs) : 0;
  }

  now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  tone(note: number, when: number, seconds: number): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = midiToHz(note);
    const start = Math.max(when, this.ctx.currentTime);
    const end = start + Math.max(0.12, seconds);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(0.28, start + 0.01);
    gain.gain.setValueAtTime(0.28, Math.max(start + 0.01, end - 0.06));
    gain.gain.linearRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  // a short click. the first beat of a bar is higher, so the bar can be heard
  click(when: number, accent: boolean): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = accent ? 1600 : 1000;
    const start = Math.max(when, this.ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(accent ? 0.5 : 0.32, start + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + 0.06);
  }

  // an optional soft low tone for a wrong note. it is off by default, since the instrument is already making sound
  wrong(): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 130.8;
    const start = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(0.18, start + 0.01);
    gain.gain.linearRampToValueAtTime(0.0001, start + 0.22);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + 0.25);
  }

  suspend(): void {
    // stopping the sound on purpose is not a loss
    this.expecting = false;
    void this.ctx?.suspend();
  }
}
