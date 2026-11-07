//! User settings: one JSON file in the app's config folder, owned here and
//! shared by the main window, the notch and the tray menu.

use std::path::PathBuf;
use std::sync::Mutex;

use masthead_core::Roots;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::notch;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Accent colour as `#RRGGBB`.
    pub accent: String,
    /// 0–100: how much of the background shows through the glass.
    pub translucency: u8,
    /// 0–100: how strongly glass edges bend what's behind them.
    pub refraction: u8,
    /// Solid surfaces instead of glass.
    pub reduce_transparency: bool,
    pub notch_enabled: bool,
    /// How long the cursor must press the top edge to reveal the notch, in milliseconds.
    pub notch_reveal_ms: u16,
    /// Pop the notch open when an agent finishes its turn.
    pub notch_on_finish: bool,
    /// How long the notch then stays open on its own, in seconds.
    pub notch_open_secs: u8,
    /// Closing the main window keeps Masthead running in the tray.
    pub close_to_tray: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            accent: "#FF6E01".into(),
            translucency: 70,
            refraction: 30,
            reduce_transparency: false,
            notch_enabled: true,
            notch_reveal_ms: 160,
            notch_on_finish: true,
            notch_open_secs: 6,
            close_to_tray: true,
        }
    }
}

impl Settings {
    /// Keeps hand-edited or out-of-range values from reaching the app.
    fn sanitized(mut self) -> Self {
        let hex = self
            .accent
            .strip_prefix('#')
            .filter(|h| h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit()));
        self.accent = match hex {
            Some(h) => format!("#{}", h.to_ascii_uppercase()),
            None => Self::default().accent,
        };
        self.translucency = self.translucency.min(100);
        self.refraction = self.refraction.min(100);
        self.notch_reveal_ms = self.notch_reveal_ms.min(1000);
        self.notch_open_secs = self.notch_open_secs.clamp(2, 30);
        self
    }
}

pub struct SettingsStore {
    path: Option<PathBuf>,
    current: Mutex<Settings>,
}

impl SettingsStore {
    /// Reads the settings file; a missing or unreadable file gives the defaults.
    pub fn load(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_config_dir()
            .ok()
            .map(|d| d.join("settings.json"));
        let current = path
            .as_ref()
            .and_then(|p| std::fs::read(p).ok())
            .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
            .unwrap_or_default()
            .sanitized();
        Self {
            path,
            current: Mutex::new(current),
        }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Writes to a temporary file first, so a crash never leaves half a file.
    fn save(&self, settings: &Settings) -> Result<(), String> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
        let temp = path.with_extension("json.tmp");
        std::fs::write(&temp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&temp, path).map_err(|e| e.to_string())
    }
}

/// Changes the settings, saves them, applies them and tells both windows.
pub fn update(app: &AppHandle, change: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
    let store = app.state::<SettingsStore>();
    let next = {
        let mut current = store.current.lock().map_err(|e| e.to_string())?;
        let mut next = current.clone();
        change(&mut next);
        let next = next.sanitized();
        *current = next.clone();
        next
    };
    store.save(&next)?;
    notch::apply(app, &next);
    app.emit("settings-changed", &next)
        .map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
pub fn get_settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    update(&app, |s| *s = settings)
}

/// Whether Masthead starts when the user signs in to Windows. This lives in
/// Windows itself (the Run key), not in the settings file.
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let launcher = app.autolaunch();
    if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    }
    .map_err(|e| e.to_string())?;
    launcher.is_enabled().map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentFolders {
    claude: Option<String>,
    codex: Option<String>,
}

/// The folders Masthead reads session logs from, for the About section.
#[tauri::command]
pub fn agent_folders() -> AgentFolders {
    let roots = Roots::detect();
    let show = |p: Option<PathBuf>| p.map(|p| p.display().to_string());
    AgentFolders {
        claude: show(roots.claude),
        codex: show(roots.codex),
    }
}

#[cfg(test)]
mod tests {
    use super::Settings;

    #[test]
    fn missing_fields_take_defaults() {
        let s: Settings = serde_json::from_str(r##"{"accent":"#0A84FF"}"##).unwrap();
        assert_eq!(s.accent, "#0A84FF");
        assert_eq!(s.translucency, Settings::default().translucency);
        assert!(s.notch_enabled);
    }

    #[test]
    fn bad_values_are_corrected() {
        let s = Settings {
            accent: "orange; background: url(x)".into(),
            translucency: 250,
            refraction: 101,
            notch_reveal_ms: 9000,
            notch_open_secs: 0,
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(s.accent, "#FF6E01");
        assert_eq!((s.translucency, s.refraction), (100, 100));
        assert_eq!(s.notch_reveal_ms, 1000);
        assert_eq!(s.notch_open_secs, 2);

        let lower = Settings {
            accent: "#0a84ff".into(),
            ..Settings::default()
        }
        .sanitized();
        assert_eq!(lower.accent, "#0A84FF");
    }
}
