# Always Awake

Keeps the Windows host awake during selected schedules, either continuously or while OmniTerm
terminal work is active.

Always Awake is built into OmniTerm (no Node sidecar). It is listed as the built-in plugin
`omniterm.always-awake` in the Plugins dialog, on by default; the state is kept in the app settings
under `disabledBuiltinFeatures`. Switching it off releases any sleep request at once and hides its
UI, while the saved schedule is kept for when it is switched back on.

The UI lives in this directory and the native implementation in `src-tauri/src/always_awake/`:

- `ui/features/always-awake/` contains the Activity Bar modal, the schedule rules, and the renderer bridge.
- `src-tauri/src/always_awake/` contains persisted scheduling (`always_awake.rs`), the rules it applies
  (`awake_schedule.rs`), and the Win32 shims for sleep prevention and mouse jiggle (`native.rs`).

OmniTerm compiles this native module into the Tauri host. Sleep prevention uses Windows `SetThreadExecutionState`; mouse movement is a fallback
after half the configured Windows sleep timeout, and always restores the original cursor position.

The poller runs on a dedicated OS thread named `always-awake`, and that is a correctness requirement
rather than a tuning choice: `SetThreadExecutionState` binds the sleep request to the calling thread,
and only a call on that same thread releases it. Anything that can migrate between threads — a tokio
task, a thread pool — will take the request out on one thread and try to hand it back on another,
which succeeds, releases nothing, and leaves the machine awake with the UI reporting OFF. The thread
also hands the request back before it exits.

The sleep request cannot outlive the app. It is scoped to the OmniTerm process three ways: the host's
`RunEvent::ExitRequested`/`Exit` calls `AlwaysAwakeState::begin_shutdown`, which the poller notices
within ~50 ms and releases on; the loop also stops if the app's managed state disappears; and Windows
drops a dead process's execution state regardless. A saved schedule *is* restored on the next launch —
that is deliberate, so a custom deadline (08:00 tomorrow by default) survives a restart — and the panel
shows ON when it is.

Nothing here runs while the feature is off. The Activity Bar icon appears only once
`always_awake_info` says it is on, and the native poller is spawned by the first `get_state` call
rather than from the host's `setup` — so while it is off the app never polls, never reads the power
configuration and never asserts anything. The poller then emits `always-awake:state` only when the
status actually changes, not on every 500 ms tick.
