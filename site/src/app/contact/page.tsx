import { ExtLink } from "../../components/ExtLink.tsx";
import { Page } from "../../components/Page.tsx";
import { pageMeta } from "../../lib/meta.ts";
import { CONTACT_EMAIL, REPO_URL, SECURITY_EMAIL, placeholder } from "../../site.config.ts";

export const metadata = pageMeta({
  title: "Contact",
  description: "How to reach the MELOPHOS project: questions and ideas on GitHub Discussions, bugs as GitHub issues, security problems in private and anything else by email.",
  path: "/contact/",
});

export default function Contact() {
  return (
    <Page path="/contact/">
      <h1 className="page-title">Contact</h1>
      <p className="lead lead-wide">Pick the place that fits what you want to say. Most of the project happens in public on GitHub, so an answer there helps the next person too.</p>

      <section className="section" aria-labelledby="where">
        <h2 id="where">Where to write</h2>
        <ul className="rows">
          <li className="row row-wide">
            <p className="name">A question or an idea</p>
            <p>
              Start a thread on <ExtLink href={`${REPO_URL}/discussions`}>GitHub Discussions</ExtLink>. You need a GitHub account to post and everything there is public.
            </p>
          </li>
          <li className="row row-wide">
            <p className="name">Something that does not work</p>
            <p>
              Open a <ExtLink href={`${REPO_URL}/issues`}>GitHub issue</ExtLink> with what you did, what you expected and what happened. A barrier to access counts as a bug.
            </p>
          </li>
          <li className="row row-wide">
            <p className="name">A security problem</p>
            <p>
              Never in a public issue. Follow <ExtLink href={`${REPO_URL}/blob/main/SECURITY.md`}>SECURITY.md</ExtLink> or write to <a href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a>.
            </p>
          </li>
          <li className="row row-wide">
            <p className="name">Anything else</p>
            <p>
              Email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. This includes a request to see or delete anything we hold about you.
            </p>
          </li>
          <li className="row row-wide">
            <p className="name">Taking part</p>
            <p>
              Read <ExtLink href={`${REPO_URL}/blob/main/CONTRIBUTING.md`}>CONTRIBUTING.md</ExtLink> and the code of conduct before you start.
            </p>
          </li>
        </ul>
      </section>

      <section className="section prose" aria-labelledby="before">
        <h2 id="before">Before you write</h2>
        <p>
          This site has no contact form, so nothing you type on it is sent anywhere. An email goes to us and we use your address only to reply. The <a href="/privacy/#contact">privacy page</a> says how long we keep it.
        </p>
        <p>If you are writing about a child, please do not send their name, age or school unless we ask for it to answer you.</p>
        <p>We are a small open source project and we do not promise a time to reply. A public question on GitHub may be answered sooner by someone else.</p>
      </section>

      <section className="section prose" aria-labelledby="who">
        <h2 id="who">Who is responsible</h2>
        <dl className="facts">
          <dt>Legal person responsible</dt>
          <dd><span className="placeholder">{placeholder("legalPerson")}</span></dd>
          <dt>Email</dt>
          <dd><a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></dd>
        </dl>
      </section>
    </Page>
  );
}
