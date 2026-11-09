import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { GlassLayer, type GlassOptions } from "./glass/GlassLayer";
import { TitleBar } from "./components/TitleBar";
import { Sidebar, type Page } from "./components/Sidebar";
import { Overview } from "./pages/Overview";
import { Sessions } from "./pages/Sessions";
import { ComingSoon } from "./pages/ComingSoon";
import { Settings } from "./pages/Settings";
import { Ports } from "./pages/Ports";
import { useSessions } from "./lib/useSessions";
import { themeFor, useSettings } from "./lib/settings";
import { inTauri, type Session } from "./lib/api";

export function App() {
  const root = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Page>("overview");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { sessions, error } = useSessions();
  const [settings, updateSettings] = useSettings();
  const glass = useMemo<GlassOptions>(() => {
    const theme = themeFor(settings.accent);
    return {
      accent: theme.accent,
      background: theme.background,
      light: theme.light,
      translucency: settings.translucency,
      solid: settings.reduceTransparency,
      refraction: settings.refraction,
    };
  }, [settings.accent, settings.translucency, settings.reduceTransparency, settings.refraction]);

  const list = sessions ?? [];
  const activeCount = list.filter((s) => s.state === "active" && !s.isSubagent).length;
  const open = (s: Session) => {
    setSelected(`${s.agent}:${s.id}`);
    setPage("sessions");
  };
  // The notch asks the main window to show a session ("agent:id"), or the overview.
  useEffect(() => {
    if (!inTauri) return;
    const off = listen<string>("open-session", ({ payload }) => {
      if (payload) {
        setSelected(payload);
        setPage("sessions");
      } else {
        setPage("overview");
      }
    });
    return () => {
      off.then((unlisten) => unlisten());
    };
  }, []);

  const search = useCallback((q: string) => {
    setQuery(q);
    if (q) setPage("sessions");
  }, []);

  return (
    <div className="app" ref={root}>
      <GlassLayer root={root} options={glass} />
      <div className="window" data-glass="window">
        <TitleBar query={query} onQuery={search} />
        <div className="body">
          <Sidebar page={page} onPage={setPage} activeCount={activeCount} />
          <main>
            {error && (
              <div className="tile alert" role="alert" style={{ marginBottom: 14 }}>
                Couldn't read sessions: {error}
              </div>
            )}
            {page === "settings" ? (
              <Settings settings={settings} onChange={updateSettings} />
            ) : sessions === null ? (
              <div className="empty">Looking for agent sessions…</div>
            ) : page === "overview" ? (
              <Overview sessions={list} onOpen={open} onViewAll={() => setPage("sessions")} />
            ) : page === "ports" ? (
              <Ports sessions={list} onOpenSession={open} />
            ) : page === "sessions" ? (
              <Sessions sessions={list} query={query} selectedKey={selected} onSelect={(s) => setSelected(`${s.agent}:${s.id}`)} />
            ) : (
              <ComingSoon page={page} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
