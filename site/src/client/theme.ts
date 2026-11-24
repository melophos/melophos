// the theme toggle: light, dark or the system setting. the choice is kept in this browser only.

const KEY = "melophos-theme";
type Choice = "light" | "dark" | "system";

const root = document.documentElement;
const group = document.querySelector<HTMLElement>("[data-theme-toggle]");
const buttons = group ? Array.from(group.querySelectorAll<HTMLButtonElement>("button[data-choice]")) : [];

function current(): Choice {
  const t = root.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "system";
}

function paint(): void {
  const now = current();
  for (const b of buttons) b.setAttribute("aria-pressed", String(b.dataset["choice"] === now));
}

function choose(choice: Choice): void {
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // the choice still applies to this page
  }
  paint();
}

if (group && buttons.length > 0) {
  for (const b of buttons) b.addEventListener("click", () => choose((b.dataset["choice"] as Choice | undefined) ?? "system"));
  group.hidden = false;
  paint();
}

export {};
