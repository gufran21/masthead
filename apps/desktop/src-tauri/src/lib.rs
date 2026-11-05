use std::sync::{Arc, Mutex};

use masthead_core::{Roots, Session, SessionStore};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};

type Store = Arc<Mutex<SessionStore>>;

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
        .invoke_handler(tauri::generate_handler![list_sessions, open_folder])
        .setup(|app| {
            let open = MenuItem::with_id(app, "open", "Open Masthead", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Masthead", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Masthead")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
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
            Ok(())
        })
        // Closing the window keeps Masthead running in the tray; Quit is in the tray menu.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Masthead");
}
