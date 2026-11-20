import { useEffect, useRef } from "react";
import { create } from "zustand";
import { executeAction, registerActions } from "@/platform/actions";
import { getContext, useContextKeys } from "@/platform/context";
import { call, commands, isTauri, onIdeEvent } from "@/platform/ipc";
import { languageFamiliesOf } from "@/platform/languageFamilies";
import { useProject } from "@/platform/project";
import { tx } from "@/platform/i18n";
import { notifications, registerStatusItem } from "@/workbench/contributions";
import { BarButton, Menu, type MenuItem } from "@/ui";
import { Icon } from "@/ui/icons";
import { effectivePython, type Sdk } from "./api";
import { tildify } from "./components";
import { interpreterScope } from "./projectEcosystems";

/** What the widget last resolved for a project, so the popup action can read it without a render. */
interface Status {
  root: string;
  configured: string;
  /** A Python build or environment file sits at the top of the project or of a linked project. */
  marked: boolean;
  /** `python` and `sdks` were read (only done while the widget can show). */
  loaded: boolean;
  python: string | null;
  sdks: Sdk[];
}

const usePopup = create<{ open: boolean; status: Status | null }>(() => ({ open: false, status: null }));
const close = () => usePopup.setState({ open: false });
const reset = () => usePopup.setState({ open: false, status: null });

/**
 * OmniTerm: the widget shows for a Python project, or while a Python file has the focus. A stray
 * script (a generator, a test fixture) in a TypeScript or Rust project does not make it one, and
 * neither does a globally saved interpreter.
 */
export function pythonStatusVisible(status: Pick<Status, "marked" | "loaded">, pythonEditor: boolean): boolean {
  return status.loaded && (status.marked || pythonEditor);
}

const isPythonEditor = () => getContext().editorLangId === "python";

/** Whether the widget is on screen, read straight from the stores (the action runs outside a render). */
function popupShown(): boolean {
  const project = useProject.getState();
  const root = project.project?.root;
  const configured = project.settings?.languages?.python?.interpreter ?? "";
  const status = usePopup.getState().status;
  if (!root || !status || status.root !== root || status.configured !== configured) return false;
  return pythonStatusVisible(status, isPythonEditor());
}

/** OmniTerm: whether Python tooling is switched on (Settings › Code › Languages). */
const pythonOn = () => languageFamiliesOf(useProject.getState().settings).python !== false;
const markers = [
  "pyproject.toml",
  "setup.py",
  "setup.cfg",
  "requirements.txt",
  "Pipfile",
  "pyrightconfig.json",
  "ty.toml",
  "uv.lock",
  "poetry.lock",
  "SConstruct",
  "SConscript",
  ".python-version",
];

const normalize = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();

/**
 * Whether `path` is a Python build or environment file at the top of one of `roots` (the project
 * and its linked projects). Files deeper down belong to a fixture, a dependency or a tool folder.
 */
export function isPythonProjectMarker(path: string, roots: readonly string[]): boolean {
  const normalized = path.replaceAll("\\", "/");
  const slash = normalized.lastIndexOf("/");
  const name = normalized.slice(slash + 1);
  if (!markers.includes(name) && !/^requirements[\w.-]*\.txt$/.test(name)) return false;
  const dir = normalize(normalized.slice(0, Math.max(slash, 0)));
  return roots.some((root) => !!root && normalize(root) === dir);
}

export function interpreterChoices(sdks: Sdk[], current: string | null): { path: string; name: string }[] {
  const choices = [...new Map(sdks.map((sdk) => [sdk.path, sdk])).values()];
  if (!current || choices.some((sdk) => sdk.path === current)) return choices;
  return [...choices, { path: current, name: current }];
}

async function hasPythonMarkers(roots: readonly string[]): Promise<boolean> {
  const matches = await Promise.all(
    ["requirements", ...markers].map((query) => call(commands.findFiles(query, 10000))),
  );
  return matches.some((files) => files.some((file) => isPythonProjectMarker(file.path, roots)));
}

function PythonStatus() {
  const root = useProject((s) => s.project?.root);
  const linked = useProject((s) => s.project?.workspace?.projects);
  const trusted = useProject((s) => s.project?.trusted !== false);
  const configured = useProject((s) => s.settings?.languages?.python?.interpreter ?? "");
  const pythonEditor = useContextKeys((s) => s.editorLangId === "python");
  const status = usePopup((s) => s.status);
  const open = usePopup((s) => s.open);
  const anchor = useRef<HTMLButtonElement>(null);
  useEffect(() => reset, [root, configured, trusted]);
  useEffect(() => {
    if (!root || !trusted || !isTauri()) return;
    let live = true;
    let sequence = 0;
    let detected: Promise<Sdk[]> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const roots = [root, ...(linked ?? [])];
    const refresh = async () => {
      const request = ++sequence;
      try {
        const marked = pythonOn() && (await hasPythonMarkers(roots));
        if (!live || sequence !== request) return;
        const loaded = pythonOn() && (marked || pythonEditor);
        const [python, sdks] = loaded
          ? await Promise.all([effectivePython(), (detected ??= call(commands.sdkDetect("python")))])
          : [null, [] as Sdk[]];
        if (live && sequence === request)
          usePopup.setState({ status: { root, configured, marked, loaded, python, sdks } });
      } catch (e) {
        console.warn("Cannot refresh Python interpreter status", e);
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 300);
    };
    void refresh();
    const off = [
      onIdeEvent("indexState", (e) => {
        if (!e.indexing) schedule();
      }),
      onIdeEvent("fsChanged", (e) => {
        if (e.created.length || e.removed.length) detected = undefined;
        if (
          e.created.length ||
          e.removed.length ||
          e.modified.some((path) => markers.includes(path.replaceAll("\\", "/").split("/").at(-1)!))
        )
          schedule();
      }),
      onIdeEvent("settingsChanged", () => {
        detected = undefined;
        schedule();
      }),
    ];
    // The last status stays while a refresh runs: focusing another file does not blink the widget.
    return () => {
      live = false;
      clearTimeout(timer);
      off.forEach((dispose) => dispose());
    };
  }, [root, linked, configured, trusted, pythonEditor]);
  // The widget only renders once its project's status is in the store, so the popup action
  // sees the same state as the button without waiting for an effect to publish a flag.
  if (!popupShown() || !status) return null;
  const current = status;
  const choices = interpreterChoices(current.sdks, current.python);
  const label = choices.find((sdk) => sdk.path === current.python)?.name ?? tx("No interpreter");
  const names = new Map<string, number>();
  for (const sdk of choices) names.set(sdk.name, (names.get(sdk.name) ?? 0) + 1);
  const items: MenuItem[] = [
    { kind: "header", label: "Python Interpreter" },
    ...choices.map((sdk): MenuItem => ({
      label: sdk.name,
      verbatim: true,
      // Several system interpreters share a name ("Python 3.11"); their paths tell them apart.
      shortcut: (names.get(sdk.name) ?? 0) > 1 ? tildify(sdk.path) : undefined,
      checked: sdk.path === current.python,
      run: () => void executeAction("python.selectInterpreter", sdk.path),
    })),
    { kind: "separator" },
    { kind: "action", action: "python.addInterpreter" },
    { kind: "action", action: "python.interpreterSettings" },
  ];
  return (
    <>
      <BarButton
        ref={anchor}
        tooltip={current.python ?? tx("No interpreter")}
        aria-label={tx`Python Interpreter: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => void executeAction("python.interpreterPopup")}
      >
        {!current.python && <Icon name="warning" size={14} />}
        {label}
      </BarButton>
      <Menu
        open={open}
        onClose={close}
        anchor={anchor}
        placement="top-end"
        items={items}
        aria-label="Python Interpreter"
      />
    </>
  );
}

export function activatePythonStatus(): () => void {
  const dispose = [
    registerStatusItem({
      id: "python.interpreter",
      title: "Python Interpreter",
      align: "right",
      priority: 90,
      component: PythonStatus,
    }),
    registerActions([
      {
        id: "python.interpreterPopup",
        title: "Python Interpreter",
        category: "Settings",
        when: "projectOpen",
        run: () =>
          popupShown()
            ? usePopup.setState((s) => ({ open: !s.open }))
            : void executeAction("file.settings", "python.interpreter"),
      },
      {
        id: "python.selectInterpreter",
        title: "Select Python Interpreter",
        category: "Settings",
        hidden: true,
        run: async ({ arg }) => {
          const project = useProject.getState().project;
          if (!project || typeof arg !== "string" || !arg) return;
          const key = "languages.python.interpreter";
          // OmniTerm: a virtualenv inside the project is the project's; any other interpreter
          // becomes the default of every project instead of pinning this one to it.
          const scope = interpreterScope(arg, [project.root, ...(project.workspace?.projects ?? [])]);
          try {
            let settings = await call(commands.settingsSet(scope, key, JSON.stringify(arg)));
            // An older project override would keep winning over the new default.
            if (scope === "global" && settings.languages?.python?.interpreter !== arg)
              settings = await call(commands.settingsSet("project", key, "null"));
            if (useProject.getState().project === project) useProject.setState({ settings });
          } catch (e) {
            notifications().notify({ level: "error", title: "Cannot select Python interpreter", body: String(e) });
          }
        },
      },
      {
        id: "python.addInterpreter",
        title: "Add New Interpreter…",
        category: "Settings",
        when: "projectOpen",
        run: () => void executeAction("file.settings", "python.interpreter"),
      },
      {
        id: "python.interpreterSettings",
        title: "Interpreter Settings…",
        category: "Settings",
        when: "projectOpen",
        run: () => void executeAction("file.settings", "python.interpreter"),
      },
    ]),
  ];
  return () => {
    reset();
    dispose.reverse().forEach((d) => d());
  };
}
