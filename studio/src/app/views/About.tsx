import type { ReactNode } from "react";
import { scoringFailure, scoringStatus } from "../../scoring";
import { Icon } from "../ui";

const SOURCE = "https://github.com/melophos/melophos";

export function About(): ReactNode {
  const commit = __STUDIO_COMMIT__;
  const sourceHref = commit === "unknown" ? SOURCE : `${SOURCE}/tree/${commit}/studio`;
  return (
    <>
      <h1>About the Studio</h1>
      <dl className="facts">
        <div>
          <dt>Version</dt>
          <dd data-testid="version">{__STUDIO_VERSION__}</dd>
        </div>
        <div>
          <dt>Commit</dt>
          <dd data-testid="commit">{commit}</dd>
        </div>
        <div>
          <dt>Scoring engine</dt>
          <dd>{scoringStatus() === "ready" ? "Loaded" : scoringStatus() === "failed" ? `Failed to load. ${scoringFailure()}` : "Loads when you practise"}</dd>
        </div>
      </dl>
      <p>
        The Studio is free software under the GNU Affero General Public License, version 3 or later. This is the exact source of the version you are running:{" "}
        <a href={sourceHref} rel="noopener">
          the source at this version
          <Icon name="external" />
          <span className="visually-hidden"> (opens another site)</span>
        </a>
        .
      </p>
      <h2>What it keeps</h2>
      <p>Your practice record and settings stay in this browser. The Studio sends nothing to the project, runs no analytics and sets no cookies. There is no account.</p>
      <h2>Licences of what it carries</h2>
      <ul>
        <li>React and React Aria Components, for the interface: MIT and Apache-2.0.</li>
        <li>Phosphor Icons, bold weight: MIT.</li>
        <li>Atkinson Hyperlegible Next and Mono, for the type: SIL Open Font Licence 1.1.</li>
        <li>The MELOPHOS scoring engine, built to WebAssembly from the same repository: AGPL-3.0-or-later.</li>
      </ul>
      <p>
        The full list is in <code>NOTICE.md</code> in the source.
      </p>
    </>
  );
}
