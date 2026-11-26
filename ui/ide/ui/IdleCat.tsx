/**
 * The lazy cat that idles on empty and waiting screens. Both colour variants are rendered and CSS
 * shows the one matching `data-theme` (`light` → the dark-ink cat, anything else → the white cat),
 * the same rule the coloured icons follow, so a theme switch needs no re-render.
 */
import clsx from "clsx";
import idleCatDarkUrl from "../../../assets/loading/converted/idle-cat-dark.gif";
import idleCatLightUrl from "../../../assets/loading/converted/idle-cat-light.gif";
import styles from "./IdleCat.module.css";

/**
 * `perched`: the cat lies on the top border of the box it is placed in (the host must be
 * `position: relative`): its shelf is moved onto that border and its tail hangs over the box.
 */
export function IdleCat({ className, perched = false }: { className?: string; perched?: boolean }) {
  return (
    <div className={clsx(styles.cat, perched && styles.perched, className)} aria-hidden="true" data-idle-cat={perched ? "perched" : ""}>
      <img className={styles.light} src={idleCatLightUrl} alt="" draggable={false} />
      <img className={styles.dark} src={idleCatDarkUrl} alt="" draggable={false} />
    </div>
  );
}
