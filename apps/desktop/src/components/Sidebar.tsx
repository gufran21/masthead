import type { ReactNode } from "react";
import {
  BroomIcon,
  CpuIcon,
  NotchIcon,
  OverviewIcon,
  PlugIcon,
  PulseIcon,
  SettingsIcon,
  TerminalIcon,
} from "./icons";

export type Page = "overview" | "sessions" | "system" | "ports" | "cleanup" | "doctor" | "notch" | "settings";

const MAIN: { id: Page; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Overview", icon: <OverviewIcon /> },
  { id: "sessions", label: "Sessions", icon: <TerminalIcon /> },
  { id: "system", label: "System", icon: <CpuIcon /> },
  { id: "ports", label: "Ports", icon: <PlugIcon /> },
  { id: "cleanup", label: "Cleanup", icon: <BroomIcon /> },
  { id: "doctor", label: "Doctor", icon: <PulseIcon /> },
  { id: "notch", label: "Notch", icon: <NotchIcon /> },
];

interface Props {
  page: Page;
  onPage: (p: Page) => void;
  activeCount: number;
}

export function Sidebar({ page, onPage, activeCount }: Props) {
  const item = (id: Page, label: string, icon: ReactNode, extra?: ReactNode) => (
    <button
      key={id}
      className={`nav-item${page === id ? " on" : ""}`}
      data-glass={page === id ? "soft" : undefined}
      aria-current={page === id ? "page" : undefined}
      onClick={() => onPage(id)}
    >
      {icon}
      {label}
      {extra}
    </button>
  );
  return (
    <nav className="sidebar" aria-label="Main">
      {MAIN.map(({ id, label, icon }) =>
        item(id, label, icon, id === "sessions" && activeCount > 0 ? <span className="count">{activeCount}</span> : null),
      )}
      <div className="grow" />
      {item("settings", "Settings", <SettingsIcon />)}
    </nav>
  );
}
