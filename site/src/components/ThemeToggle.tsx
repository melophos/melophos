import { Icon } from "./Icon.tsx";

// hidden until src/client/theme.ts runs, because without a script the buttons could do nothing
export function ThemeToggle() {
  return (
    <div className="theme-toggle" data-theme-toggle="" hidden>
      <span id="theme-label">Colour theme</span>
      <div className="options" role="group" aria-labelledby="theme-label">
        <button type="button" data-choice="light" aria-pressed="false">
          <Icon name="sun" /> Light
        </button>
        <button type="button" data-choice="dark" aria-pressed="false">
          <Icon name="moon" /> Dark
        </button>
        <button type="button" data-choice="system" aria-pressed="true">
          <Icon name="system" /> System
        </button>
      </div>
    </div>
  );
}
