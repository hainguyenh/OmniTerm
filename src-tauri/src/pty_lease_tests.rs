use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

#[test]
fn ensure_aborts_immediately_when_shutdown_requested() {
    let client_slot = OnceLock::new();
    let lease_started = AtomicBool::new(false);
    let shutdown_requested = Arc::new(AtomicBool::new(true));

    ensure(&client_slot, &lease_started, &shutdown_requested);
    assert!(!lease_started.load(Ordering::Acquire));
}

#[test]
fn ensure_returns_early_when_lease_already_started() {
    let client_slot = OnceLock::new();
    let lease_started = AtomicBool::new(true);
    let shutdown_requested = Arc::new(AtomicBool::new(false));

    ensure(&client_slot, &lease_started, &shutdown_requested);
    assert!(lease_started.load(Ordering::Acquire));
}

#[test]
fn ensure_resets_lease_started_when_client_slot_is_empty() {
    let client_slot = OnceLock::new();
    let lease_started = AtomicBool::new(false);
    let shutdown_requested = Arc::new(AtomicBool::new(false));

    ensure(&client_slot, &lease_started, &shutdown_requested);
    assert!(!lease_started.load(Ordering::Acquire));
}
