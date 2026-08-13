//! Shared DTO type crate for OmniTerm.
//!
//! Pure Ser/De structs and enums shared across the desktop adapter, the
//! (future) CLI, and the sidecar. No Tauri dependency, no IO.

pub mod openshell;
pub mod shell_spec;
pub mod session_status;
pub mod workspace;

#[cfg(test)]
mod test_support;