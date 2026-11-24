// the questions on the home page. each answer is plain text so it can be shown on the page and given to search engines
// word for word. each one rests on something the repository shows today
export interface Question {
  q: string;
  a: string[];
}

export const FAQ: Question[] = [
  {
    q: "Do I need a hub or a special keyboard to start?",
    a: [
      "No. The Studio runs in a web browser and works with no hub, no account and no network once it has loaded. The keys on screen and the home row of your computer keyboard play, so you can begin with nothing else.",
      "If you have a keyboard with MIDI over USB, the Studio can read it in Chrome, Edge or Firefox on a computer.",
    ],
  },
  {
    q: "Can I buy a MELOPHOS hub or light bar?",
    a: ["Not yet. The hub and its light bars are in design and no board has been made. There is nothing to buy yet. The hardware page shows the draft design and the roadmap shows the order of the work."],
  },
  {
    q: "What does it cost?",
    a: ["There is nothing to buy and nothing to sign up for. The software is open source under the AGPL and anyone may use it, run it on their own computer and change it, as long as they share their changes under the same licence."],
  },
  {
    q: "Where is my practice record kept?",
    a: [
      "In your browser, on your device. The Studio keeps your sessions, imported pieces and settings there and sends them nowhere. If you run the MELOPHOS server yourself you can link the Studio to it. The record is then on your server.",
    ],
  },
  {
    q: "Is it suitable for children?",
    a: [
      "The Studio has no account, no advertising and no chat. It sends nothing about the player to us. The rhythm game has no streaks, no countdown and no comparison with other players. The browser asks before the Studio can reach a MIDI keyboard, so an adult may want to set that up. Our Discord community has its own minimum age.",
    ],
  },
  {
    q: "Does it work with a guitar?",
    a: ["Not yet. The design covers guitars: there is an instrument profile for a six-string guitar and the documents describe how a fret would be lit. The Studio shows a piano keyboard only today."],
  },
];
