import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { splitLyricsIntoSections } from '../utils/lyricsService'
import { useSpeechRecognition } from '../hooks/useSpeechRecognition'

export default function PerformView({ songs }) {
  const navigate = useNavigate()
  const [currentSongIdx, setCurrentSongIdx] = useState(0)
  const [fontSize, setFontSize] = useState(32)
  const [scrollMode, setScrollMode] = useState('manual') // 'manual' | 'voice'
  const [showControls, setShowControls] = useState(true)
  const lyricsContainerRef = useRef(null)
  const controlsTimeoutRef = useRef(null)
  const wakeLockRef = useRef(null)

  const currentSong = songs[currentSongIdx]
  const sections = currentSong ? splitLyricsIntoSections(currentSong.lyrics) : []

  // Flatten all lines for speech recognition
  const allLines = sections.flatMap(s => s.lines)

  const {
    isListening, currentLineIndex, setCurrentLineIndex,
    confidence, supported, start: startListening, stop: stopListening, reset: resetRecognition
  } = useSpeechRecognition(allLines)

  // Request fullscreen + wake lock on mount
  useEffect(() => {
    // Enter fullscreen (hides browser UI — critical for iPad stage use)
    const enterFullscreen = async () => {
      try {
        const el = document.documentElement
        if (el.requestFullscreen) {
          await el.requestFullscreen()
        } else if (el.webkitRequestFullscreen) {
          await el.webkitRequestFullscreen() // Safari/iPad
        }
      } catch (e) {
        // Fullscreen not available or denied — still works, just with browser chrome
      }
    }
    enterFullscreen()

    // Prevent screen sleep
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request('screen')
        }
      } catch (e) {
        // Wake lock not available
      }
    }
    requestWakeLock()

    return () => {
      wakeLockRef.current?.release()
      // Exit fullscreen when leaving perform mode
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)
      }
    }
  }, [])

  // Auto-hide controls after 3 seconds
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true)
    clearTimeout(controlsTimeoutRef.current)
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000)
  }, [])

  // Scroll to active line when voice recognition updates
  useEffect(() => {
    if (scrollMode !== 'voice' || !isListening) return

    // Find which section/line corresponds to currentLineIndex
    let lineCount = 0
    for (let si = 0; si < sections.length; si++) {
      for (let li = 0; li < sections[si].lines.length; li++) {
        if (lineCount === currentLineIndex) {
          const el = document.getElementById(`line-${si}-${li}`)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
          return
        }
        lineCount++
      }
    }
  }, [currentLineIndex, scrollMode, isListening, sections])

  // Handle voice mode toggle
  useEffect(() => {
    if (scrollMode === 'voice' && !isListening && supported) {
      startListening()
    } else if (scrollMode !== 'voice' && isListening) {
      stopListening()
    }
    return () => {
      if (isListening) stopListening()
    }
  }, [scrollMode])

  const goToSong = (idx) => {
    if (idx >= 0 && idx < songs.length) {
      setCurrentSongIdx(idx)
      resetRecognition()
      if (lyricsContainerRef.current) {
        lyricsContainerRef.current.scrollTop = 0
      }
    }
  }

  const handleTap = (e) => {
    // If tapping the top 15% of screen, show controls
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const pct = y / rect.height

    if (pct < 0.15) {
      showControlsTemporarily()
      return
    }

    if (scrollMode === 'manual') {
      // Tap to scroll down by one "page" (80% of viewport height)
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
        case 'ArrowRight':
        case 'PageDown':
          goToSong(currentSongIdx + 1)
          break
        case 'ArrowLeft':
        case 'PageUp':
          goToSong(currentSongIdx - 1)
          break
        case 'ArrowDown':
        case ' ':
          e.preventDefault()
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
        case 'Escape':
          navigate('/')
          break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [currentSongIdx, navigate])

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

  // Calculate line highlight index relative to sections
  let lineCounter = 0
  const getLineHighlight = (sectionIdx, lineIdx) => {
    let count = 0
    for (let si = 0; si < sectionIdx; si++) {
      count += sections[si].lines.length
    }
    count += lineIdx
    return count === currentLineIndex && scrollMode === 'voice' && isListening
  }

  return (
    <div className="h-screen bg-black flex flex-col select-none" onClick={handleTap}>
      {/* Top controls - fade in/out */}
      <div className={`absolute top-0 left-0 right-0 z-20 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="bg-gradient-to-b from-black/90 to-transparent px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={(e) => { e.stopPropagation(); navigate('/') }}
              className="text-slate-400 hover:text-white text-sm px-3 py-2"
            >
              ← Back
            </button>

            <div className="text-center">
              <div className="text-xs text-slate-500">
                {currentSong.setName} &middot; Song {currentSongIdx + 1} of {songs.length}
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Font size */}
              <button
                onClick={(e) => { e.stopPropagation(); setFontSize(f => Math.max(18, f - 4)) }}
                className="text-slate-400 hover:text-white w-8 h-8 flex items-center justify-center text-lg"
              >
                A-
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setFontSize(f => Math.min(56, f + 4)) }}
                className="text-slate-400 hover:text-white w-8 h-8 flex items-center justify-center text-lg"
              >
                A+
              </button>

              {/* Scroll mode toggle */}
              {supported && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setScrollMode(m => m === 'manual' ? 'voice' : 'manual')
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    scrollMode === 'voice'
                      ? 'bg-red-600 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {scrollMode === 'voice' ? '🎙 Listening' : '🎙 Auto'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Song title — compact, stays visible */}
      <div className="pt-12 px-4 pb-1 text-center shrink-0">
        <h1 className="text-lg font-bold text-indigo-400 leading-tight">{currentSong.title}</h1>
      </div>

      {/* Lyrics — fills entire remaining screen */}
      <div
        ref={lyricsContainerRef}
        className="flex-1 overflow-y-auto px-4 pb-20"
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
            {/* Extra space at bottom so last lines can be scrolled to center */}
            <div className="h-[50vh]" />
          </div>
        )}
      </div>

      {/* Bottom navigation — minimal footprint */}
      <div className="absolute bottom-0 left-0 right-0 z-20">
        <div className="bg-gradient-to-t from-black/95 to-transparent px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <button
              onClick={(e) => { e.stopPropagation(); goToSong(currentSongIdx - 1) }}
              disabled={currentSongIdx === 0}
              className="text-slate-400 hover:text-white disabled:opacity-20 px-4 py-3 text-lg font-medium"
            >
              ← Prev
            </button>

            {/* Progress dots */}
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

      {/* Voice recognition indicator */}
      {scrollMode === 'voice' && isListening && (
        <div className="absolute top-16 right-4 z-30">
          <div className="flex items-center gap-1.5 bg-red-900/80 px-2.5 py-1 rounded-full">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-xs text-red-200">LIVE</span>
          </div>
        </div>
      )}
    </div>
  )
}
