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

export async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()

  if (['xlsx', 'xls', 'csv'].includes(ext)) {
    return parseSpreadsheet(file)
  } else if (ext === 'docx') {
    return parseWord(file)
  } else if (ext === 'pdf') {
    return parsePDF(file)
  } else if (ext === 'txt') {
    return parseText(await file.text())
  }

  throw new Error(`Unsupported file type: .${ext}. Use Excel, Word, PDF, CSV, or TXT files.`)
}

async function parseSpreadsheet(file) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  const songs = []
  let currentSet = 0
  let headerRow = -1

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
      if (songs.some(s => s.setIndex === currentSet)) {
        currentSet++
      }
      continue
    }

    const firstCell = String(row[0] || '').trim()

    // Stop at backup/encore sections — these don't need to be prepped
    if (/^(backup|extras?|reserve|encore|additional|additionals|additonals?)\b/i.test(firstCell)) {
      break
    }

    // Set marker row (standalone "Set 1", "Set 2", "---")
    if (/^(set\s*\d|---|-{3,})/i.test(firstCell)) {
      if (songs.some(s => s.setIndex === currentSet)) {
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

async function parsePDF(file) {
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

  return parseText(fullText)
}

function parseText(text) {
  const lines = text.split('\n').map(l => l.trim())
  const songs = []
  let currentSet = 0
  let hadNumberedSongs = false

  for (const line of lines) {
    // Empty line
    if (!line) {
      if (songs.some(s => s.setIndex === currentSet)) {
        currentSet++
      }
      continue
    }

    // Stop at backup/encore/additionals sections (any spelling)
    if (/^(backup|extras?|reserve|encore|additional|additionals|additonals?)\b/i.test(line)) {
      break
    }

    // Check if this line starts with a number (numbered song)
    const isNumbered = /^\d+[\.\)\s]/.test(line)

    if (isNumbered) {
      hadNumberedSongs = true
    }

    // If we previously had numbered songs and now see an unnumbered line — that's the backup section, stop
    if (hadNumberedSongs && !isNumbered) {
      break
    }

    // Standalone set marker line (e.g., "Set 1", "SET 2", "---")
    if (/^(set\s*\d+)\s*$/i.test(line) || /^---/.test(line)) {
      const setNumMatch = line.match(/set\s*(\d+)/i)
      if (setNumMatch) {
        currentSet = parseInt(setNumMatch[1], 10) - 1
      } else if (songs.some(s => s.setIndex === currentSet)) {
        currentSet++
      }
      continue
    }

    // Skip obvious headers
    if (/^(title|song|#|number)/i.test(line)) continue

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
        needsAttention: !match && !finalArtist
      })
    }
  }

  return songs
}
