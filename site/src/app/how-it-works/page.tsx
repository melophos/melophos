import { Callout } from "../../components/Callout.tsx";
import { ExtLink } from "../../components/ExtLink.tsx";
import { Page } from "../../components/Page.tsx";
import { Signal } from "../../components/Signal.tsx";
import { Status } from "../../components/Status.tsx";
import { HUB_CLAIMS } from "../../data/hub-state.ts";
import { SCORING_CLAIMS } from "../../data/scoring-state.ts";
import { PARTS, VERIFIED } from "../../data/status.ts";
import { fact, figure } from "../../lib/facts.ts";
import { pageMeta } from "../../lib/meta.ts";
import { readRepo } from "../../lib/repo.ts";

export const metadata = pageMeta({
  title: "How it works",
  description: "The instrument sends notes, the hub lights the next key and the Studio and the server keep the record. Each part says whether it is built.",
  path: "/how-it-works/",
});

const hub = HUB_CLAIMS as Record<string, (typeof HUB_CLAIMS)[string]>;
const part = (id: string) => PARTS.find((p) => p.id === id);

interface Role {
  id: string;
  label: string;
  shape: string;
  word: string;
  timing: string;
  token: string | null;
}
const colourWord: Record<string, string> = {
  "--light-right": "Amber",
  "--light-left": "Blue",
  "--light-right-soon": "Dim amber",
  "--light-left-soon": "Dim blue",
  "--light-wrong": "Rose-magenta",
};

const INPUTS: [string, string][] = [
  ["MIDI jack", "jack"],
  ["USB-MIDI", "usb"],
  ["Bluetooth MIDI", "ble"],
  ["Audio input", "audio"],
];

export default function HowItWorks() {
  const roles = (JSON.parse(readRepo("studio/src/styles/lights.json")) as { roles: Role[] }).roles;
  const studio = part("studio");
  return (
    <Page path="/how-it-works/" section="how-it-works">
      <h1 className="page-title">How it works</h1>
      <p className="lead lead-wide">Three jobs in order. The instrument sends the notes. The hub is designed to light the next key. The Studio and the server keep the record. Each statement says whether it is built, as of {VERIFIED}.</p>

      <figure className="how-figure" aria-labelledby="flow-caption">
        <div className="frame" tabIndex={0} role="region" aria-label="Diagram, scrolls sideways">
          <svg viewBox="0 0 810 300" role="img" aria-labelledby="flow-title flow-desc" focusable="false">
            <title id="flow-title">How the parts connect</title>
            <desc id="flow-desc">The instrument sends notes to the hub. The hub lights the LED bars and sends sessions to the server over Wi-Fi. The server stores them in a database. The Studio in the browser talks to the server and can also read the instrument directly through Web MIDI.</desc>
            <defs>
              <marker id="head" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto-start-reverse">
                <path className="d-arrow" d="M1 1 L9 5 L1 9 Z" />
              </marker>
            </defs>
            <rect className="d-box" x="20" y="30" width="170" height="70" rx="8" />
            <text className="d-text-bold" x="105" y="62" textAnchor="middle">Instrument</text>
            <text className="d-text" x="105" y="84" textAnchor="middle">Keyboard</text>

            <rect className="d-box" x="320" y="30" width="170" height="70" rx="8" />
            <text className="d-text-bold" x="405" y="62" textAnchor="middle">Hub</text>
            <text className="d-text" x="405" y="84" textAnchor="middle">Behind the instrument</text>

            <rect className="d-box-rail" x="620" y="30" width="170" height="70" rx="8" />
            <circle className="d-light" cx="705" cy="52" r="8" />
            <text className="d-text-rail" x="705" y="86" textAnchor="middle">LED bars</text>

            <rect className="d-box" x="320" y="200" width="170" height="70" rx="8" />
            <text className="d-text-bold" x="405" y="232" textAnchor="middle">Server</text>
            <text className="d-text" x="405" y="254" textAnchor="middle">You run it</text>

            <rect className="d-box" x="620" y="200" width="170" height="70" rx="8" />
            <text className="d-text-bold" x="705" y="232" textAnchor="middle">Database</text>
            <text className="d-text" x="705" y="254" textAnchor="middle">Every note</text>

            <rect className="d-box" x="20" y="200" width="170" height="70" rx="8" />
            <text className="d-text-bold" x="105" y="232" textAnchor="middle">Studio</text>
            <text className="d-text" x="105" y="254" textAnchor="middle">In the browser</text>

            <line className="d-line" x1="190" y1="65" x2="318" y2="65" markerEnd="url(#head)" />
            <text className="d-text" x="255" y="52" textAnchor="middle">MIDI notes</text>
            <line className="d-line" x1="490" y1="65" x2="618" y2="65" markerEnd="url(#head)" />
            <text className="d-text" x="555" y="52" textAnchor="middle">Light</text>
            <line className="d-line" x1="405" y1="100" x2="405" y2="198" markerEnd="url(#head)" />
            <text className="d-text" x="417" y="155">Sessions over Wi-Fi</text>
            <line className="d-line" x1="490" y1="235" x2="618" y2="235" markerEnd="url(#head)" />
            <text className="d-text" x="555" y="222" textAnchor="middle">Stores</text>
            <line className="d-line" x1="192" y1="235" x2="318" y2="235" markerStart="url(#head)" markerEnd="url(#head)" />
            <text className="d-text" x="255" y="222" textAnchor="middle">HTTPS</text>
            <line className="d-line d-dash" x1="105" y1="102" x2="105" y2="198" markerEnd="url(#head)" />
            <text className="d-text" x="117" y="155">Web MIDI</text>
          </svg>
        </div>
        <figcaption id="flow-caption">The parts and how they connect. The solid lines are the main path and the dashed line is the Studio reading the instrument directly. The same facts are in the three sections below.</figcaption>
      </figure>

      <section className="section prose" aria-labelledby="notes">
        <h2 id="notes">1. The instrument sends the notes</h2>
        <p>MELOPHOS needs to know what is being played. The hub is designed to read an instrument in several ways and each way has its own status.</p>
        <ul className="rows">
          {INPUTS.map(([name, id]) => (
            <li className="row row-wide" key={id}>
              <p className="name">{name}</p>
              <div className="detail">
                <p>
                  <Status status={hub[id]!.status} />
                </p>
                <p>{hub[id]!.text}</p>
              </div>
            </li>
          ))}
          <li className="row row-wide">
            <p className="name">The Studio, directly</p>
            <div className="detail">
              <p>
                <Status status="built" />
              </p>
              <p>
                The Studio reads a keyboard in the browser through Web MIDI. No hub is needed. <a href="/#browsers">Which browsers can do this</a> is on the home page.
              </p>
            </div>
          </li>
        </ul>
        <p>
          Each instrument is described by a profile, a small JSON file that says which notes it plays and how the lights are laid out. There are profiles for keyboards of 61, 76 and 88 keys and for a six-string guitar. A new instrument is designed to be a new file and not a rebuild. See <ExtLink href="https://github.com/melophos/melophos/blob/main/profiles/README.md">the profiles README</ExtLink>.
        </p>
      </section>

      <section className="section prose" aria-labelledby="lights">
        <h2 id="lights">2. The hub is designed to light the next key</h2>
        <p>The lights are designed to sit on one flat line just above the keys. The light is meant to be on the key itself and not on a screen the eyes have to move between. For a player with monocular vision this is meant to remove any need to judge depth. It has not been tried by a player.</p>
        <ul className="rows">
          <li className="row row-wide">
            <p className="name">Melody</p>
            <div className="detail">
              <p>Lights the next note and waits for it for as long as it takes. A chord can be played in any order.</p>
            </div>
          </li>
          <li className="row row-wide">
            <p className="name">Rhythm</p>
            <div className="detail">
              <p>
                Holds a tempo from {fact("bpmMin")} to {figure("bpmMax")} after a count-in. Each note must land inside a timing window and the hub scores hits, early, late, missed and wrong notes.
              </p>
            </div>
          </li>
          <li className="row row-wide">
            <p className="name">Listen</p>
            <div className="detail">
              <p>Plays the guide by itself so the player watches and listens.</p>
            </div>
          </li>
        </ul>
        <p>
          <Status status="host" /> for the hub firmware and <Status status="built" /> for the Studio, which has all three modes on screen. In the Studio Rhythm and Listen show falling notes.
        </p>
        <Callout kind="note">
          <p>{hub["colours"]!.text} Red sits too close to amber for some colour vision, which is why the wrong note is rose-magenta.</p>
        </Callout>
        <h3>What each light means</h3>
        <p>Every light has a colour and a second signal, so a player who cannot tell the colours apart can still follow it.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Light meanings table, scrolls sideways">
          <table>
            <caption className="visually-hidden">The meaning of each light</caption>
            <thead>
              <tr>
                <th scope="col">Light</th>
                <th scope="col">Colour</th>
                <th scope="col">Second signal</th>
                <th scope="col">Word</th>
                <th scope="col">Timing</th>
              </tr>
            </thead>
            <tbody>
              {roles
                .filter((r) => r.id !== "right")
                .map((r) => (
                  <tr key={r.id}>
                    <th scope="row">{r.label}</th>
                    <td>{r.token ? (colourWord[r.token] ?? "") : "None"}</td>
                    <td><Signal role={r.id}>{r.shape}</Signal></td>
                    <td>{r.word}</td>
                    <td>{r.timing}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p>
          When a right note is played its light goes out and the next one comes on. The hands are told apart by colour and by shape, because amber and blue are close in brightness. On the real bar they differ by colour and position only. The accessibility page <a href="/accessibility/#colour">measures the colours</a>.
        </p>
      </section>

      <section className="section prose" aria-labelledby="record">
        <h2 id="record">3. The Studio and the server keep the record</h2>
        <p>The Studio is the screen. The server is the memory. They work together and the Studio also works alone.</p>
        <ul className="rows">
          <li className="row row-wide">
            <p className="name">Studio</p>
            <div className="detail">
              <p>
                <Status status="partly" />
              </p>
              <p>
                {studio!.built} Not built yet: {studio!.todo} Not yet checked: {studio!.unchecked}
              </p>
            </div>
          </li>
          <li className="row row-wide">
            <p className="name">Server</p>
            <div className="detail">
              <p>
                <Status status="built" />
              </p>
              <p>Stores each practice session and every note in a database. It pairs hubs and keeps accounts for the people who run it. It is designed to run from Docker Compose on a home server or a small VPS, with a script that builds the images on your machine until a release exists. It has not been run with a real hub.</p>
            </div>
          </li>
          <li className="row row-wide">
            <p className="name">Scoring engine</p>
            <div className="detail">
              <p>
                <Status status="progress" />
              </p>
              <p>One piece of Rust code is built for the browser and for the server, so that a performance gets the same score in both places.</p>
              <p>
                {SCORING_CLAIMS.lines!.text} {SCORING_CLAIMS.verdicts!.text} {SCORING_CLAIMS.timing!.text} {SCORING_CLAIMS.studioTells!.text}
              </p>
              <p>{SCORING_CLAIMS.limits!.text}</p>
              <p>
                <Status status="unchecked" /> {SCORING_CLAIMS.synthetic!.text} A real player and a real keyboard.
              </p>
            </div>
          </li>
          <li className="row row-wide">
            <p className="name">Hub and Studio together</p>
            <div className="detail">
              <p>
                <Status status="planned" />
              </p>
              <p>{hub["studioControl"]!.text}</p>
            </div>
          </li>
        </ul>
        <p>
          The project runs no server for players. Practice data stays in your own browser or on a server you run. See <a href="/privacy/">Privacy</a>.
        </p>
        <h3>A practice session, step by step</h3>
        <ol>
          <li>The instrument sends a note on and a note off.</li>
          <li>The hub lights the next notes to play.</li>
          <li>The hub publishes the notes in batches to the server's broker over Wi-Fi.</li>
          <li>Two minutes without a note ends the session and the hub sends the finished session.</li>
          <li>The server stores the session and its summary.</li>
          <li>The Studio can ask the server for the list of sessions and show them.</li>
        </ol>
        <p>
          The messages and the routes are written down in <a href="/docs/protocol/">Protocol</a>. Steps 3 to 6 are built on the server side. The Studio can read sessions from a server you run when you type its address. No hub has run these steps on a board.
        </p>
      </section>
    </Page>
  );
}
