import { useState, useRef, useCallback, useEffect } from 'react'

const DEEPGRAM_KEY = '248fb866c5469f73c3955fd4347220023a577c5b'

/**
 * Normalize text for matching.
 */
function normalize(text) {
  return text.toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ngrams(words, n) {
  const result = []
  for (let i = 0; i <= words.length - n; i++) {
    result.push(words.slice(i, i + n).join(' '))
  }
  return result
}

function scoreMatch(tw, lw) {
  if (!lw.length || !tw.length) return 0
  let lc = 0
  for (let len = Math.min(lw.length, tw.length); len >= 2; len--) {
    const ln = ngrams(lw, len), tt = tw.join(' ')
    for (const ng of ln) { if (tt.includes(ng)) { lc = len; break } }
    if (lc > 0) break
  }
  const ts = Math.min(3, lw.length, tw.length)
  let tm = 0, tl = 0
  if (ts >= 2) {
    const a = ngrams(lw, ts), b = ngrams(tw, ts)
    tl = a.length
    for (const x of a) if (b.some(y => y === x)) tm++
  }
  const sig = lw.filter(w => w.length > 2)
  let wm = 0
  for (const w of sig) if (tw.some(t => t === w || (t.length > 3 && w.length > 3 && (t.includes(w) || w.includes(t))))) wm++
  const ws = sig.length > 0 ? wm / sig.length : 0
  return (lc / Math.max(lw.length, 1)) * 0.5 + (tl > 0 ? tm / tl : 0) * 0.3 + ws * 0.2
}

/**
 * Hook for Deepgram cloud speech recognition.
 * Streams mic audio via WebSocket for high-accuracy transcription,
 * even in noisy live music environments.
 */
export function useDeepgramRecognition(lyricsLines = []) {
  const [isListening, setIsListening] = useState(false)
  const [currentLineIndex, setCurrentLineIndex] = useState(0)
  const [confidence, setConfidence] = useState(0)
  const [connected, setConnected] = useState(false)

  const linesRef = useRef(lyricsLines)
  const currentLineRef = useRef(0)
  const highWaterMarkRef = useRef(0)
  const lastScrollTimeRef = useRef(0)
  const transcriptBufferRef = useRef('')
  const lastMatchTimeRef = useRef(Date.now())

  const wsRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const processorRef = useRef(null)
  const audioContextRef = useRef(null)
  const driftIntervalRef = useRef(null)

  useEffect(() => { linesRef.current = lyricsLines }, [lyricsLines])
  useEffect(() => { currentLineRef.current = currentLineIndex }, [currentLineIndex])

  const findBestMatch = useCallback((transcript) => {
    const transcriptWords = normalize(transcript).split(/\s+/).filter(w => w.length > 1)
    if (transcriptWords.length < 2) return { idx: -1, score: 0 }

    const current = currentLineRef.current
    let bestIdx = -1, bestScore = 0
    const searchStart = Math.max(0, current - 2)
    const searchEnd = Math.min(linesRef.current.length, current + 30)

    for (let i = searchStart; i < searchEnd; i++) {
      const lineWords = normalize(linesRef.current[i]).split(/\s+/).filter(w => w.length > 1)
      if (lineWords.length === 0) continue
      let score = scoreMatch(transcriptWords, lineWords)
      const dist = i - current
      if (dist < 0) score *= 0.2
      else if (dist <= 3) score += 0.15
      else if (dist <= 8) score *= (1.0 - (dist - 3) * 0.04)
      else { score *= (0.8 - (dist - 8) * 0.03); if (score < 0.6) score *= 0.5 }
      if (dist > 0) score += 0.001 / dist
      if (score > bestScore) { bestScore = score; bestIdx = i }
    }
    return { idx: bestIdx, score: bestScore }
  }, [])

  const processTranscript = useCallback((text, isFinal, dgConfidence) => {
    // GATE 1: Ignore very low confidence (clear noise)
    if (dgConfidence < 0.4) return

    // GATE 2: Ignore single-word noise bursts
    const words = text.trim().split(/\s+/).filter(w => w.length > 1)
    if (words.length < 2) return

    if (isFinal && text.trim()) {
      transcriptBufferRef.current += ' ' + text.trim()
      const bufWords = transcriptBufferRef.current.trim().split(/\s+/)
      if (bufWords.length > 50) transcriptBufferRef.current = bufWords.slice(-50).join(' ')
    }

    const full = (transcriptBufferRef.current + ' ' + text).trim()
    if (!full) return

    const recent = full.split(/\s+/).slice(-20).join(' ')
    const { idx, score } = findBestMatch(recent)

    const now = Date.now()
    if (now - lastScrollTimeRef.current < 800) return
    if (idx < highWaterMarkRef.current) return
    const jumpSize = idx - currentLineRef.current
    if (jumpSize > 6 && score < 0.5) return
    // Higher threshold for cloud — 0.45 instead of 0.35
    if (idx >= 0 && score >= 0.30 && idx >= currentLineRef.current) {
      currentLineRef.current = idx
      highWaterMarkRef.current = Math.max(highWaterMarkRef.current, idx)
      setCurrentLineIndex(idx)
      lastMatchTimeRef.current = now
      lastScrollTimeRef.current = now
    }
  }, [findBestMatch])

  const start = useCallback(async () => {
    try {
      // Get mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      mediaStreamRef.current = stream

      // Build keywords from current lyrics for Deepgram boost
      const keywords = [...new Set(
        linesRef.current
          .join(' ')
          .toLowerCase()
          .replace(/[^a-z ]/g, '')
          .split(/\s+/)
          .filter(w => w.length > 3)
      )].slice(0, 100)
      const keywordsParam = keywords.length > 0
        ? '&keywords=' + keywords.map(w => encodeURIComponent(w + ':2')).join('&keywords=')
        : ''

      // Connect to Deepgram via WebSocket
      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&utterance_end_ms=1500&vad_events=true&encoding=linear16&sample_rate=16000&channels=1${keywordsParam}`,
        ['token', DEEPGRAM_KEY]
      )

      ws.onopen = async () => {
        console.log('[deepgram] Connected with', keywords.length, 'keyword boosts')
        setConnected(true)

        try {
          const audioContext = new (window.AudioContext || window.webkitAudioContext)()
          audioContextRef.current = audioContext
          if (audioContext.state === 'suspended') await audioContext.resume()

          const source = audioContext.createMediaStreamSource(stream)
          const processor = audioContext.createScriptProcessor(4096, 1, 1)
          processorRef.current = processor

          // No manual filters — rely on browser's native noiseSuppression + echoCancellation
          // which are more sophisticated than simple bandpass filters
          const ctxRate = audioContext.sampleRate
          processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return
            const input = e.inputBuffer.getChannelData(0)

            // Resample to 16kHz
            let samples = input
            if (ctxRate !== 16000) {
              const ratio = 16000 / ctxRate
              const newLen = Math.round(input.length * ratio)
              samples = new Float32Array(newLen)
              for (let i = 0; i < newLen; i++) {
                const srcIdx = i / ratio
                const lo = Math.floor(srcIdx)
                const hi = Math.min(lo + 1, input.length - 1)
                const frac = srcIdx - lo
                samples[i] = input[lo] * (1 - frac) + input[hi] * frac
              }
            }

            const int16 = new Int16Array(samples.length)
            for (let i = 0; i < samples.length; i++) {
              int16[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
            }
            ws.send(int16.buffer)
          }

          source.connect(processor)
          processor.connect(audioContext.destination)
        } catch (audioErr) {
          console.error('[deepgram] Audio setup failed:', audioErr)
        }
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.channel?.alternatives?.[0]) {
            const alt = data.channel.alternatives[0]
            const text = alt.transcript || ''
            const isFinal = data.is_final || false
            if (text) {
              const dgConf = alt.confidence || 0
              setConfidence(dgConf)
              processTranscript(text, isFinal, dgConf)
            }
          }
        } catch (e) {}
      }

      ws.onerror = (e) => {
        console.error('[deepgram] WebSocket error:', e)
      }

      ws.onclose = () => {
        console.log('[deepgram] Disconnected')
        setConnected(false)
      }

      wsRef.current = ws
      setIsListening(true)

      // NO DRIFT for cloud mode — Deepgram is accurate enough,
      // we only scroll when it actually hears singing.

    } catch (e) {
      console.error('[deepgram] Failed to start:', e)
    }
  }, [processTranscript])

  const stop = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop())
      mediaStreamRef.current = null
    }
    if (driftIntervalRef.current) {
      clearInterval(driftIntervalRef.current)
      driftIntervalRef.current = null
    }
    setIsListening(false)
    setConnected(false)
    transcriptBufferRef.current = ''
  }, [])

  const reset = useCallback(() => {
    currentLineRef.current = 0
    highWaterMarkRef.current = 0
    lastScrollTimeRef.current = 0
    setCurrentLineIndex(0)
    setConfidence(0)
    transcriptBufferRef.current = ''
    lastMatchTimeRef.current = Date.now()
  }, [])

  useEffect(() => {
    return () => { stop() }
  }, [stop])

  return {
    isListening,
    currentLineIndex,
    setCurrentLineIndex,
    confidence,
    connected,
    start,
    stop,
    reset
  }
}
