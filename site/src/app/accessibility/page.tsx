import type { ReactNode } from "react";
import { ExtLink } from "../../components/ExtLink.tsx";
import { Page } from "../../components/Page.tsx";
import { Status } from "../../components/Status.tsx";
import type { Status as StatusKind } from "../../data/status.ts";
import { HUB_CLAIMS } from "../../data/hub-state.ts";
import { STUDIO_CLAIMS, STUDIO_READ_ON } from "../../data/studio-state.ts";
import { pageMeta } from "../../lib/meta.ts";
import { readRepo } from "../../lib/repo.ts";
import { CONTACT_EMAIL, REPO_URL, REVIEWED } from "../../site.config.ts";
import { contrastHex } from "../../../../studio/src/styles/colour.ts";
import { parseTokens, type PairsFile } from "../../../../studio/src/styles/tokens-model.ts";

export const metadata = pageMeta({
  title: "Accessibility",
  description: "What MELOPHOS does for accessibility, split into what is built and what is planned. It also holds the accessibility statement for this site and the Studio.",
  path: "/accessibility/",
});

const measured = [
  { what: "Body text on the page", id: "text-on-canvas" },
  { what: "Secondary text on the page", id: "text-muted-on-canvas" },
  { what: "Links and amber used as text", id: "accent-text-on-canvas" },
  { what: "The edge of a control", id: "border-strong-on-canvas" },
  { what: "The focus ring", id: "focus-on-canvas" },
  { what: "A problem mark", id: "problem-on-canvas" },
  { what: "The next-note light on the rail", id: "light-right-on-rail" },
];

function Row({ name, status, children }: { name: string; status: StatusKind; children: ReactNode }) {
  return (
    <li className="row row-wide">
      <p className="name">{name}</p>
      <div className="detail">
        <p>
          <Status status={status} />
        </p>
        <p>{children}</p>
      </div>
    </li>
  );
}

export default function Accessibility() {
  const tokens = parseTokens(readRepo("studio/src/styles/tokens.css"));
  const pairs = JSON.parse(readRepo("studio/src/styles/tokens.pairs.json")) as PairsFile;
  const ratio = (set: "light" | "dark", id: string): string => {
    const pair = pairs.pairs.find((p) => p.id === id);
    if (!pair) throw new Error(`no pair ${id} in tokens.pairs.json`);
    const fg = tokens.sets[set][pair.fg] ?? tokens.global[pair.fg];
    const bg = tokens.sets[set][pair.bg] ?? tokens.global[pair.bg];
    if (!fg || !bg) throw new Error(`pair ${id} has no value in the ${set} set`);
    return `${contrastHex(fg, bg).toFixed(1)} to 1`;
  };
  return (
    <Page path="/accessibility/" section="accessibility">
      <h1 className="page-title">Accessibility</h1>
      <p className="lead lead-wide">MELOPHOS started from one player's own need, which the founder's note on the About page tells. The same choices that meet it help many other players. This page says what is built and what is only planned.</p>
      <ul className="link-list">
        <li><a href="#built">What is built</a></li>
        <li><a href="#planned">What is planned</a></li>
        <li><a href="#studio-state">The Studio today</a></li>
        <li><a href="#colour">Colour, measured</a></li>
        <li><a href="#statement">Accessibility statement for this site and the Studio</a></li>
      </ul>

      <section className="section" aria-labelledby="built">
        <h2 id="built">What is built</h2>
        <p className="prose">Each line is true of the repository today. Anything about the hub's lights is firmware that is tested on a computer and awaits a board. No board has been made, so no light has been seen on a real bar.</p>
        <ul className="rows">
          <Row name="Reduced motion, hub" status={HUB_CLAIMS.calm!.status}>{HUB_CLAIMS.calm!.text} The Studio's own motion is listed under the Studio below.</Row>
          <Row name="A second signal for every light" status={HUB_CLAIMS.secondSignal!.status}>{HUB_CLAIMS.secondSignal!.text}</Row>
          <Row name="Flashing kept low" status={HUB_CLAIMS.flashing!.status}>{HUB_CLAIMS.flashing!.text}</Row>
          <Row name="A cap on light power" status={HUB_CLAIMS.ledCap!.status}>{HUB_CLAIMS.ledCap!.text}</Row>
          <Row name="Measured colours" status="built">The colours of this site and the Studio's new design are measured by tests that run on every change. They check contrast and how far apart the lights stay under three kinds of colour blindness.</Row>
          <Row name="A typeface for low vision" status="built">This site and the Studio's new design use Atkinson Hyperlegible, a typeface drawn by the Braille Institute so that letters such as I, l and 1 look different.</Row>
        </ul>
      </section>

      <section className="section" aria-labelledby="planned">
        <h2 id="planned">What is planned</h2>
        <p className="prose">Nothing in this list exists yet. It is listed so that nobody reads it as a promise already kept.</p>
        <ul className="rows">
          <Row name="Brightness per role" status="planned">Brightness set for each light meaning and a low-brightness mode that caps every light for people who are sensitive to light.</Row>
          <Row name="Colour vision palettes" status="planned">Alternative palettes for protanopia, deuteranopia and tritanopia. The firmware uses one fixed palette today, the same table as the Studio's.</Row>
          <Row name="A visual metronome on the hub" status="planned">On the hub's lights, kept under three flashes a second. The Studio has a beat indicator already.</Row>
        </ul>
      </section>

      <section className="section" aria-labelledby="studio-state">
        <h2 id="studio-state">The Studio, read on {STUDIO_READ_ON}</h2>
        <p className="prose">The Studio app was rebuilt recently and these statements describe it as it is on that date. Each one is checked against the Studio's own files when this site is built, so a statement that stops being true stops the build.</p>
        <h3>Built</h3>
        <ul className="rows">
          {STUDIO_CLAIMS.filter((c) => c.kind === "built").map((c) => (
            <li className="row row-wide" key={c.id}><p className="name">{c.title}</p><div className="detail"><p><Status status="built" /></p><p>{c.text}</p></div></li>
          ))}
        </ul>
        <h3>Not built and not yet checked</h3>
        <ul className="rows">
          {STUDIO_CLAIMS.filter((c) => c.kind !== "built").map((c) => (
            <li className="row row-wide" key={c.id}><p className="name">{c.title}</p><div className="detail"><p><Status status={c.kind} /></p><p>{c.text}</p></div></li>
          ))}
        </ul>
      </section>

      <section className="section" aria-labelledby="colour">
        <h2 id="colour">Colour, measured</h2>
        <p className="prose">These figures are worked out by the build from the same colour file that the page uses, so they cannot drift from what you see. The WCAG 2 level AA asks for 4.5 to 1 for text and 3 to 1 for marks. Body text here aims for 7 to 1 or more.</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Contrast table, scrolls sideways">
          <table>
            <caption className="visually-hidden">Contrast ratios for the light and dark themes</caption>
            <thead>
              <tr><th scope="col">What</th><th scope="col">Light theme</th><th scope="col">Dark theme</th></tr>
            </thead>
            <tbody>
              {measured.map((m) => (
                <tr key={m.id}><th scope="row">{m.what}</th><td>{ratio("light", m.id)}</td><td>{ratio("dark", m.id)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="prose">The rail is near-black in both themes because the real bar is. That keeps the amber light at a high contrast even on the light theme, where amber on paper is only about 1.7 to 1. On paper amber is used only as a fill behind dark text or inside a dark outline. There are also two more-contrast sets that apply when your system asks for more contrast.</p>
        <p className="prose">Amber and blue are the two hands. They differ by hue in every colour blindness test and by almost nothing in lightness, so each also carries a shape and a letter on screen. On the real bar the hands differ by hue and position only. That is a limit of the design and we state it openly.</p>
      </section>

      <section className="section prose" aria-labelledby="statement">
        <h2 id="statement">Accessibility statement for this site and the Studio</h2>
        <p>This statement covers melophos.com and the MELOPHOS Studio at app.melophos.com. It was last reviewed on {REVIEWED.text}.</p>
        <h3>The standard we aim for</h3>
        <p>We aim for the Web Content Accessibility Guidelines 2.2 at level AA. We also aim for the enhanced contrast of 7 to 1 for body text and for touch targets of 44 pixels or more. We have not had either surface audited by an outside body, so we do not claim conformance. We claim only what is tested below.</p>
        <h3>This site</h3>
        <ul>
          <li>Every page reads with scripts switched off. The site's own scripts are the theme toggle, the keyboard drawing's Play button and the still picture of the Studio on the home page. They run on React, which is sent with each page.</li>
          <li>Text is 16 pixels or larger and body text is 18 pixels. Sizes follow your browser's text size and the page works when zoomed to 200 per cent and at 320 pixels wide.</li>
          <li>Controls are 44 pixels or more and the focus ring is always visible. Links are underlined.</li>
          <li>Both themes follow your system setting and you can choose with the toggle at the foot of every page.</li>
          <li>Motion is limited to the Play button on the keyboard drawing. It never starts by itself and under reduced motion it steps one note for each press.</li>
          <li>Colour is never the only signal. Status words, marks and callouts carry a word as well.</li>
        </ul>
        <h3>How it is tested</h3>
        <p>On every change a script opens every page in a real browser in both themes. It runs the axe accessibility rules at WCAG 2.2 level A and AA plus enhanced contrast and target size. It also checks at 390, 768 and 1440 pixels wide and at 320 pixels wide for horizontal scrolling and for text under 16 pixels. It checks with scripts switched off and with reduced motion. The build fails on a broken link or an image with no description.</p>
        <h3>Known gaps</h3>
        <ul>
          <li><Status status="unchecked" /> No person who uses a screen reader has tested this site or the Studio yet. The automated checks find only part of the problems that people meet.</li>
          <li><Status status="unchecked" /> The Studio on a tablet on a music stand at a piano. The Studio in Firefox and Safari.</li>
          <li><Status status="unchecked" /> The hub's lights on a real bar, so we do not yet know how the colours look through a real diffuser.</li>
          <li>The full list for the Studio, read on {STUDIO_READ_ON}, is in the section above.</li>
        </ul>
        <h3>Tell us about a barrier</h3>
        <p>
          If something here does not work for you, tell us what you tried and what happened. Open a <ExtLink href={`${REPO_URL}/discussions`}>discussion on GitHub</ExtLink> or write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We treat accessibility problems as bugs.
        </p>
      </section>
    </Page>
  );
}
