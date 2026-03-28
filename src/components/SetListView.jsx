import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseFile } from '../utils/fileParser'
import { fetchAllLyrics } from '../utils/lyricsService'
import { getCacheCount, getCachedLyrics } from '../utils/lyricsCache'
import SongCard from './SongCard'
import LyricsEditor from './LyricsEditor'

export default function SetListView({
  songs, sets, onAddSong, onUpdateSong, onRemoveSong,
  onMoveSong, onAddSet, onRemoveSet, onClearAll, onSetSongs, onSetSets
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

  // Load cache count on mount and after fetches
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

      // Clear existing and add parsed songs
      onClearAll()

      // Create required sets
      const maxSet = Math.max(...parsed.map(s => s.setIndex))
      const newSets = Array.from({ length: maxSet + 1 }, (_, i) => ({
        name: `Set ${i + 1}`,
        songIds: []
      }))

      // Create songs and check cache for each
      const newSongs = await Promise.all(parsed.map(async (s) => {
        const cached = s.artist ? await getCachedLyrics(s.artist, s.title) : null
        return {
          id: Date.now().toString() + Math.random().toString(36).slice(2),
          title: s.title,
          artist: s.artist,
          lyrics: cached || '',
          lyricsStatus: cached ? 'cached' : (s.needsAttention ? 'attention' : 'pending'),
          setIndex: s.setIndex,
          needsAttention: s.needsAttention || false,
          rawTitle: s.rawTitle || ''
        }
      }))

      // Build set songIds
      newSongs.forEach(song => {
        newSets[song.setIndex].songIds.push(song.id)
      })

      onSetSongs(newSongs)
      onSetSets(newSets)

      // Refresh cache count
      getCacheCount().then(setCachedCount)
    } catch (err) {
      setError(err.message)
    }

    // Reset file input
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

  const handleFetchAllLyrics = async () => {
    // Fetch lyrics for songs that have an artist but no lyrics yet
    // Skip medleys/attention songs (user needs to set them up manually)
    const songsToFetch = songs.filter(s =>
      s.artist && s.title &&
      !s.needsAttention &&
      (!s.lyrics || s.lyricsStatus === 'pending' || s.lyricsStatus === 'failed')
    )
    if (songsToFetch.length === 0) return

    setFetchProgress({ current: 0, total: songsToFetch.length, song: '', status: '' })

    const results = await fetchAllLyrics(songsToFetch, (current, total, songTitle, status) => {
      setFetchProgress({ current, total, song: songTitle, status })
    })

    // Update songs with fetched lyrics
    results.forEach(r => {
      if (r.lyrics) {
        onUpdateSong(r.id, { lyrics: r.lyrics, lyricsStatus: r.status })
      } else if (r.status === 'failed') {
        onUpdateSong(r.id, { lyricsStatus: 'failed' })
      }
    })

    setFetchProgress(null)
  }

  const hasSongs = songs.length > 0
  const songsWithLyrics = songs.filter(s => s.lyrics).length
  const songsWithoutLyrics = songs.filter(s => !s.lyrics).length
  const canPerform = hasSongs && songsWithLyrics > 0
  const offlineReady = hasSongs && songsWithoutLyrics === 0

  return (
    <div className="min-h-screen bg-slate-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur border-b border-slate-700 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-indigo-400">LiveLyrics</h1>
            <p className="text-sm text-slate-400">
              {hasSongs
                ? `${songs.length} songs, ${songsWithLyrics} with lyrics${cachedCount > 0 ? ` · ${cachedCount} in library` : ''}`
                : 'Upload your set list to get started'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {offlineReady && (
              <span className="text-xs bg-emerald-900/60 text-emerald-300 px-2.5 py-1 rounded-full border border-emerald-700">
                Offline Ready
              </span>
            )}
            {canPerform && (
              <button
                onClick={() => navigate('/perform')}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl font-semibold text-lg transition-colors"
              >
                Perform
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Upload area */}
        <div className="mb-6">
          <div className="border-2 border-dashed border-slate-600 rounded-xl p-6 text-center hover:border-indigo-500 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv,.docx,.pdf,.txt"
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <div className="text-4xl mb-2">📋</div>
              <p className="text-lg font-medium text-slate-200">Upload Set List</p>
              <p className="text-sm text-slate-400 mt-1">Excel, Word, PDF, CSV, or TXT file</p>
            </label>
          </div>

          {error && (
            <div className="mt-3 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-200 text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Actions bar */}
        {hasSongs && (
          <div className="flex flex-wrap gap-2 mb-4">
            <button
              onClick={handleFetchAllLyrics}
              disabled={!!fetchProgress}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {fetchProgress ? 'Fetching...' : 'Fetch All Lyrics'}
            </button>
            <button
              onClick={() => setAddingManual(true)}
              className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              + Add Song
            </button>
            <button
              onClick={onAddSet}
              className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              + Add Set
            </button>
            <button
              onClick={() => { if (confirm('Clear entire set list?')) onClearAll() }}
              className="bg-slate-700 hover:bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors ml-auto"
            >
              Clear All
            </button>
          </div>
        )}

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

        {/* Sets and songs — only show when there are songs */}
        {hasSongs && sets.some(s => s.songIds.length > 0) && sets.map((set, setIdx) => {
          // Compute global song offset for continuous numbering
          const globalOffset = sets.slice(0, setIdx).reduce((sum, s) => sum + s.songIds.length, 0)
          return (
          <div key={setIdx} className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold text-slate-200">{set.name}</h2>
              {sets.length > 1 && (
                <button
                  onClick={() => onRemoveSet(setIdx)}
                  className="text-xs text-slate-500 hover:text-red-400"
                >
                  Remove set
                </button>
              )}
            </div>

            {set.songIds.length === 0 ? (
              <p className="text-sm text-slate-500 italic py-4 text-center">No songs in this set</p>
            ) : (
              <div className="space-y-2">
                {set.songIds.map((songId, songIdx) => {
                  const song = songs.find(s => s.id === songId)
                  if (!song) return null
                  return (
                    <SongCard
                      key={song.id}
                      song={song}
                      index={globalOffset + songIdx}
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
                  )
                })}
              </div>
            )}
          </div>
          )
        })}

        {/* Empty state */}
        {!hasSongs && (
          <div className="text-center py-16">
            <div className="text-6xl mb-4">🎤</div>
            <h2 className="text-xl font-medium text-slate-300 mb-2">No songs yet</h2>
            <p className="text-slate-500">Upload a set list file or add songs manually</p>
          </div>
        )}
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
    </div>
  )
}
