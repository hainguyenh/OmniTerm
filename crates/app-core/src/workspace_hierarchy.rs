//! Workspace parent/child ordering helpers, split out of workspace_model.rs.

use app_protocol::workspace::Workspace;
use std::collections::HashSet;

pub(crate) fn ensure_no_cycle(
    workspaces: &[Workspace],
    workspace_id: &str,
    parent_id: Option<&str>,
) -> Result<(), String> {
    let mut cursor = parent_id;
    let mut visited = HashSet::new();
    while let Some(parent) = cursor {
        if parent == workspace_id {
            return Err("A workspace cannot be moved into one of its descendants.".to_string());
        }
        if !visited.insert(parent) {
            return Err("Workspace hierarchy contains a cycle.".to_string());
        }
        cursor = workspaces
            .iter()
            .find(|item| item.id == parent)
            .and_then(|item| item.parent_id.as_deref());
    }
    Ok(())
}

pub(crate) fn normalize_siblings(
    workspaces: &mut [Workspace],
    parent_id: Option<&str>,
    insertion: Option<(&str, usize)>,
) {
    let moving = insertion.map(|(id, _)| id);
    let mut indices = workspaces
        .iter()
        .enumerate()
        .filter(|(_, item)| {
            item.parent_id.as_deref() == parent_id && Some(item.id.as_str()) != moving
        })
        .map(|(idx, _)| idx)
        .collect::<Vec<_>>();
    indices.sort_by_key(|idx| workspaces[*idx].order);
    if let Some((id, target)) = insertion {
        if let Some(moving_idx) = workspaces.iter().position(|item| item.id == id) {
            indices.insert(target.min(indices.len()), moving_idx);
        }
    }
    for (order, idx) in indices.into_iter().enumerate() {
        workspaces[idx].order = order;
    }
}
