import { useState, useRef } from 'react'
import { fetchLyrics } from '../utils/lyricsService'
import { cacheLyrics } from '../utils/lyricsCache'
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
  let text = ''

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const lines = []
    let currentLine = ''
    let lastY = null

    for (const item of content.items) {
      const y = item.transform[5]
      if (lastY !== null && Math.abs(y - lastY) > 3) {
        if (currentLine.trim()) lines.push(currentLine.trim())
        currentLine = item.str
      } else {
        const gap = lastY !== null ? item.transform[4] - (lines.length > 0 ? 0 : 0) : 0
        currentLine += (currentLine && gap > 5 ? ' ' : '') + item.str
      }
      lastY = y
      if (item.hasEOL) {
        if (currentLine.trim()) lines.push(currentLine.trim())
        currentLine = ''
        lastY = null
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim())
    text += lines.join('\n') + '\n\n'
  }

  return text.trim()
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
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState('')
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef(null)
  const needsAttention = song.needsAttention || song.lyricsStatus === 'attention'

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

  const handleSave = () => {
    const updates = {
      lyrics,
      lyricsStatus: lyrics ? 'manual' : (needsAttention ? 'attention' : 'pending'),
      needsAttention: !title || !artist || !lyrics
    }
    // Include title/artist changes
    if (title !== song.title) updates.title = title
    if (artist !== song.artist) updates.artist = artist

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
    </div>
  )
}
