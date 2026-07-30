/**
 * Convert OmniTerm's built-in TypeScript themes to JSON files for the Tauri backend.
 * Run with: node scripts/convert-themes-to-json.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const themeDataDir = path.join(root, 'electron', 'core', 'builtinThemes', 'data')
const outDir = path.join(root, 'src-tauri', 'builtinThemes')

fs.mkdirSync(outDir, { recursive: true })

// Read each .ts file and extract the theme object via regex + eval
for (const file of fs.readdirSync(themeDataDir)) {
  if (!file.endsWith('.ts')) continue
  
  let content = fs.readFileSync(path.join(themeDataDir, file), 'utf-8')
  
  // Strip TypeScript imports and type annotations
  content = content.replace(/import\s+\{[^}]*\}\s+from\s+['"][^'"]*['"];?\s*/g, '')
  content = content.replace(/:\s*AppTheme\s*/g, '')
  content = content.replace(/export\s+const\s+\w+\s*=\s*/, '')
  content = content.replace(/;\s*$/, '')
  
  // Replace single-quoted strings with double-quoted for JSON compat
  // Use Function constructor to eval the JS object literal
  let theme
  try {
    theme = new Function(`return (${content})`)()
  } catch (e) {
    console.error(`Failed to parse ${file}:`, e.message)
    continue
  }
  
  const outFile = path.join(outDir, file.replace('.ts', '.json'))
  fs.writeFileSync(outFile, JSON.stringify(theme, null, 2))
  console.log(`✓ ${file} → ${path.basename(outFile)}`)
}

console.log(`\nDone! JSON themes written to ${outDir}`)
