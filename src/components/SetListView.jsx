import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { parseFile } from '../utils/fileParser'
import { exportForTablet } from '../utils/exportTablet'
import { exportSetListPDF } from '../utils/exportPDF'
import { publishToCloud, getStoredToken, setStoredToken, getPublicURL, qrCodeSrc } from '../utils/publishToCloud'
import { fetchAllLyrics, needsServerData, needsSongDetails } from '../utils/lyricsService'
import { getCacheCount, findCachedLyrics, getAllCachedSongs, deleteCachedSong } from '../utils/lyricsCache'
import { findExistingSong, normalizeTitle } from '../utils/songMatch'
import { factoryReset } from '../utils/factoryReset'
import { exportLibrary, importLibrary } from '../utils/libraryBackup'
import { totalDuration, missingTimeHint } from '../utils/duration'
import SongCard from './SongCard'
import LyricsEditor from './LyricsEditor'
import AdditionalSongsPanel from './AdditionalSongsPanel'
import ConfirmDialog from './ConfirmDialog'

export default function SetListView({
  songs, sets, encoreSongIds, additionalSongIds,
  onAddSong, onUpdateSong, onRemoveSong,
  onMoveSong, onAddSet, onRemoveSet, onClearSetList, onDragEnd,
  onAddSongsToAdditional, onSetSongs, onSetSets, onSetEncoreSongIds, onSetAdditionalSongIds
}) {
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const restoreInputRef = useRef(null)
  const [editingSong, setEditingSong] = useState(null)
  const [fetchProgress, setFetchProgress] = useState(null)
  const [addingManual, setAddingManual] = useState(false)
  const [manualTitle, setManualTitle] = useState('')
  const [manualArtist, setManualArtist] = useState('')
  const [error, setError] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [libraryEntries, setLibraryEntries] = useState(null) // null = closed
  const [librarySearch, setLibrarySearch] = useState('')
  const [confirmState, setConfirmState] = useState(null)
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

  // Promise-based stand-in for window.confirm(), which silently returns false
  // wherever dialogs are suppressed.
  const askConfirm = (opts) => new Promise((resolve) => {
    setConfirmState({
      ...opts,
      resolve: (answer) => { setConfirmState(null); resolve(answer) }
    })
  })

  const openLibrary = async () => {
    setLibrarySearch('')
    setLibraryEntries(await getAllCachedSongs())
  }

  // Delete one song's saved lyrics. Also drops the song from the current set
  // list if it's sitting there, so the two views don't disagree.
  const deleteFromLibrary = async (entry) => {
    const ok = await askConfirm({
      title: `Delete "${entry.title}"?`,
      message: 'This removes its saved lyrics permanently. Other songs are not affected.',
      confirmLabel: 'Delete song'
    })
    if (!ok) return

    await deleteCachedSong(entry.artist, entry.title)
    const match = findExistingSong({ title: entry.title, artist: entry.artist }, songs)
    if (match) onRemoveSong(match.id)
    setLibraryEntries(await getAllCachedSongs())
    getCacheCount().then(setCachedCount)
  }

  const handleBackup = async () => {
    try {
      const r = await exportLibrary({ songs, sets, encoreSongIds, additionalSongIds })
      setImportStatus(`Backed up ${r.songs} songs and ${r.library} saved lyrics`)
      setTimeout(() => setImportStatus(''), 4000)
    } catch (err) {
      setError(`Backup failed: ${err.message}`)
    }
  }

  const handleRestore = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setError('')
    setImportStatus('Restoring backup…')
    try {
      const r = await importLibrary(file)
      if (r.setList) {
        onSetSongs(r.setList.songs)
        onSetSets(r.setList.sets)
        onSetEncoreSongIds(r.setList.encoreSongIds)
        onSetAdditionalSongIds(r.setList.additionalSongIds)
      }
      getCacheCount().then(setCachedCount)
      setImportStatus(
        `Restored ${r.restoredLyrics} songs' lyrics` +
        (r.exportedAt ? ` from the backup made ${new Date(r.exportedAt).toLocaleDateString()}` : '')
      )
      setTimeout(() => setImportStatus(''), 5000)
    } catch (err) {
      setError(err.message)
      setImportStatus('')
    }
    if (restoreInputRef.current) restoreInputRef.current.value = ''
  }

  const handleAddManual = async (toAdditional = false) => {
    const title = manualTitle.trim()
    if (!title) return
    const artist = manualArtist.trim()

    // If the library already has these lyrics, attach them now rather than
    // making the user fetch a song we already have.
    const cached = await findCachedLyrics(artist, title)

    const added = onAddSong(
      { title, artist, lyrics: cached || '', setIndex: sets.length - 1 },
      { toAdditional }
    )

    if (!added) {
      // addSong returns null for a song we already have — say so instead of
      // appearing to do nothing.
      setError(`"${title}" is already in your library.`)
      setTimeout(() => setError(''), 4000)
      return
    }

    setManualTitle('')
    setManualArtist('')
    setAddingManual(false)
    if (cached) {
      setImportStatus(`Added "${title}" with lyrics from your library`)
      setTimeout(() => setImportStatus(''), 3000)
    }
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
          if (r.discoveredArtist) updates.artist = r.discoveredArtist
          // Only apply canonical corrections for English songs — Hebrew
          // titles come from the user's set list and should never be touched
          const song = songs.find(s => s.id === r.id)
          const hasHebrew = (s) => /[֐-׿]/.test(s || '')
          if (r.canonicalTitle && song && !hasHebrew(song.title)) {
            updates.title = r.canonicalTitle
          }
          if (r.canonicalArtist && song && !hasHebrew(song.artist)) {
            updates.artist = r.canonicalArtist
          }
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
      (!s.lyrics ||
        s.lyricsStatus === 'pending' ||
        s.lyricsStatus === 'attention' ||
        s.lyricsStatus === 'failed' ||
        // Same predicates fetchAllLyrics uses internally, so the two can't
        // disagree: songs with no words, and songs whose words are here but
        // whose running time is not.
        needsServerData(s) ||
        needsSongDetails(s))
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

  const handleExportPDF = async () => {
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
    // Async because a Hebrew set list has to embed a Unicode font first.
    try {
      setImportStatus('Building PDF…')
      await exportSetListPDF(orderedSets)
    } catch (err) {
      setError(`PDF export failed: ${err.message}`)
    } finally {
      setImportStatus('')
    }
  }

  const hasSongs = songs.length > 0
  const failedCount = songs.filter(s => s.lyricsStatus === 'failed').length
  const songsWithLyrics = songs.filter(s => s.lyrics).length
  const setListSongCount = sets.reduce((sum, s) => sum + s.songIds.length, 0)
  // Whole show: every set plus the encore, ignoring the reserve pile.
  const showTotal = totalDuration(
    [...sets.flatMap(s => s.songIds), ...encoreSongIds]
      .map(id => songs.find(s => s.id === id))
      .filter(Boolean)
  )
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
                  {setListSongCount} in sets
                  {showTotal.known > 0 && (
                    <span
                      className="text-slate-400"
                      title={missingTimeHint(showTotal)}
                    >
                      {' · '}{showTotal.formatted}{showTotal.missing > 0 ? ` +${showTotal.missing}?` : ''}
                    </span>
                  )}
                  {additionalSongIds.length > 0 ? ` · ${additionalSongIds.length} additional` : ''}
                </span>

                <div className="w-px h-4 bg-slate-700 mx-1" />

                <button
                  onClick={async () => {
                    // Count what's actually in the sets and encore — `songs` is
                    // the whole library, most of which is already in Additional
                    // and isn't going anywhere.
                    const moving = setListSongCount + encoreSongIds.length
                    const ok = await askConfirm({
                      title: 'Clear the set list?',
                      message:
                        `The ${moving} song${moving === 1 ? '' : 's'} in your sets` +
                        `${encoreSongIds.length ? ' and encore' : ''} move to Additional Songs, ` +
                        `keeping their lyrics, so you can drag them into a new set list. Nothing is deleted.`,
                      confirmLabel: 'Clear set list'
                    })
                    if (ok) { stopFetching(); onClearSetList() }
                  }}
                  title="Empties the sets and encore — songs move to Additional Songs, nothing is deleted"
                  className="text-slate-500 hover:text-amber-400 hover:bg-amber-900/20 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors"
                >
                  Clear Set List
                </button>

                <button
                  onClick={async () => {
                    const ok = await askConfirm({
                      title: 'Factory Reset',
                      message: 'This returns the app to a fresh install. It cannot be undone.',
                      bullets: [
                        `All ${songs.length} songs and the set list`,
                        `The whole lyrics library (${cachedCount} saved)`,
                        'Your saved GitHub publish token',
                        'Offline cached app files'
                      ],
                      confirmLabel: 'Erase everything',
                      requireText: 'DELETE'
                    })
                    if (!ok) return

                    stopFetching()
                    setImportStatus('Erasing all data…')
                    // Deliberately no state updates before the reload: touching
                    // React state here would re-save the set list to
                    // localStorage right after we cleared it.
                    await factoryReset()
                    window.location.reload()
                  }}
                  title="Delete all songs, lyrics and settings — returns the app to a fresh install"
                  className="text-slate-600 hover:text-red-500 hover:bg-red-900/20 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-colors"
                >
                  Factory Reset
                </button>
              </>
            )}

            <button
              onClick={openLibrary}
              title="Browse every song with saved lyrics, and delete them one at a time"
              className="text-slate-500 hover:text-sky-300 hover:bg-sky-900/20 px-2.5 py-1.5 rounded-md text-[10px] font-medium transition-colors"
            >
              Library{cachedCount ? ` (${cachedCount})` : ''}
            </button>
          </div>
        </div>

        <input
          ref={restoreInputRef}
          type="file"
          accept=".json"
          onChange={handleRestore}
          className="hidden"
        />

        {confirmState && (
          <ConfirmDialog
            title={confirmState.title}
            message={confirmState.message}
            bullets={confirmState.bullets}
            confirmLabel={confirmState.confirmLabel}
            requireText={confirmState.requireText}
            onResolve={confirmState.resolve}
          />
        )}

        {/* Library manager — every song with saved lyrics, deletable one by one.
            Songs can live here without being in the current set list, so this is
            the only place some of them are reachable. */}
        {libraryEntries && (
          <div
            className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
            onClick={() => setLibraryEntries(null)}
          >
            <div
              className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-lg max-h-[80vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-slate-100 font-semibold">
                    Song Library
                    <span className="text-slate-400 text-sm font-normal ml-2">
                      {libraryEntries.length} {libraryEntries.length === 1 ? 'song' : 'songs'}
                    </span>
                  </h2>
                  <button
                    onClick={() => setLibraryEntries(null)}
                    className="text-slate-400 hover:text-slate-100 px-2"
                  >
                    ✕
                  </button>
                </div>
                <input
                  type="text"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                  placeholder="Search by title or artist…"
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500"
                />

                {/* The library only exists in this browser — give it somewhere
                    safe to live outside it. */}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleBackup}
                    title="Save every song, set list and saved lyric to a file you can keep"
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                  >
                    ⬇ Back up to file
                  </button>
                  <button
                    onClick={() => restoreInputRef.current?.click()}
                    title="Restore from a backup file — merges into what you already have"
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-100 text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                  >
                    ⬆ Restore from file
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto p-2">
                {libraryEntries.length === 0 && (
                  <p className="text-slate-400 text-sm p-4 text-center">
                    No saved lyrics yet. Fetch lyrics for a set list and they'll appear here.
                  </p>
                )}
                {libraryEntries
                  .filter(e => {
                    const q = librarySearch.toLowerCase().trim()
                    if (!q) return true
                    return (e.title || '').toLowerCase().includes(q) ||
                           (e.artist || '').toLowerCase().includes(q)
                  })
                  .map(e => (
                    <div
                      key={e.key}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg hover:bg-slate-700/50"
                    >
                      <div className="min-w-0">
                        <div dir="auto" className="text-slate-100 text-sm break-words leading-snug">{e.title}</div>
                        <div dir="auto" className="text-slate-400 text-xs break-words leading-snug">
                          {e.artist || 'Unknown artist'} · {(e.lyrics || '').length} chars
                        </div>
                      </div>
                      <button
                        onClick={() => deleteFromLibrary(e)}
                        title={`Delete "${e.title}" from the library`}
                        className="text-slate-500 hover:text-red-400 hover:bg-red-900/20 px-2 py-1 rounded shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

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
                    {/* dir="auto" so a Hebrew title types and displays right-to-left */}
                    <input
                      type="text"
                      dir="auto"
                      placeholder="Song title"
                      value={manualTitle}
                      onChange={e => setManualTitle(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddManual(false) }}
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 text-sm"
                      autoFocus
                    />
                    <input
                      type="text"
                      dir="auto"
                      placeholder="Artist (optional)"
                      value={manualArtist}
                      onChange={e => setManualArtist(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddManual(false) }}
                      className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white placeholder-slate-400 text-sm"
                    />
                  </div>
                  <p className="text-xs text-slate-500 mb-3">
                    The artist is optional — lyrics can be found from the title alone.
                    Hebrew titles work; use the Hebrew spelling rather than a transliteration.
                  </p>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setAddingManual(false)}
                      className="px-3 py-1.5 text-sm text-slate-400 hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleAddManual(true)}
                      title="Add to Additional Songs instead of the running order"
                      className="bg-slate-700 hover:bg-slate-600 text-slate-100 px-4 py-1.5 rounded-lg text-sm font-medium"
                    >
                      Add to library
                    </button>
                    <button
                      onClick={() => handleAddManual(false)}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-1.5 rounded-lg text-sm font-medium"
                    >
                      Add to {sets.length ? sets[sets.length - 1].name : 'Set 1'}
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
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <h2 className="text-lg font-semibold text-slate-200">{set.name}</h2>
                        {(() => {
                          const t = totalDuration(set.songIds.map(id => songs.find(s => s.id === id)).filter(Boolean))
                          if (!t.known) return null
                          return (
                            <span
                              className="text-xs text-slate-400 tabular-nums"
                              title={missingTimeHint(t)}
                            >
                              {t.formatted}
                              {t.missing > 0 && <span className="text-slate-500"> +{t.missing}?</span>}
                            </span>
                          )
                        })()}
                      </div>
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
                        {(() => {
                          const t = totalDuration(encoreSongIds.map(id => songs.find(s => s.id === id)).filter(Boolean))
                          return t.known ? <span className="text-slate-400 tabular-nums"> · {t.formatted}{t.missing > 0 ? ` +${t.missing}?` : ''}</span> : null
                        })()}
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
                onRemove={async (id) => {
                  // Destructive here, unlike the ✕ on a song in a set (which
                  // just moves it back to this panel).
                  const song = songs.find(s => s.id === id)
                  const ok = await askConfirm({
                    title: `Delete "${song?.title || 'this song'}" from the library?`,
                    message: 'This removes the song and its saved lyrics permanently. Other songs are not affected.',
                    confirmLabel: 'Delete song'
                  })
                  if (ok) onRemoveSong(id)
                }}
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
              if (!updates.lyrics?.trim()) {
                deleteCachedSong(editingSong.artist, editingSong.title)
                if (updates.title || updates.artist) {
                  deleteCachedSong(updates.artist || editingSong.artist, updates.title || editingSong.title)
                }
                updates.lyricsStatus = 'pending'
              }
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
