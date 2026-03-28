import { getCachedLyrics, cacheLyrics } from './lyricsCache'

/**
 * Fetch lyrics — checks persistent cache first, then fetches online.
 * Any successfully fetched lyrics are saved to cache for future use.
 */
export async function fetchLyrics(artist, title) {
  if (!artist || !title) {
    throw new Error('Both artist and title are required')
  }

  // Check cache first
  const cached = await getCachedLyrics(artist, title)
  if (cached) {
    return cached
  }

  // Fetch from server
  const params = new URLSearchParams({ artist, title })
  const response = await fetch(`/api/lyrics?${params}`)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(data.suggestion || data.error || 'Failed to fetch lyrics')
  }

  // Save to persistent cache for future shows
  await cacheLyrics(artist, title, data.lyrics)

  return data.lyrics
}

/**
 * Fetch lyrics for multiple songs with progress callback.
 * Uses cache when available — cached songs are instant, no network needed.
 */
export async function fetchAllLyrics(songs, onProgress) {
  const results = []
  let completed = 0

  for (const song of songs) {
    // Skip songs that already have lyrics loaded in current session
    if (song.lyrics && song.lyricsStatus !== 'pending') {
      results.push({ id: song.id, lyrics: song.lyrics, status: song.lyricsStatus })
      completed++
      onProgress?.(completed, songs.length, song.title, 'skipped')
      continue
    }

    try {
      // Check persistent cache first (instant, no delay needed)
      const cached = await getCachedLyrics(song.artist, song.title)
      if (cached) {
        results.push({ id: song.id, lyrics: cached, status: 'cached' })
        completed++
        onProgress?.(completed, songs.length, song.title, 'cached')
        continue
      }

      // Need to fetch online — add delay to avoid hammering server
      if (results.some(r => r.status === 'fetched')) {
        await new Promise(r => setTimeout(r, 1500))
      }

      onProgress?.(completed, songs.length, song.title, 'fetching')
      const lyrics = await fetchLyrics(song.artist, song.title)
      results.push({ id: song.id, lyrics, status: 'fetched' })
      onProgress?.(completed + 1, songs.length, song.title, 'success')
    } catch (err) {
      results.push({ id: song.id, lyrics: '', status: 'failed', error: err.message })
      onProgress?.(completed + 1, songs.length, song.title, 'failed')
    }
    completed++
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
