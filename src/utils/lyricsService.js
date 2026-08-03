import { findCachedLyrics, cacheLyrics } from './lyricsCache'

/**
 * Fetch lyrics — checks persistent cache first, then fetches online.
 * Any successfully fetched lyrics are saved to cache for future use.
 */
export async function fetchLyrics(artist, title, { useCache = true } = {}) {
  if (!title) {
    throw new Error('Song title is required')
  }

  // Check cache first — works with or without a known artist.
  // Callers that need server-only data (BPM, synced/timed lines) pass
  // useCache:false, since the cache stores lyrics text only.
  if (useCache) {
    const cached = await findCachedLyrics(artist, title)
    if (cached) {
      return { lyrics: cached, bpm: 120, syncedLines: null, duration: null }
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

  // Save to persistent cache for future shows. Stored even when the artist is
  // unknown (keyed on title alone) so title-only set lists still build a library.
  await cacheLyrics(data.artist || artist || '', title, data.lyrics)

  return {
    lyrics: data.lyrics,
    bpm: data.bpm || 120,
    syncedLines: data.syncedLines || null,
    duration: data.duration || null,
    // Only set when we asked without an artist and the source named one.
    discoveredArtist: data.discoveredArtist || null
  }
}

/**
 * Fetch lyrics with automatic retries. When many songs fetch at once the
 * network/sources can briefly time out, which previously marked a perfectly
 * findable song as "not found". Retrying a couple times with backoff catches
 * these transient failures.
 */
async function fetchLyricsWithRetry(artist, title, abortSignal, attempts = 3) {
  let lastErr
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (abortSignal?.aborted) throw new Error('Aborted')
    try {
      // useCache:false — fetchAllLyrics already resolved the cache in phase 1 and
      // is here specifically for the server-side BPM and synced-line data.
      return await fetchLyrics(artist, title, { useCache: false })
    } catch (err) {
      lastErr = err
      if (attempt < attempts && !abortSignal?.aborted) {
        // Backoff: 0.6s, then 1.2s — gives a busy source time to recover
        await new Promise(r => setTimeout(r, 600 * attempt))
      }
    }
  }
  throw lastErr
}

/**
 * Does this song still need something only the server can provide?
 *
 * Synced timings, song length and the artist name never come from the lyrics
 * cache, which stores text alone — so a song can have perfect lyrics and still
 * be missing all three.
 *
 * Exported and used by BOTH the caller's "what should I fetch" filter and the
 * skip check inside fetchAllLyrics. Those were separate copies twice over, and
 * both times they drifted: the caller selected a song and this function then
 * skipped it, so the fetch silently did nothing.
 */
export function needsServerData(song) {
  return !song.syncedLines || !(song.duration > 0) || !song.artist
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
      // Has lyrics but missing something only the server has? Still worth a fetch.
      if (needsServerData(song)) {
        toFetchOnline.push(song)
      } else {
        results.push({ id: song.id, lyrics: song.lyrics, status: song.lyricsStatus, syncedLines: song.syncedLines, bpm: song.bpm, duration: song.duration })
        completed++
        onProgress?.(completed, songs.length, song.title, 'skipped')
      }
      continue
    }

    const cached = await findCachedLyrics(song.artist, song.title)
    if (cached) {
      // Got lyrics from cache but need synced data from server
      toFetchOnline.push({ ...song, lyrics: cached, _cachedLyrics: true })
      continue
    }

    toFetchOnline.push(song)
  }

  // Phase 2: fetch remaining songs in small parallel batches. Kept low (2) so
  // we don't fire ~6 requests/song × a big batch at once and saturate the
  // connection, which was causing whole batches to time out together.
  const BATCH_SIZE = 2
  for (let i = 0; i < toFetchOnline.length; i += BATCH_SIZE) {
    if (abortSignal?.aborted) break
    const batch = toFetchOnline.slice(i, i + BATCH_SIZE)

    const batchResults = await Promise.allSettled(
      batch.map(async (song) => {
        onProgress?.(completed, songs.length, song.title, song._cachedLyrics ? 'syncing' : 'fetching')
        const result = await fetchLyricsWithRetry(song.artist, song.title, abortSignal)
        return {
          id: song.id,
          lyrics: song._cachedLyrics ? song.lyrics : result.lyrics, // keep cached lyrics if we had them
          bpm: result.bpm,
          syncedLines: result.syncedLines,
          duration: result.duration,
          // Fill in an artist the set list never had — never overwrite one it did.
          discoveredArtist: song.artist ? null : result.discoveredArtist,
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
