import { ExtLink } from "../../../components/ExtLink.tsx";
import { JsonLd } from "../../../components/JsonLd.tsx";
import { Page } from "../../../components/Page.tsx";
import { allDocs, editUrl, renderDoc } from "../../../lib/docs.ts";
import { pageMeta } from "../../../lib/meta.ts";
import { SITE_URL } from "../../../site.config.ts";

export const dynamicParams = false;

export function generateStaticParams() {
  return allDocs().map((doc) => ({ slug: doc.slug }));
}

const find = (slug: string) => {
  const docs = allDocs();
  const i = docs.findIndex((d) => d.slug === slug);
  const doc = docs[i];
  if (!doc) throw new Error(`no document ${slug}`);
  return { doc, previous: docs[i - 1] ?? null, next: docs[i + 1] ?? null };
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { doc } = find((await params).slug);
  return pageMeta({ title: doc.title, description: doc.summary || `${doc.title}, a MELOPHOS document.`, path: doc.route });
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { doc, previous, next } = find((await params).slug);
  const { html, headings } = renderDoc(doc);
  const contents = headings.filter((h) => h.depth <= 3);
  return (
    <Page path={doc.route} section="docs">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
            { "@type": "ListItem", position: 2, name: "Documentation", item: `${SITE_URL}/docs/` },
            { "@type": "ListItem", position: 3, name: doc.title, item: `${SITE_URL}${doc.route}` },
          ],
        }}
      />
      <nav className="crumbs" aria-label="Breadcrumb">
        <ol>
          <li><a href="/">Home</a></li>
          <li><a href="/docs/">Documentation</a></li>
          <li><a href={doc.route} aria-current="page">{doc.title}</a></li>
        </ol>
      </nav>
      <h1 className="page-title">{doc.title}</h1>
      <div className="doc-layout">
        {contents.length > 0 && (
          <nav className="contents" aria-labelledby="contents-title">
            <h2 id="contents-title">On this page</h2>
            <ol>
              {contents.map((h) => (
                <li className={h.depth > 2 ? "sub" : undefined} key={h.id}><a href={`#${h.id}`}>{h.text}</a></li>
              ))}
            </ol>
          </nav>
        )}
        <div className="doc-body">
          <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
          <p className="edit-link"><ExtLink href={editUrl(doc)}>Edit this page on GitHub</ExtLink></p>
          <nav className="pager" aria-label="Previous and next document">
            {previous ? <a href={previous.route} rel="prev">Previous: {previous.title}</a> : <span></span>}
            {next ? <a href={next.route} rel="next">Next: {next.title}</a> : <span></span>}
          </nav>
        </div>
      </div>
    </Page>
  );
}
