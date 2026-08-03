import { useState, useEffect, useRef } from 'react'

/**
 * In-app replacement for window.confirm().
 *
 * Native dialogs are not dependable here: a browser that has suppressed repeated
 * dialogs, and some embedded/standalone webviews, return false immediately
 * without ever showing anything. Every confirm-gated action then silently did
 * nothing — which is exactly how Factory Reset appeared to be broken.
 *
 * Set `requireText` to demand the user type a word before the action unlocks,
 * for the genuinely irreversible ones.
 */
export default function ConfirmDialog({
  title,
  message,
  bullets,
  confirmLabel = 'Confirm',
  requireText,
  onResolve
}) {
  const [typed, setTyped] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onResolve(false)
    }
    window.addEventListener('keydown', onKey)
    if (requireText) inputRef.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onResolve, requireText])

  const unlocked = !requireText || typed.trim().toUpperCase() === requireText.toUpperCase()

  return (
    <div
      className="fixed inset-0 bg-black/75 z-[60] flex items-center justify-center p-4"
      onClick={() => onResolve(false)}
    >
      <div
        className="bg-slate-800 border border-slate-600 rounded-xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-slate-100 font-semibold text-lg mb-2">{title}</h2>

        {message && (
          <p className="text-slate-300 text-sm mb-3 whitespace-pre-line">{message}</p>
        )}

        {bullets?.length > 0 && (
          <ul className="text-slate-300 text-sm mb-3 space-y-1">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-slate-500">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {requireText && (
          <div className="mb-4">
            <label className="block text-slate-400 text-xs mb-1.5">
              Type <span className="text-red-300 font-semibold">{requireText}</span> to confirm
            </label>
            <input
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && unlocked) onResolve(true) }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100"
            />
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => onResolve(false)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onResolve(true)}
            disabled={!unlocked}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              unlocked
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
