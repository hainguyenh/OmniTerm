import clsx from "clsx";

import checkbox from "@/ui/Checkbox.module.css";
import styles from "./ProjectView.module.css";
import { useRootChecked } from "./rootToggle";

/**
 * The active toggle at the start of a project root's row: a rounded box with an accent dot while
 * the project is on, an empty box while it is switched off. Nothing for a root the shell does not
 * manage.
 */
export function RootCheckbox({ path, name }: { path: string; name: string }) {
  const state = useRootChecked(path);
  if (!state) return null;
  return (
    <span className={clsx(checkbox.boxWrap, "mx-1")} style={{ width: 14, height: 14 }}>
      <input
        type="checkbox"
        className={checkbox.native}
        style={{ cursor: "pointer" }}
        checked={state.checked}
        aria-label={`${name} is active`}
        title={state.checked ? "Active project: click to switch it off" : "Switched off: click to activate"}
        data-testid="project-root-checkbox"
        data-look="dot"
        onChange={state.toggle}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      <span className={clsx(styles.rootToggle, state.checked && styles.rootToggleOn)} aria-hidden>
        {state.checked && <span className={styles.rootToggleDot} />}
      </span>
    </span>
  );
}
