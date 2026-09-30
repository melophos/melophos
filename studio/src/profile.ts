export interface KeyboardProfile {
  id: string;
  lowest: number;
  highest: number;
}

// Mirrors profiles/piano-88.json so the Studio builds on its own. Other profiles
// load at runtime from the server once profile sync lands.
export const DEFAULT_PROFILE: KeyboardProfile = { id: "piano-88", lowest: 21, highest: 108 };
