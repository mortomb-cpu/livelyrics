/**
 * Song length helpers.
 *
 * Durations come from lrclib alongside the synced lyrics (seconds, often
 * fractional) and can also be typed in by hand for songs the sources don't know
 * or that you play longer live than the record.
 */

/** 351.4 -> "5:51". Long totals get an hour part: "1:58:40". */
export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return null
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

/** "5:51" or "351" -> 351. Returns null if it can't be read. */
export function parseDuration(text) {
  const raw = (text || '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return parseInt(raw, 10)
  const parts = raw.split(':').map(p => p.trim())
  if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null
  const nums = parts.map(Number)
  return parts.length === 3
    ? nums[0] * 3600 + nums[1] * 60 + nums[2]
    : nums[0] * 60 + nums[1]
}

/**
 * Total length of a list of songs.
 * `known` / `missing` let the UI show "42:17 (2 songs unknown)" rather than
 * quietly under-reporting a set.
 */
export function totalDuration(songs) {
  let seconds = 0
  let known = 0
  const missingTitles = []
  for (const s of songs) {
    if (s?.duration > 0) { seconds += s.duration; known++ }
    else if (s) missingTitles.push(s.title)
  }
  return {
    seconds,
    known,
    missing: missingTitles.length,
    missingTitles,
    formatted: formatDuration(seconds)
  }
}

/** Tooltip text naming exactly which songs aren't counted in a total. */
export function missingTimeHint(total) {
  if (!total.missing) return 'Total running time'
  const names = total.missingTitles.filter(Boolean)
  return `Not counted (no known length): ${names.join(', ')}\n` +
         `Add a length by hand in the song's editor to include it.`
}
