import type { Listener } from "./api";

/** What a listening program is, in words people use. */
export interface ServerKind {
  /** e.g. "Next.js", "Vite", "PostgreSQL", "Node.js app". */
  label: string;
  group: "dev" | "data" | "app" | "system";
  /** Serves web pages, so "Open in browser" makes sense. */
  web: boolean;
}

type Rule = [RegExp, string, ServerKind["group"], boolean];

/** Matched against the command line, then the process name, in order. */
const RULES: Rule[] = [
  [/\bnext(\.js)?\b.*\b(dev|start)\b|next[\\/]dist[\\/]bin[\\/]next/i, "Next.js", "dev", true],
  [/\bnuxt\b|nuxi/i, "Nuxt", "dev", true],
  [/\bastro\b/i, "Astro", "dev", true],
  [/\bremix\b/i, "Remix", "dev", true],
  [/svelte-kit|sveltekit/i, "SvelteKit", "dev", true],
  [/\bstorybook\b/i, "Storybook", "dev", true],
  [/\bexpo\b/i, "Expo", "dev", true],
  [/react-scripts/i, "Create React App", "dev", true],
  [/\bng(\.js)?\s+serve\b|@angular[\\/]cli/i, "Angular", "dev", true],
  [/\bvite\b/i, "Vite", "dev", true],
  [/webpack(-dev-server)?\b.*\b(serve|dev)/i, "Webpack", "dev", true],
  [/\bparcel\b/i, "Parcel", "dev", true],
  [/\bwrangler\b/i, "Wrangler", "dev", true],
  [/\btauri\b.*\bdev\b/i, "Tauri dev", "dev", true],
  [/\bjupyter\b/i, "Jupyter", "dev", true],
  [/manage\.py\s+runserver|\bdjango\b/i, "Django", "dev", true],
  [/\bflask\b/i, "Flask", "dev", true],
  [/\buvicorn\b/i, "Uvicorn", "dev", true],
  [/\bgunicorn\b/i, "Gunicorn", "dev", true],
  [/\bstreamlit\b/i, "Streamlit", "dev", true],
  [/http\.server|SimpleHTTPServer/i, "Python web server", "dev", true],
  [/\brails\b|\bpuma\b/i, "Rails", "dev", true],
  [/\bphp\b.*\s-S\s/i, "PHP server", "dev", true],
  [/\bhugo\b/i, "Hugo", "dev", true],
  [/\bjekyll\b/i, "Jekyll", "dev", true],
  [/\bdotnet\b.*\b(run|watch)\b/i, ".NET app", "dev", true],
  [/\bcargo\b.*\b(run|watch)\b/i, "Rust app", "dev", true],
  [/\bgo\b\s+run\b/i, "Go app", "dev", true],
  [/postgres(ql)?|pg_ctl/i, "PostgreSQL", "data", false],
  [/\bmysqld\b|mariadb/i, "MySQL", "data", false],
  [/\bmongod\b/i, "MongoDB", "data", false],
  [/redis-server|\bredis\b/i, "Redis", "data", false],
  [/memurai/i, "Memurai (Redis)", "data", false],
  [/elasticsearch|opensearch/i, "Elasticsearch", "data", false],
  [/\bollama\b/i, "Ollama", "data", true],
  [/docker|com\.docker|vpnkit|wslrelay/i, "Docker", "data", false],
  [/\bmasthead\b/i, "Masthead", "app", false],
  [/\bcode(\.exe)?$|Code\.exe|\bcursor(\.exe)?$/i, "Code editor", "app", false],
];

const SYSTEM =
  /^(system|svchost|lsass|services|wininit|spoolsv|lsm|smss|csrss|winlogon|ms[a-z]*\.exe|searchindexer)(\.exe)?$/i;

function plain(name: string): string {
  const base = name.replace(/\.exe$/i, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function identify(p: Listener): ServerKind {
  const haystacks = [p.command ?? "", p.exe ?? "", p.name];
  for (const [pattern, label, group, web] of RULES) {
    if (haystacks.some((h) => pattern.test(h))) return { label, group, web };
  }
  if (SYSTEM.test(p.name) || p.pid === 4) {
    const label = /^svchost/i.test(p.name) ? "Windows service" : p.pid === 4 ? "Windows" : plain(p.name);
    return { label, group: "system", web: false };
  }
  if (!p.mine) return { label: plain(p.name), group: "system", web: false };
  // A runtime started from a project folder is almost always a dev server.
  const fromProject = !!p.cwd && !/^[a-z]:\\(windows|program files)/i.test(p.cwd);
  if (/^node(\.exe)?$/i.test(p.name)) return { label: "Node.js app", group: fromProject ? "dev" : "app", web: true };
  if (/^(python|pythonw|py)(\d|\.)*(\.exe)?$/i.test(p.name))
    return { label: "Python app", group: fromProject ? "dev" : "app", web: true };
  if (/^(deno|bun|java|ruby|php|dotnet)(\.exe)?$/i.test(p.name))
    return { label: `${plain(p.name)} app`, group: fromProject ? "dev" : "app", web: true };
  return { label: plain(p.name), group: "app", web: false };
}

export const GROUPS: { id: ServerKind["group"]; title: string; empty?: string }[] = [
  { id: "dev", title: "Dev servers" },
  { id: "data", title: "Databases and tools" },
  { id: "app", title: "Other apps" },
  { id: "system", title: "Windows and services" },
];
