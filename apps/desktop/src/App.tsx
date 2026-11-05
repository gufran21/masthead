import { useCallback, useRef, useState } from "react";
import { GlassLayer, type GlassOptions } from "./glass/GlassLayer";
import { TitleBar } from "./components/TitleBar";
import { Sidebar, type Page } from "./components/Sidebar";
import { Overview } from "./pages/Overview";
import { Sessions } from "./pages/Sessions";
import { ComingSoon } from "./pages/ComingSoon";
import { useSessions } from "./lib/useSessions";
import type { Session } from "./lib/api";

const GLASS: GlassOptions = { accent: "#FF6E01", translucency: 70, solid: false, refraction: 30 };

export function App() {
  const root = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Page>("overview");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const { sessions, error } = useSessions();

  const list = sessions ?? [];
  const activeCount = list.filter((s) => s.state === "active" && !s.isSubagent).length;
  const open = (s: Session) => {
    setSelected(`${s.agent}:${s.id}`);
    setPage("sessions");
  };
  const search = useCallback((q: string) => {
    setQuery(q);
    if (q) setPage("sessions");
  }, []);

  return (
    <div className="app" ref={root}>
      <GlassLayer root={root} options={GLASS} />
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
            {sessions === null ? (
              <div className="empty">Looking for agent sessions…</div>
            ) : page === "overview" ? (
              <Overview sessions={list} onOpen={open} onViewAll={() => setPage("sessions")} />
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
