//! Masthead core: finds AI coding agent sessions on this machine and turns their
//! logs into one common [`Session`] model.
//!
//! Each agent has an adapter in [`adapters`]. Adapters only read files; they never
//! write to an agent's data. Log formats are undocumented and change between agent
//! versions, so parsing is lenient: unknown lines are skipped, never fatal.

pub mod adapters;
pub mod model;
pub mod store;

pub use model::{Agent, Session, SessionState, TokenUsage};
pub use store::{Roots, SessionStore};
