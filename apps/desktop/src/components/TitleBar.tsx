import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { inTauri } from "../lib/api";
import { CloseIcon, MaximizeIcon, MinimizeIcon, SearchIcon } from "./icons";
import logo from "../../src-tauri/icons/64x64.png";

interface Props {
  query: string;
  onQuery: (q: string) => void;
}

export function TitleBar({ query, onQuery }: Props) {
  const win = inTauri ? getCurrentWindow() : null;
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      } else if (e.key === "Escape" && document.activeElement === input.current) {
        onQuery("");
        input.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onQuery]);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand">
        <img src={logo} alt="" />
        Masthead
      </div>
      <div className="middle" data-tauri-drag-region>
        <label className="search">
          <SearchIcon size={14} />
          <input
            ref={input}
            type="search"
            placeholder="Search sessions, projects or models"
            aria-label="Search sessions"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          <kbd>Ctrl K</kbd>
        </label>
      </div>
      <div className="window-controls" data-tauri-drag-region>
        {win && (
          <>
            <button aria-label="Minimize" onClick={() => win.minimize()}>
              <MinimizeIcon />
            </button>
            <button aria-label="Maximize" onClick={() => win.toggleMaximize()}>
              <MaximizeIcon />
            </button>
            <button className="close" aria-label="Close to tray" onClick={() => win.hide()}>
              <CloseIcon />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
