import { useRootChecked } from "./rootToggle";

/**
 * A checkbox drawn as a radio button: a ring, filled with a dot while checked. Each project still
 * toggles on its own (it stays `type="checkbox"` for behaviour and screen readers); only the look
 * is a radio's.
 */
export const RADIO_LOOK =
  "size-3 flex-none cursor-pointer appearance-none rounded-full border border-[var(--fg-muted)] bg-transparent " +
  "checked:border-[3.5px] checked:border-[var(--accent)] focus-visible:outline focus-visible:outline-1 " +
  "focus-visible:outline-[var(--focus-ring,var(--accent))]";

/** The active checkbox at the start of a project root's row; nothing for a root the shell does not manage. */
export function RootCheckbox({ path, name }: { path: string; name: string }) {
  const state = useRootChecked(path);
  if (!state) return null;
  return (
    <input
      type="checkbox"
      className={`mx-1 ${RADIO_LOOK}`}
      checked={state.checked}
      aria-label={`${name} is active`}
      title={state.checked ? "Active project: click to switch it off" : "Switched off: click to activate"}
      data-testid="project-root-checkbox"
      data-look="radio"
      onChange={state.toggle}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
