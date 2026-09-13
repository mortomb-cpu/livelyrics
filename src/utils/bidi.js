/**
 * Repairs for Hebrew titles that arrive from RTL editors / bilingual sources.
 *
 * Used by App.jsx to normalize what's in storage on load (so the fix is
 * permanent) and by SongCard as a display-time safety net.
 */

const HEBREW = /[֐-׿]/

/**
 * Invisible bidi control characters (LRM/RLM, embeddings, isolates, BOM) that
 * copy-paste from Hebrew documents sprinkles into titles. They break regex
 * matching and bracket rendering while being impossible to see.
 * Written as \u escapes: literal invisible characters in source get mangled
 * by editors and normalizers.
 */
export function stripBidiMarks(t) {
  return (t || '').replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
}

/**
 * A set-list position marker whose parens (and word order) were mirrored by an
 * RTL editor: ")6 No(" is really "(No 6)".
 *
 * Matched narrowly — digits plus a No/Num/# token — because a generic ")…("
 * swap also matches the ") (" BETWEEN two groups, turning
 * "Creep (No 3) (Acoustic)" into "Creep (No 3()Acoustic)".
 */
const REVERSED_MARKER = /\)\s*(?:(\d{1,2})\s*(no\.?|num\.?|#)|(no\.?|num\.?|#)\s*(\d{1,2}))\s*\(/gi

export function unmirrorMarker(t) {
  return (t || '').replace(REVERSED_MARKER, (_, d1, t1, t2, d2) => {
    const tok = t1 || t2
    const num = d1 || d2
    return tok === '#' ? `(#${num})` : `(${tok} ${num})`
  })
}

/**
 * Genius (and similar) return Israeli songs bilingually — "Eretz Hadasha - ארץ
 * חדשה". The set list is the authority on how the band writes the song, so
 * keep only the Hebrew half. Titles without Hebrew are left alone entirely.
 */
export function stripTransliteration(t) {
  if (!HEBREW.test(t) || !t.includes(' - ')) return t
  const parts = t.split(/\s+-\s+/)
  const hebrewPart = parts.find(p => HEBREW.test(p))
  if (hebrewPart && parts.some(p => !HEBREW.test(p))) return hebrewPart.trim()
  return t
}

/** The full repair, applied to titles and artist names on load. */
export function fixBidiTitle(t) {
  if (!t) return t
  return stripTransliteration(unmirrorMarker(stripBidiMarks(t)))
}
