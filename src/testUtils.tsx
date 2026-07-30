import { TOKYO_NIGHT } from "./themes";
import { staticShellOptions } from "./shellOptions";

type Api = Window["omnitermAPI"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(patch)) {
    const val = patch[key];
    if (isObject(val) && isObject(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, val as Record<string, unknown>);
    } else if (val !== undefined) {
      out[key] = val;
    }
  }
  return out as T;
}

const defaultSettings: AppSettings = {
  themeId: TOKYO_NIGHT.id,
  fontSize: 14,
  smartColors: true,
  checkUpdatesOnStartup: true,
  darkMode: true,
  shortcuts: {
    zoomIn: "Ctrl+=",
    zoomOut: "Ctrl+-",
    newSession: "Ctrl+N",
    newFolder: "Ctrl+Shift+N",
    openSettings: "Ctrl+,",
    toggleThemeMode: "Ctrl+/",
    layout1: "Ctrl+1",
    layout2: "Ctrl+2",
    layout4: "Ctrl+4",
    layout6: "Ctrl+6",
    layout8: "Ctrl+8",
    toggleSidebar: "Ctrl+B",
    commandPalette: "CommandOrControl+P",
    closeTab: "Ctrl+W"
  },
};

const defaultUpdateState: UpdateState = {
  current: "0.0.0",
  latest: null,
  latestTag: null,
  latestName: "",
  notes: "",
  htmlUrl: "",
  publishedAt: null,
  updateAvailable: false,
  skippedVersion: null,
  lastCheckAt: null,
  error: null,
  checking: false,
  isPortable: false,
  portableAssetUrl: null,
  installerAssetUrl: null,
  downloadProgress: null,
  downloadStatus: null,
  hasNewerVersion: false,
};

const noopSub = () => () => {};

const defaults: Api = {
  connections: {
    load: async () => ({ folders: [], connections: [] }),
    save: async () => {},
  },
  plugin: {
    available: async () => false,
    list: async () => [],
    setEnabled: async () => {
      throw new Error('Unknown plugin')
    },
    selectConnectionProvider: async () => [],
    connectionCapabilities: async () => null,
    invoke: async () => undefined,
    authGate: async () => true,
    installPackage: async () => null,
    remove: async () => true,
    restartApp: async () => {},
  },
  workspace: {
    list: async () => [],
    add: async () => null,
    remove: async () => {},
    scanScripts: async () => [],
    scanEntries: async () => [],
    run: async () => true,
    readScript: async () => '',
    writeScript: async () => {},
    loadConnections: async () => [],
    saveConnections: async () => {},
    deleteConnection: async () => {},
  },
  connect: {
    saveCredential: async () => false,
    rdp: async () => ({ ok: true }),
    rdpDisconnect: () => {},
    rdpSetBounds: () => {},
    rdpSetVisible: () => {},
    rdpSetOverlay: () => {},
    rdpSetDetached: () => {},
    rdpResetTrust: async () => {},
    onRDPDetachState: noopSub,
    overlayInit: async () => null,
    onRDPLatency: noopSub,
    onRDPReady: noopSub,
    onRDPError: noopSub,
    onRDPClosed: noopSub,
    ssh: () => {},
    sshDisconnect: () => {},
    sshInput: () => {},
    sshResize: () => {},
    onSSHReady: noopSub,
    onSSHData: noopSub,
    onSSHError: noopSub,
    onSSHClosed: noopSub,
    onSessionMetrics: noopSub,
    local: () => {},
    localDisconnect: () => {},
    localInput: () => {},
    localResize: () => {},
    onLocalReady: noopSub,
    onLocalData: noopSub,
    onLocalError: noopSub,
    onLocalClosed: noopSub,
    onLocalActivity: noopSub,
  },
  terminalWindow: {
    detachedSessionId: null,
    detach: async () => false,
    bootstrap: async () => null,
    resume: async () => null,
    reattach: async () => false,
    focus: () => {},
    release: () => {},
    onReattached: noopSub,
  },
  clipboard: {
    writeText: async () => {},
    readText: async () => "",
  },
  sftp: {
    home: async () => "/home",
    list: async () => [],
    realpath: async () => "/",
    mkdir: async () => {},
    rename: async () => {},
    delete: async () => {},
    rmdirRecursive: async () => {},
    download: async () => false,
    upload: async () => 0,
    onProgress: noopSub,
  },
  app: {
    platform: "win32",
    revealLog: async () => "",
    clearLog: async () => false,
    cleanupRdpCert: async () => false,
    openExternal: async () => false,
    setZoomFactor: () => {},
    getZoomFactor: () => 1,
  },
  files: {
    exportJson: async () => false,
    importJson: async () => null,
    importFile: async () => null,
    getHomeDir: async () => "",
    pickDirectory: async () => null,
  },
  settings: {
    get: async () => defaultSettings,
    save: async () => {},
    systemExcludedViewExts: async () => [],
  },
  updates: {
    check: async () => defaultUpdateState,
    state: async () => defaultUpdateState,
    skip: async () => defaultUpdateState,
    getVersion: async () => "0.0.0",
    showSaveDialog: async () => null,
    downloadPortable: async () => {},
    downloadInstaller: async () => {},
    onState: noopSub,
  },
  themes: {
    list: async () => [TOKYO_NIGHT],
    openFolder: async () => "",
    save: async () => {},
    delete: async () => {},
  },
  windowControl: {
    minimize: async () => {},
    toggleMaximize: async () => {},
    close: async () => {},
    isMaximized: async () => false,
    onMaximizedState: noopSub,
  },
  shells: {
    ready: () => {},
    release: () => {},
    // Tauri-only: registers an unsaved shell and returns the record to open a pane with.
    open: (shell?: string) =>
      Promise.resolve({ id: 'adhoc-test', name: 'PowerShell', type: 'LOCAL', shell: shell ?? 'default' }),
    // Tauri-only probe of the shells this machine can start. Read at call time so a test that
    // overrides `app.platform` gets that platform's shells, as the real backend would.
    list: async () => staticShellOptions(window.omnitermAPI?.app?.platform ?? 'win32'),
    onOpen: noopSub,
  },
};

export function mockOmnitermAPI(overrides: Record<string, unknown> = {}) {
  const api = deepMerge(defaults, overrides as Record<string, unknown>);
  Object.defineProperty(window, "omnitermAPI", {
    value: api,
    configurable: true,
    writable: true,
  });
}
