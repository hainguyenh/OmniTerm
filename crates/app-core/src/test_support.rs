use std::sync::Mutex;
static GLOBAL: Mutex<()> = Mutex::new(());

pub(crate) fn lock() -> std::sync::MutexGuard<'static, ()> {
    GLOBAL.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}