import { Page } from "../components/Page.tsx";
import { pageMeta } from "../lib/meta.ts";

export const metadata = pageMeta({ title: "Page not found", description: "That page does not exist. Here are the main pages of the MELOPHOS site.", path: "/404.html", noindex: true });

export default function NotFound() {
  return (
    <Page path="/404.html">
      <h1 className="page-title">Page not found</h1>
      <p className="lead">There is nothing at this address. It may have moved or the link may be wrong.</p>
      <ul className="link-list">
        <li><a href="/">The home page</a></li>
        <li><a href="/how-it-works/">How it works</a></li>
        <li><a href="/hardware/">Hardware</a></li>
        <li><a href="/accessibility/">Accessibility</a></li>
        <li><a href="/docs/">Documentation</a></li>
        <li><a href="/roadmap/">Roadmap</a></li>
      </ul>
    </Page>
  );
}
