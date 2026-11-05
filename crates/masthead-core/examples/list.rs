//! Prints the sessions Masthead finds on this machine.
//! Run with: cargo run -p masthead-core --example list

use masthead_core::{Roots, SessionStore};

fn main() {
    let started = std::time::Instant::now();
    let mut store = SessionStore::new(Roots::detect());
    let sessions = store.refresh();
    let first = started.elapsed();
    let again = std::time::Instant::now();
    store.refresh();

    for s in sessions.iter().filter(|s| !s.is_subagent).take(15) {
        println!(
            "{:<11} {:<7} {:<18} {:>9} tok  {}",
            format!("{:?}", s.agent),
            format!("{:?}", s.state),
            s.project_name.as_deref().unwrap_or("-"),
            s.tokens.total(),
            s.title
        );
    }
    println!(
        "\n{} sessions ({} subagent). First scan {:?}, cached rescan {:?}.",
        sessions.len(),
        sessions.iter().filter(|s| s.is_subagent).count(),
        first,
        again.elapsed()
    );
}
