use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::Utc;

use crate::adapters::{claude, codex};
use crate::model::Session;

/// Where each agent keeps its logs. `None` disables that agent.
#[derive(Debug, Clone, Default)]
pub struct Roots {
    pub claude: Option<PathBuf>,
    pub codex: Option<PathBuf>,
    pub codex_index: Option<PathBuf>,
}

impl Roots {
    /// The agents' standard locations under the user's home folder.
    pub fn detect() -> Self {
        Self {
            claude: claude::default_root(),
            codex: codex::default_root(),
            codex_index: codex::default_index(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Stamp {
    modified: Option<SystemTime>,
    len: u64,
}

impl Stamp {
    fn of(path: &Path) -> Option<Self> {
        let meta = std::fs::metadata(path).ok()?;
        Some(Self {
            modified: meta.modified().ok(),
            len: meta.len(),
        })
    }
}

/// Keeps parsed sessions and re-parses only files whose size or modification
/// time changed since the last [`SessionStore::refresh`].
pub struct SessionStore {
    roots: Roots,
    cache: HashMap<PathBuf, (Stamp, Session)>,
    codex_titles: HashMap<String, String>,
    codex_index_stamp: Option<Stamp>,
}

impl SessionStore {
    pub fn new(roots: Roots) -> Self {
        Self {
            roots,
            cache: HashMap::new(),
            codex_titles: HashMap::new(),
            codex_index_stamp: None,
        }
    }

    /// Scans all agents and returns every session, most recently active first.
    pub fn refresh(&mut self) -> Vec<Session> {
        let index_changed = self.reload_codex_index();
        let mut seen: Vec<PathBuf> = Vec::new();

        if let Some(root) = self.roots.claude.clone() {
            for path in claude::discover(&root) {
                self.update(&path, false, claude::parse_file);
                seen.push(path);
            }
        }
        if let Some(root) = self.roots.codex.clone() {
            let titles = self.codex_titles.clone();
            for path in codex::discover(&root) {
                self.update(&path, index_changed, |p| codex::parse_file(p, &titles));
                seen.push(path);
            }
        }

        self.cache.retain(|path, _| seen.contains(path));
        let now = Utc::now();
        let mut sessions: Vec<Session> = self
            .cache
            .values_mut()
            .map(|(_, s)| {
                s.refresh_state(now);
                s.clone()
            })
            .collect();
        sessions.sort_by_key(|s| std::cmp::Reverse(s.last_activity));
        sessions
    }

    fn update(
        &mut self,
        path: &Path,
        force: bool,
        parse: impl FnOnce(&Path) -> anyhow::Result<Session>,
    ) {
        let Some(stamp) = Stamp::of(path) else { return };
        let fresh = matches!(self.cache.get(path), Some((s, _)) if *s == stamp);
        if fresh && !force {
            return;
        }
        // A file that fails to parse keeps its previous summary, if any.
        if let Ok(session) = parse(path) {
            self.cache.insert(path.to_path_buf(), (stamp, session));
        }
    }

    /// Whether `path` is the working folder of a session found by the last refresh.
    /// The app only opens folders that pass this check.
    pub fn is_known_project(&self, path: &str) -> bool {
        self.cache
            .values()
            .any(|(_, s)| s.project_path.as_deref() == Some(path))
    }

    fn reload_codex_index(&mut self) -> bool {
        let Some(index) = self.roots.codex_index.as_deref() else {
            return false;
        };
        let stamp = Stamp::of(index);
        if stamp == self.codex_index_stamp {
            return false;
        }
        self.codex_index_stamp = stamp;
        self.codex_titles = codex::read_index(index);
        true
    }
}
