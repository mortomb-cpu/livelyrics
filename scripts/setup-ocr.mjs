/**
 * Stages the OCR assets that let the app read image-only PDFs ("Print to PDF",
 * scans) with no internet connection at import time.
 *
 * Everything lands in public/tesseract/, which is gitignored — the files are
 * either copied out of node_modules or downloaded once, so they don't need to
 * live in the repo. Runs automatically via postinstall.
 */
import { mkdirSync, copyFileSync, existsSync, writeFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'public', 'tesseract')
const coreDest = join(dest, 'core')
const langDest = join(dest, 'lang')

// tesseract.js picks one of these at runtime based on the browser's WASM SIMD
// support, so all three have to be present. Only one is ever downloaded by the
// client. The -lstm builds are the smaller ones (no legacy engine).
const CORE_FILES = [
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
]

const LANG_URL = 'https://tessdata.projectnaptha.com/4.0.0_fast/eng.traineddata.gz'

function log(msg) { console.log(`[setup-ocr] ${msg}`) }

async function main() {
  mkdirSync(coreDest, { recursive: true })
  mkdirSync(langDest, { recursive: true })

  const workerSrc = join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js')
  if (!existsSync(workerSrc)) {
    log('tesseract.js not installed yet — skipping (run npm install first)')
    return
  }
  copyFileSync(workerSrc, join(dest, 'worker.min.js'))

  const coreSrcDir = join(root, 'node_modules', 'tesseract.js-core')
  for (const f of CORE_FILES) {
    const src = join(coreSrcDir, f)
    if (existsSync(src)) copyFileSync(src, join(coreDest, f))
    else log(`WARNING: missing core file ${f}`)
  }

  // Language data isn't shipped in node_modules, so fetch it once.
  const langFile = join(langDest, 'eng.traineddata.gz')
  if (existsSync(langFile) && statSync(langFile).size > 1_000_000) {
    log('language data already present')
  } else {
    log('downloading English OCR data (~1.9MB)...')
    try {
      const res = await fetch(LANG_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(langFile, Buffer.from(await res.arrayBuffer()))
      log('language data downloaded')
    } catch (err) {
      log(`WARNING: could not download language data (${err.message}).`)
      log('Image-only PDF import will be unavailable until this succeeds.')
      return
    }
  }

  log('OCR assets ready in public/tesseract/')
}

main()
