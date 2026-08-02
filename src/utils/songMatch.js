/**
 * Shared song identity matching.
 *
 * Used when importing a set list so an incoming line is recognised as a song the
 * library already has — reusing it keeps the lyrics, BPM, synced timings and any
 * hand-edits, instead of recreating the song from scratch.
 */

/** Strip everything that varies between two spellings of the same song. */
export function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    // drop trailing qualifiers: "(live)", "[remastered 2011]", "- acoustic"
    .replace(/[([].*?[)\]]/g, ' ')
    .replace(/\s+-\s+(live|acoustic|remaster(ed)?|radio edit|single version).*$/i, ' ')
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')
}

function normalizeArtist(artist) {
  return (artist || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Artists conflict only when both are known and differ. An unknown artist on
 * either side is not evidence against a match — most imported set lists are
 * title-only.
 */
function artistsCompatible(a, b) {
  const x = normalizeArtist(a)
  const y = normalizeArtist(b)
  if (!x || !y) return true
  return x === y || x.includes(y) || y.includes(x)
}

/**
 * Near-match for spelling drift ("Dont Stop Believin" vs "Don't Stop Believing").
 * Containment alone is far too loose — it merges "Creep" into "Creepin'" and any
 * short title into a longer one that happens to contain it. So require both keys
 * to be substantial and close in length.
 */
function nearMatch(a, b) {
  if (a === b) return true
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  if (shorter.length < 8) return false
  if (longer.length - shorter.length > 3) return false
  return longer.includes(shorter)
}

/**
 * Find the song in `existing` that `candidate` refers to, or null.
 * `usedIds` lets a caller stop one library song from absorbing two different
 * lines of the same import.
 */
export function findExistingSong(candidate, existing, usedIds) {
  const key = normalizeTitle(candidate.title)
  if (!key) return null

  const available = usedIds
    ? existing.filter(s => !usedIds.has(s.id))
    : existing

  // Exact title, compatible artist — the overwhelmingly common case.
  const exact = available.find(s =>
    normalizeTitle(s.title) === key && artistsCompatible(s.artist, candidate.artist)
  )
  if (exact) return exact

  // Then tolerate small spelling differences.
  return available.find(s =>
    nearMatch(normalizeTitle(s.title), key) && artistsCompatible(s.artist, candidate.artist)
  ) || null
}
