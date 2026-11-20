//! OmniTerm's side of the embedded IDE backend (`ide_app`, see `idea_host.rs`).
//!
//! Every workbench command is answered by the embedded IDE backend. This module keeps only
//! what OmniTerm adds around it: opening the active workspace as the window's project, and the event
//! sink and request registry the updater shares with the workbench.

pub mod events;
pub(crate) mod project_bridge;
pub mod requests;
