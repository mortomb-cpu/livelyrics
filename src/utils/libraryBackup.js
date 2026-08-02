import { getAllCachedSongs, cacheLyrics } from './lyricsCache'

/**
 * Export / import the whole app state as one JSON file.
 *
 * Everything the app knows lives in one browser's localStorage and IndexedDB.
 * A cleared browser profile, a Factory Reset misclick, or a stray delete takes
 * the entire repertoire with it and there is no other copy. This gives that
 * repertoire somewhere to live outside the browser.
 */

const FORMAT = 'livelyrics-backup'
const VERSION = 1

export async function exportLibrary({ songs, sets, encoreSongIds, additionalSongIds }) {
  const cached = await getAllCachedSongs()

  const payload = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    setList: { songs, sets, encoreSongIds, additionalSongIds },
    // Strip the derived cache key — it's rebuilt on import from artist+title.
    library: cached.map(({ artist, title, lyrics, savedAt }) => ({ artist, title, lyrics, savedAt }))
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const stamp = new Date().toISOString().slice(0, 10)
  const a = document.createElement('a')
  a.href = url
  a.download = `livelyrics-backup-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the download has taken the reference.
  setTimeout(() => URL.revokeObjectURL(url), 1000)

  return { songs: songs.length, library: payload.library.length }
}

/**
 * Read a backup file. Restores the lyrics library immediately and hands the set
 * list back to the caller to apply, so React state stays owned by App.
 */
export async function importLibrary(file) {
  let payload
  try {
    payload = JSON.parse(await file.text())
  } catch {
    throw new Error('That file is not valid JSON — pick a LiveLyrics backup file.')
  }

  if (payload?.format !== FORMAT) {
    throw new Error('That JSON is not a LiveLyrics backup.')
  }
  if (payload.version > VERSION) {
    throw new Error(`This backup was made by a newer version of LiveLyrics (v${payload.version}).`)
  }

  let restored = 0
  for (const entry of payload.library || []) {
    if (await cacheLyrics(entry.artist || '', entry.title, entry.lyrics)) restored++
  }

  const sl = payload.setList || {}
  return {
    restoredLyrics: restored,
    setList: Array.isArray(sl.songs) && sl.songs.length ? {
      songs: sl.songs,
      sets: Array.isArray(sl.sets) ? sl.sets : [],
      encoreSongIds: Array.isArray(sl.encoreSongIds) ? sl.encoreSongIds : [],
      additionalSongIds: Array.isArray(sl.additionalSongIds) ? sl.additionalSongIds : []
    } : null,
    exportedAt: payload.exportedAt
  }
}
