import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CheckIcon, ChevronDownIcon } from "./icons";

export interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  /** Short text shown before the value, e.g. "Sort". */
  prefix?: string;
}

/** A glass dropdown: glossy trigger, frosted popover list, full keyboard support. */
export function Dropdown<T extends string>({ label, value, options, onChange, prefix }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, options, value]);

  const choose = (v: T) => {
    onChange(v);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(options[active].value);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className={`dropdown${open ? " open" : ""}`} ref={root} onKeyDown={onKey}>
      <button
        ref={trigger}
        type="button"
        className="glass-control dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${current?.label}`}
        onClick={() => setOpen((o) => !o)}
      >
        {prefix && <span className="prefix">{prefix}</span>}
        <span className="value">{current?.label}</span>
        <ChevronDownIcon />
      </button>
      {open && (
        <ul className="dropdown-menu" id={listId} role="listbox" aria-label={label} tabIndex={-1}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`${i === active ? "active" : ""}${o.value === value ? " selected" : ""}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(o.value)}
            >
              <span>{o.label}</span>
              {o.value === value && <CheckIcon />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
