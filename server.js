import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

/**
 * Try multiple lyrics sources in order until one succeeds.
 */
async function fetchLyricsFromSources(artist, title) {
  // Source 1: lyrics.ovh (free API, no scraping needed)
  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const data = await response.json();
      if (data.lyrics && data.lyrics.trim().length > 50) {
        console.log(`[lyrics] Found via lyrics.ovh: ${artist} - ${title}`);
        return data.lyrics.trim();
      }
    }
  } catch (e) {
    console.log(`[lyrics] lyrics.ovh failed for ${artist} - ${title}: ${e.message}`);
  }

  // Source 2: lrclib.net (free API with synced lyrics)
  try {
    const url = `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const results = await response.json();
      if (results.length > 0 && results[0].plainLyrics) {
        console.log(`[lyrics] Found via lrclib.net: ${artist} - ${title}`);
        return results[0].plainLyrics.trim();
      }
    }
  } catch (e) {
    console.log(`[lyrics] lrclib.net failed for ${artist} - ${title}: ${e.message}`);
  }

  return null;
}

// Lyrics fetching endpoint
app.get('/api/lyrics', async (req, res) => {
  const { artist, title } = req.query;

  if (!artist || !title) {
    return res.status(400).json({ error: 'Artist and title are required' });
  }

  try {
    console.log(`[lyrics] Searching: "${title}" by ${artist}`);
    const lyrics = await fetchLyricsFromSources(artist, title);

    if (lyrics) {
      return res.json({ lyrics, artist, title });
    }

    // Try without special characters in title (e.g., "Don't" → "Dont")
    const cleanTitle = title.replace(/['']/g, '').replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanTitle !== title) {
      console.log(`[lyrics] Retrying with cleaned title: "${cleanTitle}"`);
      const retryLyrics = await fetchLyricsFromSources(artist, cleanTitle);
      if (retryLyrics) {
        return res.json({ lyrics: retryLyrics, artist, title });
      }
    }

    console.log(`[lyrics] Not found: "${title}" by ${artist}`);
    res.status(404).json({
      error: 'Lyrics not found',
      suggestion: `Could not find lyrics for "${title}" by "${artist}". Try pasting lyrics manually.`
    });

  } catch (error) {
    console.error('[lyrics] Error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch lyrics',
      suggestion: 'Try again later or paste lyrics manually.'
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// In production, serve the built frontend
const distPath = join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback — serve index.html for any non-API route
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(join(distPath, 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`LiveLyrics server running on http://localhost:${PORT}`);
});
