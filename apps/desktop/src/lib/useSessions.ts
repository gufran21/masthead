import { useEffect, useState } from "react";
import { listSessions, type Session } from "./api";

const POLL_MS = 3000;

/** Polls the Rust store. Unchanged log files are cached there, so polling is cheap. */
export function useSessions() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await listSessions();
        if (alive) {
          setSessions(next);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(String(e));
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  return { sessions, error };
}
