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
/**
 * Repair the character confusions OCR reliably makes on set lists.
 *
 * A capital I in a sans-serif font is a bare vertical stroke, so Tesseract reads
 * it as "|", "l" or "1" — turning "I Want It All" into "| Want It All" and
 * "I Can't Dance" into "1Can't Dance".
 */
function repairOcrText(text) {
  return text.split('\n').map(repairOcrLine).join('\n')
}

function repairOcrLine(line) {
  return line
    // "1. I Want It All" often comes back as the single token "1.1" — the list
    // number and the misread I fused. Split them back apart. The trailing
    // whitespace check keeps real numbers safe ("1. 1979" is untouched).
    .replace(/^(\d+\s*[.)])\s*[|1l](?=\s)/, '$1 I')
    // A lone "|" or "l" is never an English word — it's a capital I.
    .replace(/(^|\s)[|l](?=\s)/g, '$1I')
    // "|Can't" / "1Can't" / "lCan't" — capital I swallowed into the next word.
    // Requires an immediately following capital+lowercase, so list numbering
    // ("1. Creep") is left alone.
    .replace(/(^|\s)[|1l](?=[A-Z][a-z])/g, '$1I ')
    // A standalone "1" *mid-line* before a capitalised word is a misread I
    // ("1. 1 Want It All" -> "1. I Want It All"). A leading "1" is list
    // numbering and is deliberately left untouched.
    .replace(/(\S\s+)1(?=\s+[A-Z])/g, '$1I')
    // A stroke glued to LOWERCASE is a misread capital too — "|he Jackson 5"
    // is "The Jackson 5". This has to run before the cleanup below, which
    // would otherwise turn the stroke into a space and eat the letter.
    .replace(/(^|\s)[|1l](?=[a-z])/g, (match, lead, offset, whole) =>
      lead + capitalForStroke(whole.slice(offset + lead.length + 1))
    )
    // Only now: a pipe with no letter attached is a ruled table border.
    .replace(/\|/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
}

// Which capital did OCR flatten into a vertical stroke? Decided by the letters
// that follow, since "The"/"This" and "It"/"In" are overwhelmingly what these
// turn out to be on a set list. Anything unrecognised keeps the stroke rather
// than guessing — a visible "|" can be corrected, a deleted letter can't.
const STROKE_WORDS = [
  [/^(he|his|hat|heir|hese|hose|hen|here|hough)\b/, 'T'],
  [/^(t|ts|n|s|f|nto|-)\b/, 'I'],
  [/^('m|'ve|'ll|'d)\b/, 'I']
]

function capitalForStroke(rest) {
  for (const [pattern, letter] of STROKE_WORDS) {
    if (pattern.test(rest)) return letter
  }
  return '|'
}

/**
 * Rebuild a text line from OCR word boxes, inserting " - " across a column gap.
 *
 * Tesseract's own `data.text` joins a two-column row into one string, so
 * "I Want It All" + "Queen" arrives as "I Want It All Queen" and the artist ends
 * up inside the title. Word geometry makes the split obvious: ordinary word gaps
 * are a few pixels, a column gap is hundreds.
 */
function lineFromWords(words, imageWidth) {
  const columnGap = Math.max(40, imageWidth * 0.05)
  let out = ''
  let prevEnd = null

  for (const w of words) {
    const text = (w.text || '').trim()
    if (!text) continue
    if (prevEnd === null) out = text
    else if (w.bbox.x0 - prevEnd > columnGap) out += ' - ' + text
    else out += ' ' + text
    prevEnd = w.bbox.x1
  }
  return out
}

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

      // Ask for word geometry too — data.text alone loses the column structure.
      const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })

      const lines = []
      for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            const rebuilt = lineFromWords(line.words || [], canvas.width)
            if (rebuilt.trim()) lines.push(rebuilt)
          }
        }
      }

      // Fall back to the flat text if the layout data is unavailable.
      text += repairOcrText(lines.length ? lines.join('\n') : (data.text || '')) + '\n\n'

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

      // pdfjs synthesises whitespace-only items whose width spans the gap
      // between two runs. Measuring from one of those makes every gap look like
      // zero, which collapsed "Title" + "Artist" columns into a single string
      // and broke re-importing an exported set list. Skip them and keep
      // measuring from the last item that actually drew glyphs.
      if (!item.str.trim()) {
        if (item.hasEOL) {
          if (currentLine.trim()) lines.push(currentLine.trim())
          currentLine = ''
          lastY = null
        }
        continue
      }

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
        } else if (gap > 1.5) {
          // Significant gap = word boundary. The old 5pt threshold was too wide:
          // a two-digit list number sits ~3pt from the title, so "10" and
          // "רדיו חזק" fused into "10רדיו חזק" while single digits (a wider gap)
          // came through fine. Genuine mid-word splits have a gap at or below zero.
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

/**
 * Drop a trailing performance cue: "CUT IF TIGHT", "CLOSER · ALWAYS LAST",
 * "CALL FIRST IF RUNNING LONG".
 *
 * Printed set lists put these beside the title as a note to the band. They sit
 * on the same text line, so they end up inside the title — "ארץ חדשה No 4
 * CLOSER · ALWAYS LAST" — and then match nothing when the lyrics are fetched.
 *
 * Only a run of two or more ALL-CAPS words is removed, and only when something
 * that is not all-caps remains in front of it, so a genuinely capitalised title
 * ("YMCA", "ABC") is never eaten.
 */
function stripCueAnnotation(title) {
  const stripped = title.replace(/\s+(?:[A-Z][A-Z0-9'’]*(?:\s+|\s*·\s*)){1,}[A-Z][A-Z0-9'’]*\s*$/, '').trim()
  if (!stripped || stripped === title) return title
  // Require the remainder to contain a lowercase letter or non-Latin script,
  // otherwise the whole title was capitals and we'd be truncating it.
  return /[a-z]|[^\x00-\x7F]/.test(stripped) ? stripped : title
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
  // "SET 2" on its own, and also "SET 2 — FULL HOUSE" where the set carries a
  // name. Requiring the line to END after the number missed the latter, so every
  // song landed in one giant Set 1.
  const SET_HEADER = /^set\s*(\d+)\b/i
  const hasExplicitSets = lines.some(l => SET_HEADER.test(l))

  // "1. Song" is unambiguous, but a bare "99 Red Balloons" is both a plausible
  // list entry and a real title. Only treat a leading bare number as numbering
  // when the file does it repeatedly — one such line is a title, many are a list.
  const bareNumbered = lines.filter(l => /^\d{1,2}\s+\S/.test(l)).length
  const usesBareNumbering = bareNumbered >= 3

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

    // A notes block ("RULES FOR THE NIGHT", "NOTES") holds prose, not songs —
    // unlike an encore or reserve heading, which introduces real songs. Its
    // numbered instructions were being imported as tracks.
    if (/^(rules?|notes?|reminders?|instructions?|running order notes)\b/i.test(line)) {
      currentSection = 'notes'
      continue
    }
    if (currentSection === 'notes') continue

    // Standalone set marker line (e.g., "Set 1", "SET 2", "---").
    // Handled BEFORE the numbered-list heuristic below, otherwise a multi-set
    // numbered list (1..9 under "Set 1", 10..18 under "Set 2", ...) would stop
    // at "Set 2" because it's an unnumbered line following numbered songs.
    if (SET_HEADER.test(line) || /^-{3,}/.test(line)) {
      const setNumMatch = line.match(SET_HEADER)
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

    // Running-order chrome that sits alongside the songs on a printed sheet:
    // slot times ("19:30 → 20:00"), durations ("~30 min"), and the blurb under
    // the title ("Corporate event · Singapore · 24 songs ... · rev. 4"). These
    // were all imported as songs.
    if (/^\d{1,2}:\d{2}\s*(?:→|->|–|—|-)/.test(line)) continue
    if (/^~?\s*\d+\s*min\b/i.test(line)) continue
    // The blurb under the title ("Corporate event · Singapore · 24 songs ... · rev. 4")
    // carries several "·" separators. Matching on one was far too broad — it
    // silently dropped any song row whose annotation used a "·", such as
    // "CLOSER · ALWAYS LAST".
    if ((line.match(/·/g) || []).length >= 2) continue

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

    // Remove numbering like "1." or "1)" from the title, and a bare "1 " only
    // when the file clearly numbers that way. Capped at two digits: set lists
    // don't number past 99, and longer runs belong to the title ("1979").
    title = title.replace(/^\d{1,2}[.)]\s*/, '')
    if (usesBareNumbering) title = title.replace(/^\d{1,2}\s+/, '')
    // In a right-to-left line the leading "1." is laid out at the visual end, so
    // it extracts as "שיר .1". No real title ends in a full stop then digits.
    title = title.replace(/\s+\.\d{1,2}$/, '')
    title = stripCueAnnotation(title)
    // A trailing "(No 4)" is deliberately LEFT ALONE. It's something the user
    // types to label their own running order, and titles are theirs to control.
    // It's removed only when building a lyrics search query — see
    // searchableTitle() in lyricsService.

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
