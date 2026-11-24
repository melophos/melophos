import { ExtLink } from "../../components/ExtLink.tsx";
import { Html } from "../../components/Html.tsx";
import { Page } from "../../components/Page.tsx";
import { directNames, packages } from "../../lib/licences.ts";
import { pageMeta } from "../../lib/meta.ts";
import { sectionOf } from "../../lib/sections.ts";
import { REVIEWED, sourceUrl } from "../../site.config.ts";

export const metadata = pageMeta({
  title: "Licences",
  description: "The two licences that cover MELOPHOS, the font and icon licences and a generated list of the packages this site is built with.",
  path: "/licences/",
});

// the packages whose code is part of every page a visitor receives. the rest only build and check the site
const SENT = new Set(["next", "react", "react-dom"]);

export default async function Licences() {
  const all = await packages();
  const direct = new Set(directNames());
  const shown = all.filter((p) => direct.has(p.name));
  const counts = new Map<string, number>();
  for (const p of all) counts.set(p.licence, (counts.get(p.licence) ?? 0) + 1);
  const summary = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return (
    <Page path="/licences/">
      <h1 className="page-title">Licences</h1>
      <p className="lead lead-wide">MELOPHOS mixes software and hardware designs, so it has two licences. This page says which covers what and lists everything else the site uses.</p>

      <section className="section prose" aria-labelledby="project">
        <h2 id="project">The two project licences</h2>
        <p>
          The licence texts are in the repository. The copyright holder is named in <ExtLink href={sourceUrl("NOTICE.md")}>NOTICE.md</ExtLink> and in each licence file.
        </p>
        <p>Which licence covers which folder, as the repository states it:</p>
        <Html html={sectionOf("NOTICE.md", "What the two licences mean in practice")} />
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Licence paths table, scrolls sideways">
          <table>
            <caption className="visually-hidden">Which licence covers which part of the repository</caption>
            <thead>
              <tr><th scope="col">Path</th><th scope="col">Licence</th><th scope="col">Licence file</th></tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row"><code>hardware/</code></th>
                <td>CERN Open Hardware Licence v2, Strongly Reciprocal (CERN-OHL-S-2.0)</td>
                <td><ExtLink href={sourceUrl("hardware/LICENSE")}>hardware/LICENSE</ExtLink></td>
              </tr>
              <tr>
                <th scope="row">Everything else</th>
                <td>GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)</td>
                <td><ExtLink href={sourceUrl("LICENSE")}>LICENSE</ExtLink></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section prose" aria-labelledby="fonts">
        <h2 id="fonts">Fonts and icons</h2>
        <p>This site serves three font files from its own address. Each is under the SIL Open Font License 1.1 and its licence text is here.</p>
        <ul>
          <li><strong>Atkinson Hyperlegible Next</strong> by the Atkinson Hyperlegible Next project authors. <a href="/fonts/OFL-AtkinsonHyperlegibleNext.txt">Licence text</a></li>
          <li><strong>Atkinson Hyperlegible Mono</strong> by the same authors. <a href="/fonts/OFL-AtkinsonHyperlegibleMono.txt">Licence text</a></li>
          <li><strong>Melophos Music Signs</strong>, a subset of Bravura Text by Steinberg Media Technologies GmbH. It holds the sharp, flat and natural signs only and is renamed because Bravura is a reserved font name. <a href="/fonts/OFL-MelophosMusicSigns-from-Bravura.txt">Licence text</a></li>
        </ul>
        <p>The icons are from Phosphor Icons, bold weight, under the MIT licence. They are drawn into every page as inline images, so a visitor receives them with the page.</p>
      </section>

      <section className="section prose" aria-labelledby="packages">
        <h2 id="packages">Packages this site is built with</h2>
        <p>
          The site is made with Next.js and React and their code is sent with every page, under the MIT licence. Apart from those and the icons above, none of these is sent to a visitor. They run on a computer when the site is built. The list was generated on {REVIEWED.text} from the exact versions in the lock file. All {all.length} packages, including those these depend on, are under these licences:
        </p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Licence counts table, scrolls sideways">
          <table>
            <caption className="visually-hidden">Number of packages under each licence</caption>
            <thead><tr><th scope="col">Licence</th><th scope="col">Packages</th></tr></thead>
            <tbody>
              {summary.map(([licence, n]) => (
                <tr key={licence}><th scope="row">{licence}</th><td>{n}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>The packages we chose</h3>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Direct packages table, scrolls sideways">
          <table>
            <caption className="visually-hidden">Direct dependencies with their versions and licences</caption>
            <thead><tr><th scope="col">Package</th><th scope="col">Version</th><th scope="col">Licence</th><th scope="col">Sent to a visitor</th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.name}><th scope="row">{p.name}</th><td>{p.version}</td><td>{p.licence}</td><td>{SENT.has(p.name) ? "Yes" : "No"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Page>
  );
}
