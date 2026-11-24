// plays the keyboard figure on request. it never starts by itself, pause is always on screen,
// it stops when the tab is hidden and, under reduced motion, it steps one note per press instead of running.
// the steps are timed from the page clock inside one animation frame loop, so nothing drifts.

import { EXERCISE, describeLit, KEY_H, RAIL_H, TOP, WIDTH, keyGeometry, spokenName } from "../lib/keyboard-svg.ts";

const STEP_MS = 900;

const root = document.querySelector<HTMLElement>("[data-keyboard-figure]");
if (root) init(root);

function init(figure: HTMLElement): void {
  const svg = figure.querySelector<SVGSVGElement>("svg");
  const frame = figure.querySelector<HTMLElement>("[data-frame]");
  const button = figure.querySelector<HTMLButtonElement>("[data-play]");
  const word = figure.querySelector<HTMLElement>("[data-play-word]");
  const icons = figure.querySelectorAll<HTMLElement>("[data-play-icon]");
  const readout = figure.querySelector<HTMLElement>("[data-readout]");
  const controls = figure.querySelector<HTMLElement>("[data-controls]");
  const desc = svg?.querySelector("desc");
  const lit = svg?.querySelector<SVGGElement>(".lit");
  const label = svg?.querySelector<SVGTextElement>(".lit-label");
  if (!svg || !frame || !button || !word || !readout || !controls || !desc || !lit || !label) return;

  const centres = new Map(keyGeometry().map((k) => [k.note, k]));
  const rings = lit.querySelectorAll<SVGCircleElement>(".soon");
  const disc = lit.querySelector<SVGCircleElement>(".next");
  const marker = lit.querySelector<SVGCircleElement>(".key-marker");
  const keys = svg.querySelectorAll<SVGRectElement>(".key");
  if (!disc || !marker) return;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let index = 0;
  let running = false;
  let last = 0;
  let frameId = 0;

  const at = (n: number): number => EXERCISE[n % EXERCISE.length] ?? 60;

  const show = (): void => {
    const note = at(index);
    const key = centres.get(note);
    if (!key) return;
    disc?.setAttribute("cx", String(key.centre));
    disc?.setAttribute("cy", String(RAIL_H / 2));
    marker?.setAttribute("cx", String(key.centre));
    marker?.setAttribute("cy", String(TOP + KEY_H - 40));
    rings.forEach((ring, n) => {
      const soon = centres.get(at(index + 1 + n));
      ring.setAttribute("cx", String(soon ? soon.centre : key.centre));
      ring.setAttribute("cy", String(RAIL_H / 2));
    });
    keys.forEach((k) => k.classList.toggle("is-lit", Number(k.dataset["note"]) === note));
    label.setAttribute("x", String(key.centre));
    label.textContent = key.name;
    const next = spokenName(at(index + 1));
    const words = `${spokenName(note)}, right hand`;
    readout.textContent = `Lit now: ${words}. Next: ${next}.`;
    desc.textContent = describeLit(note);
    // keep the lit key inside the frame without any animation
    const scale = frame.scrollWidth / WIDTH;
    const left = key.centre * scale;
    if (left < frame.scrollLeft + 80 || left > frame.scrollLeft + frame.clientWidth - 80) {
      frame.scrollLeft = Math.max(0, left - frame.clientWidth / 2);
    }
  };

  const setLabel = (): void => {
    const stepping = motion.matches;
    word.textContent = stepping ? "Next note" : running ? "Pause" : "Play";
    icons.forEach((icon) => {
      const kind = icon.dataset["playIcon"];
      icon.hidden = stepping ? kind !== "play" : kind !== (running ? "pause" : "play");
    });
    button?.setAttribute("aria-label", stepping ? "Show the next note" : running ? "Pause the demonstration" : "Play the demonstration");
  };

  const tick = (now: number): void => {
    if (!running) return;
    if (now - last >= STEP_MS) {
      last = now;
      index += 1;
      show();
    }
    frameId = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    running = false;
    cancelAnimationFrame(frameId);
    setLabel();
  };

  button.addEventListener("click", (event) => {
    if (motion.matches) {
      index += 1;
      show();
      return;
    }
    if (running) {
      stop();
    } else {
      running = true;
      last = event.timeStamp;
      setLabel();
      frameId = requestAnimationFrame(tick);
    }
  });

  // a hidden tab pauses the demonstration, as a practice piece pauses
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && running) stop();
  });
  motion.addEventListener("change", () => {
    stop();
    setLabel();
  });

  controls.hidden = false;
  setLabel();
  show();
  // start with the lit key in view on a narrow screen
  frame.scrollLeft = Math.max(0, (centres.get(at(0))?.centre ?? 0) * (frame.scrollWidth / WIDTH) - frame.clientWidth / 2);
}

export {};
