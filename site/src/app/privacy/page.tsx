import { ExtLink } from "../../components/ExtLink.tsx";
import { Page } from "../../components/Page.tsx";
import { Status } from "../../components/Status.tsx";
import { STUDIO_READ_ON, studioClaim } from "../../data/studio-state.ts";
import { pageMeta } from "../../lib/meta.ts";
import { CONTACT_EMAIL, REVIEWED, placeholder } from "../../site.config.ts";

export const metadata = pageMeta({
  title: "Privacy",
  description: "What the MELOPHOS site, the Studio app and our community server store and send. The site sets no cookies and has no analytics. Some things are kept: a theme choice, the Studio's data in your browser, a moderation log and any email you send.",
  path: "/privacy/",
});

export default function Privacy() {
  return (
    <Page path="/privacy/">
      <h1 className="page-title">Privacy</h1>
      <p className="lead lead-wide">This page says what the MELOPHOS website, the Studio app and our community server store and send. Where we keep something about you it says what, for how long and why. It was last reviewed on {REVIEWED.text} and describes the Studio as read on {STUDIO_READ_ON}.</p>

      <section className="section prose" aria-labelledby="short">
        <h2 id="short">In short</h2>
        <ul>
          <li>This site has no accounts, no analytics, no cookies, no advertising and no third-party scripts, fonts or images. It stores one value in your browser and only if you choose a theme.</li>
          <li>The Studio app keeps your sessions, imported pieces, settings and an offline copy of its own files in your browser. It is built to send something over the network only to a server address that you type in yourself, apart from loading its own files from its host. That is marked Not yet checked below.</li>
          <li>The host of this site, Cloudflare, sees each request for a page under its own policy.</li>
          <li>
            Our Discord community server keeps a private moderation log for 12 months. <a href="/docs/community-privacy/">Community server privacy</a> has the detail.
          </li>
          <li>If you email us we keep your message for as long as the conversation needs.</li>
          <li>There is no cookie banner because the site sets no cookies. The one value it stores is a choice you make.</li>
        </ul>
      </section>

      <section className="section prose" aria-labelledby="site">
        <h2 id="site">This website</h2>
        <p>Every page is a plain file. Nothing you type here is sent anywhere, because the site has no forms. The site makes no request to any address other than its own.</p>
        <h3>Your theme choice</h3>
        <p>If you press Light or Dark in the footer the site writes one short word to your browser's local storage so that your choice is still there next time. It is stored on your device only and is not sent to anyone. Press System to remove it. If your browser blocks storage the site follows your system setting instead.</p>
        <h3>What the host sees</h3>
        <p>
          The site is served by Cloudflare Pages. As with any website, the host receives each request for a page. That includes your internet address and the browser details your browser sends. The host handles this under <ExtLink href="https://www.cloudflare.com/privacypolicy/">its own privacy policy</ExtLink>. We do not receive that information. Before this site goes live we switch off the host's visitor analytics, tag manager and email address rewriting and check on the live address that they are off. We do not announce the site until that check passes.
        </p>
      </section>

      <section className="section prose" aria-labelledby="studio">
        <h2 id="studio">The Studio app</h2>
        <p>
          The Studio is a separate app at app.melophos.com. Its files and its updates are served by <span className="placeholder">{placeholder("studioHost")}</span>, which receives the request for each file in the same way as the host of this site. The Studio runs in your browser. When you connect a MIDI keyboard your browser asks your permission. The notes you play are used on the page to light the keys and check your playing.
        </p>
        <h3>What the Studio keeps on your device</h3>
        <p><Status status={studioClaim("stores-in-browser").kind} /> {studioClaim("stores-in-browser").text}</p>
        <p><Status status={studioClaim("offline").kind} /> {studioClaim("offline").text}</p>
        <p>Clearing your browser's site data for app.melophos.com removes everything the Studio kept.</p>
        <h3>What the Studio sends and to whom</h3>
        <p><Status status={studioClaim("network").kind} /> {studioClaim("network").text}</p>
        <p><Status status={studioClaim("own-server").kind} /> {studioClaim("own-server").text}</p>
        <p>That server is yours. We do not run it and we do not receive what it holds. If someone else runs the server you type in, they receive what the Studio sends and their own privacy notice applies.</p>
        <h3>Spoken note names</h3>
        <p><Status status={studioClaim("spoken-voice").kind} /> {studioClaim("spoken-voice").text}</p>
      </section>

      <section className="section prose" aria-labelledby="community">
        <h2 id="community">Our Discord community</h2>
        <p>
          Discord runs the community server and is the controller of your account data there. We keep a private moderation log of automatic alerts and member reports for 12 months. It is seen by maintainers and moderators only. The bot cannot read the content of messages and keeps no database. The page <a href="/docs/community-privacy/">Community server privacy</a> lists everything and says how to ask us to remove an entry.
        </p>
      </section>

      <section className="section prose" aria-labelledby="self-hosted">
        <h2 id="self-hosted">If you run the server yourself</h2>
        <p>The MELOPHOS server is software you can run on your own machine. If you do, you decide what it stores and you are responsible for that data. The project does not run a server for players and does not host accounts.</p>
      </section>

      <section className="section prose" aria-labelledby="children">
        <h2 id="children">Children</h2>
        <p>
          People of any age can use the site and the Studio. Neither sends anything about a visitor to us. Discord sets its own minimum age for the community server and <a href="/docs/community-privacy/">the community page</a> says what we do when we learn that a member is under it. Before the project ever hosts an account it will review the plan against the UK Information Commissioner's Age Appropriate Design Code and this page will change first.
        </p>
      </section>

      <section className="section prose" aria-labelledby="contact">
        <h2 id="contact">Writing to us</h2>
        <p>
          If you email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> we use your address only to reply and we keep the message for as long as the conversation needs. You can ask us to show you or delete anything we hold about you by writing to the same address. If you are unhappy with how we handle it you can complain to the <ExtLink href="https://ico.org.uk/make-a-complaint/">Information Commissioner's Office</ExtLink>.
        </p>
        <dl className="facts">
          <dt>Legal person responsible</dt>
          <dd><span className="placeholder">{placeholder("legalPerson")}</span></dd>
          <dt>Email</dt>
          <dd><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></dd>
          {/* for the lawyer to confirm: no postal address is given, so check that email alone meets the duty to give contact details */}
          <dt>Post</dt>
          <dd>We do not give a postal address. Email reaches us about everything, including a request about your data.</dd>
        </dl>
      </section>

      <section className="section prose" aria-labelledby="changes">
        <h2 id="changes">Changes</h2>
        <p>When this page changes the date at the top changes. The older wording stays in the project's history on GitHub.</p>
      </section>
    </Page>
  );
}
