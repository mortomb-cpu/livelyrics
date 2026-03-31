import { getCachedLyrics, cacheLyrics } from './lyricsCache'

/**
 * Fetch lyrics — checks persistent cache first, then fetches online.
 * Any successfully fetched lyrics are saved to cache for future use.
 */
export async function fetchLyrics(artist, title) {
  if (!title) {
    throw new Error('Song title is required')
  }

  // Check cache first (only if we have an artist for the cache key)
  if (artist) {
    const cached = await getCachedLyrics(artist, title)
    if (cached) {
      return cached
    }
  }

  // Fetch from server
  const params = new URLSearchParams({ title })
  if (artist) params.set('artist', artist)
  const response = await fetch(`/api/lyrics?${params}`)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.suggestion || data.error || 'Failed to fetch lyrics')
  }

  // Save to persistent cache for future shows
  const cacheArtist = data.artist || artist || ''
  if (cacheArtist) {
    await cacheLyrics(cacheArtist, title, data.lyrics)
  }

  return {
    lyrics: data.lyrics,
    bpm: data.bpm || 120,
    syncedLines: data.syncedLines || null,
    duration: data.duration || null
  }
}

/**
 * Fetch lyrics for multiple songs with progress callback.
 * Uses cache when available — cached songs are instant, no network needed.
 */
export async function fetchAllLyrics(songs, onProgress, abortSignal) {
  const results = []
  let completed = 0

  // Phase 1: quickly resolve cached/skipped songs (instant, no network)
  const toFetchOnline = []
  for (const song of songs) {
    if (song.lyrics && song.lyricsStatus !== 'pending') {
      // Has lyrics but missing syncedLines? Still need to fetch from server for synced data
      if (!song.syncedLines) {
        toFetchOnline.push(song)
      } else {
        results.push({ id: song.id, lyrics: song.lyrics, status: song.lyricsStatus, syncedLines: song.syncedLines, bpm: song.bpm })
        completed++
        onProgress?.(completed, songs.length, song.title, 'skipped')
      }
      continue
    }

    const cached = song.artist ? await getCachedLyrics(song.artist, song.title) : null
    if (cached) {
      // Got lyrics from cache but need synced data from server
      toFetchOnline.push({ ...song, lyrics: cached, _cachedLyrics: true })
      continue
    }

    toFetchOnline.push(song)
  }

  // Phase 2: fetch remaining songs in parallel batches of 3
  const BATCH_SIZE = 3
  for (let i = 0; i < toFetchOnline.length; i += BATCH_SIZE) {
    if (abortSignal?.aborted) break
    const batch = toFetchOnline.slice(i, i + BATCH_SIZE)

    const batchResults = await Promise.allSettled(
      batch.map(async (song) => {
        onProgress?.(completed, songs.length, song.title, song._cachedLyrics ? 'syncing' : 'fetching')
        const result = await fetchLyrics(song.artist, song.title)
        return {
          id: song.id,
          lyrics: song._cachedLyrics ? song.lyrics : result.lyrics, // keep cached lyrics if we had them
          bpm: result.bpm,
          syncedLines: result.syncedLines,
          duration: result.duration,
          status: song._cachedLyrics ? 'cached' : 'fetched'
        }
      })
    )

    for (let j = 0; j < batchResults.length; j++) {
      const br = batchResults[j]
      if (br.status === 'fulfilled') {
        results.push(br.value)
        onProgress?.(completed + 1, songs.length, batch[j].title, 'success')
      } else {
        results.push({ id: batch[j].id, lyrics: '', status: 'failed', error: br.reason?.message })
        onProgress?.(completed + 1, songs.length, batch[j].title, 'failed')
      }
      completed++
    }

    // Small delay between batches to be polite to external APIs
    if (i + BATCH_SIZE < toFetchOnline.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  return results
}

/**
 * Split lyrics text into sections (verses, choruses, etc.)
 */
export function splitLyricsIntoSections(lyrics) {
  if (!lyrics) return []

  const lines = lyrics.split('\n')
  const sections = []
  let currentSection = { label: '', lines: [] }

  for (const line of lines) {
    const trimmed = line.trim()

    // Section header detection: [Verse 1], [Chorus], etc.
    const bracketMatch = trimmed.match(/^\[(.+?)\]$/)
    if (bracketMatch) {
      if (currentSection.lines.length > 0) {
        sections.push(currentSection)
      }
      currentSection = { label: bracketMatch[1], lines: [] }
      continue
    }

    // Empty line = section break
    if (trimmed === '' && currentSection.lines.length > 0) {
      currentSection.lines = currentSection.lines.filter(l => l !== '')
      if (currentSection.lines.length > 0) {
        sections.push(currentSection)
        currentSection = { label: '', lines: [] }
      }
      continue
    }

    if (trimmed !== '') {
      currentSection.lines.push(trimmed)
    }
  }

  // Don't forget the last section
  if (currentSection.lines.length > 0) {
    sections.push(currentSection)
  }

  return sections
}
