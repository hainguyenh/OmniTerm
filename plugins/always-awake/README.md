# Always Awake

Keeps the Windows host awake during selected schedules, either continuously or while OmniTerm
terminal work is active.

The plugin UI and native implementation live in this directory:

- `app/` contains the Activity Bar modal and renderer bridge.
- `native/` contains persisted scheduling, terminal activity detection, Windows sleep prevention,
  and mouse-jiggle behavior.

OmniTerm only provides generic plugin-host wiring and compiles this plugin's native module into the
Tauri host. Sleep prevention uses Windows `SetThreadExecutionState`; mouse movement is a fallback
after half the configured Windows sleep timeout, and always restores the original cursor position.
