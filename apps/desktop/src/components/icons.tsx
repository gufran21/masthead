import type { ReactNode, SVGProps } from "react";

function Icon({ children, size = 16, ...rest }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export const OverviewIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="9" rx="2" />
    <rect x="14" y="3" width="7" height="5" rx="2" />
    <rect x="14" y="12" width="7" height="9" rx="2" />
    <rect x="3" y="16" width="7" height="5" rx="2" />
  </Icon>
);
export const TerminalIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 17l6-5-6-5" />
    <path d="M12 19h8" />
  </Icon>
);
export const CodeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M8 7l-5 5 5 5" />
    <path d="M16 7l5 5-5 5" />
  </Icon>
);
export const CpuIcon = (p: P) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
  </Icon>
);
export const PlugIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 7V3M15 7V3M6 7h12v4a6 6 0 01-12 0zM12 17v4" />
  </Icon>
);
export const BroomIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
  </Icon>
);
export const PulseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 12h4l3-7 4 14 3-7h4" />
  </Icon>
);
export const NotchIcon = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="5" width="18" height="15" rx="3" />
    <rect x="8.5" y="3" width="7" height="4" rx="2" />
  </Icon>
);
export const SettingsIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
  </Icon>
);
export const SearchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
);
export const ClockIcon = (p: P) => (
  <Icon size={13} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
export const TokensIcon = (p: P) => (
  <Icon size={13} {...p}>
    <path d="M12 3l9 5-9 5-9-5 9-5z" />
    <path d="M3 13l9 5 9-5" />
  </Icon>
);
export const ChevronIcon = ({ open, size = 14 }: P & { open?: boolean }) => (
  <Icon size={size} style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.15s ease" }}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
export const SortIcon = ({ descending, size = 14 }: P & { descending?: boolean }) => (
  <Icon size={size}>
    {descending ? <path d="M12 5v14M6 13l6 6 6-6" /> : <path d="M12 19V5M6 11l6-6 6 6" />}
  </Icon>
);
export const ChevronDownIcon = (p: P) => (
  <Icon size={14} {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
export const CheckIcon = (p: P) => (
  <Icon size={14} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
export const ClearIcon = (p: P) => (
  <Icon size={14} {...p}>
    <path d="M7 7l10 10M17 7L7 17" />
  </Icon>
);
export const FolderIcon = (p: P) => (
  <Icon size={18} {...p}>
    <path d="M3 7.5A2.5 2.5 0 015.5 5h3.6l2 2.2h7.4A2.5 2.5 0 0121 9.7v7.8a2.5 2.5 0 01-2.5 2.5h-13A2.5 2.5 0 013 17.5z" />
  </Icon>
);
export const OpenFolderIcon = (p: P) => (
  <Icon size={15} {...p}>
    <path d="M3 17.5V7.5A2.5 2.5 0 015.5 5h3.6l2 2.2h6.4A2.5 2.5 0 0120 9.7V11" />
    <path d="M3 17.5l2.6-6.1A2 2 0 017.4 10h12.1a1.5 1.5 0 011.4 2.1l-2.3 5.6A2 2 0 0116.8 19H5a2 2 0 01-2-1.5z" />
  </Icon>
);
export const CopyIcon = (p: P) => (
  <Icon size={14} {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 9V6.5A2.5 2.5 0 0012.5 4h-6A2.5 2.5 0 004 6.5v6A2.5 2.5 0 006.5 15H9" />
  </Icon>
);
export const ChevronRightIcon = (p: P) => (
  <Icon size={11} {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
export const MinimizeIcon = () => (
  <Icon size={14}>
    <path d="M5 12h14" />
  </Icon>
);
export const MaximizeIcon = () => (
  <Icon size={13}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon size={14}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
