/**
 * Build a Windows ICO file from PNG images without another image dependency.
 * Modern ICO readers accept PNG payloads, preserving full alpha and avoiding
 * the quality loss of legacy BMP/DIB icon entries.
 */
export function encodeIco(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new TypeError('encodeIco requires at least one PNG image')
  }
  if (images.length > 0xffff) {
    throw new RangeError('ICO supports at most 65535 images')
  }

  const headerSize = 6
  const directoryEntrySize = 16
  let dataOffset = headerSize + directoryEntrySize * images.length
  const header = Buffer.alloc(headerSize)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // image type: icon
  header.writeUInt16LE(images.length, 4)

  const entries = []
  const payloads = []
  for (const image of images) {
    const { width, height } = image
    const data = Buffer.from(image.data ?? [])
    if (!Number.isInteger(width) || width < 1 || width > 256) {
      throw new RangeError(`ICO width must be 1..256; got ${width}`)
    }
    if (!Number.isInteger(height) || height < 1 || height > 256) {
      throw new RangeError(`ICO height must be 1..256; got ${height}`)
    }
    if (data.length === 0) throw new TypeError('ICO image data cannot be empty')

    const entry = Buffer.alloc(directoryEntrySize)
    entry.writeUInt8(width === 256 ? 0 : width, 0)
    entry.writeUInt8(height === 256 ? 0 : height, 1)
    entry.writeUInt8(0, 2) // palette size: true color
    entry.writeUInt8(0, 3) // reserved
    entry.writeUInt16LE(1, 4) // color planes
    entry.writeUInt16LE(32, 6) // RGBA bits per pixel
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(dataOffset, 12)
    entries.push(entry)
    payloads.push(data)
    dataOffset += data.length
  }

  return Buffer.concat([header, ...entries, ...payloads])
}
