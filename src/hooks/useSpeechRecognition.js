import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * Normalize text for matching: lowercase, strip punctuation, collapse spaces.
 */
function normalize(text) {
  return text.toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract n-grams (sequences of n consecutive words) from a word array.
 */
function ngrams(words, n) {
  const result = []
  for (let i = 0; i <= words.length - n; i++) {
    result.push(words.slice(i, i + n).join(' '))
  }
  return result
}

/**
 * Score how well a transcript matches a lyrics line using sequence matching.
 * Returns 0-1 where 1 is a perfect match.
 */
function scoreMatch(transcriptWords, lineWords) {
  if (lineWords.length === 0 || transcriptWords.length === 0) return 0

  // 1. Consecutive sequence matching (most precise)
  //    Find the longest consecutive word sequence from the line that appears in the transcript
  let longestConsecutive = 0
  for (let len = Math.min(lineWords.length, transcriptWords.length); len >= 2; len--) {
    const lineNgrams = ngrams(lineWords, len)
    const transcriptText = transcriptWords.join(' ')
    for (const ng of lineNgrams) {
      if (transcriptText.includes(ng)) {
        longestConsecutive = len
        break
      }
    }
    if (longestConsecutive > 0) break
  }

  // 2. Trigram overlap (good for partial matches)
  const triSize = Math.min(3, lineWords.length, transcriptWords.length)
  let trigramMatches = 0
  let trigramTotal = 0
  if (triSize >= 2) {
    const lineTrigrams = ngrams(lineWords, triSize)
    const transTrigrams = ngrams(transcriptWords, triSize)
    trigramTotal = lineTrigrams.length
    for (const lt of lineTrigrams) {
      if (transTrigrams.some(tt => tt === lt)) {
        trigramMatches++
      }
    }
  }

  // 3. Individual word overlap (fallback, less precise)
  let wordMatches = 0
  const significantLineWords = lineWords.filter(w => w.length > 2)
  for (const lw of significantLineWords) {
    if (transcriptWords.some(tw => tw === lw || (tw.length > 3 && lw.length > 3 && (tw.includes(lw) || lw.includes(tw))))) {
      wordMatches++
    }
  }
  const wordScore = significantLineWords.length > 0
    ? wordMatches / significantLineWords.length
    : 0

  // Combine scores: consecutive sequences weighted highest
  const consecutiveScore = longestConsecutive / Math.max(lineWords.length, 1)
  const trigramScore = trigramTotal > 0 ? trigramMatches / trigramTotal : 0

  return (consecutiveScore * 0.5) + (trigramScore * 0.3) + (wordScore * 0.2)
}

/**
 * Hook for voice-based lyrics auto-scroll.
 * Uses Web Speech API with sequence matching, forward-only scrolling,
 * transcript buffering, and progressive drift for reliable stage use.
 */
export function useSpeechRecognition(lyricsLines = []) {
  const [isListening, setIsListening] = useState(false)
  const [currentLineIndex, setCurrentLineIndex] = useState(0)
  const [confidence, setConfidence] = useState(0)
  const [supported, setSupported] = useState(false)
  const recognitionRef = useRef(null)
  const linesRef = useRef(lyricsLines)
  const currentLineRef = useRef(0)
  const transcriptBufferRef = useRef('')     // Accumulates recent transcripts
  const lastMatchTimeRef = useRef(Date.now())
  const lastScrollTimeRef = useRef(0)        // Cooldown between scroll changes
  const highWaterMarkRef = useRef(0)         // Furthest line we've reached (no going back)
  const driftIntervalRef = useRef(null)

  useEffect(() => {
    linesRef.current = lyricsLines
  }, [lyricsLines])

  // Keep ref in sync with state
  useEffect(() => {
    currentLineRef.current = currentLineIndex
  }, [currentLineIndex])

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    setSupported(!!SpeechRecognition)
  }, [])

  /**
   * Find the best matching line for the given transcript.
   * Only searches FORWARD from the current position (never backwards).
   * For chorus repeats, prefers the next occurrence after current position.
   */
  const findBestMatch = useCallback((transcript) => {
    const transcriptWords = normalize(transcript).split(/\s+/).filter(w => w.length > 1)
    if (transcriptWords.length < 2) return { idx: -1, score: 0 }

    const current = currentLineRef.current
    let bestIdx = -1
    let bestScore = 0

    // Search window: small lookback + forward
    const searchStart = Math.max(0, current - 2)
    const searchEnd = Math.min(linesRef.current.length, current + 30)

    for (let i = searchStart; i < searchEnd; i++) {
      const lineWords = normalize(linesRef.current[i]).split(/\s+/).filter(w => w.length > 1)
      if (lineWords.length === 0) continue

      let score = scoreMatch(transcriptWords, lineWords)

      const distance = i - current

      if (distance < 0) {
        // Going backwards — heavy penalty
        score *= 0.2
      } else if (distance >= 0) {
        // Forward: strong preference for the CLOSEST match
        // Lines 0-3 ahead: full score + bonus
        // Lines 4-8 ahead: slight decay
        // Lines 9+ ahead: significant decay — prevents jumping to distant repeated sections
        if (distance <= 3) {
          score += 0.15  // Strong bonus for immediate next lines
        } else if (distance <= 8) {
          score *= (1.0 - (distance - 3) * 0.04)  // Gentle decay
        } else {
          score *= (0.8 - (distance - 8) * 0.03)  // Steeper decay for distant lines
          // Only allow distant jumps if the match is near-perfect
          if (score < 0.6) score *= 0.5
        }
      }

      // Tiebreaker: when scores are very close, prefer the closer line
      // Add tiny proximity bonus that won't override a genuinely better match
      if (distance > 0) {
        score += 0.001 / distance
      }

      if (score > bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    return { idx: bestIdx, score: bestScore }
  }, [])

  /**
   * Progressive drift: if no speech match for a while,
   * slowly advance forward. This prevents getting stuck
   * if the mic misses a section.
   */
  const startDrift = useCallback(() => {
    if (driftIntervalRef.current) return

    driftIntervalRef.current = setInterval(() => {
      const now = Date.now()
      const elapsed = now - lastMatchTimeRef.current
      const current = currentLineRef.current

      // After 8 seconds of no match, advance 1 line every 4 seconds
      if (elapsed > 8000 && current < linesRef.current.length - 1) {
        const newIdx = current + 1
        currentLineRef.current = newIdx
        setCurrentLineIndex(newIdx)
        lastMatchTimeRef.current = now - 5000 // Keep drifting but slowly
      }
    }, 4000)
  }, [])

  const stopDrift = useCallback(() => {
    if (driftIntervalRef.current) {
      clearInterval(driftIntervalRef.current)
      driftIntervalRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'
    recognition.maxAlternatives = 3

    recognition.onresult = (event) => {
      // Build transcript from recent results
      let interimTranscript = ''
      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript + ' '
          setConfidence(result[0].confidence)
        } else {
          interimTranscript += result[0].transcript + ' '
        }
      }

      // Add final results to the rolling buffer (keep last ~50 words)
      if (finalTranscript.trim()) {
        transcriptBufferRef.current += ' ' + finalTranscript.trim()
        const bufferWords = transcriptBufferRef.current.trim().split(/\s+/)
        if (bufferWords.length > 50) {
          transcriptBufferRef.current = bufferWords.slice(-50).join(' ')
        }
      }

      // Use the combined buffer + current interim for matching
      // This gives us a longer context window for better sequence matching
      const fullTranscript = (transcriptBufferRef.current + ' ' + interimTranscript).trim()

      if (fullTranscript) {
        // Use the last 15-20 words for matching (recent context)
        const recentWords = fullTranscript.split(/\s+/).slice(-20).join(' ')
        const { idx, score } = findBestMatch(recentWords)

        const current = currentLineRef.current
        const now = Date.now()

        // STABILITY RULES:
        // 1. Cooldown: minimum 800ms between scroll changes (prevents rapid jumping)
        if (now - lastScrollTimeRef.current < 800) return

        // 2. STRICTLY FORWARD ONLY: never go behind the high water mark
        //    This prevents ALL backwards scrolling during a song
        if (idx < highWaterMarkRef.current) return

        // 3. Higher minimum score threshold to reduce false matches
        const minScore = 0.35

        // 4. Don't jump more than 6 lines at once unless score is very high
        const jumpSize = idx - current
        if (jumpSize > 6 && score < 0.5) return

        if (idx >= 0 && score >= minScore && idx >= current) {
          currentLineRef.current = idx
          highWaterMarkRef.current = Math.max(highWaterMarkRef.current, idx)
          setCurrentLineIndex(idx)
          lastMatchTimeRef.current = now
          lastScrollTimeRef.current = now
        }
      }
    }

    recognition.onerror = (event) => {
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        console.error('Speech recognition error:', event.error)
      }
    }

    recognition.onend = () => {
      // Restart if still supposed to be listening
      if (recognitionRef.current) {
        try {
          recognition.start()
        } catch (e) {
          // Already started
        }
      }
    }

    transcriptBufferRef.current = ''
    lastMatchTimeRef.current = Date.now()
    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
    startDrift()
  }, [findBestMatch, startDrift])

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
    setIsListening(false)
    stopDrift()
    transcriptBufferRef.current = ''
  }, [stopDrift])

  const reset = useCallback(() => {
    currentLineRef.current = 0
    highWaterMarkRef.current = 0
    lastScrollTimeRef.current = 0
    setCurrentLineIndex(0)
    setConfidence(0)
    transcriptBufferRef.current = ''
    lastMatchTimeRef.current = Date.now()
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.onend = null
        recognitionRef.current.stop()
        recognitionRef.current = null
      }
      stopDrift()
    }
  }, [stopDrift])

  return {
    isListening,
    currentLineIndex,
    setCurrentLineIndex,
    confidence,
    supported,
    start,
    stop,
    reset
  }
}
