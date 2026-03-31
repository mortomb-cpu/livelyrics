import { useState, useRef, useEffect } from 'react'
import { fetchLyrics } from '../utils/lyricsService'
import { cacheLyrics, getAllCachedSongs, searchCachedSongs } from '../utils/lyricsCache'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'

// Reuse the PDF.js worker setup
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

/**
 * Extract plain text from a PDF file.
 */
async function extractTextFromPDF(file) {
  const buffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  let fullText = ''

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()

    // Build lines by tracking Y position changes
    // Track the Y gaps to detect blank lines (stanza breaks)
    const rawLines = []
    let currentLine = ''
    let lastY = null
    let lastX = 0
    let lastWidth = 0

    for (const item of content.items) {
      const x = item.transform[4]
      const y = item.transform[5]

      if (lastY !== null && Math.abs(y - lastY) > 2) {
        // Y changed = new line
        if (currentLine.trim()) {
          rawLines.push({ text: currentLine.trim(), y: lastY })
        }
        currentLine = item.str
      } else {
        // Same line — check horizontal gap for word spacing
        const gap = x - (lastX + lastWidth)
        if (lastY === null) {
          currentLine = item.str
        } else if (gap > 5) {
          currentLine += ' ' + item.str
        } else {
          currentLine += item.str
        }
      }

      lastX = x
      lastY = y
      lastWidth = item.width || 0

      if (item.hasEOL) {
        if (currentLine.trim()) {
          rawLines.push({ text: currentLine.trim(), y })
        }
        currentLine = ''
        lastY = null
      }
    }
    if (currentLine.trim()) {
      rawLines.push({ text: currentLine.trim(), y: lastY })
    }

    // Now reconstruct text with proper blank lines
    // Detect stanza breaks by looking at Y gaps between consecutive lines
    // A normal line gap is ~12-16px; a stanza break is typically 1.5x-2x that
    const lineGaps = []
    for (let j = 1; j < rawLines.length; j++) {
      // Y decreases as we go down the page in PDF coordinates
      const gap = Math.abs(rawLines[j - 1].y - rawLines[j].y)
      lineGaps.push(gap)
    }

    // Find the typical single line gap (median of all gaps)
    if (lineGaps.length > 0) {
      const sorted = [...lineGaps].sort((a, b) => a - b)
      const medianGap = sorted[Math.floor(sorted.length / 2)]
      // Threshold: a gap > 1.4x the median = stanza break
      const blankLineThreshold = medianGap * 1.4

      const outputLines = []
      for (let j = 0; j < rawLines.length; j++) {
        outputLines.push(rawLines[j].text)
        if (j < lineGaps.length && lineGaps[j] > blankLineThreshold) {
          outputLines.push('') // Insert blank line for stanza break
        }
      }
      fullText += outputLines.join('\n') + '\n\n'
    } else if (rawLines.length > 0) {
      fullText += rawLines.map(l => l.text).join('\n') + '\n\n'
    }
  }

  return fullText.trim()
}

/**
 * Extract plain text from a Word (.docx) file.
 */
async function extractTextFromWord(file) {
  const buffer = await file.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value.trim()
}

export default function LyricsEditor({ song, onSave, onClose }) {
  const [title, setTitle] = useState(song.title || '')
  const [artist, setArtist] = useState(song.artist || '')
  const [lyrics, setLyrics] = useState(song.lyrics || '')
  const [bpm, setBpm] = useState(song.bpm || '')
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryResults, setLibraryResults] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const fileInputRef = useRef(null)
  const needsAttention = song.needsAttention || song.lyricsStatus === 'attention'

  // Auto-check library for exact match on mount (for needsAttention songs)
  useEffect(() => {
    if (!needsAttention) return
    const checkLibrary = async () => {
      // Try the raw title as a search term
      const rawSearch = song.rawTitle || song.title
      if (!rawSearch) return
      const results = await searchCachedSongs(rawSearch)
      if (results.length === 1) {
        // Exact single match — auto-load it
        setTitle(results[0].title)
        setArtist(results[0].artist)
        setLyrics(results[0].lyrics)
      }
    }
    checkLibrary()
  }, [])

  const handleFetch = async () => {
    if (!artist) {
      setError('Artist name is needed to fetch lyrics')
      return
    }
    if (!title) {
      setError('Song title is needed to fetch lyrics')
      return
    }
    setFetching(true)
    setError('')
    try {
      const result = await fetchLyrics(artist, title)
      setLyrics(result)
    } catch (err) {
      setError(err.message)
    }
    setFetching(false)
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setUploadingFile(true)
    setError('')

    try {
      const ext = file.name.split('.').pop().toLowerCase()
      let text = ''

      if (ext === 'pdf') {
        text = await extractTextFromPDF(file)
      } else if (ext === 'docx') {
        text = await extractTextFromWord(file)
      } else if (ext === 'txt') {
        text = await file.text()
      } else {
        setError('Supported formats: PDF, Word (.docx), or TXT')
        setUploadingFile(false)
        return
      }

      if (text.trim()) {
        setLyrics(text.trim())
      } else {
        setError('Could not extract text from file. Try pasting lyrics manually.')
      }
    } catch (err) {
      setError('Failed to read file: ' + err.message)
    }

    setUploadingFile(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleOpenLibrary = async () => {
    setShowLibrary(true)
    setLibraryLoading(true)
    const all = await getAllCachedSongs()
    setLibraryResults(all)
    setLibraryLoading(false)
  }

  const handleLibrarySearch = async (query) => {
    setLibrarySearch(query)
    setLibraryLoading(true)
    const results = await searchCachedSongs(query)
    setLibraryResults(results)
    setLibraryLoading(false)
  }

  const handlePickFromLibrary = (entry) => {
    setTitle(entry.title)
    setArtist(entry.artist)
    setLyrics(entry.lyrics)
    setShowLibrary(false)
    setLibrarySearch('')
  }

  const handleSave = () => {
    const updates = {
      lyrics,
      lyricsStatus: lyrics ? 'manual' : (needsAttention ? 'attention' : 'pending'),
      needsAttention: !title || !artist || !lyrics
    }
    if (title !== song.title) updates.title = title
    if (artist !== song.artist) updates.artist = artist
    if (bpm) updates.bpm = parseInt(bpm)

    // Save to persistent cache for future shows
    if (lyrics && artist && title) {
      cacheLyrics(artist, title, lyrics)
    }

    onSave(updates)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-700">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">
              {needsAttention ? 'Set Up Song' : 'Edit Lyrics'}
            </h2>
            <button onClick={onClose} className="text-slate-400 hover:text-white text-2xl p-2">
              ✕
            </button>
          </div>

          {/* Editable title and artist */}
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              placeholder="Song title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-indigo-500"
            />
            <input
              type="text"
              placeholder="Artist"
              value={artist}
              onChange={e => setArtist(e.target.value)}
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-indigo-500"
            />
            <input
              type="number"
              placeholder="BPM"
              value={bpm}
              onChange={e => setBpm(e.target.value ? parseInt(e.target.value) : '')}
              min="40"
              max="250"
              className="w-20 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleFetch}
              disabled={fetching || !artist || !title}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {fetching ? 'Searching...' : 'Fetch Lyrics'}
            </button>

            {/* File upload for lyrics */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={handleFileUpload}
              className="hidden"
              id="lyrics-file-upload"
            />
            <label
              htmlFor="lyrics-file-upload"
              className={`cursor-pointer px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                uploadingFile
                  ? 'bg-slate-600 text-slate-400'
                  : 'bg-slate-700 hover:bg-slate-600 text-white'
              }`}
            >
              {uploadingFile ? 'Reading...' : 'Upload Lyrics File'}
            </label>

            <button
              onClick={handleOpenLibrary}
              className="bg-indigo-700 hover:bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Search Library
            </button>

            <span className="text-xs text-slate-500 self-center">PDF, Word, or TXT</span>
          </div>

          {needsAttention && !lyrics && (
            <div className="mt-3 p-2.5 bg-amber-900/30 border border-amber-700/40 rounded-lg">
              <p className="text-sm text-amber-300">
                This song wasn't recognized automatically. Set the title and artist above,
                then fetch lyrics, upload a lyrics file, or paste them below.
              </p>
            </div>
          )}

          {error && (
            <p className="mt-2 text-sm text-red-400">{error}</p>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden p-4">
          <textarea
            value={lyrics}
            onChange={e => setLyrics(e.target.value)}
            placeholder={"Paste or type lyrics here...\n\nUse blank lines between verses.\nUse [Chorus], [Verse 1] etc. for section headers."}
            className="w-full h-full min-h-[300px] bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-500 text-sm font-mono resize-none focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-400 hover:text-white text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-lg text-sm font-medium"
          >
            Save
          </button>
        </div>
      </div>

      {/* Library Browser Modal */}
      {showLibrary && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="p-4 border-b border-slate-700">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-white">Song Library</h3>
                <button
                  onClick={() => { setShowLibrary(false); setLibrarySearch('') }}
                  className="text-slate-400 hover:text-white text-2xl p-2"
                >
                  ✕
                </button>
              </div>
              <input
                type="text"
                placeholder="Search by title or artist..."
                value={librarySearch}
                onChange={e => handleLibrarySearch(e.target.value)}
                autoFocus
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 text-sm focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {libraryLoading ? (
                <p className="text-center text-slate-400 py-8">Loading...</p>
              ) : libraryResults.length === 0 ? (
                <p className="text-center text-slate-500 py-8">
                  {librarySearch ? 'No matches found' : 'Library is empty'}
                </p>
              ) : (
                libraryResults.map((entry, i) => (
                  <button
                    key={i}
                    onClick={() => handlePickFromLibrary(entry)}
                    className="w-full text-left p-3 rounded-lg hover:bg-slate-700 transition-colors mb-1"
                  >
                    <div className="text-white font-medium text-sm">{entry.title}</div>
                    <div className="text-slate-400 text-xs">{entry.artist}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
