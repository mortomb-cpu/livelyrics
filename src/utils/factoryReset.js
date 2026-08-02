import { clearCache } from './lyricsCache'

/**
 * Wipe every trace of app state and return to a first-launch install.
 *
 * The old reset called indexedDB.deleteDatabase() and reloaded immediately.
 * Both halves were broken: deleteDatabase() only runs once every connection to
 * the database is closed, so with a connection open it fired "blocked" and
 * never deleted anything, and the reload happened before any of it could
 * finish anyway. The lyrics library survived untouched.
 *
 * So: empty the store through a transaction first — that always runs — and
 * treat dropping the database itself as a bonus. Then clear localStorage and
 * the PWA's cached assets, and only reload once everything has settled.
 */

const DB_NAME = 'livelyrics_cache'

function deleteDatabase(name, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => { if (!settled) { settled = true; resolve(result) } }
    try {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = () => finish('deleted')
      req.onerror = () => finish('error')
      // Blocked is survivable — clearCache() already emptied the store.
      req.onblocked = () => finish('blocked')
      setTimeout(() => finish('timeout'), timeoutMs)
    } catch {
      finish('error')
    }
  })
}

export async function factoryReset() {
  const report = {}

  // 1. Lyrics library. Empty it first so the data is gone even if the drop stalls.
  report.cacheCleared = await clearCache()
  report.database = await deleteDatabase(DB_NAME)

  // 2. Set list, song list and the saved GitHub publish token.
  const keys = Object.keys(localStorage).filter(k => k.toLowerCase().startsWith('livelyrics'))
  keys.forEach(k => localStorage.removeItem(k))
  report.localStorageKeysRemoved = keys

  // 3. PWA cached assets, so the app reloads fresh rather than from the
  //    service worker's copy.
  try {
    if (typeof caches !== 'undefined') {
      const names = await caches.keys()
      await Promise.all(names.map(n => caches.delete(n)))
      report.cachesDeleted = names
    }
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister()))
      report.serviceWorkersUnregistered = regs.length
    }
  } catch {
    // Cache/SW cleanup is best-effort; the user's data is already gone.
  }

  return report
}
