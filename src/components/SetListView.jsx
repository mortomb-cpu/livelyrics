import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { parseFile } from '../utils/fileParser'
import { exportForTablet } from '../utils/exportTablet'
import { publishToCloud, getStoredToken, setStoredToken, getPublicURL, qrCodeSrc } from '../utils/publishToCloud'
import { fetchAllLyrics } from '../utils/lyricsService'
import { getCacheCount, getCachedLyrics } from '../utils/lyricsCache'
import SongCard from './SongCard'
import LyricsEditor from './LyricsEditor'
import AdditionalSongsPanel from './AdditionalSongsPanel'

export default function SetListView({
  songs, sets, encoreSongIds, additionalSongIds,
  onAddSong, onUpdateSong, onRemoveSong,
  onMoveSong, onAddSet, onRemoveSet, onClearAll, onDragEnd,
  onAddSongsToAdditional, onSetSongs, onSetSets, onSetEncoreSongIds, onSetAdditionalSongIds
}) {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [editingSong, setEditingSong] = useState(null)
  const [fetchProgress, setFetchProgress] = useState(null)
  const [addingManual, setAddingManual] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualArtist, setManualArtist] = useState('')
  const [error, setError] = useState('')
  const [cachedCount, setCachedCount] = useState(0)
  const [showEncore, setShowEncore] = useState(true)
  const [publishDialog, setPublishDialog] = useState(null) // null | 'token' | 'publishing' | 'success' | 'error'
  const [publishError, setPublishError] = useState('')
  const [publishURL, setPublishURL] = useState('')
  const [githubToken, setGithubToken] = useState(getStoredToken())
  const fetchAbortRef = useRef(null)

  useEffect(() => {
    getCacheCount().then(setCachedCount)
  }, [songs])

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setError('')

    try {
      const parsed = await parseFile(file)
      if (parsed.length === 0) {
        setError('No songs found in file. Check the format and try again.')
        return
      }

      // Clear only set list songs — keep additional songs intact
      // Remove songs that are in sets (not in additional)
      const additionalSet = new Set(additionalSongIds)
      const songsToKeep = songs.filter(s => additionalSet.has(s.id))
      onSetSongs(songsToKeep)
      onSetSets([])
      onSetEncoreSongIds([])

      const maxSet = Math.max(...parsed.map(s => s.setIndex))
      const newSets = Array.from({ length: maxSet + 1 }, (_, i) => ({
        name: `Set ${i + 1}`,
        songIds: []
      }))

      // Build a lookup of existing additional songs by normalized title
      const normalizeKey = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/\s+/g, '')
      const additionalByTitle = {}
      songsToKeep.forEach(s => {
        additionalByTitle[normalizeKey(s.title)] = s
      })

      // Deduplicate within the parsed file only
      const seenInParsed = new Set()
      const dedupedParsed = parsed.filter(s => {
        const key = normalizeKey(s.title)
        if (seenInParsed.has(key)) return false
        seenInParsed.add(key)
        return true
      })

      // For each parsed song: reuse existing additional song if it matches, otherwise create new
      const movedFromAdditional = new Set() // track which additional songs got moved to sets
      const newSongs = []

      const createdKeys = new Set() // track keys of songs we've already handled
      for (const s of dedupedParsed) {
        const key = normalizeKey(s.title)
        if (createdKeys.has(key)) continue // skip if already handled
        createdKeys.add(key)

        // Try exact normalized match first, then fuzzy match
        let existing = additionalByTitle[key]
        if (!existing) {
          // Fuzzy: find any additional song whose normalized title contains this key or vice versa
          for (const [aKey, aSong] of Object.entries(additionalByTitle)) {
            if (aKey.includes(key) || key.includes(aKey)) {
              existing = aSong
              break
            }
          }
        }

        if (existing) {
          // Song exists in additional — move it to the set (reuse the object)
          newSets[s.setIndex].songIds.push(existing.id)
          movedFromAdditional.add(existing.id)
        } else {
          // New song — create it and check cache
          const cached = s.artist ? await getCachedLyrics(s.artist, s.title) : null
          const newSong = {
            id: Date.now().toString() + Math.random().toString(36).slice(2),
            title: s.title,
            artist: s.artist,
            lyrics: cached || '',
            lyricsStatus: cached ? 'cached' : (s.needsAttention ? 'attention' : 'pending'),
            setIndex: s.setIndex,
            needsAttention: s.needsAttention || false,
            rawTitle: s.rawTitle || ''
          }
          newSongs.push(newSong)
          newSets[s.setIndex].songIds.push(newSong.id)
        }
      }

      // Remove moved songs from additional
      const remainingAdditional = additionalSongIds.filter(id => !movedFromAdditional.has(id))

      // Merge: kept additional songs + new songs
      onSetSongs([...songsToKeep, ...newSongs])
      onSetSets(newSets)
      onSetAdditionalSongIds(remainingAdditional)
      getCacheCount().then(setCachedCount)
    } catch (err) {
      setError(err.message)
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleAddManual = () => {
    if (!manualTitle.trim()) return
    onAddSong({
      title: manualTitle.trim(),
      artist: manualArtist.trim(),
      setIndex: sets.length - 1
    })
    setManualTitle('')
    setManualArtist('')
    setAddingManual(false)
  }

  const stopFetching = () => {
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort()
      fetchAbortRef.current = null
    }
    setFetchProgress(null)
  }

  const handleFetchAllLyrics = async () => {
    const songsToFetch = songs.filter(s =>
      s.title &&
      !s.needsAttention &&
      (!s.lyrics || s.lyricsStatus === 'pending' || s.lyricsStatus === 'failed')
    )
    if (songsToFetch.length === 0) return

    const abortController = new AbortController()
    fetchAbortRef.current = abortController

    setFetchProgress({ current: 0, total: songsToFetch.length, song: '', status: '' })

    const results = await fetchAllLyrics(songsToFetch, (current, total, songTitle, status) => {
      if (abortController.signal.aborted) return
      setFetchProgress({ current, total, song: songTitle, status })
    }, abortController.signal)

    if (!abortController.signal.aborted) {
      results.forEach(r => {
        if (r.lyrics) {
          const updates = { lyrics: r.lyrics, lyricsStatus: r.status }
          if (r.bpm) updates.bpm = r.bpm
          if (r.syncedLines) updates.syncedLines = r.syncedLines
          if (r.duration) updates.duration = r.duration
          onUpdateSong(r.id, updates)
        } else if (r.status === 'failed') {
          onUpdateSong(r.id, { lyricsStatus: 'failed' })
        }
      })
    }

    fetchAbortRef.current = null
    setFetchProgress(null)
  }

  const handlePublishToCloud = async () => {
    const token = getStoredToken()
    if (!token) {
      setPublishDialog('token')
      return
    }
    setPublishDialog('publishing')
    setPublishError('')
    try {
      const ordered = [
        ...sets.flatMap((set, si) =>
          set.songIds.map(id => {
            const s = songs.find(x => x.id === id)
            return s ? { ...s, setName: set.name, setIndex: si } : null
          }).filter(Boolean)
        ),
        ...encoreSongIds.map(id => {
          const s = songs.find(x => x.id === id)
          return s ? { ...s, setName: 'Encore', setIndex: sets.length } : null
        }).filter(Boolean)
      ]
      const url = await publishToCloud(ordered, songs, token)
      setPublishURL(url)
      setPublishDialog('success')
    } catch (err) {
      setPublishError(err.message)
      setPublishDialog('error')
    }
  }

  const handleSaveToken = () => {
    if (githubToken) {
      setStoredToken(githubToken)
      setPublishDialog(null)
      // Now trigger publish
      setTimeout(() => handlePublishToCloud(), 100)
    }
  }

  const handleExportPDF = () => {
    const orderedSets = [
      ...sets.map((set) => ({
        name: set.name,
        songs: set.songIds.map(id => songs.find(s => s.id === id)).filter(Boolean)
      })),
      ...(encoreSongIds.length > 0 ? [{
        name: 'Encore',
        songs: encoreSongIds.map(id => songs.find(s => s.id === id)).filter(Boolean)
      }] : [])
    ]

    const esc = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    let globalNum = 0
    let setListHtml = ''
    for (const set of orderedSets) {
      setListHtml += '<div class="set-block">'
      setListHtml += '<div class="set-title">' + esc(set.name) + '</div>'
      for (const song of set.songs) {
        globalNum++
        setListHtml += '<div class="song-row">'
        setListHtml += '<span class="song-num">' + globalNum + '</span>'
        setListHtml += '<span class="song-title">' + esc(song.title) + '</span>'
        setListHtml += '<span class="song-artist">' + esc(song.artist || '') + '</span>'
        setListHtml += '</div>'
      }
      setListHtml += '</div>'
    }

    const dateStr = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })

    // A4 page: 297mm height, with 10mm top/bottom padding = 277mm usable
    // We use a script to find the largest font that fits in one page
    const html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Set List</title>'
      + '<style>'
      + '@page { margin: 0; size: A4; }'
      + '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }'
      + '* { box-sizing: border-box; margin: 0; padding: 0; }'
      + 'html, body { height: 100%; margin: 0; }'
      + 'body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; color: #1a1a1a; }'
      + '.page { display: flex; flex-direction: column; height: 297mm; width: 210mm; padding: 10mm 12mm; overflow: hidden; }'
      + '.header { text-align: center; padding-bottom: 0.4em; border-bottom: 2px solid #333; margin-bottom: 0.3em; }'
      + '.header h1 { font-size: 1.7em; font-weight: 700; }'
      + '.header .meta { font-size: 0.65em; color: #888; margin-top: 0.1em; }'
      + '.sets-container { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }'
      + '.set-block { }'
      + '.set-title { font-size: 1.05em; font-weight: 700; padding: 0.2em 0.5em; background: #f0f0f0; border-radius: 3px; margin-bottom: 0.1em; }'
      + '.song-row { display: flex; align-items: baseline; padding: 0.15em 0.5em; border-bottom: 1px solid #eee; line-height: 1.5; }'
      + '.song-num { width: 1.8em; font-weight: 700; color: #666; font-size: 0.9em; flex-shrink: 0; }'
      + '.song-title { flex: 1; font-weight: 600; }'
      + '.song-artist { font-size: 0.85em; color: #888; margin-left: 0.5em; flex-shrink: 0; }'
      + '.song-row:nth-child(even) { background: #fafafa; }'
      + '.footer { text-align: center; font-size: 0.5em; color: #bbb; padding-top: 0.3em; border-top: 1px solid #eee; }'
      + '</style></head><body>'
      + '<div class="page" id="page">'
      + '<div class="header"><h1>Set List</h1><div class="meta">' + esc(dateStr) + '</div></div>'
      + '<div class="sets-container">'
      + setListHtml
      + '</div>'
      + '<div class="footer">Generated by LiveLyrics</div>'
      + '</div>'
      + '<script>'
      // Auto-size: start large, shrink until content fits the page
      + 'var page = document.getElementById("page");'
      + 'var size = 18;'
      + 'page.style.fontSize = size + "px";'
      + 'while (page.scrollHeight > page.clientHeight && size > 7) {'
      + '  size -= 0.5;'
      + '  page.style.fontSize = size + "px";'
      + '}'
      + '</script>'
      + '</body></html>'

    // Save as HTML file and open in default browser for print preview
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)

    // Try opening in a new window first
    const printWindow = window.open(url, '_blank')
    if (printWindow) {
      printWindow.onload = () => {
        setTimeout(() => printWindow.print(), 500)
      }
    } else {
      // Fallback: download the HTML file
      const a = document.createElement('a')
      a.href = url
      a.download = 'LiveLyrics-SetList.html'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }

  const hasSongs = songs.length > 0
  const songsWithLyrics = songs.filter(s => s.lyrics).length
  const setListSongCount = sets.reduce((sum, s) => sum + s.songIds.length, 0)
  const songsWithoutLyrics = songs.filter(s => !s.lyrics).length
  const canPerform = hasSongs && songsWithLyrics > 0
  const offlineReady = hasSongs && songsWithoutLyrics === 0

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="min-h-screen bg-slate-900 pb-24">
        {/* Header / Top Bar */}
        <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-700/50">
          {/* Row 1: Brand + Main CTAs */}
          <div className="max-w-2xl lg:max-w-[90rem] mx-auto px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-indigo-400 tracking-tight">LiveLyrics</h1>
              {offlineReady && (
                <span className="text-[10px] bg-emerald-500/15 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30 hidden sm:inline">
                  Offline Ready
                </span>
              )}
            </div>
            {canPerform && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const ordered = [
                      ...sets.flatMap((set, si) =>
                        set.songIds.map(id => {
                          const s = songs.find(x => x.id === id)
                          return s ? { ...s, setName: set.name, setIndex: si } : null
                        }).filter(Boolean)
                      ),
                      ...encoreSongIds.map(id => {
                        const s = songs.find(x => x.id === id)
                        return s ? { ...s, setName: 'Encore', setIndex: sets.length } : null
                      }).filter(Boolean)
                    ]
                    exportForTablet(ordered, songs)
                  }}
                  className="bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-lg shadow-amber-900/20"
                  title="Download standalone perform file for your tablet"
                >
                  Send to Tablet
                </button>
                <button
                  onClick={handlePublishToCloud}
                  className="bg-gradient-to-r from-cyan-600 to-cyan-500 hover:from-cyan-500 hover:to-cyan-400 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-lg shadow-cyan-900/20"
                  title="Publish to cloud (HTTPS) so Cloud Voice & screen wake lock work on tablet"
                >
                  ☁ Publish
                </button>
                <button
                  onClick={() => navigate('/perform')}
                  className="bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white px-6 py-2 rounded-lg text-sm font-bold transition-all shadow-lg shadow-indigo-900/30"
                >
                  Perform
                </button>
              </div>
            )}
          </div>

          {/* Row 2: Toolbar */}
          <div className="max-w-2xl lg:max-w-[90rem] mx-auto px-4 pb-2.5 flex items-center gap-1">
            {/* File upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.docx,.pdf,.txt"
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="cursor-pointer text-slate-400 hover:text-white hover:bg-slate-700/50 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
            >
              Upload Setlist
            </label>

            <div className="w-px h-4 bg-slate-700 mx-1" />

            <button
              onClick={() => setAddingManual(true)}
              className="text-slate-400 hover:text-white hover:bg-slate-700/50 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
            >
              + Song
            </button>
            <button
              onClick={onAddSet}
              className="text-slate-400 hover:text-white hover:bg-slate-700/50 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
            >
              + Set
            </button>
            {!showEncore && encoreSongIds.length === 0 && (
              <button
                onClick={() => setShowEncore(true)}
                className="text-amber-500 hover:text-amber-400 hover:bg-amber-900/20 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
              >
                + Encore
              </button>
            )}

            {hasSongs && (
              <>
                <div className="w-px h-4 bg-slate-700 mx-1" />

                <button
                  onClick={handleFetchAllLyrics}
                  disabled={!!fetchProgress}
                  className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-900/30 disabled:text-slate-600 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                >
                  {fetchProgress ? 'Fetching...' : 'Fetch Lyrics'}
                </button>

                {songsWithLyrics > 0 && (
                  <>
                    <div className="w-px h-4 bg-slate-700 mx-1" />
                    <button
                      onClick={handleExportPDF}
                      className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/30 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                    >
                      Export PDF
                    </button>
                  </>
                )}

                <div className="flex-1" />

                {/* Stats */}
                <span className="text-[10px] text-slate-500 hidden md:inline">
                  {setListSongCount} in sets{additionalSongIds.length > 0 ? ` · ${additionalSongIds.length} additional` : ''}
                </span>

                <div className="w-px h-4 bg-slate-700 mx-1" />

                <button
                  onClick={() => { if (confirm('Clear entire set list and start fresh?')) { stopFetching(); onClearAll() } }}
                  className="text-slate-500 hover:text-red-400 hover:bg-red-900/20 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                >
                  Clear All
                </button>

                <button
                  onClick={() => {
                    if (confirm('WARNING: This will permanently delete ALL songs, lyrics, and cached data. This cannot be undone.\n\nAre you sure?')) {
                      if (confirm('Really delete everything? Your entire song library will be gone.')) {
                        stopFetching()
                        onClearAll()
                        // Wipe IndexedDB and localStorage
                        indexedDB.deleteDatabase('livelyrics_cache')
                        localStorage.removeItem('livelyrics_data')
                        window.location.reload()
                      }
                    }
                  }}
                  className="text-slate-600 hover:text-red-500 hover:bg-red-900/20 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-colors"
                >
                  Reset Library
                </button>
              </>
            )}
          </div>
        </div>

        {/* Error display */}
        {error && (
          <div className="max-w-2xl lg:max-w-[90rem] mx-auto px-4 mt-3">
            <div className="p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          </div>
        )}

        {/* Main two-column layout */}
        <div className="max-w-2xl lg:max-w-[90rem] mx-auto px-4 py-4">
          <div className="lg:flex lg:gap-6">
            {/* Left column — Set List */}
            <div className="flex-1 min-w-0">

              {/* Fetch progress */}
              {fetchProgress && (
                <div className="mb-4 p-3 bg-slate-800 rounded-lg">
                  <div className="flex justify-between text-sm text-slate-300 mb-1">
                    <span>
                      {fetchProgress.status === 'fetching' ? 'Fetching' : 'Done'}:
                      {' '}{fetchProgress.song}
                    </span>
                    <span>{fetchProgress.current}/{fetchProgress.total}</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-2">
                    <div
                      className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(fetchProgress.current / fetchProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Manual add form */}
              {addingManual && (
                <div className="mb-4 p-4 bg-slate-800 rounded-xl">
                  <h3 className="text-sm font-medium text-slate-300 mb-3">Add Song Manually</h3>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Song title"
                      value={manualTitle}
                      onChange={e => setManualTitle(e.target.value)}
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 text-sm"
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder="Artist"
                      value={manualArtist}
                      onChange={e => setManualArtist(e.target.value)}
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 text-sm"
                    />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setAddingManual(false)}
                      className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddManual}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {/* Sets and songs with Droppable zones */}
              {(hasSongs || sets.some(s => s.songIds.length > 0)) && sets.map((set, setIdx) => {
                const globalOffset = sets.slice(0, setIdx).reduce((sum, s) => sum + s.songIds.length, 0)
                return (
                  <div key={setIdx} className="mb-6">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-lg font-semibold text-slate-200">{set.name}</h2>
                      {(
                        <button
                          onClick={() => onRemoveSet(setIdx)}
                          className="text-xs text-slate-500 hover:text-red-400"
                        >
                          Remove set
                        </button>
                      )}
                    </div>

                    <Droppable droppableId={`set-${setIdx}`}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`space-y-2 min-h-[60px] rounded-lg transition-colors p-1 ${
                            snapshot.isDraggingOver
                              ? 'bg-indigo-900/20 border border-dashed border-indigo-500/50'
                              : set.songIds.length === 0
                                ? 'border border-dashed border-slate-700'
                                : ''
                          }`}
                        >
                          {set.songIds.length === 0 && !snapshot.isDraggingOver && (
                            <p className="text-sm text-slate-500 italic py-6 text-center">
                              Drag songs here to {set.name}
                            </p>
                          )}
                          {set.songIds.map((songId, songIdx) => {
                            const song = songs.find(s => s.id === songId)
                            if (!song) return null
                            return (
                              <Draggable key={songId} draggableId={songId} index={songIdx}>
                                {(dragProvided, dragSnapshot) => (
                                  <div
                                    ref={dragProvided.innerRef}
                                    {...dragProvided.draggableProps}
                                    {...dragProvided.dragHandleProps}
                                  >
                                    <SongCard
                                      song={song}
                                      index={globalOffset + songIdx}
                                      isDragging={dragSnapshot.isDragging}
                                      onEdit={() => setEditingSong(song)}
                                      onRemove={() => onRemoveSong(song.id)}
                                      onMoveUp={songIdx > 0 ? () => {
                                        const ids = [...set.songIds]
                                        ;[ids[songIdx - 1], ids[songIdx]] = [ids[songIdx], ids[songIdx - 1]]
                                        onSetSets(prev => prev.map((s, i) => i === setIdx ? { ...s, songIds: ids } : s))
                                      } : null}
                                      onMoveDown={songIdx < set.songIds.length - 1 ? () => {
                                        const ids = [...set.songIds]
                                        ;[ids[songIdx], ids[songIdx + 1]] = [ids[songIdx + 1], ids[songIdx]]
                                        onSetSets(prev => prev.map((s, i) => i === setIdx ? { ...s, songIds: ids } : s))
                                      } : null}
                                    />
                                  </div>
                                )}
                              </Draggable>
                            )
                          })}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  </div>
                )
              })}

              {/* Encore section — show when there are songs and encore is active */}
              {hasSongs && (encoreSongIds.length > 0 || showEncore) && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-lg font-semibold text-amber-400">Encore</h2>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">
                        {encoreSongIds.length} song{encoreSongIds.length !== 1 ? 's' : ''}
                      </span>
                      <button
                        onClick={() => {
                          if (encoreSongIds.length > 0) {
                            onSetAdditionalSongIds(prev => [...prev, ...encoreSongIds])
                          }
                          onSetEncoreSongIds([])
                          setShowEncore(false)
                        }}
                        className="text-xs text-slate-500 hover:text-red-400"
                      >
                        Remove encore
                      </button>
                    </div>
                  </div>

                  <Droppable droppableId="encore">
                    {(provided, snapshot) => {
                      const globalOffset = sets.reduce((sum, s) => sum + s.songIds.length, 0)
                      return (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`space-y-2 min-h-[60px] rounded-lg transition-colors p-1 ${
                            snapshot.isDraggingOver ? 'bg-amber-900/20 border border-dashed border-amber-500/50' : 'border border-dashed border-slate-700'
                          }`}
                        >
                          {encoreSongIds.length === 0 && !snapshot.isDraggingOver && (
                            <p className="text-sm text-slate-500 italic py-4 text-center">
                              Drag songs here from Additional Songs
                            </p>
                          )}
                          {encoreSongIds.map((songId, songIdx) => {
                            const song = songs.find(s => s.id === songId)
                            if (!song) return null
                            return (
                              <Draggable key={songId} draggableId={songId} index={songIdx}>
                                {(dragProvided, dragSnapshot) => (
                                  <div
                                    ref={dragProvided.innerRef}
                                    {...dragProvided.draggableProps}
                                    {...dragProvided.dragHandleProps}
                                  >
                                    <SongCard
                                      song={song}
                                      index={globalOffset + songIdx}
                                      isDragging={dragSnapshot.isDragging}
                                      onEdit={() => setEditingSong(song)}
                                      onRemove={() => onRemoveSong(song.id)}
                                      onMoveUp={songIdx > 0 ? () => {
                                        const ids = [...encoreSongIds]
                                        ;[ids[songIdx - 1], ids[songIdx]] = [ids[songIdx], ids[songIdx - 1]]
                                        onSetEncoreSongIds(ids)
                                      } : null}
                                      onMoveDown={songIdx < encoreSongIds.length - 1 ? () => {
                                        const ids = [...encoreSongIds]
                                        ;[ids[songIdx], ids[songIdx + 1]] = [ids[songIdx + 1], ids[songIdx]]
                                        onSetEncoreSongIds(ids)
                                      } : null}
                                    />
                                  </div>
                                )}
                              </Draggable>
                            )
                          })}
                          {provided.placeholder}
                        </div>
                      )
                    }}
                  </Droppable>
                </div>
              )}

              {/* Empty state */}
              {!hasSongs && (
                <div className="text-center py-16">
                  <div className="text-6xl mb-4">🎤</div>
                  <h2 className="text-xl font-medium text-slate-300 mb-2">No songs yet</h2>
                  <p className="text-slate-500">Upload a set list file or add songs manually</p>
                </div>
              )}
            </div>

            {/* Right column — Additional Songs (desktop only) */}
            <div className="hidden lg:block lg:w-[40rem] xl:w-[48rem] lg:sticky lg:top-20 lg:self-start shrink-0">
              <AdditionalSongsPanel
                songs={songs}
                additionalSongIds={additionalSongIds}
                onEdit={(song) => setEditingSong(song)}
                onRemove={(id) => onRemoveSong(id)}
                onAddSongs={onAddSongsToAdditional}
              />
            </div>
          </div>
        </div>

        {/* Lyrics editor modal */}
        {editingSong && (
          <LyricsEditor
            song={editingSong}
            onSave={(updates) => {
              onUpdateSong(editingSong.id, updates)
              setEditingSong(null)
            }}
            onClose={() => setEditingSong(null)}
          />
        )}

        {/* Publish to Cloud dialog */}
        {publishDialog && (
          <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
            <div className="bg-slate-800 rounded-xl max-w-md w-full p-6 border border-slate-700">
              {publishDialog === 'token' && (
                <>
                  <h2 className="text-lg font-bold text-cyan-400 mb-3">GitHub Token Required</h2>
                  <p className="text-sm text-slate-300 mb-4">
                    To publish to the cloud, you need a GitHub Personal Access Token.
                  </p>
                  <ol className="text-xs text-slate-400 space-y-1 mb-4 list-decimal list-inside">
                    <li>Go to <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener" className="text-cyan-400 underline">github.com/settings/tokens/new</a></li>
                    <li>Name: "LiveLyrics Publish"</li>
                    <li>Select scope: <strong>repo</strong> (or just <strong>public_repo</strong>)</li>
                    <li>Click "Generate token" and copy it</li>
                  </ol>
                  <input
                    type="password"
                    placeholder="Paste your token here"
                    value={githubToken}
                    onChange={e => setGithubToken(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm mb-3 focus:outline-none focus:border-cyan-500"
                  />
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setPublishDialog(null)}
                      className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveToken}
                      disabled={!githubToken}
                      className="bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
                    >
                      Save & Publish
                    </button>
                  </div>
                </>
              )}
              {publishDialog === 'publishing' && (
                <div className="text-center py-4">
                  <div className="text-cyan-400 text-lg font-bold mb-2">Publishing...</div>
                  <p className="text-sm text-slate-400">Uploading to GitHub Pages</p>
                  <div className="mt-4 w-full h-1 bg-slate-700 rounded overflow-hidden">
                    <div className="h-full bg-cyan-500 animate-pulse w-full" />
                  </div>
                </div>
              )}
              {publishDialog === 'success' && (
                <>
                  <h2 className="text-lg font-bold text-emerald-400 mb-3">✓ Published!</h2>
                  <p className="text-sm text-slate-300 mb-4">
                    Your set list is live at this URL (may take 30-60 seconds to update):
                  </p>
                  <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 mb-4 break-all">
                    <a href={publishURL} target="_blank" rel="noopener" className="text-cyan-400 text-sm font-mono">
                      {publishURL}
                    </a>
                  </div>
                  <div className="text-center mb-4">
                    <p className="text-xs text-slate-400 mb-2">Scan on your tablet:</p>
                    <img
                      src={qrCodeSrc(publishURL)}
                      alt="QR code"
                      className="mx-auto bg-white p-2 rounded-lg"
                      width="180"
                      height="180"
                    />
                  </div>
                  <div className="text-xs text-slate-500 mb-4">
                    <p className="font-semibold text-slate-400 mb-1">On your tablet:</p>
                    <ol className="list-decimal list-inside space-y-0.5">
                      <li>Open the URL in Chrome</li>
                      <li>Tap the menu (⋮) → "Add to Home screen"</li>
                      <li>Works offline after first load</li>
                      <li>Mic & wake lock work because it's HTTPS</li>
                    </ol>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(publishURL)
                      }}
                      className="px-4 py-2 text-sm text-slate-300 hover:text-white bg-slate-700 rounded-lg"
                    >
                      Copy URL
                    </button>
                    <button
                      onClick={() => setPublishDialog(null)}
                      className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
                    >
                      Done
                    </button>
                  </div>
                </>
              )}
              {publishDialog === 'error' && (
                <>
                  <h2 className="text-lg font-bold text-red-400 mb-3">Publish Failed</h2>
                  <p className="text-sm text-slate-300 mb-4">{publishError}</p>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setPublishDialog('token')}
                      className="px-4 py-2 text-sm text-slate-400 hover:text-white"
                    >
                      Change Token
                    </button>
                    <button
                      onClick={() => setPublishDialog(null)}
                      className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm"
                    >
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </DragDropContext>
  )
}
