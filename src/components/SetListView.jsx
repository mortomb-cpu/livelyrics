import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { parseFile } from '../utils/fileParser'
import { exportForTablet } from '../utils/exportTablet'
import { exportSetListPDF } from '../utils/exportPDF'
import { publishToCloud, getStoredToken, setStoredToken, getPublicURL, qrCodeSrc } from '../utils/publishToCloud'
import { fetchAllLyrics } from '../utils/lyricsService'
import { getCacheCount, findCachedLyrics } from '../utils/lyricsCache'
import { findExistingSong, normalizeTitle } from '../utils/songMatch'
import SongCard from './SongCard'
import LyricsEditor from './LyricsEditor'
import AdditionalSongsPanel from './AdditionalSongsPanel'

export default function SetListView({
  songs, sets, encoreSongIds, additionalSongIds,
  onAddSong, onUpdateSong, onRemoveSong,
  onMoveSong, onAddSet, onRemoveSet, onClearSetList, onDeleteEverything, onDragEnd,
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
  const [importStatus, setImportStatus] = useState('')
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
    setImportStatus('Reading file…')

    try {
      const parsed = await parseFile(file, setImportStatus)
      if (parsed.length === 0) {
        setError('No songs found in file. Check the format and try again.')
        return
      }

      // Songs under an "Encore" / "Backup" heading are tagged by the parser and
      // routed to their own zones instead of being dropped on import.
      const setOnly = parsed.filter(s => (s.section || 'set') === 'set')
      const maxSet = setOnly.length ? Math.max(...setOnly.map(s => s.setIndex)) : 0
      const newSets = Array.from({ length: maxSet + 1 }, (_, i) => ({
        name: `Set ${i + 1}`,
        songIds: []
      }))
      const newEncoreIds = []
      const importedAdditionalIds = []

      // Deduplicate within the parsed file itself
      const seenInParsed = new Set()
      const dedupedParsed = parsed.filter(s => {
        const key = normalizeTitle(s.title)
        if (!key || seenInParsed.has(key)) return false
        seenInParsed.add(key)
        return true
      })

      // Match against the WHOLE library, not just Additional Songs. A song that
      // was already in a set keeps its lyrics, BPM, synced timings and any
      // hand-edits when it appears in the new file — previously those songs were
      // discarded and rebuilt from scratch.
      const reusedIds = new Set()
      const newSongs = []
      const artistFills = new Map() // existing song id -> artist learned from this file

      for (const s of dedupedParsed) {
        const existing = findExistingSong(s, songs, reusedIds)

        const section = s.section || 'set'
        const placeId = (id) => {
          if (section === 'encore') newEncoreIds.push(id)
          else if (section === 'additional') importedAdditionalIds.push(id)
          else newSets[s.setIndex].songIds.push(id)
        }

        if (existing) {
          reusedIds.add(existing.id)
          // The file may name an artist the library was missing.
          if (!existing.artist && s.artist) artistFills.set(existing.id, s.artist)
          placeId(existing.id)
        } else {
          // Genuinely new song — create it, seeded from the lyrics library
          const cached = await findCachedLyrics(s.artist, s.title)
          const newSong = {
            id: Date.now().toString() + Math.random().toString(36).slice(2),
            title: s.title,
            artist: s.artist,
            lyrics: cached || '',
            lyricsStatus: cached ? 'cached' : (s.needsAttention ? 'attention' : 'pending'),
            setIndex: s.setIndex,
            needsAttention: s.needsAttention || false,
            isMedley: s.isMedley || false,
            rawTitle: s.rawTitle || ''
          }
          newSongs.push(newSong)
          placeId(newSong.id)
        }
      }

      // Everything the new file didn't mention stays in the library, parked in
      // Additional Songs — importing a set list never deletes songs.
      const remainingAdditional = songs.filter(s => !reusedIds.has(s.id)).map(s => s.id)

      const keptSongs = songs.map(s =>
        artistFills.has(s.id) ? { ...s, artist: artistFills.get(s.id) } : s
      )
      onSetSongs([...keptSongs, ...newSongs])
      onSetSets(newSets)
      onSetEncoreSongIds(newEncoreIds)
      onSetAdditionalSongIds([...new Set([...remainingAdditional, ...importedAdditionalIds])])
      getCacheCount().then(setCachedCount)
    } catch (err) {
      setError(err.message)
    } finally {
      setImportStatus('')
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

  const runFetch = async (songsToFetch) => {
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
          // Lyrics arrived, so whatever the file was missing no longer matters —
          // clear the amber "Needs info" flag.
          const updates = { lyrics: r.lyrics, lyricsStatus: r.status, needsAttention: false }
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

  // A song is fetchable as long as it has a real title. Only medleys ("A + B + C")
  // are skipped, since they're compound entries the user has to split by hand.
  // Note: we deliberately do NOT skip `needsAttention` songs — that flag only means
  // "title wasn't in the 220-song lookup table and the file had no artist column",
  // which describes most of a modern set list. The lyrics API resolves by title
  // alone just fine, so skipping them meant nothing got fetched at all.
  const isFetchable = (s) => s.title && !s.isMedley

  const handleFetchAllLyrics = () => {
    runFetch(songs.filter(s =>
      isFetchable(s) &&
      (!s.lyrics || s.lyricsStatus === 'pending' || s.lyricsStatus === 'attention' || s.lyricsStatus === 'failed')
    ))
  }

  // Re-fetch only the songs that failed last time (most failures are transient
  // timeouts, so a targeted retry usually fills them in).
  const handleRetryFailed = () => {
    runFetch(songs.filter(s =>
      isFetchable(s) && s.lyricsStatus === 'failed'
    ))
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
    ].filter(set => set.songs.length > 0)

    if (orderedSets.length === 0) return

    // Generate a real, text-layer PDF directly (no browser print dialog, so the
    // output is always a true PDF rather than an image from "Print to PDF").
    exportSetListPDF(orderedSets)
  }

  const hasSongs = songs.length > 0
  const failedCount = songs.filter(s => s.lyricsStatus === 'failed').length
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

                {failedCount > 0 && !fetchProgress && (
                  <button
                    onClick={handleRetryFailed}
                    title="Re-fetch only the songs that failed (usually transient timeouts)"
                    className="text-amber-400 hover:text-amber-300 hover:bg-amber-900/30 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                  >
                    Retry {failedCount} failed
                  </button>
                )}

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
                  onClick={() => {
                    if (confirm(
                      `Clear the set list?\n\nAll ${songs.length} songs (and their lyrics) move to Additional Songs, ` +
                      `so you can drag them into a new set list. Nothing is deleted.`
                    )) { stopFetching(); onClearSetList() }
                  }}
                  title="Empties the sets and encore — songs move to Additional Songs, nothing is deleted"
                  className="text-slate-500 hover:text-amber-400 hover:bg-amber-900/20 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                >
                  Clear Set List
                </button>

                <button
                  onClick={() => {
                    if (confirm('WARNING: This will permanently delete ALL songs, lyrics, and cached data. This cannot be undone.\n\nAre you sure?')) {
                      if (confirm('Really delete everything? Your entire song library will be gone.')) {
                        stopFetching()
                        onDeleteEverything()
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

        {/* Import status — OCR on an image-only PDF takes a few seconds per page */}
        {importStatus && (
          <div className="max-w-2xl lg:max-w-[90rem] mx-auto px-4 mt-3">
            <div className="p-3 bg-sky-900/40 border border-sky-700 rounded-lg text-sky-200 text-sm flex items-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-sky-300 border-t-transparent rounded-full animate-spin" />
              {importStatus}
            </div>
          </div>
        )}

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
