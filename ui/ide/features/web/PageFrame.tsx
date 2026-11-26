/** A page of the built-in server in a frame: the built-in preview and the editor tab share it. */
import clsx from "clsx";
import type { ServedPage } from "./useServedPage";
import styles from "./Web.module.css";
import { tx } from "@/platform/i18n";

export function PageFrame({ page, className }: { page: ServedPage; className?: string }) {
  if (page.error) return <div className={clsx(className, styles.message)}>{page.error}</div>;
  if (!page.url) return <div className={className} />;
  return (
    <iframe
      key={page.seq}
      className={className}
      title={tx("HTML preview")}
      src={page.url}
      sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
    />
  );
}
