import type { ReactNode } from "react";
import { findSong } from "../../pieces";
import { hrefFor } from "../router";
import { lastSetup, useSessions } from "../runtime";
import { ButtonLink, Icon, formatDateTime } from "../ui";
import { updateSettings, useSettings } from "../settings";
import { Link } from "../ui";

// the four signals a player meets first, drawn with the same shapes the keyboard's rail uses. the words carry the
// meaning, so the drawing is hidden from a screen reader
const SIGNALS: { id: string; shape: ReactNode; name: string; text: string }[] = [
  { id: "next-right", shape: <circle className="sig-right" cx="20" cy="20" r="12" />, name: "Next note, right hand", text: "A large amber disc over the key to play now." },
  { id: "next-left", shape: <rect className="sig-left" x="8" y="8" width="24" height="24" />, name: "Next note, left hand", text: "A large blue square. The left hand is also drawn dimmer." },
  { id: "soon", shape: <circle className="sig-soon" cx="20" cy="20" r="7" />, name: "Coming up", text: "A small ring over the notes after that. The left hand has a hollow square." },
  { id: "wrong", shape: <path className="sig-wrong" d="M11 11 L29 29 M29 11 L11 29" />, name: "Wrong note", text: "A cross on the key you pressed and the words wrong note. The light you were following stays where it is." },
];

function SpeechOffer(): ReactNode {
  return (
    <section className="panel" aria-labelledby="speech" data-testid="speech-offer">
      <h2 id="speech">Spoken note names</h2>
      <p>The Studio can say each next note aloud in Melody mode, for example &quot;C sharp 4&quot;. It uses a voice that runs on your device and never an online voice unless you allow one in Settings. You can change this at any time.</p>
      <div className="actions">
        <button type="button" className="button-primary" onClick={() => updateSettings({ spoken: true, speechOffered: true })}>
          Turn on spoken note names
        </button>
        <button type="button" onClick={() => updateSettings({ speechOffered: true })}>
          Not now
        </button>
      </div>
      <p className="muted">
        More choices are in <Link to={["settings", "sound"]}>Sound settings</Link>.
      </p>
    </section>
  );
}

export function Start(): ReactNode {
  const { records } = useSessions();
  const settings = useSettings();
  const last = lastSetup();
  const lastPiece = last ? findSong(last.pieceId) : undefined;
  const lastRecord = records.at(-1);

  // a player who has practised before is offered their last piece first
  if (lastPiece && last) {
    return (
      <>
        <h1>MELOPHOS Studio</h1>
        <p className="lead">Practise with light guidance in your browser. It works with no hub, no account and no network once it has loaded.</p>
        <section className="panel" aria-labelledby="resume">
          <h2 id="resume">Carry on</h2>
          <p>
            {lastPiece.title}
            {lastRecord ? `, last practised ${formatDateTime(lastRecord.startedAt)}` : ""}.
          </p>
          <a className="button button-primary" href={hrefFor(["practise", lastPiece.id], last.query)}>
            <Icon name="play" />
            Resume {lastPiece.title}
          </a>
        </section>
        {settings.speechOffered ? null : <SpeechOffer />}
        <section className="panel" aria-labelledby="more">
          <h2 id="more">Or choose</h2>
          <div className="actions">
            <ButtonLink to={["library"]}>Open the library</ButtonLink>
            <ButtonLink to={["progress"]}>See your progress</ButtonLink>
          </div>
        </section>
      </>
    );
  }

  // the first visit: one question with two answers, the lights explained before the first piece and the one setting
  // worth asking about. everything is on the page at once, so nothing is hidden behind a step and nothing is stored
  return (
    <>
      <h1>MELOPHOS Studio</h1>
      <p className="lead">Learn a piece with a light on the key to play next. The Studio works in your browser with no hub, no account and no network once it has loaded.</p>

      <section className="welcome" aria-labelledby="first">
        <h2 id="first">How will you play today?</h2>
        <p>You can begin with nothing but this screen. A keyboard can be added at any time.</p>
        <ul className="choices">
          <li>
            <a className="choice choice-primary" href={hrefFor(["try"])}>
              <Icon name="keyboard" />
              <span className="choice-text">
                <span className="choice-name">Try it with no keyboard</span>
                <span className="choice-hint">Play the keys on screen or the home row of your computer keyboard, A to K. A simulated player can show you first.</span>
              </span>
            </a>
          </li>
          <li>
            <a className="choice" href={hrefFor(["devices"])}>
              <Icon name="usb" />
              <span className="choice-text">
                <span className="choice-name">Connect a keyboard</span>
                <span className="choice-hint">A keyboard with MIDI over USB, in Chrome, Edge or Firefox on a computer. Your browser asks before the Studio can reach it.</span>
              </span>
            </a>
          </li>
        </ul>
      </section>

      <section className="welcome" aria-labelledby="lights">
        <h2 id="lights">What the lights mean</h2>
        <p>The lights sit on a dark rail just above the keys. Each one has its own shape, so you can follow them without telling the colours apart.</p>
        <ul className="legend">
          {SIGNALS.map((s) => (
            <li key={s.id}>
              <svg className="legend-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
                <rect className="sig-bed" width="40" height="40" rx="6" />
                {s.shape}
              </svg>
              <span className="legend-text">
                <span className="legend-name">{s.name}</span>
                <span>{s.text}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted">When you play the right note its light goes out and the next one comes on. In Melody mode nothing moves until you play it, so take as long as you need.</p>
      </section>

      {settings.speechOffered ? null : <SpeechOffer />}

      <section className="welcome" aria-labelledby="more">
        <h2 id="more">Or choose a piece yourself</h2>
        <div className="actions">
          <ButtonLink to={["library"]}>Open the library</ButtonLink>
          <ButtonLink to={["progress"]}>See your progress</ButtonLink>
        </div>
      </section>
    </>
  );
}
