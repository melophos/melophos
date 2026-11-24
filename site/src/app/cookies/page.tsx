import { Page } from "../../components/Page.tsx";
import { Review } from "../../components/Review.tsx";
import { pageMeta } from "../../lib/meta.ts";
import { REVIEWED } from "../../site.config.ts";

export const metadata = pageMeta({
  title: "Cookies and storage",
  description: "The MELOPHOS site sets no cookies and runs no analytics. It keeps one word in your browser if you choose a theme. This page lists it and what the Studio keeps on your device.",
  path: "/cookies/",
});

export default function Cookies() {
  return (
    <Page path="/cookies/">
      <h1 className="page-title">Cookies and storage</h1>
      <p className="lead lead-wide">This site sets no cookies. It keeps one word in your browser and only after you press a button. It was last reviewed on {REVIEWED.text}.</p>

      <section className="section" aria-labelledby="site">
        <h2 id="site">What this site keeps</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Storage used by this site, scrolls sideways">
          <table>
            <caption className="visually-hidden">Everything this site keeps in your browser</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Kind</th>
                <th scope="col">What it holds</th>
                <th scope="col">When it is written</th>
                <th scope="col">How long</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row"><code>melophos-theme</code></th>
                <td>Local storage on this site</td>
                <td>The word light or dark</td>
                <td>When you press Light or Dark at the foot of a page</td>
                <td>Until you press System or clear the site&apos;s data</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="prose">It never leaves your device and nothing reads it but this site&apos;s theme script. There is nothing else: no cookie, no analytics, no advertising, no tracking pixel and nothing loaded from another company.</p>
      </section>

      <section className="section prose" aria-labelledby="banner">
        <h2 id="banner">Why there is no cookie banner</h2>
        <p>A banner asks for your consent to storage that a site does not need. This site keeps nothing of that kind, so there is nothing to ask about. If that ever changes, this page changes first and the site will ask before anything is stored, with Accept and Reject side by side.</p>
        <Review>
          The theme word is stored only when the visitor presses a button that asks for it. We read that as storage the visitor has requested, which the Privacy and Electronic Communications Regulations allow without a consent banner. A lawyer should confirm this reading.
        </Review>
      </section>

      <section className="section prose" aria-labelledby="host">
        <h2 id="host">The host</h2>
        <p>The site is served by Cloudflare Pages. Some of its features add cookies or scripts to a site. Before the site goes live we check on the live address that the host adds none and we do not announce the site until that check passes.</p>
      </section>

      <section className="section" aria-labelledby="studio">
        <h2 id="studio">What the Studio keeps</h2>
        <p className="prose">The Studio is a separate app at app.melophos.com. It sets no cookies. To work offline and to remember your practice it keeps these in your browser, on that address only:</p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Storage used by the Studio, scrolls sideways">
          <table>
            <caption className="visually-hidden">Everything the Studio keeps in your browser</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Kind</th>
                <th scope="col">What it holds</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row"><code>melophos</code></th>
                <td>A database in the browser (IndexedDB)</td>
                <td>Your sessions, imported pieces and personal bests</td>
              </tr>
              <tr>
                <th scope="row"><code>melophos.settings</code></th>
                <td>Local storage</td>
                <td>Your settings, such as the theme, the sound and the display</td>
              </tr>
              <tr>
                <th scope="row"><code>melophos.last</code></th>
                <td>Local storage</td>
                <td>The piece and the practice settings you used last, so the start page can offer to carry on</td>
              </tr>
              <tr>
                <th scope="row"><code>melophos-studio-</code> and a version</th>
                <td>The offline copy (Cache Storage)</td>
                <td>The Studio&apos;s own files, so it works with no network</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="prose">Each of these is there because you use the Studio and none is sent to us. Delete everything, under Settings and then Data in the Studio, removes them all. The <a href="/privacy/#studio">privacy page</a> has the detail.</p>
      </section>

      <section className="section prose" aria-labelledby="clear">
        <h2 id="clear">How to clear it yourself</h2>
        <p>Every browser can clear the data of one site. Look for the site settings or the padlock beside the address and choose to clear the data for melophos.com or app.melophos.com.</p>
      </section>
    </Page>
  );
}
