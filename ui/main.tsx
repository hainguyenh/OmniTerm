import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import OverlayBar from './components/OverlayBar.tsx'
import { initTauriBridge } from './omnitermAPI'
import { silenceConsole } from './diag'
import './index.css'

// A packaged (release or portable) build reports nothing about itself. App code routes diagnostics
// through `diag` (no-ops there), but dependencies write to the console directly, so the console is
// closed outright — first statement in the entry module, ahead of the bridge and the first render, so
// nothing can slip a line out before it. No-op in development. See diag.ts.
silenceConsole()

// Initialize the Tauri ↔ omnitermAPI bridge when running under Tauri.
// This must happen before any component mounts so that window.omnitermAPI
// is available for the first render cycle.
initTauriBridge()

// The floating fullscreen restore bar is rendered into a separate transparent overlay
// window (main.ts) that loads this same bundle with the '#overlay' hash. The global
// dark background from index.css must be cleared there so the window stays see-through.
const isOverlay = window.location.hash === '#overlay'
if (isOverlay) {
  for (const el of [document.documentElement, document.body, document.getElementById('root')]) {
    if (el) (el as HTMLElement).style.background = 'transparent'
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  isOverlay ? <OverlayBar /> : <App />,
)
