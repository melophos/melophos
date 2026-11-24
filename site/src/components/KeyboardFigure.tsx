import type { ReactNode } from "react";
import { HEIGHT, WIDTH, initialDescription, keyboardMarkup } from "../lib/keyboard-svg.ts";
import { Icon } from "./Icon.tsx";

// the drawing is made at build time, so it is a still picture with scripts off. src/client/figure.ts adds Play
export function KeyboardFigure({ children }: { children: ReactNode }) {
  return (
    <figure className="keyboard-figure" data-keyboard-figure="">
      <div className="frame" data-frame="" tabIndex={0} role="region" aria-label="Keyboard drawing, scrolls sideways">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="kb-title kb-desc" focusable="false">
          <title id="kb-title">A piano keyboard with a rail of lights above it</title>
          <desc id="kb-desc">{initialDescription()}</desc>
          <g dangerouslySetInnerHTML={{ __html: keyboardMarkup() }} />
        </svg>
      </div>
      <div className="figure-controls" data-controls="" hidden>
        <button type="button" className="button-primary" data-play="" aria-label="Play the demonstration">
          <span data-play-icon="play">
            <Icon name="play" />
          </span>
          <span data-play-icon="pause" hidden>
            <Icon name="pause" />
          </span>
          <span data-play-word="">Play</span>
        </button>
        <p data-readout=""></p>
      </div>
      <figcaption>{children}</figcaption>
    </figure>
  );
}
