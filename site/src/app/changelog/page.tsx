import { Html } from "../../components/Html.tsx";
import { Page } from "../../components/Page.tsx";
import { intro, releases } from "../../lib/changelog.ts";
import { pageMeta } from "../../lib/meta.ts";

export const metadata = pageMeta({ title: "Changelog", description: "Notable changes to MELOPHOS, release by release, with a feed you can subscribe to.", path: "/changelog/" });

export default function Changelog() {
  const list = releases();
  return (
    <Page path="/changelog/">
      <h1 className="page-title">Changelog</h1>
      <Html className="prose" html={intro()} />
      <p className="prose">
        <a href="/changelog.xml">Subscribe with the Atom feed</a>. The feed lists released versions only{list.some((r) => r.date) ? "" : " and there is no release yet, so it is empty"}.
      </p>
      {list.map((r) => (
        <section className="release" aria-labelledby={r.slug} key={r.slug}>
          <h2 id={r.slug}>
            {r.title}
            {r.date && (
              <>
                {" "}
                <small>{r.date}</small>
              </>
            )}
          </h2>
          <Html html={r.html} />
        </section>
      ))}
    </Page>
  );
}
