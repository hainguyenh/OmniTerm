/**
 * The content policy injected into every HTML preview: inline styles and `data:` images/fonts render,
 * nothing is fetched from the network and no script runs (the iframe sandbox already forbids scripts;
 * this also stops remote stylesheets, images and fonts from beaconing out).
 */
export const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`

/** Insert the CSP right after `<head>` when there is one (a meta tag before the doctype would push
 *  the page into quirks mode), else in front of everything. */
export function withPreviewCsp(html: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (!head) return CSP_META + html
  const at = head.index + head[0].length
  return html.slice(0, at) + CSP_META + html.slice(at)
}
