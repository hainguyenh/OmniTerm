#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { encodeBmp24 } from './image/bmp.mjs'
import { encodeIco } from './image/ico.mjs'
import { isMain } from './is-main.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'assets/OmniTerm-Logo-Original.png')
const rendererLogo = resolve(root, 'ui/generated/OmniTerm-Logo.webp')
const windowsIcon = resolve(root, 'src-tauri/icons/icon.ico')
const nsisHeader = resolve(root, 'src-tauri/icons/nsis-header.bmp')
const nsisSidebar = resolve(root, 'src-tauri/icons/nsis-sidebar.bmp')
const ICO_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256])

async function writeIfChanged(path, content) {
  let current
  try {
    current = await readFile(path)
  } catch {
    current = null
  }
  if (current?.equals(content)) return false
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
  return true
}

async function resizedPng(sourceBuffer, size) {
  return sharp(sourceBuffer)
    .resize(size, size, {
      fit: 'contain',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
}

const PNG_ICONS = Object.freeze([
  { path: resolve(root, 'src-tauri/icons/32x32.png'), size: 32 },
  { path: resolve(root, 'src-tauri/icons/128x128.png'), size: 128 },
  { path: resolve(root, 'src-tauri/icons/128x128@2x.png'), size: 256 },
  { path: resolve(root, 'src-tauri/icons/icon.png'), size: 512 },
])

export async function generateAppAssets() {
  const sourceBuffer = await readFile(source)
  const metadata = await sharp(sourceBuffer).metadata()
  if (metadata.format !== 'png' || metadata.width !== metadata.height || !metadata.hasAlpha) {
    throw new Error('OmniTerm-Logo-Original.png must be a square PNG with an alpha channel')
  }
  if ((metadata.width ?? 0) < 512) {
    throw new Error('OmniTerm-Logo-Original.png must be at least 512×512')
  }

  const webp = await sharp(sourceBuffer)
    .resize(256, 256, {
      fit: 'contain',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      withoutEnlargement: true,
    })
    .webp({ lossless: true, effort: 6 })
    .toBuffer()

  const icoImages = await Promise.all(ICO_SIZES.map(async (size) => ({
    width: size,
    height: size,
    data: await resizedPng(sourceBuffer, size),
  })))
  const ico = encodeIco(icoImages)

  const headerLogo = await sharp(sourceBuffer)
    .resize(48, 48, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer()

  const headerRaw = await sharp({
    create: { width: 150, height: 57, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: headerLogo, gravity: 'center' }])
    .removeAlpha()
    .raw()
    .toBuffer()

  const headerBmp = encodeBmp24({ width: 150, height: 57, data: headerRaw })

  const sidebarLogo = await sharp(sourceBuffer)
    .resize(112, 112, { fit: 'contain', background: { r: 26, g: 27, b: 38, alpha: 0 } })
    .png()
    .toBuffer()

  const sidebarRaw = await sharp({
    create: { width: 164, height: 314, channels: 3, background: { r: 26, g: 27, b: 38 } },
  })
    .composite([{ input: sidebarLogo, gravity: 'center' }])
    .removeAlpha()
    .raw()
    .toBuffer()

  const sidebarBmp = encodeBmp24({ width: 164, height: 314, data: sidebarRaw })

  const rendererChanged = await writeIfChanged(rendererLogo, webp)
  const iconChanged = await writeIfChanged(windowsIcon, ico)
  const headerChanged = await writeIfChanged(nsisHeader, headerBmp)
  const sidebarChanged = await writeIfChanged(nsisSidebar, sidebarBmp)

  for (const { path: pngPath, size } of PNG_ICONS) {
    const pngBuf = await resizedPng(sourceBuffer, size)
    await writeIfChanged(pngPath, pngBuf)
  }

  console.log(
    `[app-assets] renderer=${webp.length}B${rendererChanged ? ' updated' : ''}; `
      + `windows-icon=${ico.length}B${iconChanged ? ' updated' : ''}; `
      + `nsis-header=${headerBmp.length}B${headerChanged ? ' updated' : ''}; `
      + `nsis-sidebar=${sidebarBmp.length}B${sidebarChanged ? ' updated' : ''}`,
  )
}

if (isMain(import.meta.url)) {
  generateAppAssets().catch((error) => {
    console.error(`[app-assets] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
