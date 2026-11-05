//! The notch: a transparent, always-on-top window at the top centre of the screen.
//!
//! Resizing or hiding a transparent window makes it flicker on Windows, so this
//! one keeps a fixed size and stays shown. The island inside it animates in and
//! out, and the window lets clicks through everywhere except over the island.
//! A watcher thread reveals the island when the cursor is pushed against the top
//! edge of the screen, reports hover, and hides it again once the cursor leaves.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow};

pub const LABEL: &str = "notch";
/// Window size in logical pixels: room for the largest peek card and its shadow.
/// Must match `FRAME` in src/notch/Notch.tsx.
const FRAME: (f64, f64) = (440.0, 420.0);
/// How long the cursor must press against the top edge before the island appears.
const REVEAL_DWELL: Duration = Duration::from_millis(160);
/// Half-width of the strip along the top edge that reveals the island, in logical pixels.
const REVEAL_HALF_WIDTH: f64 = 320.0;
/// How long the cursor must stay away before the island hides.
const HIDE_DELAY: Duration = Duration::from_millis(700);
/// Extra room around the island that still counts as "near it", in logical pixels.
const NEAR_MARGIN: f64 = 28.0;
const POLL: Duration = Duration::from_millis(16);

#[derive(Default)]
pub struct NotchState {
    /// The user clicked the pill to keep the peek card open.
    pinned: AtomicBool,
    /// Turned off from the tray menu: the edge no longer reveals the island.
    disabled: AtomicBool,
    /// The page has loaded and is listening for events.
    ready: AtomicBool,
    /// The window is excluded from screen capture, so capturing behind it is safe.
    capture: AtomicBool,
    /// Island bounds in logical pixels relative to the window: x, y, width, height.
    island: Mutex<[f64; 4]>,
    /// Shown without the cursor (an agent finished) and kept up until then.
    announce_until: Mutex<Option<Instant>>,
}

fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Sizes the window and centres it at the very top of the primary monitor.
fn place(win: &WebviewWindow) -> tauri::Result<()> {
    let Some(monitor) = win.primary_monitor()?.or(win.current_monitor()?) else {
        return Ok(());
    };
    let origin = monitor.position();
    let width = (FRAME.0 * monitor.scale_factor()).round() as i32;
    win.set_size(LogicalSize::new(FRAME.0, FRAME.1))?;
    let x = origin.x + (monitor.size().width as i32 - width) / 2;
    win.set_position(PhysicalPosition::new(x, origin.y))
}

/// One-time setup: place the window, exclude it from screen capture (so it can
/// capture what is behind it for the glass) and start watching the cursor. The
/// window is shown later by `notch_ready`, once the page can draw.
pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<NotchState>();
    if let Some(win) = window(app) {
        place(&win)?;
        win.set_ignore_cursor_events(true)?;
        state
            .capture
            .store(capture::exclude_from_capture(&win), Ordering::Relaxed);
    }
    let app = app.clone();
    thread::Builder::new()
        .name("notch-watch".into())
        .spawn(move || watch(app))?;
    Ok(())
}

/// The page has mounted and listens for events: show the (still empty) window.
#[tauri::command]
pub fn notch_ready(app: AppHandle, state: State<'_, NotchState>) -> Result<(), String> {
    if state.ready.swap(true, Ordering::Relaxed) {
        return Ok(());
    }
    let win = window(&app).ok_or("The notch window is missing")?;
    win.show().map_err(|e| e.to_string())
}

/// Where the island is (or is heading), so hover and click-through follow it.
#[tauri::command]
pub fn notch_island(state: State<'_, NotchState>, x: f64, y: f64, width: f64, height: f64) {
    if let Ok(mut island) = state.island.lock() {
        *island = [x, y, width, height];
    }
}

/// While pinned, the island stays even when the cursor moves away.
#[tauri::command]
pub fn notch_pin(state: State<'_, NotchState>, pinned: bool) {
    state.pinned.store(pinned, Ordering::Relaxed);
}

/// Pops the island out and keeps it up for `ms`, wherever the cursor is.
#[tauri::command]
pub fn notch_announce(state: State<'_, NotchState>, ms: u64) {
    if let Ok(mut until) = state.announce_until.lock() {
        let end = Instant::now() + Duration::from_millis(ms.min(30_000));
        *until = Some(until.map_or(end, |u| u.max(end)));
    }
}

/// Tray menu: turns the notch off or back on. The window itself stays put.
pub fn toggle_enabled(app: &AppHandle) {
    let state = app.state::<NotchState>();
    let disabled = !state.disabled.load(Ordering::Relaxed);
    state.disabled.store(disabled, Ordering::Relaxed);
}

fn watch(app: AppHandle) {
    let mut revealed = false;
    let mut hovering = false;
    let mut passthrough = true;
    let mut pressing_since: Option<Instant> = None;
    let mut away_since: Option<Instant> = None;
    loop {
        thread::sleep(POLL);
        let state = app.state::<NotchState>();
        if !state.ready.load(Ordering::Relaxed) {
            continue;
        }
        let Some(win) = window(&app) else { continue };
        let (Ok(cursor), Ok(pos), Ok(Some(monitor))) = (
            win.cursor_position(),
            win.outer_position(),
            win.primary_monitor(),
        ) else {
            continue;
        };
        let scale = monitor.scale_factor();
        let top = f64::from(monitor.position().y);
        // The cursor in the window's logical coordinates.
        let cx = (cursor.x - f64::from(pos.x)) / scale;
        let cy = (cursor.y - f64::from(pos.y)) / scale;
        let [ix, iy, iw, ih] = state.island.lock().map(|i| *i).unwrap_or_default();
        let disabled = state.disabled.load(Ordering::Relaxed);
        let announcing = state
            .announce_until
            .lock()
            .map(|u| u.is_some_and(|u| Instant::now() < u))
            .unwrap_or(false);

        if !revealed && !disabled && announcing {
            pressing_since = None;
            away_since = None;
            revealed = true;
            let _ = app.emit_to(LABEL, "notch-show", ());
        }
        if !revealed && !disabled {
            let at_edge = cursor.y <= top + 1.0 && cursor.y >= top - 1.0;
            let in_strip = (cx - FRAME.0 / 2.0).abs() <= REVEAL_HALF_WIDTH;
            if at_edge && in_strip {
                let since = *pressing_since.get_or_insert_with(Instant::now);
                if since.elapsed() >= REVEAL_DWELL {
                    pressing_since = None;
                    away_since = None;
                    revealed = true;
                    let _ = app.emit_to(LABEL, "notch-show", ());
                }
            } else {
                pressing_since = None;
            }
        }

        // Pressing the edge only reveals the pill; moving onto it expands it.
        let over = revealed && cx >= ix && cx <= ix + iw && cy >= iy && cy <= iy + ih;
        if over != hovering {
            hovering = over;
            let _ = app.emit_to(LABEL, "notch-hover", over);
        }
        if passthrough == over && win.set_ignore_cursor_events(!over).is_ok() {
            passthrough = !over;
        }

        if revealed {
            let near = cx >= ix - NEAR_MARGIN
                && cx <= ix + iw + NEAR_MARGIN
                && cy >= -1.0
                && cy <= iy + ih + NEAR_MARGIN;
            let stay = !disabled && (near || announcing || state.pinned.load(Ordering::Relaxed));
            if stay {
                away_since = None;
            } else if disabled
                || away_since.get_or_insert_with(Instant::now).elapsed() >= HIDE_DELAY
            {
                away_since = None;
                revealed = false;
                let _ = app.emit_to(LABEL, "notch-hide", ());
            }
        }
    }
}

/// The pixels behind the notch window, for the liquid-glass backdrop. The window
/// is excluded from capture, so this is what the user would see without it.
/// Layout: width (u32 LE), height (u32 LE), then RGBA rows.
#[tauri::command]
pub async fn capture_backdrop(
    app: AppHandle,
    state: State<'_, NotchState>,
) -> Result<tauri::ipc::Response, String> {
    if !state.capture.load(Ordering::Relaxed) {
        return Err("Screen capture is not available".into());
    }
    let win = window(&app).ok_or("The notch window is missing")?;
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let (w, h) = (size.width, size.height);
    let pixels = tauri::async_runtime::spawn_blocking(move || capture::rect(pos.x, pos.y, w, h))
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Screen capture failed")?;
    let mut out = Vec::with_capacity(8 + pixels.len());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    out.extend_from_slice(&pixels);
    Ok(tauri::ipc::Response::new(out))
}

#[cfg(windows)]
mod capture {
    use tauri::WebviewWindow;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
        GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT,
        DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };

    /// Windows 10 2004+: leaves the window out of screen captures, including its own.
    /// Without this, capturing behind the notch would capture the notch itself.
    pub fn exclude_from_capture(win: &WebviewWindow) -> bool {
        match win.hwnd() {
            // SAFETY: the handle belongs to a live window owned by this process.
            Ok(hwnd) => unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) }.is_ok(),
            Err(_) => false,
        }
    }

    /// Copies a rectangle of the screen (physical pixels) as RGBA.
    pub fn rect(x: i32, y: i32, width: u32, height: u32) -> Option<Vec<u8>> {
        let (w, h) = (i32::try_from(width).ok()?, i32::try_from(height).ok()?);
        if w == 0 || h == 0 {
            return None;
        }
        // SAFETY: plain GDI calls on handles created and released in this function.
        unsafe {
            let screen = GetDC(None);
            let mem = CreateCompatibleDC(Some(screen));
            let bitmap = CreateCompatibleBitmap(screen, w, h);
            let previous = SelectObject(mem, bitmap.into());
            let copied = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT).is_ok();

            let mut info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut pixels = vec![0u8; width as usize * height as usize * 4];
            let rows = if copied {
                GetDIBits(
                    mem,
                    bitmap,
                    0,
                    height,
                    Some(pixels.as_mut_ptr().cast()),
                    &mut info,
                    DIB_RGB_COLORS,
                )
            } else {
                0
            };

            SelectObject(mem, previous);
            let _ = DeleteObject(bitmap.into());
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);

            if rows == 0 {
                return None;
            }
            for px in pixels.chunks_exact_mut(4) {
                px.swap(0, 2); // BGRA -> RGBA
                px[3] = 255;
            }
            Some(pixels)
        }
    }
}

#[cfg(not(windows))]
mod capture {
    use tauri::WebviewWindow;

    pub fn exclude_from_capture(_: &WebviewWindow) -> bool {
        false
    }

    pub fn rect(_: i32, _: i32, _: u32, _: u32) -> Option<Vec<u8>> {
        None
    }
}
