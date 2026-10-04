import { withPreviewCsp } from './htmlPreviewCsp'

/**
 * Static rendering of an HTML file.
 *
 * Workspace HTML is untrusted, so it is shown in an `<iframe sandbox="">` — no scripts, an opaque
 * origin (no access to the app, its storage or Tauri IPC), no popups, forms or top navigation — with
 * a CSP that keeps it off the network. Markup and inline CSS render; external resources do not load.
 */
export function HtmlPreview({ html }: { html: string }) {
  return (
    <iframe
      title="HTML preview"
      className="file-editor-html-frame"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={withPreviewCsp(html)}
    />
  )
}
