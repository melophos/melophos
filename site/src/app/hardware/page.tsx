import { Callout } from "../../components/Callout.tsx";
import { ExtLink } from "../../components/ExtLink.tsx";
import { Html } from "../../components/Html.tsx";
import { Page } from "../../components/Page.tsx";
import { Status } from "../../components/Status.tsx";
import { VERIFIED } from "../../data/status.ts";
import { bom, boardTable } from "../../lib/hardware.ts";
import { figure } from "../../lib/facts.ts";
import { pageMeta } from "../../lib/meta.ts";

export const metadata = pageMeta({
  title: "Hardware",
  description: "The MELOPHOS hub and its octave LED bars are in design. No board has been made. The draft bill of materials, the power budget and the licence are here.",
  path: "/hardware/",
});

export default function Hardware() {
  const rows = bom();
  const total = rows.reduce((sum, r) => sum + Number(r.quantity), 0);
  return (
    <Page path="/hardware/" section="hardware">
      <h1 className="page-title">Hardware</h1>
      <p className="lead lead-wide">
        The hub and its light bars are open hardware. <Status status="design" /> The boards are still in the works. Rev A is in design and <strong>no board has been made</strong>. This page shows what is written down so far.
      </p>

      <Callout kind="important">
        <p>Nothing described here has been built or run. The firmware is tested on a computer only. The numbers below are design figures and not measurements. This page was checked against the repository on {VERIFIED}.</p>
      </Callout>

      <section className="section prose" aria-labelledby="what">
        <h2 id="what">What the hardware is</h2>
        <p>
          A <strong>hub</strong> is designed to sit behind the instrument. It is meant to read the notes and drive the lights. <strong>Octave bars</strong> are designed to carry 12 lights each, placed at real key spacing and joined end to end through edge connectors, with short end bars for the keys left over on a keyboard of 61, 76 or 88 keys. No bar has been made. A plain LED strip is designed to work too, with a profile that picks the nearest light for each key. Neither has been tried on a real keyboard.
        </p>
        <p>
          The hub is designed around an ESP32-S3 module because that one chip has a USB host port, Bluetooth and Wi-Fi. The <a href="/docs/architecture/">architecture</a> page gives the reasons.
        </p>
      </section>

      <section className="section" aria-labelledby="boards">
        <h2 id="boards">The boards and their status</h2>
        <Html html={boardTable()} />
      </section>

      <section className="section" aria-labelledby="bom">
        <h2 id="bom">Bill of materials, rev A, draft</h2>
        <p className="prose">
          {rows.length} lines and {total} parts. Manufacturer part numbers are added once the layout is final. This is the file <ExtLink href="https://github.com/melophos/melophos/blob/main/hardware/bom/hub-rev-a.csv">hardware/bom/hub-rev-a.csv</ExtLink>, shown as a table.
        </p>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Bill of materials, scrolls sideways">
          <table>
            <caption className="visually-hidden">Hub rev A bill of materials, draft</caption>
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Quantity</th>
                <th scope="col">Part</th>
                <th scope="col">Value or package</th>
                <th scope="col">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.reference}>
                  <th scope="row">{r.reference}</th>
                  <td>{r.quantity}</td>
                  <td>{r.part}</td>
                  <td>{r.value}</td>
                  <td>{r.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section prose" aria-labelledby="power">
        <h2 id="power">Power budget</h2>
        <p>
          The boards are still in the works and the power budget is being finalised with them. No board has been made, so nothing has been measured. The firmware limits the total LED current to {figure("ledCeilingMa")}. The figures behind that limit are in <ExtLink href="https://github.com/melophos/melophos/blob/main/firmware/docs/pins-and-power.md">firmware/docs/pins-and-power.md</ExtLink>.
        </p>
      </section>

      <section className="section prose" aria-labelledby="licence">
        <h2 id="licence">Licence</h2>
        <p>
          The hardware designs are under the CERN Open Hardware Licence Version 2, Strongly Reciprocal (CERN-OHL-S-2.0). Anyone can build, modify, manufacture and sell boards made from them. Anyone who distributes a product based on a modified design must share the modified design files under the same licence. The <a href="/licences/">Licences</a> page has the detail.
        </p>
      </section>
    </Page>
  );
}
