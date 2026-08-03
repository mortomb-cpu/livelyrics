import { jsPDF } from 'jspdf'

const HEBREW = /[֐-׿]/

/**
 * jsPDF's built-in faces (helvetica and friends) are Latin-1 only — they have
 * no way to encode a Hebrew codepoint, so Hebrew titles came out as garbage.
 * Embedding a Unicode TTF is the only fix.
 *
 * Noto Sans Hebrew carries Hebrew and basic Latin, so a mixed set list can be
 * drawn in one face. Loaded from public/fonts (staged by scripts/setup-assets.mjs)
 * and cached, so an all-English export never pays for it.
 */
let fontPromise = null

function loadHebrewFont() {
  if (fontPromise) return fontPromise
  const base = import.meta.env.BASE_URL || '/'

  const toBase64 = (buf) => {
    const bytes = new Uint8Array(buf)
    let binary = ''
    // Chunked: String.fromCharCode(...) on a 48KB array blows the call stack.
    for (let i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
    }
    return btoa(binary)
  }

  fontPromise = Promise.all(
    ['Regular', 'Bold'].map(async (weight) => {
      const res = await fetch(`${base}fonts/NotoSansHebrew-${weight}.ttf`)
      if (!res.ok) throw new Error(`font ${weight}: HTTP ${res.status}`)
      return [weight, toBase64(await res.arrayBuffer())]
    })
  ).catch((err) => {
    fontPromise = null // let a later export retry
    throw err
  })

  return fontPromise
}

/**
 * Register the Hebrew face on a document. Returns false if it couldn't be
 * loaded, so the caller can fall back to helvetica rather than export nothing.
 */
async function attachHebrewFont(doc) {
  try {
    const faces = await loadHebrewFont()
    for (const [weight, b64] of faces) {
      const file = `NotoSansHebrew-${weight}.ttf`
      doc.addFileToVFS(file, b64)
      doc.addFont(file, 'NotoSansHebrew', weight === 'Bold' ? 'bold' : 'normal')
    }
    return true
  } catch {
    return false
  }
}

/**
 * Build a real, text-layer PDF of the set list.
 *
 * Unlike the old "open HTML + browser print" approach (which depended on the
 * user's printer choice and could silently produce an image-only PDF via
 * "Microsoft Print to PDF"), this generates the PDF directly with jsPDF, so the
 * output always contains selectable, extractable text — and round-trips cleanly
 * back through the app's PDF importer.
 *
 * @param {{name: string, songs: {title: string, artist?: string}[]}[]} orderedSets
 * @param {string} dateStr
 * @returns {import('jspdf').jsPDF}
 */
export async function buildSetListPDF(orderedSets, dateStr) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })

  // Only pay the font cost when the set list actually contains Hebrew.
  const needsHebrew = orderedSets.some(set =>
    set.songs.some(s => HEBREW.test(`${s.title || ''} ${s.artist || ''}`))
  )
  const hebrewReady = needsHebrew ? await attachHebrewFont(doc) : false
  const face = hebrewReady ? 'NotoSansHebrew' : 'helvetica'

  // Hebrew runs right-to-left; jsPDF reorders the glyphs only when told to,
  // and the flag is per-call state, so set it around each string.
  const drawText = (text, x, y, opts) => {
    const rtl = hebrewReady && HEBREW.test(text)
    if (rtl) doc.setR2L(true)
    doc.text(text, x, y, opts)
    if (rtl) doc.setR2L(false)
  }

  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 40
  const leftX = margin
  const rightX = pageW - margin

  const totalSongs = orderedSets.reduce((n, s) => n + s.songs.length, 0)

  // --- auto-fit: shrink row height / fonts so everything fits on one page ---
  const headerBlock = 58 // title + date + rule
  const footerBlock = 22
  const available = pageH - margin * 2 - headerBlock - footerBlock
  const baseSetHeader = 22
  const baseRow = 18
  const needed = orderedSets.length * baseSetHeader + totalSongs * baseRow
  const scale = needed > available ? Math.max(available / needed, 0.45) : 1
  const setHeaderH = baseSetHeader * scale
  const rowH = baseRow * scale
  const titleFont = 22
  const songFont = Math.max(8, Math.min(13, 13 * scale))
  const setFont = Math.max(9, Math.min(13, 13 * scale))

  let y = margin

  // --- title ---
  doc.setFont(face, 'bold')
  doc.setFontSize(titleFont)
  doc.setTextColor(26, 26, 26)
  drawText('Set List', pageW / 2, y + titleFont, { align: 'center' })
  // Clear the title's descenders before the date line — at 6pt they collided.
  y += titleFont + 14

  // --- date ---
  doc.setFont(face, 'normal')
  doc.setFontSize(9)
  doc.setTextColor(140, 140, 140)
  drawText(dateStr, pageW / 2, y, { align: 'center' })
  y += 10

  // --- rule ---
  doc.setDrawColor(60, 60, 60)
  doc.setLineWidth(1.2)
  doc.line(leftX, y, rightX, y)
  y += 14

  let globalNum = 0
  for (const set of orderedSets) {
    // set header bar
    doc.setFillColor(240, 240, 240)
    doc.rect(leftX, y - setHeaderH + 5, rightX - leftX, setHeaderH - 3, 'F')
    doc.setFont(face, 'bold')
    doc.setFontSize(setFont)
    doc.setTextColor(40, 40, 40)
    drawText(set.name, leftX + 6, y)
    y += 6

    // song rows
    doc.setFontSize(songFont)
    for (const song of set.songs) {
      globalNum++
      y += rowH
      doc.setFont(face, 'normal')
      doc.setTextColor(26, 26, 26)
      // The number is drawn as its own left-to-right run. Folded into the title
      // it became part of the right-to-left pass, which moved the full stop to
      // the wrong side — "1." rendered as ".1" beside a Hebrew title.
      const numText = `${globalNum}.`
      doc.text(numText, leftX + 4, y)
      // Small gap: the PDF importer joins runs this close with a space, and only
      // inserts a " - " separator across a wide column gap.
      const titleX = leftX + 4 + doc.getTextWidth(numText) + 6
      drawText(song.title || '', titleX, y)
      // artist right-aligned, lighter (separate run; importer rejoins via the big column gap)
      if (song.artist) {
        doc.setTextColor(140, 140, 140)
        drawText(song.artist, rightX - 4, y, { align: 'right' })
      }
      // faint row separator
      doc.setDrawColor(235, 235, 235)
      doc.setLineWidth(0.5)
      doc.line(leftX, y + rowH * 0.28, rightX, y + rowH * 0.28)
    }
    y += setHeaderH * 0.4
  }

  // --- footer ---
  doc.setFont(face, 'normal')
  doc.setFontSize(7)
  doc.setTextColor(190, 190, 190)
  drawText('Generated by LiveLyrics', pageW / 2, pageH - margin + 4, { align: 'center' })

  return doc
}

/**
 * Build the set-list PDF and download it as a true .pdf file.
 *
 * @param {{name: string, songs: {title: string, artist?: string}[]}[]} orderedSets
 */
export async function exportSetListPDF(orderedSets) {
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })
  const doc = await buildSetListPDF(orderedSets, dateStr)

  // Download via blob + anchor (works in both browser and the Electron renderer)
  const blob = doc.output('blob')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'LiveLyrics-SetList.pdf'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
