/**
 * Stages the binary assets the app needs at runtime but doesn't keep in git:
 *
 *  - OCR (tesseract) so image-only "Print to PDF" set lists can be read with no
 *    internet connection at import time.
 *  - A Hebrew-capable TTF, because jsPDF's built-in fonts are Latin-1 only and
 *    render Hebrew as garbage in the exported set list PDF.
 *
 * Everything lands in public/, which is gitignored for these paths — the files
 * are copied out of node_modules or downloaded once. Runs via postinstall.
 */
import { mkdirSync, copyFileSync, existsSync, writeFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function log(msg) { console.log(`[setup-assets] ${msg}`) }

// ---------------------------------------------------------------- OCR assets

const ocrDest = join(root, 'public', 'tesseract')
const coreDest = join(ocrDest, 'core')
const langDest = join(ocrDest, 'lang')

// tesseract.js picks one of these at runtime based on the browser's WASM SIMD
// support, so all three have to be present. Only one is ever downloaded by the
// client. The -lstm builds are the smaller ones (no legacy engine).
const CORE_FILES = [
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
]

const LANG_URL = 'https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz'

async function setupOcr() {
  mkdirSync(coreDest, { recursive: true })
  mkdirSync(langDest, { recursive: true })

  const workerSrc = join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
  if (!existsSync(workerSrc)) {
    log('tesseract.js not installed yet — skipping OCR assets')
    return
  }
  copyFileSync(workerSrc, join(ocrDest, 'worker.min.js'))

  const coreSrcDir = join(root, 'node_modules', 'tesseract.js-core')
  for (const f of CORE_FILES) {
    const src = join(coreSrcDir, f)
    if (existsSync(src)) copyFileSync(src, join(coreDest, f))
    else log(`WARNING: missing core file ${f}`)
  }

  const langFile = join(langDest, 'eng.traineddata.gz')
  if (existsSync(langFile) && statSync(langFile).size > 1_000_000) {
    log('OCR language data already present')
  } else {
    log('downloading English OCR data (~1.9MB)...')
    try {
      const res = await fetch(LANG_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(langFile, Buffer.from(await res.arrayBuffer()))
      log('OCR language data downloaded')
    } catch (err) {
      log(`WARNING: could not download OCR language data (${err.message}).`)
      log('Image-only PDF import will be unavailable until this succeeds.')
    }
  }
}

// --------------------------------------------------------------- PDF fonts

const fontDest = join(root, 'public', 'fonts')

// Noto Sans Hebrew ships Hebrew *and* basic Latin, so one face covers a mixed
// set list. ~47KB each, loaded by the PDF exporter only when it needs them.
const FONTS = [
  ['400Regular/NotoSansHebrew_400Regular.ttf', 'NotoSansHebrew-Regular.ttf'],
  ['700Bold/NotoSansHebrew_700Bold.ttf', 'NotoSansHebrew-Bold.ttf'],
]

function setupFonts() {
  mkdirSync(fontDest, { recursive: true })
  const base = join(root, 'node_modules', '@expo-google-fonts', 'noto-sans-hebrew')
  if (!existsSync(base)) {
    log('Hebrew font package not installed — skipping fonts')
    return
  }
  for (const [src, name] of FONTS) {
    const from = join(base, src)
    if (existsSync(from)) copyFileSync(from, join(fontDest, name))
    else log(`WARNING: missing font ${src}`)
  }
  log('PDF fonts ready in public/fonts/')
}

await setupOcr()
setupFonts()
log('done')
