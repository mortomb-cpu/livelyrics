import { Routes, Route } from 'react-router-dom'
import { useState, useEffect } from 'react'
import SetListView from './components/SetListView'
import PerformView from './components/PerformView'

const STORAGE_KEY = 'livelyrics_data'

function App() {
  const [songs, setSongs] = useState([])
  const [sets, setSets] = useState([{ name: 'Set 1', songIds: [] }])

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const data = JSON.parse(saved)
        if (data.songs) setSongs(data.songs)
        if (data.sets) setSets(data.sets)
      }
    } catch (e) {
      console.error('Failed to load saved data:', e)
    }
  }, [])

  // Save to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ songs, sets }))
    } catch (e) {
      console.error('Failed to save data:', e)
    }
  }, [songs, sets])

  const addSong = (song) => {
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

    // Add to the appropriate set
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

  const removeSong = (id) => {
    setSongs(prev => prev.filter(s => s.id !== id))
    setSets(prev => prev.map(set => ({
      ...set,
      songIds: set.songIds.filter(sid => sid !== id)
    })))
  }

  const moveSong = (songId, fromSetIdx, toSetIdx, newPosition) => {
    setSets(prev => {
      const updated = prev.map(s => ({ ...s, songIds: [...s.songIds] }))
      // Remove from old set
      updated[fromSetIdx].songIds = updated[fromSetIdx].songIds.filter(id => id !== songId)
      // Add to new set at position
      updated[toSetIdx].songIds.splice(newPosition, 0, songId)
      return updated
    })
  }

  const addSet = () => {
    setSets(prev => [...prev, { name: `Set ${prev.length + 1}`, songIds: [] }])
  }

  const removeSet = (idx) => {
    if (sets.length <= 1) return
    setSets(prev => {
      const removed = prev[idx]
      const updated = prev.filter((_, i) => i !== idx)
      // Move orphaned songs to previous set
      if (removed.songIds.length > 0) {
        const targetIdx = Math.min(idx, updated.length - 1)
        updated[targetIdx] = {
          ...updated[targetIdx],
          songIds: [...updated[targetIdx].songIds, ...removed.songIds]
        }
      }
      return updated
    })
  }

  const clearAll = () => {
    setSongs([])
    setSets([{ name: 'Set 1', songIds: [] }])
    localStorage.removeItem(STORAGE_KEY)
  }

  // Build ordered song list for perform mode
  const orderedSongs = sets.flatMap((set, setIdx) =>
    set.songIds.map(id => {
      const song = songs.find(s => s.id === id)
      return song ? { ...song, setName: set.name, setIndex: setIdx } : null
    }).filter(Boolean)
  )

  return (
    <Routes>
      <Route path="/" element={
        <SetListView
          songs={songs}
          sets={sets}
          onAddSong={addSong}
          onUpdateSong={updateSong}
          onRemoveSong={removeSong}
          onMoveSong={moveSong}
          onAddSet={addSet}
          onRemoveSet={removeSet}
          onClearAll={clearAll}
          onSetSongs={setSongs}
          onSetSets={setSets}
        />
      } />
      <Route path="/perform" element={
        <PerformView songs={orderedSongs} />
      } />
    </Routes>
  )
}

export default App
