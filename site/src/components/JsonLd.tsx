// structured data for search engines. it states only what the page itself shows. it is data, not code: the browser
// never runs it, so the content security policy is unchanged
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
