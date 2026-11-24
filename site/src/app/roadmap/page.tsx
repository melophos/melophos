import { Fragment } from "react";
import { Page } from "../../components/Page.tsx";
import { Status } from "../../components/Status.tsx";
import { STATUS_MEANING, STATUS_ORDER } from "../../data/status.ts";
import { pageMeta } from "../../lib/meta.ts";
import { roadmap } from "../../lib/roadmap.ts";

export const metadata = pageMeta({
  title: "Roadmap",
  description: "The three versions of MELOPHOS and what is built and planned in each. Rendered from the roadmap in the repository.",
  path: "/roadmap/",
});

export default function Roadmap() {
  const { versions, notes } = roadmap();
  return (
    <Page path="/roadmap/" section="roadmap">
      <h1 className="page-title">Roadmap</h1>
      <p className="lead lead-wide">What is built and what is planned, version by version. This page is the repository's roadmap file shown with a status word on every item.</p>
      {notes.map((n) => (
        <p className="prose" key={n} dangerouslySetInnerHTML={{ __html: n }} />
      ))}
      <h2 id="words">The status words</h2>
      <p className="prose">The whole site uses these words and no others. No board has been made. The Studio works in your browser today.</p>
      <ul className="rows">
        {STATUS_ORDER.map((word) => (
          <li className="row row-wide row-status" key={word}>
            <p><Status status={word} /></p>
            <p>{STATUS_MEANING[word]}</p>
          </li>
        ))}
      </ul>
      {versions.map((v, i) => (
        <section className="section" aria-labelledby={`v${i}`} key={v.title}>
          <h2 id={`v${i}`}>
            {v.title}
            {v.target && <> (target: {v.target})</>}
            {v.state === "done" && <> (done)</>}
          </h2>
          {v.groups.map((g, gi) => (
            <Fragment key={`${g.name}-${gi}`}>
              {g.name && <h3 className="group-name">{g.name}</h3>}
              <ul className="rows">
                {g.items.map((item, ii) => (
                  <li className="row row-wide row-status" key={ii}>
                    <p><Status status={item.status} /></p>
                    <p dangerouslySetInnerHTML={{ __html: item.html }} />
                  </li>
                ))}
              </ul>
            </Fragment>
          ))}
        </section>
      ))}
    </Page>
  );
}
