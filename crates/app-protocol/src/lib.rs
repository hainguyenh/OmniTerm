//! Shared DTO type crate for OmniTerm.
//!
//! Pure Ser/De structs and enums shared across the desktop adapter, the
//! (future) CLI, and the sidecar. No Tauri dependency, no IO.

pub mod git;
pub mod openshell;
pub mod session_status;
pub mod shell_spec;
pub mod text_file;
pub mod workspace;

#[cfg(test)]
mod test_support;
