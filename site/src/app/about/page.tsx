import { ExtLink } from "../../components/ExtLink.tsx";
import { Html } from "../../components/Html.tsx";
import { Page } from "../../components/Page.tsx";
import { FOUNDER_NOTE, FOUNDER_SIGNATURE } from "../../data/story.ts";
import { pageMeta } from "../../lib/meta.ts";
import { sectionOf } from "../../lib/sections.ts";
import { CONTACT_EMAIL, REPO_URL } from "../../site.config.ts";

export const metadata = pageMeta({ title: "About", description: "Why MELOPHOS exists, what its name means, who is behind it and how to get in touch.", path: "/about/" });

export default function About() {
  return (
    <Page path="/about/">
      <h1 className="page-title">About MELOPHOS</h1>
      <p className="lead lead-wide">An open source system for learning an instrument with light. We build it in the open and keep its design, its software and its data in the hands of the people who use it.</p>

      <section className="section prose" aria-labelledby="why">
        <h2 id="why">Why it exists</h2>
        <p>MELOPHOS is built to separate the lights from the instrument and to keep the practice record with the player. The founder's note below says where the idea came from.</p>
      </section>

      <section className="section" aria-labelledby="founders-note">
        <h2 id="founders-note">A note from the founder</h2>
        <figure className="note-signed">
          <blockquote>
            <p>{FOUNDER_NOTE}</p>
          </blockquote>
          <figcaption>
            <p className="signature">{FOUNDER_SIGNATURE}</p>
          </figcaption>
        </figure>
      </section>

      <section className="section prose" aria-labelledby="name">
        <h2 id="name">The name</h2>
        <Html html={sectionOf("README.md", "The name")} />
      </section>

      <section className="section prose" aria-labelledby="people">
        <h2 id="people">The people and how to reach us</h2>
        <p>
          MELOPHOS is made by its contributors and anyone may join. We work in public on <ExtLink href={REPO_URL}>GitHub</ExtLink>. The <a href="/contact/">contact page</a> says where each kind of message goes.
        </p>
        <dl className="facts">
          <dt>Questions and ideas</dt>
          <dd>
            <ExtLink href={`${REPO_URL}/discussions`}>GitHub Discussions</ExtLink>
          </dd>
          <dt>Bugs</dt>
          <dd>
            <ExtLink href={`${REPO_URL}/issues`}>GitHub issues</ExtLink>
          </dd>
          <dt>Anything else</dt>
          <dd>
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </dd>
          <dt>Security problems</dt>
          <dd>
            Never in a public issue. See <ExtLink href={`${REPO_URL}/blob/main/SECURITY.md`}>SECURITY.md</ExtLink>.
          </dd>
          <dt>Taking part</dt>
          <dd>
            Read <ExtLink href={`${REPO_URL}/blob/main/CONTRIBUTING.md`}>CONTRIBUTING.md</ExtLink> and the code of conduct before you start.
          </dd>
        </dl>
      </section>
    </Page>
  );
}
