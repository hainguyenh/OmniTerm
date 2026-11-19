/**
 * OmniTerm: an HTML file served by the built-in server in its own editor tab, with an address
 * bar, Reload and Open in System Default Browser. The page reloads when files are saved.
 */
import type { EditorInput } from "@/workbench/contributions";
import { IconButton } from "@/ui";
import { openInBrowser, webTabPath } from "./browsers";
import { PageFrame } from "./PageFrame";
import { useServedPage } from "./useServedPage";
import styles from "./Web.module.css";
import { tx } from "@/platform/i18n";

export function WebPageEditor({ input }: { input: EditorInput }) {
  const path = webTabPath(input) ?? "";
  const page = useServedPage(path);
  return (
    <div className={styles.page}>
      <div className={styles.pageBar} role="toolbar" aria-label={tx("Page")}>
        <IconButton icon="refresh" size="small" iconSize={16} title="Reload" onClick={page.reload} />
        <span className={styles.address} title={page.url ?? path}>
          {page.url ?? path}
        </span>
        <IconButton
          icon="external-link"
          size="small"
          iconSize={16}
          title="Open in System Default Browser"
          onClick={() => void openInBrowser(path)}
        />
      </div>
      <PageFrame page={page} className={styles.pageFrame} />
    </div>
  );
}
