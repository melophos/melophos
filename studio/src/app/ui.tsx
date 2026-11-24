// the small shared pieces of the interface. controls that have no good native form (the segmented choices, the slider
// and the switch) come from React Aria Components, which is tested with screen readers, touch, keyboard and forced
// colours. everything else is a native element.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Label, Slider, SliderOutput, SliderThumb, SliderTrack, Switch, ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { ICONS, iconMarkup, type IconName } from "../icons/index";
import { hrefFor } from "./router";

export function Icon({ name }: { name: IconName }): ReactNode {
  return <span className="icon-wrap" aria-hidden="true" dangerouslySetInnerHTML={{ __html: iconMarkup(name) }} />;
}

export const iconLabel = (name: IconName): string => ICONS[name].label;

export function Link({ to, query, children, className, current }: { to: string[]; query?: Record<string, string | number | null | undefined>; children: ReactNode; className?: string; current?: boolean }): ReactNode {
  const props: { href: string; className?: string; "aria-current"?: "page" } = { href: hrefFor(to, query) };
  if (className) props.className = className;
  if (current) props["aria-current"] = "page";
  return <a {...props}>{children}</a>;
}

// a link that looks like a button: the destination is an address, so it stays a link
export function ButtonLink({ to, query, children, primary }: { to: string[]; query?: Record<string, string | number | null | undefined>; children: ReactNode; primary?: boolean }): ReactNode {
  return (
    <a className={primary ? "button button-primary" : "button"} href={hrefFor(to, query)}>
      {children}
    </a>
  );
}

export interface Option<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

// one choice from a few. the chosen one is filled and carries a tick, so it differs by shape as well as colour
export function Segmented<T extends string>({ label, value, onChange, options, hideLabel }: { label: string; value: T; onChange: (v: T) => void; options: Option<T>[]; hideLabel?: boolean }): ReactNode {
  return (
    <div className="field">
      <span className={hideLabel ? "visually-hidden" : "field-label"} id={`seg-${label.replace(/\W+/g, "-")}`}>
        {label}
      </span>
      <ToggleButtonGroup
        className="segmented"
        aria-labelledby={`seg-${label.replace(/\W+/g, "-")}`}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[value]}
        onSelectionChange={(keys) => {
          const first = [...keys][0];
          if (typeof first === "string") onChange(first as T);
        }}
      >
        {options.map((o) => (
          <ToggleButton key={o.value} id={o.value} className="segment">
            {({ isSelected }) => (
              <>
                {isSelected ? <Icon name="tick" /> : o.icon ? <Icon name={o.icon} /> : null}
                <span>{o.label}</span>
              </>
            )}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}

// a slider with its value as text beside it. arrow keys step by one and Page Up and Page Down by ten
export function Range({ label, value, onChange, min, max, step = 1, unit, format }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; format?: (v: number) => string }): ReactNode {
  return (
    <Slider className="range" value={value} onChange={onChange} minValue={min} maxValue={max} step={step}>
      <div className="range-head">
        <Label className="field-label">{label}</Label>
        <SliderOutput className="range-value">{({ state }) => format?.(state.values[0] ?? value) ?? `${state.values[0] ?? value}${unit ?? ""}`}</SliderOutput>
      </div>
      <SliderTrack className="range-track">
        <SliderThumb className="range-thumb" />
      </SliderTrack>
    </Slider>
  );
}

// a switch that says its state in words as well as position
export function Toggle({ label, isSelected, onChange, hint }: { label: string; isSelected: boolean; onChange: (v: boolean) => void; hint?: string }): ReactNode {
  return (
    <Switch className="switch" isSelected={isSelected} onChange={onChange}>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint ? <span className="switch-hint">{hint}</span> : null}
      </span>
      <span className="switch-state" aria-hidden="true">
        {isSelected ? "On" : "Off"}
      </span>
    </Switch>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }): ReactNode {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const DATE_TIME = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const formatDate = (iso: string): string => DATE.format(new Date(iso));
export const formatDateTime = (iso: string): string => DATE_TIME.format(new Date(iso));

// an action that cannot be undone. it opens a real modal dialog: focus moves inside and stays there, Escape cancels and
// focus goes back to the button that opened it. it says what is removed and asks before it does anything. the password
// field is shown only where the server asks for one
export function Confirm({ trigger, what, confirm, onConfirm, password, testId }: { trigger: string; what: ReactNode; confirm: string; onConfirm: (password: string) => Promise<void> | void; password?: boolean; testId?: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);

  const close = (): void => {
    dialog.current?.close();
    setSecret("");
    setOpen(false);
    // the browser returns focus to the opener when a modal closes. this makes sure of it when the page changed meanwhile
    queueMicrotask(() => opener.current?.focus());
  };

  return (
    <>
      <button ref={opener} type="button" className="button-destructive" onClick={() => setOpen(true)} data-testid={testId} aria-haspopup="dialog">
        <Icon name="trash" />
        {trigger}
      </button>
      {open ? (
        <dialog
          ref={dialog}
          className="confirm"
          aria-labelledby={titleId}
          // tab goes round inside the dialog and never out of it
          onKeyDown={(e) => {
            if (e.key !== "Tab") return;
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
            const first = items[0];
            const last = items[items.length - 1];
            if (!first || !last) return;
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }}
          onCancel={(e) => {
            e.preventDefault();
            close();
          }}
        >
          <h2 id={titleId}>{trigger}</h2>
          <p>{what}</p>
          <p>
            <strong>This cannot be undone.</strong>
          </p>
          {password ? (
            <label className="stack-label">
              <span className="field-label">Your password</span>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
            </label>
          ) : null}
          <div className="actions">
            <button type="button" autoFocus onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="button-destructive"
              disabled={busy || (password === true && secret === "")}
              onClick={async () => {
                setBusy(true);
                await onConfirm(secret);
                setBusy(false);
                close();
              }}
            >
              <Icon name="trash" />
              {confirm}
            </button>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
