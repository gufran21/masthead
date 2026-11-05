import { useEffect, useRef, useState, type RefObject } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  captureBackdrop,
  inTauri,
  notchAnnounce,
  notchIsland,
  notchPin,
  notchReady,
  openInMain,
  type Session,
  type Turn,
} from "../lib/api";
import { compact, displayTitle, isToday, relativeTime, totalTokens } from "../lib/format";
import { useSessions } from "../lib/useSessions";
import { AgentBadge, StatePill } from "../components/badges";
import { sessionKey } from "../components/SessionCard";
import { NotchGlass, type Backdrop } from "./glass";
import logo from "../../src-tauri/icons/64x64.png";

/** Window size; must match FRAME in src-tauri/src/notch.rs. It never changes, so it never flickers. */
const FRAME = { w: 440, h: 420 };
/** Gap between the top of the screen and the island. */
const TOP_GAP = 8;
const PILL = { w: 236, h: 34 };
const PEEK_W = 404;
const ROW_H = 58;
const MAX_ROWS = 5;
const CLOSE_DELAY_MS = 260;
const CAPTURE_MS = 500;
/** How long the notch stays open on its own when an agent finishes. */
const ANNOUNCE_MS = 6000;
/** How long to wait for the first capture before appearing without it. */
const FIRST_CAPTURE_MS = 150;

/** Island height: padding (20) + header (36) + rows + footer (34). */
function peekHeight(rows: number): number {
  const body = rows === 0 ? 64 : Math.min(rows, MAX_ROWS) * ROW_H;
  return 20 + 36 + body + 34;
}

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Appear spring: under-damped, so the island overshoots and wobbles once. */
const APPEAR = reducedMotion ? { k: 300, c: 40 } : { k: 260, c: 17 };
/** Size spring for the pill-to-card morph. */
const MORPH = reducedMotion ? { k: 300, c: 40 } : { k: 320, c: 24 };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

interface Spring {
  x: number;
  v: number;
}

function step(s: Spring, target: number, { k, c }: { k: number; c: number }, dt: number) {
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
}

function atRest(s: Spring, target: number, eps: number) {
  return Math.abs(s.x - target) < eps && Math.abs(s.v) < eps * 10;
}

interface Target {
  shown: boolean;
  w: number;
  h: number;
}

/**
 * Drives the island with springs. Each frame moves the DOM and draws the glass
 * from the same numbers, so the two never drift apart. Frames run only while
 * something moves; at rest the page does no work.
 */
function useIslandMotion(
  island: RefObject<HTMLDivElement | null>,
  canvas: RefObject<HTMLCanvasElement | null>,
  target: Target,
) {
  const targetRef = useRef(target);
  targetRef.current = target;
  const kick = useRef(() => {});
  const glassRef = useRef<NotchGlass | null>(null);
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const el = island.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const glass = NotchGlass.create(cv, FRAME.w, FRAME.h, () => setSolid(true));
    glassRef.current = glass;
    if (!glass) setSolid(true);

    const start = targetRef.current;
    const p: Spring = { x: start.shown ? 1 : 0, v: 0 };
    const w: Spring = { x: start.w, v: 0 };
    const h: Spring = { x: start.h, v: 0 };
    let raf = 0;
    let last = 0;

    const apply = () => {
      // Overshoot past 1 shows as a gentle swell; speed stretches it along the
      // direction of travel and squashes it across, like something soft.
      const s = Math.min(p.x, 1) + Math.max(p.x - 1, 0) * 0.6;
      const stretch = reducedMotion ? 0 : clamp(p.v * 0.05, -0.22, 0.3);
      const sx = Math.max(s * (1 - stretch * 0.6), 0);
      const sy = Math.max(s * (1 + stretch), 0);
      const alpha = clamp(p.x * 3, 0, 1);
      const radius = Math.min(h.x / 2, 22);
      const top = TOP_GAP * clamp(p.x, 0, 1);
      const style = el.style;
      style.left = `${(FRAME.w - w.x) / 2}px`;
      style.top = `${top}px`;
      style.width = `${w.x}px`;
      style.height = `${h.x}px`;
      style.borderRadius = `${radius}px`;
      style.transform = `scale(${sx}, ${sy})`;
      style.opacity = `${alpha}`;
      style.visibility = alpha > 0.001 ? "visible" : "hidden";
      glass?.draw(
        { x: FRAME.w / 2 - (w.x * sx) / 2, y: top, w: w.x * sx, h: h.x * sy },
        radius * Math.min(sx, sy),
        alpha,
      );
    };

    const frame = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      const t = targetRef.current;
      const goal = t.shown ? 1 : 0;
      // Small fixed steps keep the springs stable at any refresh rate.
      const n = Math.ceil(dt / 0.004);
      for (let i = 0; i < n; i++) {
        step(p, goal, APPEAR, dt / n);
        step(w, t.w, MORPH, dt / n);
        step(h, t.h, MORPH, dt / n);
      }
      if (p.x < 0) p.x = p.v = 0;
      const settled = atRest(p, goal, 0.001) && atRest(w, t.w, 0.05) && atRest(h, t.h, 0.05);
      if (settled) {
        p.x = goal;
        w.x = t.w;
        h.x = t.h;
        p.v = w.v = h.v = 0;
      }
      apply();
      if (settled && !glass?.fading) {
        raf = 0;
        last = 0;
      } else {
        raf = requestAnimationFrame(frame);
      }
    };

    kick.current = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    apply();
    return () => cancelAnimationFrame(raf);
  }, [island, canvas]);

  useEffect(() => kick.current(), [target.shown, target.w, target.h]);

  const setBackdrop = (b: Backdrop) => {
    glassRef.current?.setBackdrop(b);
    kick.current();
  };
  return { solid, setBackdrop };
}

export function Notch() {
  const { sessions } = useSessions();
  // In a plain browser (pnpm dev:web) there is no edge to push, so start shown.
  const [shown, setShown] = useState(!inTauri);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [open, setOpen] = useState(false);
  const islandRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wantShown = useRef(false);
  /** Sessions whose agent finished since the user last looked: key → when. */
  const [finished, setFinished] = useState<Record<string, number>>({});
  const [announcing, setAnnouncing] = useState(false);
  const turns = useRef(new Map<string, Turn>());
  const seen = useRef(false);

  const all = (sessions ?? []).filter((s) => !s.isSubagent);
  const live = all.filter((s) => s.state !== "ended");
  const active = live.filter((s) => s.state === "active").length;
  const idle = live.length - active;
  const today = all.filter((s) => isToday(s.lastActivity));
  const tokensToday = today.reduce((n, s) => n + totalTokens(s.tokens), 0);
  const isFinished = (s: Session) => sessionKey(s) in finished;
  const finishedCount = all.filter(isFinished).length;
  // Finished sessions first, newest first, then everything else that's live.
  const rows = [
    ...all.filter(isFinished).sort((a, b) => finished[sessionKey(b)] - finished[sessionKey(a)]),
    ...live.filter((s) => !isFinished(s)),
  ].slice(0, MAX_ROWS);
  const size = open ? { w: PEEK_W, h: peekHeight(rows.length) } : PILL;

  const { solid, setBackdrop } = useIslandMotion(islandRef, canvasRef, { shown, ...size });
  const setBackdropRef = useRef(setBackdrop);
  setBackdropRef.current = setBackdrop;

  // Rust reveals and hides the island and reports hover; the window is shown
  // only once these listeners are in place.
  useEffect(() => {
    if (!inTauri) return;
    const offs = Promise.all([
      listen("notch-show", async () => {
        wantShown.current = true;
        // Appear with the glass already filled, so the first frames don't change look.
        const shot = await Promise.race([
          captureBackdrop(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), FIRST_CAPTURE_MS)),
        ]);
        if (shot) setBackdropRef.current(shot);
        if (wantShown.current) setShown(true);
      }),
      listen("notch-hide", () => {
        wantShown.current = false;
        setShown(false);
      }),
      listen<boolean>("notch-hover", ({ payload }) => setHover(payload)),
    ]);
    offs.then(() => notchReady());
    return () => {
      offs.then((fns) => fns.forEach((off) => off()));
    };
  }, []);

  // An agent that was working and is now done: pop the notch open and mark it.
  // The first poll only records turns, so nothing is announced on startup.
  useEffect(() => {
    if (!sessions) return;
    const now = Date.now();
    const fresh: string[] = [];
    const working: string[] = [];
    for (const s of sessions) {
      if (s.isSubagent) continue;
      const key = sessionKey(s);
      if (turns.current.get(key) === "working" && s.turn === "done") fresh.push(key);
      if (s.turn === "working") working.push(key);
      turns.current.set(key, s.turn);
    }
    if (fresh.length === 0 && working.length === 0) return;
    setFinished((f) => {
      if (fresh.length === 0 && !working.some((k) => k in f)) return f;
      const next = { ...f };
      for (const key of working) delete next[key];
      for (const key of fresh) next[key] = now;
      return next;
    });
    if (fresh.length > 0) {
      seen.current = false;
      setAnnouncing(true);
      notchAnnounce(ANNOUNCE_MS);
    }
  }, [sessions]);

  useEffect(() => {
    if (!announcing) return;
    const timer = setTimeout(() => setAnnouncing(false), ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [announcing, finished]);

  // Keep the glass in step with what's behind it while the island is out.
  useEffect(() => {
    if (!inTauri || !shown) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const grab = async () => {
      const shot = await captureBackdrop();
      if (stopped || !shot) return; // no capture: the glass keeps its plain tint
      setBackdropRef.current(shot);
      timer = setTimeout(grab, CAPTURE_MS);
    };
    timer = setTimeout(grab, CAPTURE_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [shown]);

  // Hovering the pill expands it; leaving collapses it after a moment unless pinned.
  useEffect(() => {
    if (shown && (hover || pinned || announcing)) {
      setOpen(true);
      return;
    }
    if (!shown) {
      setOpen(false);
      setPinned(false);
      return;
    }
    const timer = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [shown, hover, pinned, announcing]);

  // Once the user has hovered the card, closing it counts as having seen what finished.
  useEffect(() => {
    if (open && hover) seen.current = true;
    if (!open && seen.current) {
      seen.current = false;
      setFinished({});
    }
  }, [open, hover]);

  useEffect(() => {
    notchPin(pinned);
  }, [pinned]);

  useEffect(() => {
    notchIsland((FRAME.w - size.w) / 2, TOP_GAP, size.w, size.h);
  }, [size.w, size.h]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const openSession = (s: Session) => {
    const key = sessionKey(s);
    setPinned(false);
    setFinished((f) => {
      const next = { ...f };
      delete next[key];
      return next;
    });
    openInMain(key);
  };

  const status = finishedCount
    ? `${finishedCount} finished`
    : active
      ? `${active} active`
      : idle
        ? `${idle} idle`
        : "No agents";

  return (
    <>
      <canvas ref={canvasRef} className="notch-glass" aria-hidden="true" />
      <div
        ref={islandRef}
        className={`island${open ? " open" : ""}${pinned ? " pinned" : ""}${solid ? " solid" : ""}`}
        onMouseEnter={inTauri ? undefined : () => setHover(true)}
        onMouseLeave={inTauri ? undefined : () => setHover(false)}
      >
        <button
          className="pill-row"
          onClick={() => setPinned((p) => !p)}
          aria-expanded={open}
          aria-label={`Masthead: ${status}`}
        >
          <span className="dots" aria-hidden="true">
            <span className={`dot running${active ? " on" : ""}`} />
            <span className={`dot needs${finishedCount ? " on" : ""}`} />
            <span className={`dot idle${idle ? " on" : ""}`} />
          </span>
          <span className="pill-status">{status}</span>
          <span className="pill-tokens">{compact(tokensToday)}</span>
        </button>

        <div className="peek" aria-hidden={!open}>
          <div className="peek-head">
            <img src={logo} alt="" />
            <span>Masthead</span>
            {finishedCount > 0 && <span className="peek-badge">{finishedCount} finished</span>}
            <button
              className="peek-open"
              onClick={() => {
                setFinished({});
                openInMain();
              }}
              tabIndex={open ? 0 : -1}
            >
              Open
            </button>
          </div>
          {rows.length === 0 ? (
            <div className="peek-empty">No agent is working right now.</div>
          ) : (
            <div className="peek-rows">
              {rows.map((s) => (
                <button
                  key={sessionKey(s)}
                  className={`peek-row${isFinished(s) ? " finished" : ""}`}
                  onClick={() => openSession(s)}
                  tabIndex={open ? 0 : -1}
                >
                  <AgentBadge agent={s.agent} />
                  <span className="peek-text">
                    <span className="peek-title">{displayTitle(s.title)}</span>
                    <span className="peek-meta">
                      {[s.projectName, `${isFinished(s) ? "finished " : ""}${relativeTime(s.lastActivity)}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {isFinished(s) ? <span className="pill done">Done</span> : <StatePill session={s} />}
                </button>
              ))}
            </div>
          )}
          <div className="peek-foot">
            {today.length} {today.length === 1 ? "session" : "sessions"} today · {compact(tokensToday)} tokens
            {live.length > MAX_ROWS && <span className="more">+{live.length - MAX_ROWS} more</span>}
          </div>
        </div>
      </div>
    </>
  );
}
