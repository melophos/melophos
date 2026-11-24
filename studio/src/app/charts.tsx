// the charts. drawn as SVG by hand, because a chart library would ship far more than three simple marks need.
// the rules for data are the specification's: labelled axes with real units, bars and lines from zero, no decoration,
// the series named directly on the chart and a table that carries every number. sizes follow the root text size and the
// chart is drawn at the width it is given, so its text is never scaled down on a narrow screen.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { BLACK_WIDTH, keyBox, rangeWidth } from "../geometry";
import { isBlackKey, keyRange, noteLabel, type NameOptions } from "../notes";
import { Icon, formatDate } from "./ui";
import { heatStep, type Day, type Point } from "./progress";

function useWidth(): [React.RefObject<HTMLDivElement | null>, number, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(320);
  const [rem, setRem] = useState(16);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      setWidth(Math.max(240, Math.floor(el.getBoundingClientRect().width)));
      setRem(parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width, rem];
}

export interface LineChartProps {
  title: string;
  // what the y axis measures, with its unit
  yLabel: string;
  xLabel: string;
  points: { x: number; y: number | null; label: string }[];
  yMax: number;
  yTicks: number[];
  unit: string;
  // the name written beside the last point
  seriesName: string;
}

// one series in the accent colour, with the first and last values written on the chart
export function LineChart({ title, yLabel, xLabel, points, yMax, yTicks, unit, seriesName }: LineChartProps): ReactNode {
  const [ref, width, rem] = useWidth();
  const height = Math.round(rem * 17);
  const left = Math.round(rem * 3.6);
  const right = Math.round(rem * 1.2);
  const top = Math.round(rem * 1.2);
  const bottom = Math.round(rem * 4.2);
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const defined = points.filter((p) => p.y !== null);
  const xs = points.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const px = (x: number): number => left + (xMax === xMin ? innerW / 2 : ((x - xMin) / (xMax - xMin)) * innerW);
  const py = (y: number): number => top + innerH - (y / yMax) * innerH;
  const path = defined.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)} ${py(p.y ?? 0).toFixed(1)}`).join("");
  // thin out the x labels so they never touch: one for every few points on a narrow chart
  const labelEvery = Math.max(1, Math.ceil((points.length * rem * 3.2) / innerW));
  const first = defined[0];
  const last = defined.at(-1);
  return (
    <div ref={ref} className="chart">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}. ${points.length} sessions. The same figures are in the table below.`}>
        {yTicks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={left} x2={width - right} y1={py(t)} y2={py(t)} />
            <text className="chart-text" x={left - 8} y={py(t)} textAnchor="end" dominantBaseline="middle" fontSize={rem}>
              {t}
            </text>
          </g>
        ))}
        <line className="chart-axis" x1={left} x2={left} y1={top} y2={top + innerH} />
        <line className="chart-axis" x1={left} x2={width - right} y1={top + innerH} y2={top + innerH} />
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.x} className="chart-text" x={px(p.x)} y={top + innerH + rem * 1.4} textAnchor="middle" fontSize={rem}>
              {p.label}
            </text>
          ) : null,
        )}
        <text className="chart-text" x={left + innerW / 2} y={height - 6} textAnchor="middle" fontSize={rem}>
          {xLabel}
        </text>
        <text className="chart-text" transform={`translate(${rem * 0.9} ${top + innerH / 2}) rotate(-90)`} textAnchor="middle" fontSize={rem}>
          {yLabel}
        </text>
        {defined.length > 1 ? <path className="chart-line" d={path} fill="none" /> : null}
        {defined.map((p) => (
          <circle key={p.x} className="chart-dot" cx={px(p.x)} cy={py(p.y ?? 0)} r={rem * 0.35} />
        ))}
        {first && defined.length > 1 ? (
          <text className="chart-value" x={px(first.x)} y={py(first.y ?? 0) - rem * 0.8} textAnchor="start" fontSize={rem}>
            {first.y}
            {unit}
          </text>
        ) : null}
        {last ? (
          <text className="chart-value" x={px(last.x)} y={py(last.y ?? 0) - rem * 0.8} textAnchor="end" fontSize={rem}>
            {seriesName} {last.y}
            {unit}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

export function SeriesTable({ points }: { points: Point[] }): ReactNode {
  return (
    <div className="table-frame">
      <table>
        <caption className="visually-hidden">Sessions of this piece, oldest first</caption>
        <thead>
          <tr>
            <th scope="col">Session</th>
            <th scope="col">Date</th>
            <th scope="col">Notes right first time</th>
            <th scope="col">Per cent</th>
            <th scope="col">Tempo</th>
            <th scope="col">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.session}>
              <th scope="row">{p.session}</th>
              <td>{formatDate(p.startedAt)}</td>
              <td>
                {p.firstTime} of {p.total}
              </td>
              <td>{p.firstTimePct}%</td>
              <td>{p.speedPct}%</td>
              <td>{p.accuracyPct === null ? "not scored" : `${p.accuracyPct}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// the keys missed, drawn on the keyboard itself. each key shows its count as a number and takes one of five steps of a
// single hue. steps one and two are pale against the page, so every key also has a firm outline and its number.
export function HeatKeyboard({ counts, names, title }: { counts: ReadonlyMap<number, number>; names: NameOptions; title: string }): ReactNode {
  const notes = [...counts.keys()];
  if (notes.length === 0) return null;
  // whole octaves, so the picture always starts on a C and ends on a B
  const lowest = Math.max(21, Math.floor(Math.min(...notes) / 12) * 12);
  const highest = Math.min(108, Math.floor(Math.max(...notes) / 12) * 12 + 11);
  const max = Math.max(...counts.values());
  const unit = 40;
  const whites = rangeWidth(lowest, highest);
  const height = 190;
  const all = keyRange(lowest, highest);
  const draw = (note: number): ReactNode => {
    const box = keyBox(note, lowest);
    const count = counts.get(note) ?? 0;
    const step = heatStep(count, max);
    const black = isBlackKey(note);
    const x = box.x * unit;
    const w = box.width * unit;
    const h = black ? 110 : height;
    return (
      <g key={note}>
        <rect className={`heat-key ${black ? "heat-black" : "heat-white"}`} data-step={step} x={x} y={0} width={w} height={h} rx={3} />
        {count > 0 ? (
          <g>
            <rect className="heat-chip" x={x + w / 2 - 15} y={h - 34} width={30} height={26} rx={4} />
            <text className="heat-count" x={x + w / 2} y={h - 21} textAnchor="middle" dominantBaseline="middle" fontSize={16}>
              {count}
            </text>
          </g>
        ) : null}
        {!black && note % 12 === 0 ? (
          <text className="heat-name" x={x + 4} y={22} textAnchor="start" fontSize={16}>
            {noteLabel(note, names)}
          </text>
        ) : null}
      </g>
    );
  };
  return (
    <div className="heat-frame">
      <svg className="heat" viewBox={`0 0 ${whites * unit} ${height}`} role="img" aria-label={title} style={{ ["--whites" as string]: whites }}>
        {all.filter((n) => !isBlackKey(n)).map(draw)}
        {all.filter((n) => isBlackKey(n)).map(draw)}
      </svg>
    </div>
  );
}

export function HeatTable({ counts, names }: { counts: ReadonlyMap<number, number>; names: NameOptions }): ReactNode {
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return (
    <div className="table-frame">
      <table>
        <caption className="visually-hidden">Keys missed, most often first</caption>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Times missed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([note, count]) => (
            <tr key={note}>
              <th scope="row">{noteLabel(note, names)}</th>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "short" });

// the last 28 days as a grid of seven columns. a day practised is a filled square with a tick, a day not practised is an
// empty outline: they differ by shape and by the word in the table, not by colour
export function DaysGrid({ days }: { days: Day[] }): ReactNode {
  return (
    <ol className="days" aria-label="Days practised in the last 28 days, oldest first">
      {days.map((d) => {
        const date = new Date(`${d.date}T12:00:00`);
        return (
          <li key={d.date} className={d.practised ? "day day-yes" : "day day-no"}>
            <span className="day-weekday">{WEEKDAY.format(date)}</span>
            <span className="day-number">{date.getDate()}</span>
            <span className="day-mark" aria-hidden="true">
              {d.practised ? <Icon name="tick" /> : null}
            </span>
            <span className="visually-hidden">{d.practised ? `Practised, ${d.sessions} ${d.sessions === 1 ? "session" : "sessions"}` : "Not practised"}</span>
          </li>
        );
      })}
    </ol>
  );
}

export const BLACK_UNITS = BLACK_WIDTH;
