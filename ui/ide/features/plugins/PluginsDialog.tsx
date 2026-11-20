/**
 * Plugins as their own window, like JetBrains: Marketplace and Installed, with the built-in and
 * the user-installed plugins of every plugin system in one list. Opened by `plugins.settings`
 * (Plugins…).
 */
import { Dialog, lazyComponent } from "@/ui";
import { closePluginsDialog, usePluginsDialog } from "./pluginsDialogStore";
import styles from "./PluginsDialog.module.css";

const PluginsPage = lazyComponent(() => import("./PluginsPage").then((m) => m.PluginsPage));

export function PluginsDialog() {
  const open = usePluginsDialog((s) => s.open);
  return (
    <Dialog
      open={open}
      title="Plugins"
      width={1000}
      minWidth={760}
      minHeight={520}
      resizable="both"
      onClose={closePluginsDialog}
      buttons={[{ label: "Close", role: "default", onClick: closePluginsDialog }]}
    >
      <div className={styles.body}>
        <div className={styles.page}>{open && <PluginsPage />}</div>
      </div>
    </Dialog>
  );
}
