import { Routes, Route } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import SetListView from './components/SetListView'
import PerformView from './components/PerformView'

const STORAGE_KEY = 'livelyrics_data'

function App() {
  const [songs, setSongs] = useState([])
  const [sets, setSets] = useState([{ name: 'Set 1', songIds: [] }])
  const [encoreSongIds, setEncoreSongIds] = useState([])
  const [additionalSongIds, setAdditionalSongIds] = useState([])
  const [loaded, setLoaded] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        if (data.songs?.length) setSongs(data.songs)
        if (data.sets?.length) setSets(data.sets)
        if (data.encoreSongIds?.length) setEncoreSongIds(data.encoreSongIds)
        if (data.additionalSongIds?.length) setAdditionalSongIds(data.additionalSongIds)
      }
    } catch (e) {
      console.error('Failed to load saved data:', e)
    }
    setLoaded(true)
  }, [])

  // Save to localStorage on change
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ songs, sets, encoreSongIds, additionalSongIds }))
    } catch (e) {
      console.error('Failed to save data:', e)
    }
  }, [songs, sets, encoreSongIds, additionalSongIds, loaded])

  // Check if a song already exists (by normalized title + artist)
  const isDuplicate = (title, artist) => {
    const normTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '')
    const normArtist = (artist || '').toLowerCase().replace(/[^a-z0-9]/g, '')
    return songs.some(s => {
      const sTitle = s.title.toLowerCase().replace(/[^a-z0-9]/g, '')
      const sArtist = (s.artist || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      // Match by title alone, or title + artist if both have artists
      return sTitle === normTitle && (!normArtist || !sArtist || sArtist === normArtist)
    })
  }

  const addSong = (song) => {
    if (isDuplicate(song.title, song.artist)) return null
    const newSong = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      title: song.title,
      artist: song.artist,
      lyrics: song.lyrics || '',
      lyricsStatus: song.lyrics ? 'manual' : 'pending',
      setIndex: song.setIndex ?? 0,
      needsAttention: song.needsAttention || false,
      rawTitle: song.rawTitle || ''
    }
    setSongs(prev => [...prev, newSong])

    setSets(prev => {
      const updated = [...prev]
      const idx = newSong.setIndex
      while (updated.length <= idx) {
        updated.push({ name: `Set ${updated.length + 1}`, songIds: [] })
      }
      updated[idx] = {
        ...updated[idx],
        songIds: [...updated[idx].songIds, newSong.id]
      }
      return updated
    })

    return newSong
  }

  const updateSong = (id, updates) => {
    setSongs(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }

  // Remove song from set/encore → moves to additional (song stays in library)
  // Remove song from additional → deletes permanently
  const removeSong = (id) => {
    const isInAdditional = additionalSongIds.includes(id)
    const isInSet = sets.some(s => s.songIds.includes(id))
    const isInEncore = encoreSongIds.includes(id)

    if (isInAdditional) {
      // Removing from additional = remove from view only, lyrics stay in IndexedDB cache
      setSongs(prev => prev.filter(s => s.id !== id))
      setAdditionalSongIds(prev => prev.filter(sid => sid !== id))
    } else if (isInSet || isInEncore) {
      // Removing from set/encore = move to additional
      setSets(prev => prev.map(set => ({
        ...set,
        songIds: set.songIds.filter(sid => sid !== id)
      })))
      setEncoreSongIds(prev => prev.filter(sid => sid !== id))
      setAdditionalSongIds(prev => [...prev, id])
    }
  }

  const moveSong = (songId, fromSetIdx, toSetIdx, newPosition) => {
    setSets(prev => {
      const updated = prev.map(s => ({ ...s, songIds: [...s.songIds] }))
      updated[fromSetIdx].songIds = updated[fromSetIdx].songIds.filter(id => id !== songId)
      updated[toSetIdx].songIds.splice(newPosition, 0, songId)
      return updated
    })
  }

  const addSet = () => {
    setSets(prev => [...prev, { name: `Set ${prev.length + 1}`, songIds: [] }])
  }

  const removeSet = (idx) => {
    setSets(prev => {
      const removed = prev[idx]
      const updated = prev.filter((_, i) => i !== idx)
      // Move songs from deleted set back to additional
      if (removed.songIds.length > 0) {
        setAdditionalSongIds(prev => [...prev, ...removed.songIds])
      }
      return updated
    })
  }

  const addSongsToAdditional = (newSongs) => {
    // Filter out songs that already exist
    const unique = newSongs.filter(s => !isDuplicate(s.title, s.artist))
    if (unique.length === 0) return
    setSongs(prev => [...prev, ...unique])
    setAdditionalSongIds(prev => [...prev, ...unique.map(s => s.id)])
  }

  const clearAll = () => {
    // Clear everything visually — songs stay in IndexedDB cache for future auto-populate
    setSongs([])
    setSets([])
    setEncoreSongIds([])
    setAdditionalSongIds([])
    // Force save empty state immediately so reload doesn't bring back old data
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ songs: [], sets: [], encoreSongIds: [], additionalSongIds: [] }))
  }

  // Parse droppable ID
  const parseDroppableId = (id) => {
    if (id === 'additional') return { type: 'additional' }
    if (id === 'encore') return { type: 'encore' }
    return { type: 'set', index: parseInt(id.split('-')[1]) }
  }

  // Get songIds array for a droppable zone
  const getSongIdsForZone = (zone) => {
    if (zone.type === 'additional') return additionalSongIds
    if (zone.type === 'encore') return encoreSongIds
    return sets[zone.index]?.songIds || []
  }

  // Central drag-end handler
  const handleDragEnd = useCallback((result) => {
    const { source, destination } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    const src = parseDroppableId(source.droppableId)
    const dst = parseDroppableId(destination.droppableId)

    const songId = getSongIdsForZone(src)[source.index]
    if (!songId) return

    // Remove from source
    if (src.type === 'additional') {
      setAdditionalSongIds(prev => { const n = [...prev]; n.splice(source.index, 1); return n })
    } else if (src.type === 'encore') {
      setEncoreSongIds(prev => { const n = [...prev]; n.splice(source.index, 1); return n })
    } else {
      setSets(prev => {
        const next = prev.map(s => ({ ...s, songIds: [...s.songIds] }))
        next[src.index].songIds.splice(source.index, 1)
        return next
      })
    }

    // Add to destination
    if (dst.type === 'additional') {
      setAdditionalSongIds(prev => { const n = [...prev]; n.splice(destination.index, 0, songId); return n })
    } else if (dst.type === 'encore') {
      setEncoreSongIds(prev => { const n = [...prev]; n.splice(destination.index, 0, songId); return n })
    } else {
      setSets(prev => {
        const next = prev.map(s => ({ ...s, songIds: [...s.songIds] }))
        next[dst.index].songIds.splice(destination.index, 0, songId)
        return next
      })
    }
  }, [sets, encoreSongIds, additionalSongIds])

  // Build ordered song list for perform mode: sets + encore (excludes additional)
  const orderedSongs = [
    ...sets.flatMap((set, setIdx) =>
      set.songIds.map(id => {
        const song = songs.find(s => s.id === id)
        return song ? { ...song, setName: set.name, setIndex: setIdx } : null
      }).filter(Boolean)
    ),
    ...encoreSongIds.map(id => {
      const song = songs.find(s => s.id === id)
      return song ? { ...song, setName: 'Encore', setIndex: sets.length } : null
    }).filter(Boolean)
  ]

  return (
    <Routes>
      <Route path="/" element={
        <SetListView
          songs={songs}
          sets={sets}
          encoreSongIds={encoreSongIds}
          additionalSongIds={additionalSongIds}
          onAddSong={addSong}
          onUpdateSong={updateSong}
          onRemoveSong={removeSong}
          onMoveSong={moveSong}
          onAddSet={addSet}
          onRemoveSet={removeSet}
          onClearAll={clearAll}
          onDragEnd={handleDragEnd}
          onAddSongsToAdditional={addSongsToAdditional}
          onSetSongs={setSongs}
          onSetSets={setSets}
          onSetEncoreSongIds={setEncoreSongIds}
          onSetAdditionalSongIds={setAdditionalSongIds}
        />
      } />
      <Route path="/perform" element={
        <PerformView songs={orderedSongs} allSongs={songs} />
      } />
    </Routes>
  )
}

export default App
