import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { splitLyricsIntoSections } from '../utils/lyricsService'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'
import { useDeepgramRecognition } from '../hooks/useDeepgramRecognition'

export default function PerformView({ songs, allSongs = [] }) {
  const navigate = useNavigate()
  const [currentSongIdx, setCurrentSongIdx] = useState(0)
  const [fontSize, setFontSize] = useState(32)
  const [showControls, setShowControls] = useState(true)
  const [showLibrary, setShowLibrary] = useState(false)
  const [showSetList, setShowSetList] = useState(false)
  const [librarySong, setLibrarySong] = useState(null) // temporarily performing a library song
  const [savedSetIdx, setSavedSetIdx] = useState(null) // where we were in the set before library pick

  // Scroll modes — each can be on or off
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [cloudVoiceEnabled, setCloudVoiceEnabled] = useState(false)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false)
  const [autoScrollPaused, setAutoScrollPaused] = useState(false)
  const [timedEnabled, setTimedEnabled] = useState(false)
  const [timedRunning, setTimedRunning] = useState(false)

  const lyricsContainerRef = useRef(null)
  const controlsTimeoutRef = useRef(null)
  const wakeLockRef = useRef(null)
  const autoScrollRef = useRef(null)
  const timedStartRef = useRef(null)       // When the timed mode was started
  const timedIntervalRef = useRef(null)
  const timedLineIndexRef = useRef(0)

  const currentSong = librarySong || songs[currentSongIdx]
  const sections = currentSong ? splitLyricsIntoSections(currentSong.lyrics) : []
  const bpm = currentSong?.bpm || 120
  const syncedLines = currentSong?.syncedLines || null
  const hasSyncedData = syncedLines && syncedLines.length > 0

  // Flatten all lines for speech recognition
  const allLines = sections.flatMap(s => s.lines)

  const {
    isListening, currentLineIndex, setCurrentLineIndex,
    confidence, supported, start: startListening, stop: stopListening, reset: resetRecognition
  } = useSpeechRecognition(allLines)

  const {
    isListening: isCloudListening, currentLineIndex: cloudLineIndex, setCurrentLineIndex: setCloudLineIndex,
    connected: cloudConnected, start: startCloud, stop: stopCloud, reset: resetCloud
  } = useDeepgramRecognition(allLines)

  // Sync cloud line index to the shared currentLineIndex when cloud is active
  useEffect(() => {
    if (cloudVoiceEnabled && isCloudListening) {
      setCurrentLineIndex(cloudLineIndex)
    }
  }, [cloudLineIndex, cloudVoiceEnabled, isCloudListening])

  // Request fullscreen + robust wake lock on mount
  useEffect(() => {
    const enterFullscreen = async () => {
      try {
        const el = document.documentElement
        if (el.requestFullscreen) await el.requestFullscreen()
        else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen()
      } catch (e) {}
    }
    enterFullscreen()

    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen')
          wakeLockRef.current.addEventListener('release', () => { wakeLockRef.current = null })
        }
      } catch (e) {}
    }
    requestWakeLock()

    // Re-acquire wake lock when tab becomes visible again
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        requestWakeLock()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      wakeLockRef.current?.release()
      document.removeEventListener('visibilitychange', onVisibility)
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
      }
    }
  }, [])

  // Auto-hide controls after 5 seconds
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true)
    clearTimeout(controlsTimeoutRef.current)
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 5000)
  }, [])

  // ===== LOCAL VOICE MODE =====
  useEffect(() => {
    if (voiceEnabled && !isListening && supported) {
      startListening()
    } else if (!voiceEnabled && isListening) {
      stopListening()
    }
    return () => {
      if (isListening) stopListening()
    }
  }, [voiceEnabled])

  // ===== CLOUD VOICE MODE (Deepgram) =====
  useEffect(() => {
    if (cloudVoiceEnabled && !isCloudListening) {
      startCloud()
    } else if (!cloudVoiceEnabled && isCloudListening) {
      stopCloud()
    }
    return () => {
      if (isCloudListening) stopCloud()
    }
  }, [cloudVoiceEnabled])

  // Scroll to active line when voice recognition updates
  useEffect(() => {
    if (!(voiceEnabled && isListening) && !(cloudVoiceEnabled && isCloudListening)) return
    let lineCount = 0
    for (let si = 0; si < sections.length; si++) {
      for (let li = 0; li < sections[si].lines.length; li++) {
        if (lineCount === currentLineIndex) {
          const el = document.getElementById(`line-${si}-${li}`)
          if (el) {
                    // Keep current line in the upper third so upcoming lyrics are always visible
                    const container = lyricsContainerRef.current
                    if (container) {
                      const elRect = el.getBoundingClientRect()
                      const containerRect = container.getBoundingClientRect()
                      const targetY = containerRect.top + containerRect.height * 0.25
                      const diff = elRect.top - targetY
                      // Only scroll if line is significantly off-target (>30px)
                      if (Math.abs(diff) > 30) {
                        container.scrollBy({ top: diff, behavior: 'smooth' })
                      }
                    }
                  }
          return
        }
        lineCount++
      }
    }
  }, [currentLineIndex, voiceEnabled, isListening, sections])

  // ===== AUTO-SCROLL MODE =====
  const autoScrollPausedRef = useRef(false)
  useEffect(() => { autoScrollPausedRef.current = autoScrollPaused }, [autoScrollPaused])

  useEffect(() => {
    if (autoScrollRef.current) {
      clearInterval(autoScrollRef.current)
      autoScrollRef.current = null
    }

    if (!autoScrollEnabled) return
    if (!lyricsContainerRef.current) return

    const bpmFactor = bpm / 120
    const basePixelsPerTick = 1.2 * bpmFactor
    const container = lyricsContainerRef.current
    const pixelsPerTick = Math.max(0.3, basePixelsPerTick)

    autoScrollRef.current = setInterval(() => {
      // Check pause via ref so we don't need it as a dependency (avoids re-creating interval)
      if (autoScrollPausedRef.current) return
      if (container) {
        container.scrollTop += pixelsPerTick
        if (container.scrollTop >= container.scrollHeight - container.clientHeight) {
          clearInterval(autoScrollRef.current)
          autoScrollRef.current = null
        }
      }
    }, 50)

    return () => {
      if (autoScrollRef.current) {
        clearInterval(autoScrollRef.current)
        autoScrollRef.current = null
      }
    }
  }, [autoScrollEnabled, currentSongIdx, bpm])

  // ===== TIMED + VOICE HYBRID MODE =====
  const syncMapRef = useRef([]) // maps synced line index → allLines index

  // Build a mapping from synced lines to allLines when song changes
  useEffect(() => {
    if (!syncedLines || !allLines.length) { syncMapRef.current = []; return }
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
    const map = []
    let lastMapped = -1
    for (let si = 0; si < syncedLines.length; si++) {
      const syncNorm = normalize(syncedLines[si].text)
      if (!syncNorm) continue
      let bestIdx = -1, bestScore = 0
      // Search forward from last mapped position
      const start = Math.max(0, lastMapped)
      const end = Math.min(allLines.length, start + 10)
      for (let ai = start; ai < end; ai++) {
        const lineNorm = normalize(allLines[ai])
        if (!lineNorm) continue
        // Check if they share significant content
        if (lineNorm === syncNorm) { bestIdx = ai; bestScore = 1; break }
        if (lineNorm.includes(syncNorm) || syncNorm.includes(lineNorm)) {
          const score = Math.min(lineNorm.length, syncNorm.length) / Math.max(lineNorm.length, syncNorm.length)
          if (score > bestScore) { bestScore = score; bestIdx = ai }
        }
      }
      if (bestIdx >= 0 && bestScore > 0.4) {
        map.push({ syncIdx: si, lineIdx: bestIdx, time: syncedLines[si].time })
        lastMapped = bestIdx + 1
      }
    }
    syncMapRef.current = map
  }, [syncedLines, allLines])

  const startTimed = useCallback(() => {
    if (!hasSyncedData) return
    timedStartRef.current = Date.now()
    timedLineIndexRef.current = 0
    setTimedRunning(true)
    setCurrentLineIndex(0)

    if (supported && !isListening) startListening()

    timedIntervalRef.current = setInterval(() => {
      if (!timedStartRef.current) return
      const elapsed = (Date.now() - timedStartRef.current) / 1000
      const map = syncMapRef.current
      if (!map.length) return

      // Find which mapped line we should be on based on elapsed time
      let finalIdx = 0
      for (let i = 0; i < map.length; i++) {
        if (map[i].time <= elapsed) {
          finalIdx = map[i].lineIdx
        } else {
          break
        }
      }

      // Voice correction: if voice is ahead by 1-5 lines, follow voice
      const voiceIdx = currentLineIndex
      if (voiceIdx > finalIdx && voiceIdx <= finalIdx + 5) {
        finalIdx = voiceIdx
      }

      // Only advance forward
      if (finalIdx > timedLineIndexRef.current) {
        timedLineIndexRef.current = finalIdx
        setCurrentLineIndex(finalIdx)

        let lineCount = 0
        for (let si = 0; si < sections.length; si++) {
          for (let li = 0; li < sections[si].lines.length; li++) {
            if (lineCount === finalIdx) {
              const el = document.getElementById(`line-${si}-${li}`)
              if (el) {
                    const container = lyricsContainerRef.current
                    if (container) {
                      const elRect = el.getBoundingClientRect()
                      const containerRect = container.getBoundingClientRect()
                      const targetY = containerRect.top + containerRect.height * 0.25
                      const diff = elRect.top - targetY
                      // Only scroll if line is significantly off-target (>30px)
                      if (Math.abs(diff) > 30) {
                        container.scrollBy({ top: diff, behavior: 'smooth' })
                      }
                    }
                  }
              return
            }
            lineCount++
          }
        }
      }
    }, 200) // Check 5 times per second for smooth tracking
  }, [hasSyncedData, syncedLines, allLines, sections, supported, isListening, startListening, currentLineIndex])

  const stopTimed = useCallback(() => {
    setTimedRunning(false)
    timedStartRef.current = null
    if (timedIntervalRef.current) {
      clearInterval(timedIntervalRef.current)
      timedIntervalRef.current = null
    }
    if (isListening) stopListening()
  }, [isListening, stopListening])

  // Cleanup timed mode on unmount or song change
  useEffect(() => {
    return () => {
      if (timedIntervalRef.current) {
        clearInterval(timedIntervalRef.current)
        timedIntervalRef.current = null
      }
    }
  }, [currentSongIdx])

  // ===== SONG NAVIGATION =====
  const goToSong = (idx) => {
    if (idx >= 0 && idx < songs.length) {
      setCurrentSongIdx(idx)
      resetRecognition(); resetCloud()
      setAutoScrollPaused(false)
      if (timedRunning) stopTimed()
      timedLineIndexRef.current = 0
      if (lyricsContainerRef.current) {
        lyricsContainerRef.current.scrollTop = 0
      }
    }
  }

  const handleTap = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const pct = y / rect.height

    // Top 12% = show controls
    if (pct < 0.12) {
      showControlsTemporarily()
      return
    }

    // If auto-scroll is active, tap to pause/resume
    if (autoScrollEnabled) {
      e.stopPropagation()
      setAutoScrollPaused(p => !p)
      return
    }

    // Manual mode: tap to scroll
    if (!voiceEnabled) {
      if (lyricsContainerRef.current) {
        const scrollAmount = window.innerHeight * 0.7
        lyricsContainerRef.current.scrollBy({ top: scrollAmount, behavior: 'smooth' })
      }
    }
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e) => {
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': goToSong(currentSongIdx + 1); break
        case 'ArrowLeft': case 'PageUp': goToSong(currentSongIdx - 1); break
        case 'ArrowDown': case ' ':
          e.preventDefault()
          if (autoScrollEnabled) { setAutoScrollPaused(p => !p); break }
          if (lyricsContainerRef.current) {
            lyricsContainerRef.current.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' })
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          if (lyricsContainerRef.current) {
            lyricsContainerRef.current.scrollBy({ top: -window.innerHeight * 0.7, behavior: 'smooth' })
          }
          break
        case 'Escape': navigate('/'); break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [currentSongIdx, navigate, autoScrollEnabled])

  if (!currentSong) {
    return (
      <div className="h-screen bg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-2xl text-slate-400 mb-4">No songs with lyrics to perform</p>
          <button onClick={() => navigate('/')} className="text-indigo-400 text-lg">
            Back to set list
          </button>
        </div>
      </div>
    )
  }

  // Calculate line highlight for voice mode
  const getLineHighlight = (sectionIdx, lineIdx) => {
    let count = 0
    for (let si = 0; si < sectionIdx; si++) {
      count += sections[si].lines.length
    }
    count += lineIdx
    return count === currentLineIndex && (
      (voiceEnabled && isListening) || (cloudVoiceEnabled && isCloudListening) || (timedEnabled && timedRunning)
    )
  }

  return (
    <div className="h-screen bg-black flex flex-col select-none" onClick={handleTap}>
      {/* Top bar — always visible, thin */}
      <div className="relative top-0 left-0 right-0 z-20 shrink-0">
        <div className="bg-black border-b border-white/5 px-3 py-1 flex items-center gap-2">
          {/* Left: back + song info */}
          <button
            onClick={(e) => { e.stopPropagation(); navigate('/') }}
            className="text-slate-500 hover:text-white text-[11px] px-1 shrink-0"
          >
            ←
          </button>

          <div className="flex items-center gap-1.5 min-w-0 shrink">
            {librarySong && <span className="text-[9px] uppercase text-cyan-500 shrink-0">Surprise</span>}
            <span className={`text-sm font-bold truncate ${librarySong ? 'text-cyan-400' : 'text-indigo-400'}`}>{currentSong.title}</span>
            <span className="text-[10px] text-slate-600 shrink-0">{currentSongIdx + 1}/{songs.length}</span>
          </div>

          <div className="flex-1" />

          {/* Right: controls */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setFontSize(f => Math.max(18, f - 4)) }}
              className="text-slate-500 hover:text-white w-6 h-6 flex items-center justify-center text-[11px]"
            >
              A-
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setFontSize(f => Math.min(56, f + 4)) }}
              className="text-slate-500 hover:text-white w-6 h-6 flex items-center justify-center text-[11px]"
            >
              A+
            </button>

            <div className="w-px h-4 bg-slate-800 mx-0.5" />

              {/* Local Voice mode toggle */}
              {supported && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setVoiceEnabled(v => {
                      if (!v) {
                        setCloudVoiceEnabled(false); stopCloud()
                        setAutoScrollEnabled(false)
                        setTimedEnabled(false); stopTimed()
                      }
                      return !v
                    })
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    voiceEnabled
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-700/80 text-slate-400'
                  }`}
                >
                  {voiceEnabled ? '🎙 Local' : '🎙 Voice'}
                </button>
              )}

              {/* Cloud Voice (Deepgram) toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setCloudVoiceEnabled(v => {
                    if (!v) {
                      setVoiceEnabled(false); if (isListening) stopListening()
                      setAutoScrollEnabled(false)
                      setTimedEnabled(false); stopTimed()
                    }
                    return !v
                  })
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  cloudVoiceEnabled
                    ? cloudConnected ? 'bg-blue-600 text-white' : 'bg-yellow-600 text-white'
                    : 'bg-slate-700/80 text-slate-400'
                }`}
              >
                {cloudVoiceEnabled ? (cloudConnected ? '☁ Cloud' : '☁ ...') : '☁ Cloud'}
              </button>

              {/* Auto-scroll toggle */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setAutoScrollEnabled(a => {
                    if (!a) {
                      setVoiceEnabled(false); setCloudVoiceEnabled(false); stopCloud()
                      setTimedEnabled(false); stopTimed()
                      setAutoScrollPaused(false)
                    }
                    return !a
                  })
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  autoScrollEnabled
                    ? autoScrollPaused
                      ? 'bg-amber-600 text-white'
                      : 'bg-emerald-600 text-white'
                    : 'bg-slate-700/80 text-slate-400'
                }`}
              >
                {autoScrollEnabled
                  ? autoScrollPaused ? '⏸ Paused' : '▶ Scrolling'
                  : '▶ Auto'}
              </button>

              {/* Timed + Voice hybrid toggle — only show if synced data exists */}
              {hasSyncedData && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!timedEnabled) {
                      setTimedEnabled(true)
                      setVoiceEnabled(false); setCloudVoiceEnabled(false); stopCloud()
                      setAutoScrollEnabled(false)
                      startTimed()
                    } else {
                      setTimedEnabled(false)
                      stopTimed()
                    }
                  }}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                    timedEnabled
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-700/80 text-slate-400'
                  }`}
                >
                  {timedEnabled ? '⏱ Synced' : '⏱ Timed'}
                </button>
              )}

              <div className="w-px h-4 bg-slate-800 mx-0.5" />

              {/* Set List jump button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowSetList(true)
                }}
                className="bg-slate-700/80 text-slate-400 px-2 py-0.5 rounded text-[11px] font-medium hover:text-white transition-colors"
              >
                Set List
              </button>

              {/* Library button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowLibrary(true)
                  showControlsTemporarily()
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  librarySong ? 'bg-cyan-600 text-white' : 'bg-slate-700/80 text-slate-400'
                }`}
              >
                {librarySong ? '📚 Library Song' : '📚 Library'}
              </button>

              {/* Back to set button — only when performing a library song */}
              {librarySong && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setLibrarySong(null)
                    setCurrentSongIdx(savedSetIdx ?? 0)
                    setSavedSetIdx(null)
                    resetRecognition(); resetCloud()
                    if (lyricsContainerRef.current) lyricsContainerRef.current.scrollTop = 0
                  }}
                  className="bg-indigo-600 text-white px-2 py-0.5 rounded text-[11px] font-medium"
                >
                  ← Back to Set
                </button>
              )}
            </div>
          </div>
        </div>

      {/* Lyrics */}
      <div
        ref={lyricsContainerRef}
        className="flex-1 overflow-y-auto px-4 pb-16"
        style={{ scrollBehavior: 'smooth' }}
      >
        {sections.length === 0 ? (
          <p className="text-center text-slate-500 text-lg mt-16">No lyrics available for this song</p>
        ) : (
          <div className="max-w-2xl mx-auto py-2">
            {sections.map((section, si) => (
              <div key={si} className="mb-8">
                {section.label && (
                  <div className="text-xs uppercase tracking-widest text-indigo-400/60 mb-2 font-medium">
                    {section.label}
                  </div>
                )}
                {section.lines.map((line, li) => (
                  <p
                    key={li}
                    id={`line-${si}-${li}`}
                    className={`leading-relaxed transition-all duration-300 ${
                      getLineHighlight(si, li)
                        ? 'text-white lyrics-active scale-105 origin-left'
                        : 'text-slate-200'
                    }`}
                    style={{ fontSize: `${fontSize}px`, lineHeight: 1.6 }}
                  >
                    {line}
                  </p>
                ))}
              </div>
            ))}
            <div className="h-[50vh]" />
          </div>
        )}
      </div>

      {/* Bottom bar: next song + navigation */}
      <div className="absolute bottom-0 left-0 right-0 z-20">
        {/* Next song indicator — always visible */}
        {currentSongIdx < songs.length - 1 ? (
          <div className="text-center py-1 bg-black/80">
            <span className="text-[10px] uppercase tracking-widest text-slate-600 mr-2">Next:</span>
            <span className="text-xs text-slate-400 font-medium">{songs[currentSongIdx + 1].title}</span>
          </div>
        ) : (
          <div className="text-center py-1 bg-black/80">
            <span className="text-[10px] uppercase tracking-widest text-slate-600">Last song</span>
          </div>
        )}
        <div className="bg-black/95 px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <button
              onClick={(e) => { e.stopPropagation(); goToSong(currentSongIdx - 1) }}
              disabled={currentSongIdx === 0}
              className="text-slate-400 hover:text-white disabled:opacity-20 px-4 py-3 text-lg font-medium"
            >
              ← Prev
            </button>

            <div className="flex gap-1.5 items-center overflow-hidden max-w-[50%]">
              {songs.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); goToSong(i) }}
                  className={`shrink-0 rounded-full transition-all ${
                    i === currentSongIdx
                      ? 'w-3 h-3 bg-indigo-500'
                      : 'w-2 h-2 bg-slate-600 hover:bg-slate-400'
                  }`}
                />
              ))}
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); goToSong(currentSongIdx + 1) }}
              disabled={currentSongIdx === songs.length - 1}
              className="text-slate-400 hover:text-white disabled:opacity-20 px-4 py-3 text-lg font-medium"
            >
              Next →
            </button>
          </div>
        </div>
      </div>


      {/* Set List jump overlay */}
      {showSetList && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
            <h2 className="text-lg font-bold text-indigo-400">Jump to Song</h2>
            <button
              onClick={() => setShowSetList(false)}
              className="text-slate-400 hover:text-white text-2xl px-3 py-1"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-2">
            <div className="max-w-xl mx-auto">
              {(() => {
                // Group songs by setName
                let currentSet = null
                let songNum = 0
                return songs.map((song, idx) => {
                  const showHeader = song.setName !== currentSet
                  currentSet = song.setName
                  songNum++
                  return (
                    <div key={idx}>
                      {showHeader && (
                        <div className="text-xs uppercase tracking-widest text-slate-500 font-semibold mt-4 mb-1 px-3">
                          {song.setName}
                        </div>
                      )}
                      <button
                        onClick={() => {
                          if (librarySong) {
                            setLibrarySong(null)
                            setSavedSetIdx(null)
                          }
                          setCurrentSongIdx(idx)
                          resetRecognition(); resetCloud()
                          if (lyricsContainerRef.current) lyricsContainerRef.current.scrollTop = 0
                          setShowSetList(false)
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors flex items-center gap-3 mb-1 ${
                          idx === currentSongIdx && !librarySong
                            ? 'bg-indigo-900/40 border border-indigo-500/30'
                            : 'bg-slate-800/60 hover:bg-slate-700/60'
                        }`}
                      >
                        <span className="text-slate-500 font-mono text-sm w-6 text-right shrink-0">{songNum}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white">{song.title}</div>
                          {song.artist && <div className="text-xs text-slate-400">{song.artist}</div>}
                        </div>
                        {idx === currentSongIdx && !librarySong && (
                          <span className="text-[10px] text-indigo-400 shrink-0">Now playing</span>
                        )}
                      </button>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Library overlay */}
      {showLibrary && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
            <h2 className="text-lg font-bold text-cyan-400">Song Library</h2>
            <button
              onClick={() => setShowLibrary(false)}
              className="text-slate-400 hover:text-white text-2xl px-3 py-1"
            >
              ✕
            </button>
          </div>

          {/* Song list — alphabetically sorted, only songs with lyrics */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            <div className="max-w-2xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-1">
              {allSongs
                .filter(s => s.lyrics && s.lyrics.length > 0 && !songs.some(ss => ss.id === s.id))
                .sort((a, b) => a.title.localeCompare(b.title))
                .map(song => (
                    <button
                      key={song.id}
                      onClick={() => {
                        if (!librarySong) {
                          setSavedSetIdx(currentSongIdx)
                        }
                        setLibrarySong({ ...song, setName: 'Library' })
                        setShowLibrary(false)
                        resetRecognition(); resetCloud()
                        if (lyricsContainerRef.current) lyricsContainerRef.current.scrollTop = 0
                      }}
                      className="text-left px-3 py-2.5 rounded-lg transition-colors bg-slate-800/60 hover:bg-slate-700/60"
                    >
                      <div className="text-sm font-medium text-white">{song.title}</div>
                      {song.artist && <div className="text-xs text-slate-400">{song.artist}</div>}
                    </button>
                ))
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
