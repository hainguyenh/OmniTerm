# Always Awake

Keeps the Windows host awake during selected schedules, either continuously or while OmniTerm
terminal work is active.

The plugin UI and native implementation live in this directory:

- `app/` contains the Activity Bar modal, the schedule rules, and the renderer bridge.
- `native/` contains persisted scheduling (`always_awake.rs`), the rules it applies
  (`awake_schedule.rs`), and the Win32 shims for sleep prevention and mouse jiggle (`native.rs`).

OmniTerm only provides generic plugin-host wiring and compiles this plugin's native module into the
Tauri host. Sleep prevention uses Windows `SetThreadExecutionState`; mouse movement is a fallback
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
that is deliberate, so a 24-hour schedule survives a restart — and the panel shows ON when it is.

Nothing here runs until the plugin activates. The Activity Bar icon appears only once the plugin has
answered `alwaysAwake.info`, and the native poller is spawned by the first `get_state` call rather
than from the host's `setup` — so a build without this plugin never polls, never reads the power
configuration and never asserts anything. The poller then emits `always-awake:state` only when the
status actually changes, not on every 500 ms tick.
