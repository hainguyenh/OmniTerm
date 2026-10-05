//! OmniTerm core: domain logic + IO services.
//!
//! No Tauri dependency lives here. The desktop adapter (`src-tauri/`) links
//! this crate directly and supplies Tauri-bound wrappers around any
//! behavior that needs the host runtime.

pub mod agent_model;
pub mod agent_sessions;
pub mod attachments;
pub mod claude_transcript;
pub mod git;
pub mod git_branch;
pub mod git_branch_compare;
pub mod git_branch_delete;
pub mod git_branch_tools;
pub mod git_diff;
pub mod git_history;
pub mod git_stash;
pub mod git_status;
pub mod git_worktree;
pub mod image_file;
pub mod launch;
pub mod proc_activity;
pub mod rdp_launch;
pub mod safepath;
pub mod temp_notes;
pub mod text_file;
pub mod tree_validate;
#[cfg(windows)]
pub mod win_job;
pub mod workspace_fs;
pub mod workspace_launch;
pub mod workspace_model;
pub mod workspace_scan;

#[cfg(test)]
mod git_branch_flow_tests;
#[cfg(test)]
mod git_diff_flow_tests;
#[cfg(test)]
mod git_flow_tests;
#[cfg(test)]
mod git_regression_tests;
#[cfg(test)]
mod git_stash_flow_tests;
#[cfg(test)]
mod git_test_repo;
#[cfg(test)]
mod git_tests;
#[cfg(test)]
mod test_support;
