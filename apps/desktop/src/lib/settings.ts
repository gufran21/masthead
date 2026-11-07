import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { inTauri } from "./api";

/** Mirrors `settings::Settings` in src-tauri. */
export interface Settings {
  accent: string;
  translucency: number;
  refraction: number;
  reduceTransparency: boolean;
  notchEnabled: boolean;
  notchRevealMs: number;
  notchOnFinish: boolean;
  notchOpenSecs: number;
  approvalWaitSecs: number;
  closeToTray: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  accent: "#FF6E01",
  translucency: 70,
  refraction: 30,
  reduceTransparency: false,
  notchEnabled: true,
  notchRevealMs: 160,
  notchOnFinish: true,
  notchOpenSecs: 6,
  approvalWaitSecs: 30,
  closeToTray: true,
};

type RGB = [number, number, number];

function rgbOf(hex: string): RGB {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexOf([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Dark or white, whichever reads on `hex`. */
export function readableOn(hex: string): string {
  return luminance(hex) > 0.45 ? "#111114" : "#FFFFFF";
}

export interface Theme {
  /** The flat colour behind the glass. */
  background: string;
  /** Toggles, sliders, selection. */
  accent: string;
  /** Text and marks drawn on the accent. */
  onAccent: string;
  /** Dark text on light glass. */
  light: boolean;
  /** The notch is always dark glass, so neutral themes use a light accent there. */
  notchAccent: string;
}

/**
 * One chosen colour sets the whole look. Colours are used as they are; the
 * neutrals (Black, Grey, White, Warm white) get an ink accent instead, since a
 * white toggle on a white app would vanish.
 */
export function themeFor(color: string): Theme {
  const rgb = rgbOf(color);
  const light = luminance(color) > 0.5;
  const neutral = Math.max(...rgb) - Math.min(...rgb) < 26;
  const ink = light ? hexOf(rgb.map((v) => v * 0.16) as RGB) : "#F5F5F7";
  const accent = neutral ? ink : color;
  return {
    background: color,
    accent,
    onAccent: readableOn(accent),
    light,
    notchAccent: neutral ? (light ? color : "#F5F5F7") : color,
  };
}

/** Puts a theme on the page: CSS variables and the light/dark switch. */
function applyTheme(theme: Theme, surface: "app" | "notch") {
  const root = document.documentElement;
  if (surface === "notch") {
    root.style.setProperty("--accent", theme.notchAccent);
    root.style.setProperty("--on-accent", readableOn(theme.notchAccent));
    return;
  }
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--on-accent", theme.onAccent);
  root.style.setProperty("--theme", theme.background);
  root.dataset.theme = theme.light ? "light" : "dark";
}

/** The last settings seen, so a window starts in the right colours before Rust answers. */
const CACHE_KEY = "masthead.settings";
/** Sliders save after the hand stops moving, not on every step. */
const SAVE_DELAY_MS = 180;

function cached(): Settings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function remember(s: Settings) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s));
  } catch {
    // Only a start-up nicety; Rust keeps the real copy.
  }
}

/**
 * The app's settings, kept in step across windows. Changes show at once and are
 * saved shortly after; Rust validates them and tells every window.
 */
export function useSettings(surface: "app" | "notch" = "app") {
  const [settings, setSettings] = useState<Settings>(cached);
  const pending = useRef<Settings | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!inTauri) return;
    invoke<Settings>("get_settings").then((s) => {
      if (!pending.current) setSettings(s);
    });
    const off = listen<Settings>("settings-changed", ({ payload }) => {
      // Our own unsaved change wins over an older broadcast.
      if (!pending.current) setSettings(payload);
    });
    return () => {
      off.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    remember(settings);
    applyTheme(themeFor(settings.accent), surface);
  }, [settings, surface]);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      pending.current = next;
      return next;
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const next = pending.current;
      if (!next || !inTauri) {
        pending.current = null;
        return;
      }
      try {
        const saved = await invoke<Settings>("set_settings", { settings: next });
        if (pending.current === next) {
          pending.current = null;
          setSettings(saved);
        }
      } catch {
        pending.current = null;
      }
    }, SAVE_DELAY_MS);
  }, []);

  return [settings, update] as const;
}

/** Starting with Windows lives in Windows itself; null outside the desktop app. */
export async function getAutostart(): Promise<boolean | null> {
  if (!inTauri) return null;
  try {
    return await invoke<boolean>("get_autostart");
  } catch {
    return null;
  }
}

export async function setAutostart(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("set_autostart", { enabled });
}

export interface AgentFolders {
  claude: string | null;
  codex: string | null;
}

export async function agentFolders(): Promise<AgentFolders | null> {
  if (!inTauri) return null;
  return invoke<AgentFolders>("agent_folders");
}
