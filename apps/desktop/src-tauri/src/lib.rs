mod notch;
mod settings;

use std::sync::{Arc, Mutex};

use masthead_core::{Roots, Session, SessionStore};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

type Store = Arc<Mutex<SessionStore>>;

/// Passed by the Windows sign-in entry, so Masthead starts in the tray.
const STARTED_BY_LOGIN: &str = "--minimized";

/// Brings up the main window on one session (clicked in the notch).
#[tauri::command]
fn open_session(app: AppHandle, key: String) -> Result<(), String> {
    show_main(&app);
    app.emit("open-session", key).map_err(|e| e.to_string())
}

/// Every known agent session, most recently active first. Parsing runs off the
/// main thread; unchanged log files are served from the store's cache.
#[tauri::command]
async fn list_sessions(store: State<'_, Store>) -> Result<Vec<Session>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        store
            .lock()
            .map(|mut s| s.refresh())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens a session's project folder in the system file manager. Only folders that
/// belong to a known session are accepted, so the UI can't open arbitrary paths.
#[tauri::command]
async fn open_folder(store: State<'_, Store>, path: String) -> Result<(), String> {
    let known = store
        .lock()
        .map(|s| s.is_known_project(&path))
        .map_err(|e| e.to_string())?;
    if !known {
        return Err("Not a known project folder".into());
    }
    if !std::path::Path::new(&path).is_dir() {
        return Err("This folder no longer exists".into());
    }
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage::<Store>(Arc::new(Mutex::new(SessionStore::new(Roots::detect()))))
        .manage(notch::NotchState::default())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![STARTED_BY_LOGIN]),
        ))
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            open_folder,
            open_session,
            notch::notch_ready,
            notch::notch_island,
            notch::notch_pin,
            notch::notch_announce,
            notch::capture_backdrop,
            settings::get_settings,
            settings::set_settings,
            settings::get_autostart,
            settings::set_autostart,
            settings::agent_folders
        ])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open Masthead", true, None::<&str>)?;
            let notch_item =
                MenuItem::with_id(app, "notch", "Turn notch on or off", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Masthead", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &notch_item, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Masthead")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "notch" => {
                        let _ = settings::update(app, |s| s.notch_enabled = !s.notch_enabled);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            let store = settings::SettingsStore::load(app.handle());
            let current = store.get();
            app.manage(store);
            notch::init(app.handle())?;
            notch::apply(app.handle(), &current);

            // Started by Windows at sign-in: stay in the tray with the notch ready.
            if !std::env::args().any(|a| a == STARTED_BY_LOGIN) {
                show_main(app.handle());
            }
            Ok(())
        })
        // Closing the main window keeps Masthead in the tray (Quit is in the tray
        // menu), unless the user turned that off in Settings.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let app = window.app_handle();
                    if app.state::<settings::SettingsStore>().get().close_to_tray {
                        let _ = window.hide();
                    } else {
                        app.exit(0);
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Masthead");
}
