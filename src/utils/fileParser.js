import * as XLSX from 'xlsx'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
import { lookupSong } from './knownSongs'

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

/**
 * Parse uploaded file into a list of songs grouped by sets.
 * Supports: .xlsx, .xls, .csv, .docx, .pdf, .txt
 *
 * Expected Excel/CSV format:
 *   Column A: Song Title (or "Title", "Song")
 *   Column B: Artist (or "Artist", "Band", "By")
 *   Empty rows or rows starting with "Set" / "---" mark set breaks
 *
 * Expected Word/PDF/Text format:
 *   Each line: "Song Title - Artist" or "Song Title by Artist"
 *   Empty lines or lines with "Set X" / "---" mark set breaks
 */

export async function parseFile(file, onProgress) {
  const ext = file.name.split('.').pop().toLowerCase()

  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    return parseSpreadsheet(file)
  } else if (ext === 'docx') {
    return parseWord(file)
  } else if (ext === 'pdf') {
    return parsePDF(file, onProgress)
  } else if (ext === 'txt') {
    return parseText(await file.text())
  }

  // Legacy .doc is a different binary format that mammoth can't read — say so
  // plainly instead of calling Word "unsupported".
  if (ext === 'doc') {
    throw new Error(
      'Old-style .doc files are not supported. Open it in Word and use ' +
      '"Save As" → .docx, then upload that.'
    )
  }

  throw new Error(`Unsupported file type: .${ext}. Use Excel (.xlsx/.xls/.csv), Word (.docx), PDF, or TXT files.`)
}

async function parseSpreadsheet(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  const songs = []
  let currentSet = 0
  let currentSection = 'set'
  let headerRow = -1
  // See parseText: explicit "Set N" rows win over blank-row inference.
  const hasExplicitSets = rows.some(r => r && /^set\s*\d+\s*$/i.test(String(r[0] || '').trim()))

  // Find header row and column mapping
  let titleCol = 0
  let artistCol = 1

  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i]
    if (!row) continue
    const cells = row.map(c => String(c || '').toLowerCase().trim())

    const ti = cells.findIndex(c => ['title', 'song', 'song title', 'song name', 'name'].includes(c))
    const ai = cells.findIndex(c => ['artist', 'band', 'by', 'performer', 'singer'].includes(c))

    if (ti !== -1) {
      titleCol = ti
      artistCol = ai !== -1 ? ai : ti + 1
      headerRow = i
      break
    }
  }

  const startRow = headerRow + 1

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i]

    // Empty row = set break
    if (!row || row.every(c => !c || String(c).trim() === '')) {
      if (!hasExplicitSets && currentSection === 'set' &&
          songs.some(s => s.setIndex === currentSet && s.section === 'set')) {
        currentSet++
      }
      continue
    }

    const firstCell = String(row[0] || '').trim()

    // Section header row. Previously this stopped parsing and discarded every
    // song below it; now it routes them to the encore / additional zone instead.
    const sectionMatch = firstCell.match(/^(backup|extras?|reserve|encore|additionals?|additonals?)\b/i)
    if (sectionMatch) {
      currentSection = /^encore/i.test(sectionMatch[1]) ? 'encore' : 'additional'
      continue
    }

    // Set marker row (standalone "Set 1", "Set 2", "---")
    if (/^(set\s*\d|---|-{3,})/i.test(firstCell)) {
      currentSection = 'set'
      const setNumMatch = firstCell.match(/set\s*(\d+)/i)
      if (setNumMatch) {
        currentSet = parseInt(setNumMatch[1], 10) - 1
      } else if (songs.some(s => s.setIndex === currentSet && s.section === 'set')) {
        currentSet++
      }
      continue
    }

    let title = String(row[titleCol] || '').trim()
    const artist = String(row[artistCol] || '').trim()

    if (!title) continue

    // Detect "SET X" embedded in title (e.g., "Creep SET 1", "Radio Gaga + BR SET 2")
    const setMatch = title.match(/\s+SET\s*(\d+)\s*$/i)
    if (setMatch) {
      const setNum = parseInt(setMatch[1], 10) - 1
      title = title.replace(/\s+SET\s*\d+\s*$/i, '').trim()
      // Switch to the indicated set
      if (setNum > currentSet || (setNum !== currentSet && songs.some(s => s.setIndex === currentSet))) {
        currentSet = setNum
      }
    }

    // Check if this is a medley/compound entry (contains "+")
    // Keep full text (e.g. "BR + Radio Gaga + BR") — let user edit it
    if (title.includes('+')) {
      songs.push({
        title: title.trim(),
        artist: '',
        setIndex: currentSet,
        section: currentSection,
        needsAttention: true,
        isMedley: true,
        rawTitle: title.trim()
      })
    } else {
      // Single song — clean up standalone "BR" markers
      title = title.replace(/\bBR\b/gi, '').trim()
      if (!title) continue

      // Auto-lookup from known songs database: correct title + fill artist
      const match = lookupSong(title)
      const finalTitle = match ? match.title : title
      const finalArtist = artist || (match ? match.artist : '')
      songs.push({
        title: finalTitle,
        artist: finalArtist,
        setIndex: currentSet,
        section: currentSection,
        needsAttention: !match && !finalArtist
      })
    }
  }

  return songs
}

async function parseWord(file) {
  const buffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return parseText(result.value)
}

/**
 * Read an image-only PDF (a "Print to PDF" export, or a scan) by rendering each
 * page and running OCR over it. Assets are served from public/tesseract/, staged
 * by scripts/setup-ocr.mjs, so this works with no internet connection.
 */
async function ocrPDF(pdf, onProgress) {
  const { createWorker } = await import('tesseract.js')
  const base = import.meta.env.BASE_URL || '/'

  let worker
  try {
    worker = await createWorker('eng', 1, {
      workerPath: `${base}tesseract/worker.min.js`,
      corePath: `${base}tesseract/core`,
      langPath: `${base}tesseract/lang`,
      gzip: true
    })
  } catch (err) {
    throw new Error(
      'This PDF has no text layer, and the OCR engine failed to start ' +
      `(${err.message}). Run "npm run setup-ocr" to stage the OCR files.`
    )
  }

  try {
    let text = ''
    for (let i = 1; i <= pdf.numPages; i++) {
      onProgress?.(`Reading page ${i} of ${pdf.numPages} (scanned PDF)…`)
      const page = await pdf.getPage(i)
      // 2x scale — OCR accuracy drops badly at native resolution.
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      // PDFs render with a transparent background, which OCRs poorly — paint white first.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise

      const { data } = await worker.recognize(canvas)
      text += (data.text || '') + '\n\n'

      // Release the bitmap before the next page — a multi-page set list at 2x
      // scale otherwise holds every canvas in memory at once.
      canvas.width = 0
      canvas.height = 0
    }
    return text
  } finally {
    await worker.terminate()
  }
}

async function parsePDF(file, onProgress) {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  let fullText = ''

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    // Build lines by tracking Y position changes and joining text items carefully.
    // PDF text items that are close together horizontally should be joined WITHOUT
    // spaces (they may be split mid-word due to font changes or kerning).
    const lines = []
    let currentLine = ''
    let lastX = 0
    let lastY = null
    let lastWidth = 0

    for (const item of content.items) {
      const x = item.transform[4]
      const y = item.transform[5]

      // If Y position changed significantly, it's a new line
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        if (currentLine.trim()) {
          lines.push(currentLine.trim())
        }
        currentLine = item.str
      } else {
        // Same line — check horizontal gap to decide on spacing
        const gap = x - (lastX + lastWidth)
        if (lastY === null) {
          // First item
          currentLine = item.str
        } else if (gap > 40 && currentLine && !/[-–—]\s*$/.test(currentLine)) {
          // Big gap = a second column (e.g. right-aligned artist next to the
          // title). Insert a " - " delimiter so the line parses as Title - Artist.
          currentLine += ' - ' + item.str
        } else if (gap > 5) {
          // Significant gap = word boundary
          currentLine += ' ' + item.str
        } else {
          // Small or no gap = same word (PDF split mid-word for font/style reasons)
          currentLine += item.str
        }
      }

      lastX = x
      lastY = y
      lastWidth = item.width || 0

      if (item.hasEOL) {
        if (currentLine.trim()) {
          lines.push(currentLine.trim())
        }
        currentLine = ''
        lastY = null
      }
    }

    if (currentLine.trim()) {
      lines.push(currentLine.trim())
    }

    fullText += lines.join('\n') + '\n\n'
  }

  // Image-only PDFs (scanned, or made with "Microsoft Print to PDF") have no
  // text layer, so fall back to OCR on the rendered pages.
  if (!fullText.trim()) {
    fullText = await ocrPDF(pdf, onProgress)

    if (!fullText.trim()) {
      throw new Error(
        'This PDF has no readable text and OCR could not make out any either. ' +
        'If it is a photo or a low-resolution scan, try re-saving it as a ' +
        'text-based PDF ("Save as PDF" rather than "Print to PDF"), or upload ' +
        'an Excel, Word, CSV, or TXT file instead.'
      )
    }
  }

  return parseText(fullText)
}

function parseText(text) {
  const lines = text.split('\n').map(l => l.trim())
  const songs = []
  let currentSet = 0
  let currentSection = 'set'

  // When the file labels its sets explicitly, those labels are the only thing
  // that starts a new set. Otherwise a stray blank line splits a set in two —
  // which OCR output triggers constantly, since row spacing in a rendered page
  // is irregular.
  const hasExplicitSets = lines.some(l => /^set\s*\d+\s*$/i.test(l))

  for (const line of lines) {
    // Empty line
    if (!line) {
      if (!hasExplicitSets && currentSection === 'set' &&
          songs.some(s => s.setIndex === currentSet && s.section === 'set')) {
        currentSet++
      }
      continue
    }

    // Section headers (any spelling). These used to stop parsing entirely, which
    // silently dropped every song below them. Instead, route what follows to the
    // encore or additional-songs zone so nothing is lost on import.
    const sectionMatch = line.match(/^(backup|extras?|reserve|encore|additionals?|additonals?)\b/i)
    if (sectionMatch) {
      currentSection = /^encore/i.test(sectionMatch[1]) ? 'encore' : 'additional'
      continue
    }

    // Standalone set marker line (e.g., "Set 1", "SET 2", "---").
    // Handled BEFORE the numbered-list heuristic below, otherwise a multi-set
    // numbered list (1..9 under "Set 1", 10..18 under "Set 2", ...) would stop
    // at "Set 2" because it's an unnumbered line following numbered songs.
    if (/^set\s*\d+\s*$/i.test(line) || /^-{3,}/.test(line)) {
      const setNumMatch = line.match(/set\s*(\d+)/i)
      // An explicit "Set N" heading returns us to the numbered-set flow even if
      // an encore/backup heading appeared earlier in the file.
      currentSection = 'set'
      if (setNumMatch) {
        currentSet = parseInt(setNumMatch[1], 10) - 1
      } else if (songs.some(s => s.setIndex === currentSet && s.section === 'set')) {
        currentSet++
      }
      continue
    }

    // Skip non-song header/footer lines — column headers plus our own PDF
    // export's title ("Set List"), date, and credit ("Generated by...") lines,
    // so they don't get ingested as bogus songs on re-import.
    if (/^(set\s*list|title|song|#|number)\s*$/i.test(line)) continue
    if (/^generated by\b/i.test(line)) continue
    if (/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s/i.test(line) && /\b\d{4}\b/.test(line)) continue

    // Parse "Title - Artist" or "Title by Artist"
    let title = line
    let artist = ''

    // Try "Title - Artist" format
    const dashMatch = line.match(/^(.+?)\s*[-–—]\s*(.+)$/)
    if (dashMatch) {
      title = dashMatch[1].trim()
      artist = dashMatch[2].trim()
    } else {
      // Try "Title by Artist" format
      const byMatch = line.match(/^(.+?)\s+by\s+(.+)$/i)
      if (byMatch) {
        title = byMatch[1].trim()
        artist = byMatch[2].trim()
      }
    }

    // Remove numbering like "1." or "1)" or "1 " from title
    title = title.replace(/^\d+[\.\)\s]\s*/, '')

    // Detect "SET X" embedded in title (e.g., "Creep SET 1")
    const setMatch = title.match(/\s+SET\s*(\d+)\s*$/i)
    if (setMatch) {
      const setNum = parseInt(setMatch[1], 10) - 1
      title = title.replace(/\s+SET\s*\d+\s*$/i, '').trim()
      if (setNum > currentSet || (setNum !== currentSet && songs.some(s => s.setIndex === currentSet))) {
        currentSet = setNum
      }
    }

    // Check if this is a medley/compound entry (contains "+")
    // e.g. "BR + Radio Gaga + BR" — keep the full text, let the user edit it
    if (title.includes('+')) {
      songs.push({
        title: title.trim(),
        artist: '',
        setIndex: currentSet,
        section: currentSection,
        needsAttention: true,
        isMedley: true,
        rawTitle: title.trim()
      })
    } else {
      // Single song — remove standalone "BR" markers
      title = title.replace(/\bBR\b/gi, '').trim()
      if (!title) continue

      const match = lookupSong(title)
      const finalTitle = match ? match.title : title
      const finalArtist = artist || (match ? match.artist : '')
      songs.push({
        title: finalTitle,
        artist: finalArtist,
        setIndex: currentSet,
        section: currentSection,
        needsAttention: !match && !finalArtist
      })
    }
  }

  return songs
}
