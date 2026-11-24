// the icon set: Phosphor, bold weight, one stroke weight at every size.
// each icon is imported on its own, so a build carries only the ones named here.
// phosphor is MIT licensed, see the package licence. standard marks stay standard (section 5.6).

import arrowSquareOut from "@phosphor-icons/core/assets/bold/arrow-square-out-bold.svg?raw";
import bluetooth from "@phosphor-icons/core/assets/bold/bluetooth-bold.svg?raw";
import caretDown from "@phosphor-icons/core/assets/bold/caret-down-bold.svg?raw";
import caretLeft from "@phosphor-icons/core/assets/bold/caret-left-bold.svg?raw";
import check from "@phosphor-icons/core/assets/bold/check-bold.svg?raw";
import downloadSimple from "@phosphor-icons/core/assets/bold/download-simple-bold.svg?raw";
import gear from "@phosphor-icons/core/assets/bold/gear-bold.svg?raw";
import info from "@phosphor-icons/core/assets/bold/info-bold.svg?raw";
import keyboard from "@phosphor-icons/core/assets/bold/keyboard-bold.svg?raw";
import magnifyingGlass from "@phosphor-icons/core/assets/bold/magnifying-glass-bold.svg?raw";
import metronome from "@phosphor-icons/core/assets/bold/metronome-bold.svg?raw";
import monitor from "@phosphor-icons/core/assets/bold/monitor-bold.svg?raw";
import moon from "@phosphor-icons/core/assets/bold/moon-bold.svg?raw";
import pause from "@phosphor-icons/core/assets/bold/pause-bold.svg?raw";
import play from "@phosphor-icons/core/assets/bold/play-bold.svg?raw";
import repeat from "@phosphor-icons/core/assets/bold/repeat-bold.svg?raw";
import skipForward from "@phosphor-icons/core/assets/bold/skip-forward-bold.svg?raw";
import skipBack from "@phosphor-icons/core/assets/bold/skip-back-bold.svg?raw";
import trophy from "@phosphor-icons/core/assets/bold/trophy-bold.svg?raw";
import trash from "@phosphor-icons/core/assets/bold/trash-bold.svg?raw";
import uploadSimple from "@phosphor-icons/core/assets/bold/upload-simple-bold.svg?raw";
import speakerHigh from "@phosphor-icons/core/assets/bold/speaker-high-bold.svg?raw";
import stop from "@phosphor-icons/core/assets/bold/stop-bold.svg?raw";
import sun from "@phosphor-icons/core/assets/bold/sun-bold.svg?raw";
import usb from "@phosphor-icons/core/assets/bold/usb-bold.svg?raw";
import warning from "@phosphor-icons/core/assets/bold/warning-bold.svg?raw";
import x from "@phosphor-icons/core/assets/bold/x-bold.svg?raw";

export interface IconInfo {
  svg: string;
  // the word that goes beside the mark. It is also its accessible name when it stands alone
  label: string;
  // what the standard mark means, from section 5.6
  meaning: string;
}

export const ICONS = {
  play: { svg: play, label: "Play", meaning: "A right-pointing triangle starts the piece" },
  pause: { svg: pause, label: "Pause", meaning: "Two bars hold the piece where it is" },
  stop: { svg: stop, label: "Stop", meaning: "A square ends the piece" },
  restart: { svg: skipBack, label: "Restart", meaning: "The return-to-start mark" },
  loop: { svg: repeat, label: "Loop", meaning: "The standard repeat arrows" },
  sun: { svg: sun, label: "Light", meaning: "The light theme, with the moon beside it" },
  moon: { svg: moon, label: "Dark", meaning: "The dark theme, with the sun beside it" },
  system: { svg: monitor, label: "System", meaning: "The theme follows the device setting" },
  settings: { svg: gear, label: "Settings", meaning: "A cog opens the settings" },
  search: { svg: magnifyingGlass, label: "Search", meaning: "A magnifier starts a search" },
  close: { svg: x, label: "Close", meaning: "A cross closes a dialog. On a key it also marks a wrong note" },
  back: { svg: caretLeft, label: "Back", meaning: "A left chevron goes back one step" },
  disclosure: { svg: caretDown, label: "Show more", meaning: "A chevron opens a disclosure row" },
  volume: { svg: speakerHigh, label: "Volume", meaning: "A speaker sets the sound" },
  bluetooth: { svg: bluetooth, label: "Bluetooth", meaning: "The Bluetooth mark" },
  usb: { svg: usb, label: "USB", meaning: "The USB mark" },
  external: { svg: arrowSquareOut, label: "Opens another site", meaning: "A link that leaves the site carries this mark and says so" },
  download: { svg: downloadSimple, label: "Download", meaning: "A download carries this mark and the file size" },
  keyboard: { svg: keyboard, label: "Keyboard", meaning: "A MIDI keyboard or the keys on screen" },
  next: { svg: skipForward, label: "Next phrase", meaning: "Skips on to the start of the next phrase" },
  trash: { svg: trash, label: "Delete", meaning: "Deletes what is named beside it" },
  upload: { svg: uploadSimple, label: "Import", meaning: "Brings a file into the app" },
  trophy: { svg: trophy, label: "Best", meaning: "Marks a personal best, always with the words New best" },
  tick: { svg: check, label: "Done", meaning: "A tick on a step card that was played right" },
  metronome: { svg: metronome, label: "Metronome", meaning: "The click that accents the first beat" },
  info: { svg: info, label: "Information", meaning: "A neutral note" },
  warning: { svg: warning, label: "Problem", meaning: "A problem that needs the player's attention" },
} as const satisfies Record<string, IconInfo>;

export type IconName = keyof typeof ICONS;

// inline markup that takes its colour and size from the text around it
export function iconMarkup(name: IconName, className = "icon"): string {
  return ICONS[name].svg.replace("<svg ", `<svg class="${className}" aria-hidden="true" focusable="false" `);
}
