/**
 * Text editor wrapper of HTML files: the browser bar at the top right (IDEA's
 * floating "open in browser" toolbar) and the built-in preview beside the
 * editor, served by the built-in server and reloaded when files are saved.
 */
import { useRef, type ReactNode } from "react";
import clsx from "clsx";
import { FloatingToolbar, IconButton } from "@/ui";
import { browserIcon, openInBrowser, openInEditorTab, useBrowsers, useWebPreview } from "./browsers";
import { PageFrame } from "./PageFrame";
import { useServedPage } from "./useServedPage";
import styles from "./Web.module.css";
import { tx } from "@/platform/i18n";

export function WebEditor({ path, children }: { path: string; tabId: string; children: ReactNode }) {
  const preview = useWebPreview((s) => !!s[path]);
  const browsers = useBrowsers((s) => s.list);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className={clsx(styles.split, preview && styles.withPreview)}>
      <div ref={ref} className={styles.editor}>
        {children}
        <FloatingToolbar targetRef={ref} className={styles.browserBar} hideOnTyping={false} retentionMs={1500}>
          <div className={styles.actions} role="toolbar" aria-label={tx("Open in browser")}>
            <IconButton
              icon="eye"
              size="small"
              iconSize={16}
              action="web.togglePreview"
              actionArg={path}
              pressed={preview}
              title="Built-in Preview"
            />
            <IconButton
              icon="web"
              size="small"
              iconSize={16}
              title="Open in Editor Tab"
              onClick={() => void openInEditorTab(path)}
            />
            <IconButton
              icon="external-link"
              size="small"
              iconSize={16}
              title="Open in System Default Browser"
              onClick={() => void openInBrowser(path)}
            />
            {browsers.map((b) => (
              <IconButton
                key={b.id}
                icon={browserIcon(b.id)}
                size="small"
                iconSize={16}
                title={b.name}
                onClick={() => void openInBrowser(path, b.id)}
              />
            ))}
          </div>
        </FloatingToolbar>
      </div>
      {preview && <WebPreview path={path} />}
    </div>
  );
}

function WebPreview({ path }: { path: string }) {
  const page = useServedPage(path);
  return <PageFrame page={page} className={styles.preview} />;
}
