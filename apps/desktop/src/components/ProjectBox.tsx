import { useEffect, useState } from "react";
import { inTauri, openFolder } from "../lib/api";
import { CheckIcon, ChevronRightIcon, CopyIcon, FolderIcon, OpenFolderIcon } from "./icons";

/** Splits a Windows or POSIX path into display segments, with an upper-case drive letter. */
export function pathSegments(path: string): string[] {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length && /^[a-z]:$/i.test(parts[0])) parts[0] = parts[0].toUpperCase();
  return parts;
}

export function ProjectBox({
  name,
  path,
  onOpen = openFolder,
}: {
  name: string | null;
  path: string;
  /** Opens the folder; defaults to the session-project check in Rust. */
  onOpen?: (path: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const segments = pathSegments(path);
  const fullPath = path.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => setError(null), [path]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(fullPath);
      setCopied(true);
      return;
    } catch {
      // Fall back to a hidden text area when the async clipboard is refused.
    }
    const area = document.createElement("textarea");
    area.value = fullPath;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    setCopied(ok);
  };

  const open = async () => {
    setError(null);
    try {
      // The backend checks the path before opening it.
      await onOpen(path);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="project-box">
      <div className="project-head">
        <span className="folder-tile" aria-hidden="true">
          <FolderIcon />
        </span>
        <span className="project-name" title={name ?? undefined}>
          {name ?? segments.at(-1) ?? fullPath}
        </span>
        {inTauri && (
          <button
            className="glass-control icon-button small"
            onClick={open}
            aria-label="Open folder"
            title="Open in File Explorer"
          >
            <OpenFolderIcon />
          </button>
        )}
        <button
          className={`glass-control icon-button small${copied ? " done" : ""}`}
          onClick={copy}
          aria-label={copied ? "Path copied" : "Copy folder path"}
          title={copied ? "Copied" : "Copy path"}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      <div className="crumbs" title={fullPath} aria-label={fullPath}>
        {segments.map((seg, i) => (
          <span key={i} className={`crumb${i === segments.length - 1 ? " last" : ""}`}>
            {i > 0 && <ChevronRightIcon />}
            {seg}
          </span>
        ))}
      </div>
      {error && (
        <div className="project-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
