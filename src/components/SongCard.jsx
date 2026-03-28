const statusColors = {
  pending: 'bg-slate-600',
  attention: 'bg-amber-600',
  fetching: 'bg-yellow-600',
  fetched: 'bg-emerald-600',
  cached: 'bg-emerald-600',
  manual: 'bg-blue-600',
  failed: 'bg-red-600'
}

const statusLabels = {
  pending: 'No lyrics',
  attention: 'Needs info',
  fetching: 'Fetching...',
  fetched: 'Lyrics ready',
  cached: 'From library',
  manual: 'Lyrics ready',
  failed: 'Not found'
}

export default function SongCard({ song, index, onEdit, onRemove, onMoveUp, onMoveDown }) {
  const needsAttention = song.needsAttention || song.lyricsStatus === 'attention'

  return (
    <div className={`rounded-lg p-3 flex items-center gap-3 group ${
      needsAttention ? 'bg-amber-900/30 border border-amber-700/50' : 'bg-slate-800'
    }`}>
      {/* Song number */}
      <span className="text-slate-500 font-mono text-sm w-6 text-right shrink-0">
        {index + 1}
      </span>

      {/* Reorder buttons */}
      <div className="flex flex-col gap-0.5 shrink-0">
        <button
          onClick={onMoveUp}
          disabled={!onMoveUp}
          className="text-slate-500 hover:text-white disabled:opacity-20 text-xs leading-none p-0.5"
        >
          ▲
        </button>
        <button
          onClick={onMoveDown}
          disabled={!onMoveDown}
          className="text-slate-500 hover:text-white disabled:opacity-20 text-xs leading-none p-0.5"
        >
          ▼
        </button>
      </div>

      {/* Song info */}
      <div className="flex-1 min-w-0">
        <div className="font-medium text-white truncate">{song.title}</div>
        {song.artist ? (
          <div className="text-sm text-slate-400 truncate">{song.artist}</div>
        ) : needsAttention ? (
          <div className="text-sm text-amber-400 truncate">Tap edit to set title, artist & lyrics</div>
        ) : null}
      </div>

      {/* Status badge */}
      <span className={`${statusColors[song.lyricsStatus]} px-2 py-0.5 rounded-full text-xs text-white shrink-0`}>
        {statusLabels[song.lyricsStatus]}
      </span>

      {/* Actions */}
      <div className="flex gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className={`p-1.5 text-sm ${needsAttention ? 'text-amber-400 hover:text-amber-300' : 'text-slate-400 hover:text-indigo-400'}`}
          title="Edit lyrics"
        >
          ✏️
        </button>
        <button
          onClick={onRemove}
          className="text-slate-400 hover:text-red-400 p-1.5 text-sm"
          title="Remove song"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
