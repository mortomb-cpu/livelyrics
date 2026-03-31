import { useRef } from 'react'
import { Droppable, Draggable } from '@hello-pangea/dnd'
import { parseFile } from '../utils/fileParser'
import { getCachedLyrics } from '../utils/lyricsCache'
import SongCard from './SongCard'

export default function AdditionalSongsPanel({ songs, additionalSongIds, onEdit, onRemove, onAddSongs }) {
  const fileInputRef = useRef(null)

  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    try {
      const parsed = await parseFile(file)
      if (parsed.length === 0) return

      // Build song objects, check cache for each
      const newSongs = await Promise.all(parsed.map(async (s) => {
        const cached = s.artist ? await getCachedLyrics(s.artist, s.title) : null
        return {
          id: Date.now().toString() + Math.random().toString(36).slice(2),
          title: s.title,
          artist: s.artist,
          lyrics: cached || '',
          lyricsStatus: cached ? 'cached' : (s.needsAttention ? 'attention' : 'pending'),
          setIndex: 0,
          needsAttention: s.needsAttention || false,
          rawTitle: s.rawTitle || ''
        }
      }))

      onAddSongs(newSongs)
    } catch (err) {
      console.error('Failed to parse additional songs file:', err)
    }

    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const additionalSongs = additionalSongIds
    .map(id => songs.find(s => s.id === id))
    .filter(Boolean)


  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl flex flex-col max-h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="p-3 border-b border-slate-700 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
            Additional Songs
          </h2>
          <span className="text-xs text-slate-500 bg-slate-700 px-2 py-0.5 rounded-full">
            {additionalSongs.length}
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.docx,.pdf,.txt"
          onChange={handleUpload}
          className="hidden"
          id="additional-upload"
        />
        <label
          htmlFor="additional-upload"
          className="cursor-pointer block text-center bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors"
        >
          + Upload Songs
        </label>
      </div>

      {/* Song list */}
      <Droppable droppableId="additional">
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 overflow-y-auto p-1 min-h-[80px] transition-colors ${
              snapshot.isDraggingOver ? 'bg-indigo-900/20' : ''
            }`}
          >
            {additionalSongs.length === 0 && (
              <div className="text-center py-8 px-3">
                <p className="text-slate-500 text-xs">
                  Drag songs here from the set list, or upload your band's full repertoire.
                </p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-0.5">
              {additionalSongs.map((song, idx) => (
                  <Draggable
                    key={song.id}
                    draggableId={song.id}
                    index={idx}
                  >
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        {...dragProvided.dragHandleProps}
                      >
                        <SongCard
                          song={song}
                          compact
                          isDragging={dragSnapshot.isDragging}
                          onEdit={() => onEdit(song)}
                          onRemove={() => onRemove(song.id)}
                        />
                      </div>
                    )}
                  </Draggable>
              ))}
            </div>
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  )
}
