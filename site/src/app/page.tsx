import { Callout } from "../components/Callout.tsx";
import { Icon } from "../components/Icon.tsx";
import { JsonLd } from "../components/JsonLd.tsx";
import { KeyboardFigure } from "../components/KeyboardFigure.tsx";
import { Page } from "../components/Page.tsx";
import { Status } from "../components/Status.tsx";
import { StudioMoment } from "../components/StudioMoment.tsx";
import { FAQ } from "../data/faq.ts";
import { PARTS, STATUS_ORDER, STATUS_WORD, VERIFIED } from "../data/status.ts";
import { pageMeta } from "../lib/meta.ts";
import { REPO_URL, SITE_URL } from "../site.config.ts";

export const metadata = pageMeta({
  title: "MELOPHOS: song made visible",
  description: "MELOPHOS is an open source system for learning the piano with light. The Studio app works in your browser today. The hub with LED bars is in design and no board has been made.",
  path: "/",
});

// the words of the status list, joined as a sentence with no comma before the last
const words = STATUS_ORDER.map((s) => STATUS_WORD[s]);
const wordList = `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;

// what the page shows, for search engines: the site, the project and the questions with their answers
const STRUCTURED = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": `${SITE_URL}/#site`, url: `${SITE_URL}/`, name: "MELOPHOS", inLanguage: "en-GB" },
    { "@type": "Organization", "@id": `${SITE_URL}/#project`, name: "MELOPHOS", url: `${SITE_URL}/`, logo: `${SITE_URL}/brand/melophos-mark.svg`, sameAs: [REPO_URL] },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a.join(" ") } })),
    },
  ],
};

const STUDIO_PICTURE =
  "The Studio's keyboard from C 2 to C 5 on Brother John, hands together, at the start of bar 3. Above the keys the falling notes come down to the keys they name: the right hand as solid amber bars, the left hand as hatched blue bars. On the rail of lights the next right hand note, E 4, has an amber disc and the next left hand note, C 3, has a blue square. The notes after them have a ring or a hollow square.";

export default function Home() {
  return (
    <Page path="/" bleed>
      <JsonLd data={STRUCTURED} />
      <section className="stage" aria-labelledby="top">
        <div className="wrap">
          <h1 id="top" className="stage-title">Song made visible</h1>
          <p className="lead">
            MELOPHOS is an open source system for learning the piano with light. A bar of lights above the keys is designed to show the next note to play, right where your hands are. The Studio, an app in your browser, already does the same on screen.
          </p>
          <div className="actions">
            <a className="button button-primary" href="/try">
              <Icon name="play" /> Try the Studio in your browser
            </a>
            <a href="/how-it-works/">How it works</a>
          </div>
          <KeyboardFigure>
            A drawing of the idea, not a photograph. In the drawing the bar of lights is designed to sit above the keys. The light for the next note is a large amber disc and the two notes after it are small rings. Amber is the right hand. Press Play to watch a short exercise move along the keys. No hub has been made yet, so no real bar looks like this yet.
          </KeyboardFigure>
        </div>
      </section>

      <div className="wrap">
        <p className="status-line">
          <strong>Where it stands on {VERIFIED}.</strong> The Studio, the server and the scoring engine are built and tested on a computer. The hub firmware is tested on a computer and has never run on a board. No board has been made.
        </p>

        <div className="split">
          <section aria-labelledby="who">
            <h2 id="who">Who it is for</h2>
            <ul className="rows">
              <li className="row">
                <p className="name">People learning the piano at home</p>
                <p>From a first lesson on. The Studio shows the next note on the key and waits for you to play it, so a piece can be followed without reading music.</p>
              </li>
              <li className="row">
                <p className="name">Players who find screens hard to follow</p>
                <p>Looking from a screen to the keys and back is hard for some players. MELOPHOS began with one of them, as the <a href="/about/#founders-note">founder&apos;s note</a> tells.</p>
              </li>
              <li className="row">
                <p className="name">Families and teachers</p>
                <p>A practice tool with no account and no advertising. The record stays on your own device unless you link a server you run.</p>
              </li>
              <li className="row">
                <p className="name">People who build things</p>
                <p>The software and the hardware designs are open. You can run the server at home and change any part of it.</p>
              </li>
            </ul>
          </section>

          <section aria-labelledby="why">
            <h2 id="why">Why it is built this way</h2>
            <p>MELOPHOS separates the lights from the instrument and keeps the practice record with the player. Three choices follow from that.</p>
            <ul className="rows">
              <li className="row">
                <p className="name">The lights belong to the player</p>
                <p>The same hub is meant to move from a first keyboard to a better piano.</p>
              </li>
              <li className="row">
                <p className="name">The data belongs to the player</p>
                <p>Practice history is meant to live on a server you run and not in someone else&apos;s cloud.</p>
              </li>
              <li className="row">
                <p className="name">The design is open</p>
                <p>The software is under the AGPL and the hardware designs are under CERN-OHL-S. The licences let anyone build on it and require changes to be shared. The hardware is written as requirements so far and no design files exist yet.</p>
              </li>
            </ul>
            <p>
              Accessibility is a design goal from the first revision. The <a href="/accessibility/">Accessibility page</a> lists what is built and what is planned.
            </p>
          </section>
        </div>

        <section className="section" aria-labelledby="studio-today">
          <h2 id="studio-today">The Studio, as it looks today</h2>
          <p className="prose">
            This is the Studio&apos;s own keyboard and falling notes, drawn by the same code the app runs, on one moment of a built-in piece. The hands differ by shape as well as colour: a disc and solid bars for the right hand, a square and hatched bars for the left.
          </p>
          <StudioMoment label={STUDIO_PICTURE} />
          <p className="prose">
            <a href="/try">Open the Studio with a simulated player</a> to see it move. It needs no keyboard.
          </p>
        </section>

        <section className="section" aria-labelledby="built">
          <h2 id="built">What is built today</h2>
          <p className="prose">
            Each part carries a status word: {wordList}. <a href="/roadmap/#words">What each word means</a> is on the roadmap. This list was checked against the repository on {VERIFIED}.
          </p>
          <ul className="rows">
            {PARTS.map((part) => (
              <li className="row row-part" key={part.id}>
                <div className="who">
                  <p className="name">{part.name}</p>
                  <p>
                    <Status status={part.status} />
                  </p>
                </div>
                <div className="detail">
                  <p>{part.built}</p>
                  {part.todo && (
                    <p>
                      <strong>Not built yet:</strong> {part.todo}
                    </p>
                  )}
                  {part.unchecked && (
                    <p>
                      <Status status="unchecked" /> {part.unchecked}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Callout kind="important">
            <p>Nothing here has run on real hardware. No board has been made. Everything described as built is software that is tested on a computer.</p>
          </Callout>
          <p>
            The <a href="/roadmap/">roadmap</a> lists what comes next and in what order.
          </p>
        </section>

        <section className="section" aria-labelledby="browsers">
          <h2 id="browsers">What you need to try the Studio</h2>
          <p className="prose">
            The Studio runs in a web browser. You do not need a keyboard, because the on-screen keys and the home row of your computer keyboard play and a simulated player can run through a piece for you. To play your own keyboard it must reach the browser through Web MIDI. Browsers differ.
          </p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Browser support table, scrolls sideways">
            <table>
              <caption className="visually-hidden">Browser support for connecting a MIDI keyboard to the Studio</caption>
              <thead>
                <tr>
                  <th scope="col">Browser</th>
                  <th scope="col">Connect a MIDI keyboard</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Chrome and Edge</th>
                  <td>Yes</td>
                </tr>
                <tr>
                  <th scope="row">Firefox on a computer, version 108 or later</th>
                  <td>Yes. Firefox asks to install a site permission add-on the first time</td>
                </tr>
                <tr>
                  <th scope="row">Safari and every browser on an iPhone or iPad</th>
                  <td>No. These browsers cannot reach MIDI devices. The on-screen keys work there</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="prose">Every browser needs a secure address (https) or localhost for this. We have tried only Chromium. The other rows follow the Studio&apos;s README and have not been tried by us.</p>
        </section>

        <section className="section" aria-labelledby="questions">
          <h2 id="questions">Questions people ask</h2>
          <dl className="faq">
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt>{f.q}</dt>
                <dd>
                  {f.a.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="next-step" aria-labelledby="start">
          <h2 id="start">Play your first piece with light</h2>
          <p className="prose">Try it opens a short piece in the Studio. Press Play the demo and a simulated player runs through it, so you can watch the lights before you play a note yourself.</p>
          <div className="actions">
            <a className="button button-primary" href="/try">
              <Icon name="play" /> Try the Studio
            </a>
            <a href="/contact/">Ask us a question</a>
          </div>
        </section>
      </div>
    </Page>
  );
}
