/**
 * Persistent lyrics cache using IndexedDB.
 * Stores lyrics keyed by "artist|title" so the same song never needs
 * to be fetched twice, even across different shows/set lists.
 */

const DB_NAME = 'livelyrics_cache'
const DB_VERSION = 1
const STORE_NAME = 'lyrics'

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
        store.createIndex('artist', 'artist', { unique: false })
        store.createIndex('title', 'title', { unique: false })
        store.createIndex('savedAt', 'savedAt', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function makeCacheKey(artist, title) {
  return `${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`
}

/**
 * Look up cached lyrics for a song.
 * Returns the lyrics string if found, null otherwise.
 */
export async function getCachedLyrics(artist, title) {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const key = makeCacheKey(artist, title)

    return new Promise((resolve) => {
      const request = store.get(key)
      request.onsuccess = () => {
        const result = request.result
        resolve(result ? result.lyrics : null)
      }
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/**
 * Save lyrics to the persistent cache.
 */
export async function cacheLyrics(artist, title, lyrics) {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)

    store.put({
      key: makeCacheKey(artist, title),
      artist: artist.trim(),
      title: title.trim(),
      lyrics,
      savedAt: new Date().toISOString()
    })

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}

/**
 * Get total count of cached songs.
 */
export async function getCacheCount() {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)

    return new Promise((resolve) => {
      const request = store.count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(0)
    })
  } catch {
    return 0
  }
}

/**
 * Clear entire lyrics cache.
 */
export async function clearCache() {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    store.clear()

    return new Promise((resolve) => {
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}
