/**
 * Encode an RGB image buffer into a standard 24-bit uncompressed Windows BMP.
 * Used for NSIS installer wizard bitmaps (header and sidebar images).
 */
export function encodeBmp24({ width, height, data }) {
  if (!Number.isInteger(width) || width < 1) {
    throw new RangeError(`BMP width must be a positive integer; got ${width}`)
  }
  if (!Number.isInteger(height) || height < 1) {
    throw new RangeError(`BMP height must be a positive integer; got ${height}`)
  }
  const expectedLength = width * height * 3
  const bufData = Buffer.from(data ?? [])
  if (bufData.length !== expectedLength) {
    throw new TypeError(`BMP image data length must be width * height * 3 (${expectedLength}); got ${bufData.length}`)
  }

  const rowSize = Math.floor((24 * width + 31) / 32) * 4
  const padding = rowSize - width * 3
  const imageSize = rowSize * height
  const fileSize = 54 + imageSize
  const buf = Buffer.alloc(fileSize)

  // File Header (14 bytes)
  buf.write('BM', 0, 2, 'ascii')
  buf.writeUInt32LE(fileSize, 2)
  buf.writeUInt32LE(54, 10)

  // DIB Header (BITMAPINFOHEADER - 40 bytes)
  buf.writeUInt32LE(40, 14)
  buf.writeInt32LE(width, 18)
  buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26) // color planes
  buf.writeUInt16LE(24, 28) // bits per pixel (24 bpp RGB)
  buf.writeUInt32LE(0, 30) // BI_RGB (uncompressed)
  buf.writeUInt32LE(imageSize, 34)
  buf.writeInt32LE(2835, 38) // ~72 DPI horizontal
  buf.writeInt32LE(2835, 42) // ~72 DPI vertical

  let offset = 54
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3
      buf[offset++] = bufData[srcIdx + 2] // B
      buf[offset++] = bufData[srcIdx + 1] // G
      buf[offset++] = bufData[srcIdx] // R
    }
    for (let p = 0; p < padding; p++) {
      buf[offset++] = 0
    }
  }

  return buf
}
