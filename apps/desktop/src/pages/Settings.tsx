import { Fragment, useEffect, useId, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { getApprovalHook, inTauri, setApprovalHook } from "../lib/api";
import {
  agentFolders,
  DEFAULT_SETTINGS,
  getAutostart,
  setAutostart,
  type AgentFolders,
  readableOn,
  type Settings as SettingsValues,
} from "../lib/settings";
import { CheckIcon } from "../components/icons";

const ACCENTS = [
  { name: "Orange", value: "#FF6E01" },
  { name: "Red", value: "#FF453A" },
  { name: "Pink", value: "#FF375F" },
  { name: "Purple", value: "#BF5AF2" },
  { name: "Blue", value: "#0A84FF" },
  { name: "Teal", value: "#40C8E0" },
  { name: "Green", value: "#30D158" },
];
const NEUTRALS = [
  { name: "Black", value: "#1C1C1E" },
  { name: "Grey", value: "#8E8E93" },
  { name: "White", value: "#F5F5F7" },
  { name: "Warm white", value: "#F4EFE6" },
];
const REVEAL = [
  { label: "Quick", value: 60 },
  { label: "Normal", value: 160 },
  { label: "Relaxed", value: 400 },
];
const OPEN_FOR = [3, 6, 10, 20];
const APPROVAL_WAIT = [15, 30, 60, 120];

interface Props {
  settings: SettingsValues;
  onChange: (patch: Partial<SettingsValues>) => void;
}

export function Settings({ settings, onChange }: Props) {
  const [autostart, setAutostartState] = useState<boolean | null>(null);
  const [autostartError, setAutostartError] = useState("");
  const [approvalHook, setApprovalHookState] = useState<boolean | null>(null);
  const [approvalError, setApprovalError] = useState("");
  const [version, setVersion] = useState("");
  const [folders, setFolders] = useState<AgentFolders | null>(null);

  useEffect(() => {
    getAutostart().then(setAutostartState);
    getApprovalHook()
      .then(setApprovalHookState)
      .catch((e) => setApprovalError(String(e)));
    agentFolders().then(setFolders);
    if (inTauri) getVersion().then(setVersion);
  }, []);

  const toggleAutostart = async (on: boolean) => {
    setAutostartError("");
    try {
      setAutostartState(await setAutostart(on));
    } catch (e) {
      setAutostartError(String(e));
    }
  };

  const toggleApprovalHook = async (on: boolean) => {
    setApprovalError("");
    try {
      setApprovalHookState(await setApprovalHook(on));
    } catch (e) {
      setApprovalError(String(e));
    }
  };

  const glassOff = settings.reduceTransparency;
  const notchOff = !settings.notchEnabled;

  return (
    <div className="settings-page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      <Group title="Appearance">
        <Row label="Theme colour" hint="Colours the whole app, its highlights and the notch.">
          <div className="swatches" role="radiogroup" aria-label="Theme colour">
            {[...ACCENTS, ...NEUTRALS].map((a, i) => (
              <Fragment key={a.value}>
                {i === ACCENTS.length && <span className="swatch-divider" aria-hidden="true" />}
                <button
                  className={`swatch${settings.accent === a.value ? " on" : ""}`}
                  style={{ background: a.value, color: readableOn(a.value) }}
                  role="radio"
                  aria-checked={settings.accent === a.value}
                  aria-label={a.name}
                  title={a.name}
                  onClick={() => onChange({ accent: a.value })}
                >
                  {settings.accent === a.value && <CheckIcon />}
                </button>
              </Fragment>
            ))}
          </div>
        </Row>
        <Row label="Glass translucency" hint="How much of the background shows through." disabled={glassOff}>
          <Slider
            label="Glass translucency"
            value={settings.translucency}
            disabled={glassOff}
            onChange={(translucency) => onChange({ translucency })}
          />
        </Row>
        <Row label="Glass refraction" hint="How strongly glass edges bend what's behind them." disabled={glassOff}>
          <Slider
            label="Glass refraction"
            value={settings.refraction}
            disabled={glassOff}
            onChange={(refraction) => onChange({ refraction })}
          />
        </Row>
        <Row label="Reduce transparency" hint="Solid surfaces instead of glass. Easier to read, lighter on the GPU.">
          <Toggle
            label="Reduce transparency"
            on={settings.reduceTransparency}
            onChange={(reduceTransparency) => onChange({ reduceTransparency })}
          />
        </Row>
      </Group>

      <Group title="Notch">
        <Row label="Show the notch" hint="Push the cursor against the top edge of the screen to reveal it.">
          <Toggle
            label="Show the notch"
            on={settings.notchEnabled}
            onChange={(notchEnabled) => onChange({ notchEnabled })}
          />
        </Row>
        <Row label="Reveal delay" hint="How long to push against the edge before it appears." disabled={notchOff}>
          <Segmented
            label="Reveal delay"
            options={REVEAL}
            value={settings.notchRevealMs}
            disabled={notchOff}
            onChange={(notchRevealMs) => onChange({ notchRevealMs })}
          />
        </Row>
        <Row
          label="Pop open when an agent finishes"
          hint="Shows which session finished, and keeps it marked until you've seen it."
          disabled={notchOff}
        >
          <Toggle
            label="Pop open when an agent finishes"
            on={settings.notchOnFinish}
            disabled={notchOff}
            onChange={(notchOnFinish) => onChange({ notchOnFinish })}
          />
        </Row>
        <Row
          label="Stay open for"
          hint="After popping open, unless you're hovering it."
          disabled={notchOff || !settings.notchOnFinish}
        >
          <Segmented
            label="Stay open for"
            options={OPEN_FOR.map((s) => ({ label: `${s} s`, value: s }))}
            value={settings.notchOpenSecs}
            disabled={notchOff || !settings.notchOnFinish}
            onChange={(notchOpenSecs) => onChange({ notchOpenSecs })}
          />
        </Row>
        <Row
          label="Approve from the notch"
          hint={
            approvalError ||
            (approvalHook === null
              ? "Available in the desktop app."
              : "Claude Code's permission requests appear in the notch with Allow and Deny. Adds a hook to Claude Code's settings; new sessions pick it up.")
          }
          disabled={approvalHook === null || notchOff}
        >
          <Toggle
            label="Approve from the notch"
            on={approvalHook ?? false}
            disabled={approvalHook === null}
            onChange={toggleApprovalHook}
          />
        </Row>
        <Row
          label="Wait for an answer"
          hint="Then Claude Code asks in the terminal instead."
          disabled={!approvalHook || notchOff}
        >
          <Segmented
            label="Wait for an answer"
            options={APPROVAL_WAIT.map((s) => ({ label: `${s} s`, value: s }))}
            value={settings.approvalWaitSecs}
            disabled={!approvalHook || notchOff}
            onChange={(approvalWaitSecs) => onChange({ approvalWaitSecs })}
          />
        </Row>
      </Group>

      <Group title="General">
        <Row
          label="Start with Windows"
          hint={
            autostartError ||
            (autostart === null ? "Available in the desktop app." : "Starts in the tray, with the notch ready.")
          }
          disabled={autostart === null}
        >
          <Toggle
            label="Start with Windows"
            on={autostart ?? false}
            disabled={autostart === null}
            onChange={toggleAutostart}
          />
        </Row>
        <Row
          label="Keep running when closed"
          hint="Closing the window leaves Masthead in the tray. Quit from the tray menu."
        >
          <Toggle
            label="Keep running when closed"
            on={settings.closeToTray}
            onChange={(closeToTray) => onChange({ closeToTray })}
          />
        </Row>
      </Group>

      <Group title="About">
        <Row label="Version">
          <span className="settings-value">{version || "—"}</span>
        </Row>
        <Row label="Claude Code sessions" hint="Masthead only reads these folders; it never changes them.">
          <span className="settings-path" title={folders?.claude ?? undefined}>
            {folders?.claude ?? "—"}
          </span>
        </Row>
        <Row label="Codex sessions">
          <span className="settings-path" title={folders?.codex ?? undefined}>
            {folders?.codex ?? "—"}
          </span>
        </Row>
        <Row label="Antigravity conversations">
          <span className="settings-path" title={folders?.antigravity ?? undefined}>
            {folders?.antigravity ?? "—"}
          </span>
        </Row>
        <Row label="Reset settings" hint="Back to the defaults. Start with Windows is left as it is.">
          <button className="glass-control settings-button" onClick={() => onChange(DEFAULT_SETTINGS)}>
            Reset
          </button>
        </Row>
      </Group>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tile settings-group" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  disabled,
  children,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`settings-row${disabled ? " disabled" : ""}`}>
      <div className="settings-text">
        <div className="settings-label">{label}</div>
        {hint && <div className="settings-hint">{hint}</div>}
      </div>
      <div className="settings-control">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  on,
  disabled,
  onChange,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      className={`toggle${on ? " on" : ""}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="knob" />
    </button>
  );
}

function Slider({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const id = useId();
  return (
    <div className="slider">
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        aria-label={label}
        style={{ ["--fill" as string]: `${value}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <output htmlFor={id}>{value}%</output>
    </div>
  );
}

function Segmented<T extends number>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? "on" : ""}
          aria-pressed={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
