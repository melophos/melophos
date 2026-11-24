import { ExtLink } from "../../components/ExtLink.tsx";
import { Page } from "../../components/Page.tsx";
import { Review } from "../../components/Review.tsx";
import { pageMeta } from "../../lib/meta.ts";
import { CONTACT_EMAIL, REVIEWED, placeholder, sourceUrl } from "../../site.config.ts";

export const metadata = pageMeta({
  title: "Terms of use",
  description: "The terms for using melophos.com and the MELOPHOS Studio, how the open source licences fit with them and what the draft hardware designs are not.",
  path: "/terms/",
});

export default function Terms() {
  return (
    <Page path="/terms/">
      <h1 className="page-title">Terms of use</h1>
      <p className="lead lead-wide">These terms cover this website and the MELOPHOS Studio at app.melophos.com. They are short because nothing here is sold and there is no account. They were last reviewed on {REVIEWED.text}.</p>
      <Review>These terms were written from what the site and the Studio really do. They have not yet been read by a lawyer and they are not a promise that the project meets any law. Each point marked like this one needs that review before the site goes live.</Review>

      <section className="section prose" aria-labelledby="who">
        <h2 id="who">Who we are</h2>
        <p>
          MELOPHOS is an open source project. The person responsible for it is <span className="placeholder">{placeholder("legalPerson")}</span>. You can reach us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> or on the <a href="/contact/">contact page</a>. Email reaches us about everything, including a legal notice. We give no postal address.
        </p>
        {/* for the lawyer to confirm: no postal address is given, so check that email alone is enough for notices */}
      </section>

      <section className="section prose" aria-labelledby="use">
        <h2 id="use">Using the site and the Studio</h2>
        <p>You may read this site and use the Studio without an account and without paying. Please do not try to break, overload or misuse either of them. Do not use them to harm anyone.</p>
        <p>The Studio keeps your practice in your own browser. You are responsible for keeping a copy if it matters to you: the Studio can export your sessions under Settings, Data.</p>
      </section>

      <section className="section prose" aria-labelledby="licences">
        <h2 id="licences">The software and the designs</h2>
        <p>
          The software is under the GNU Affero General Public License v3.0 or later and the hardware designs are under the CERN Open Hardware Licence v2, Strongly Reciprocal. Those licences say what you may do with the code and the designs. Nothing in these terms takes away a right the licences give you. The <a href="/licences/">licences page</a> says which covers what and the texts are in <ExtLink href={sourceUrl("LICENSE")}>the repository</ExtLink>.
        </p>
        <p>Both licences say the work comes with no warranty. The software may have faults and the scoring engine is still being worked on, so a score is only what the engine judged and not a measure of your skill.</p>
      </section>

      <section className="section prose" aria-labelledby="hardware">
        <h2 id="hardware">The hardware designs are drafts</h2>
        <p>No hub or light bar has been made and nothing in the hardware folder has been tested on a bench. The designs are drafts and may be wrong. Anyone who builds from them does so at their own risk and is responsible for the safety of what they build, including its power supply.</p>
        <Review>Under UK law a liability for death or personal injury caused by negligence cannot be excluded. Other limits must be fair. A lawyer should write the limit of liability for the site, the Studio and the designs.</Review>
      </section>

      <section className="section prose" aria-labelledby="server">
        <h2 id="server">If you run the server</h2>
        <p>The MELOPHOS server is software you run yourself. If you run it for other people you decide what it stores and you are responsible for their data and for telling them how you use it.</p>
      </section>

      <section className="section prose" aria-labelledby="name">
        <h2 id="name">The name and the mark</h2>
        <p>
          The name MELOPHOS and its mark identify the project. You may use them to refer to the project. Please do not use them in a way that suggests we made or approved something we did not. The <ExtLink href={sourceUrl("assets/brand", "tree")}>brand files</ExtLink> are in the repository with notes on their use.
        </p>
        <Review>Whether the name and the mark need a licence of their own, separate from the software and hardware licences.</Review>
      </section>

      <section className="section prose" aria-labelledby="changes">
        <h2 id="changes">Changes and the law</h2>
        <p>When these terms change, the date at the top changes and the older wording stays in the project&apos;s history on GitHub.</p>
        <p>
          These terms are governed by <span className="placeholder">{placeholder("governingLaw")}</span>. If you live in the UK as a consumer, nothing here takes away the rights the law gives you.
        </p>
      </section>
    </Page>
  );
}
