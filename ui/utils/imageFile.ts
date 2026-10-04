/**
 * Raster formats the editor shows in its image viewer — the renderer half of `IMAGE_EXTS` in
 * `crates/app-core/src/image_file.rs`, which re-checks every read. `.svg` is text and previews from
 * its source instead; `.tif`/`.tiff` are absent because the webview cannot decode them.
 */
const IMAGE_MIME_BY_EXT: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
}

/** MIME type of a file the image viewer opens, or null for anything else. */
export function rasterImageMime(fileName: string): string | null {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return null
  return IMAGE_MIME_BY_EXT[fileName.slice(dot + 1).toLowerCase()] ?? null
}
