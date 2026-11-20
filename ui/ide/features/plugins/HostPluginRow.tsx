/**
 * A row of the Installed list for a plugin of the host's own plugin system (OmniTerm's Node
 * plugins), drawn like the IDE plugin rows so both systems read as one list.
 */
import { useState } from "react";
import clsx from "clsx";
import { Badge, Checkbox, Icon, T } from "@/ui";
import { tx } from "@/platform/i18n";
import { logError } from "@/platform/errorLog";
import type { HostPlugin, HostPluginSource } from "./pluginsDialogStore";
import styles from "./PluginsPage.module.css";

export function HostPluginRow({
  plugin,
  source,
  selected,
  onSelect,
}: {
  plugin: HostPlugin;
  source: HostPluginSource;
  selected: boolean;
  onSelect: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const toggle = (on: boolean) => {
    setBusy(true);
    source
      .setEnabled(plugin.id, on)
      .catch((error: unknown) => logError(`Changing plugin ${plugin.id}`, error))
      .finally(() => setBusy(false));
  };
  return (
    <li className={clsx(styles.row, selected && styles.rowSelected, !plugin.enabled && styles.rowDisabled)}>
      <button
        type="button"
        className={styles.rowMain}
        aria-current={selected || undefined}
        onClick={onSelect}
        title={plugin.description || plugin.name}
      >
        <span className={styles.icon} aria-hidden>
          <Icon name="plugin" size={20} />
        </span>
        <span className={styles.rowText}>
          <span className={styles.rowName}>{plugin.name}</span>
          <span className={styles.rowMeta}>
            <span className={styles.rowVendor}>OmniTerm</span>
            <span>{plugin.version}</span>
            {plugin.error && (
              <Badge dot tone="danger">
                <T>Failed</T>
              </Badge>
            )}
          </span>
        </span>
      </button>
      <Checkbox
        className={styles.rowCheck}
        checked={plugin.enabled}
        disabled={busy}
        onChange={toggle}
        aria-label={plugin.enabled ? tx`Disable ${plugin.name}` : tx`Enable ${plugin.name}`}
      />
    </li>
  );
}
