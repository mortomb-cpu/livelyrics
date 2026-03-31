import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as cheerio from 'cheerio';

const GENIUS_TOKEN = 'vtbuRd3VchwIH7bHATJDMqpxRDDfxddLZQgHsO3xVfCGZGSB9L-Ed9-cWoEHACyW';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

/**
 * Fetch lyrics from a single source. Returns { lyrics, source } or null.
 */
async function fetchFromLyricsOvh(artist, title) {
  try {
    const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const data = await response.json();
      if (data.lyrics && data.lyrics.trim().length > 50) {
        return { lyrics: data.lyrics.trim(), source: 'lyrics.ovh' };
      }
    }
  } catch (e) {
    console.log(`[lyrics] lyrics.ovh failed: ${e.message}`);
  }
  return null;
}

async function fetchFromLrclib(artist, title) {
  try {
    const url = `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const results = await response.json();
      if (results.length > 0 && results[0].plainLyrics) {
        return { lyrics: results[0].plainLyrics.trim(), source: 'lrclib.net' };
      }
    }
  } catch (e) {
    console.log(`[lyrics] lrclib.net failed: ${e.message}`);
  }
  return null;
}

/**
 * Fetch synced (timestamped) lyrics from lrclib.net.
 * Returns array of { time: seconds, text: "lyric line" } or null.
 */
async function fetchSyncedLyrics(artist, title) {
  try {
    const params = new URLSearchParams({ track_name: title });
    if (artist) params.set('artist_name', artist);
    const url = `https://lrclib.net/api/search?${params}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;

    const results = await response.json();
    // Find first result with synced lyrics
    const match = results.find(r => r.syncedLyrics && r.syncedLyrics.trim().length > 50);
    if (!match) return null;

    // Parse LRC format: [mm:ss.xx] text
    const lines = match.syncedLyrics.split('\n');
    const synced = [];
    for (const line of lines) {
      const m = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/);
      if (m) {
        const mins = parseInt(m[1]);
        const secs = parseInt(m[2]);
        const ms = parseInt(m[3].padEnd(3, '0'));
        const time = mins * 60 + secs + ms / 1000;
        const text = m[4].trim();
        if (text) { // Skip empty timestamp lines
          synced.push({ time, text });
        }
      }
    }

    if (synced.length > 5) {
      console.log(`[lyrics] Found ${synced.length} synced lines from lrclib.net for "${title}"`);
      return { syncedLines: synced, duration: match.duration || null };
    }
  } catch (e) {
    console.log(`[lyrics] Synced lyrics fetch failed: ${e.message}`);
  }
  return null;
}

async function fetchFromChartLyrics(artist, title) {
  try {
    const searchUrl = `http://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${encodeURIComponent(artist)}&song=${encodeURIComponent(title)}`;
    const response = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) });
    if (response.ok) {
      const text = await response.text();
      // Extract lyrics from XML response
      const match = text.match(/<Lyric>([\s\S]*?)<\/Lyric>/);
      if (match && match[1] && match[1].trim().length > 50) {
        return { lyrics: match[1].trim(), source: 'chartlyrics.com' };
      }
    }
  } catch (e) {
    console.log(`[lyrics] chartlyrics failed: ${e.message}`);
  }
  return null;
}

/**
 * Fetch from Genius: search API → get song URL → scrape lyrics from page.
 * Genius often has the best-structured lyrics with [Verse], [Chorus] labels.
 */
async function fetchFromGenius(artist, title) {
  try {
    // Step 1: Search for the song
    const query = artist ? `${artist} ${title}` : title;
    const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${GENIUS_TOKEN}` },
      signal: AbortSignal.timeout(10000)
    });

    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const hits = searchData.response?.hits;
    if (!hits || hits.length === 0) return null;

    // Find the best match — check that artist roughly matches (if we have one)
    let songUrl = null;
    if (artist) {
      const artistLower = artist.toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const hit of hits.slice(0, 5)) {
        const hitArtist = (hit.result?.primary_artist?.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (hitArtist.includes(artistLower) || artistLower.includes(hitArtist)) {
          songUrl = hit.result?.url;
          break;
        }
      }
    }
    // Fallback to first result if no artist match or no artist provided
    if (!songUrl && hits[0]?.result?.url) {
      songUrl = hits[0].result.url;
    }
    if (!songUrl) return null;

    // Step 2: Scrape lyrics from the Genius page
    const pageRes = await fetch(songUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiveLyrics/1.0)' },
      signal: AbortSignal.timeout(15000)
    });
    if (!pageRes.ok) return null;

    const html = await pageRes.text();
    const $ = cheerio.load(html);

    // Genius lyrics are in divs with data-lyrics-container="true"
    let lyrics = '';
    $('[data-lyrics-container="true"]').each((_, el) => {
      // Replace <br> with newlines before extracting text
      $(el).find('br').replaceWith('\n');
      // Section headers are in <a> or <span> elements — preserve them
      const text = $(el).html();
      if (text) {
        // Convert HTML to text, preserving line breaks
        const cleaned = text
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/?(div|p)[^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, '') // strip remaining HTML tags
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#x27;/g, "'")
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ');
        lyrics += cleaned + '\n';
      }
    });

    lyrics = lyrics.trim();

    // AGGRESSIVE CLEANUP: Strip everything before the first [ section header.
    const firstHeader = lyrics.search(/^\[/m);
    if (firstHeader > 0) {
      lyrics = lyrics.substring(firstHeader).trim();
    }
    // If no headers, try to cut after "Lyrics" label
    if (firstHeader === -1) {
      const lyricsLabel = lyrics.search(/Lyrics\s*\n/i);
      if (lyricsLabel >= 0) {
        const afterLabel = lyrics.indexOf('\n', lyricsLabel);
        if (afterLabel >= 0) lyrics = lyrics.substring(afterLabel).trim();
      }
    }

    // Remove all known junk lines
    lyrics = lyrics.split('\n').filter(line => {
      const t = line.trim();
      if (!t) return true;
      if (/^\d+\s*contributors?/i.test(t)) return false;
      if (/^\d*\s*Embed$/i.test(t)) return false;
      if (/^translations?$/i.test(t)) return false;
      if (/Lyrics$/i.test(t) && t.split(' ').length <= 5) return false;
      if (/Read More/i.test(t)) return false;
      // Language names (individual or concatenated without spaces)
      if (/^[A-Za-zÀ-ÿА-яа-я\u0600-\u06FF\u4e00-\u9fff\uAC00-\uD7AF]{25,}$/.test(t)) return false;
      if (/^(Français|Português|Polski|Deutsch|Español|Italiano|Türkçe|Česky)/i.test(t)) return false;
      if (/Українська|Русский|العربية|Österreichisches/i.test(t)) return false;
      // Song descriptions / prose
      if (/^This song is/i.test(t)) return false;
      if (/^According to/i.test(t)) return false;
      if (/^The (song|track|band|album|single) (is|was|has|features|deals|explores|describes|tells|captures|became|reached)/i.test(t)) return false;
      if (/^In (this|the) (song|track)/i.test(t)) return false;
      if (/^(It|This) (is|was|has|became|reached|peaked|debuted|features)/i.test(t)) return false;
      if (/^Clocking in at/i.test(t)) return false;
      if (/by following her around/i.test(t)) return false;
      // Long prose (descriptions have periods, commas, and many words)
      if (t.length > 80 && (t.split('.').length > 2 || t.split(',').length > 3)) return false;
      // Genius UI elements
      if (/^You might also like/i.test(t)) return false;
      if (/^See .* Live/i.test(t)) return false;
      if (/^Get tickets/i.test(t)) return false;
      if (/^How to Format/i.test(t)) return false;
      if (/^Sign Up/i.test(t)) return false;
      return true;
    }).join('\n').trim();

    if (lyrics.length > 50) {
      console.log(`[lyrics] Found via Genius: ${artist} - ${title}`);
      return { lyrics, source: 'genius.com' };
    }
  } catch (e) {
    console.log(`[lyrics] Genius failed: ${e.message}`);
  }
  return null;
}

/**
 * Fetch from ALL sources in parallel, return all results.
 */
async function fetchAllSources(artist, title) {
  const results = await Promise.allSettled([
    fetchFromGenius(artist, title),
    fetchFromLyricsOvh(artist, title),
    fetchFromLrclib(artist, title),
    fetchFromChartLyrics(artist, title),
  ]);

  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);
}

/**
 * Score a lyrics string by structural quality.
 * Higher = better structured.
 */
function scoreStructure(lyrics) {
  if (!lyrics) return 0;

  const lines = lyrics.split('\n');
  let score = 0;

  // Count section headers like [Verse], [Chorus], Verse:, Chorus: etc.
  const headerPattern = /^\[?.*(verse|chorus|bridge|outro|intro|pre[- ]?chorus|refrain|hook|interlude|solo).*\]?:?\s*$/i;
  const headers = lines.filter(l => headerPattern.test(l.trim()));
  score += headers.length * 20;

  // Count blank lines (section separators) — more = better structured
  const blankLines = lines.filter(l => l.trim() === '').length;
  score += Math.min(blankLines, 15) * 3;

  // Penalize wall-of-text (many consecutive non-blank lines without any break)
  let maxConsecutive = 0;
  let consecutive = 0;
  for (const line of lines) {
    if (line.trim() === '' || headerPattern.test(line.trim())) {
      consecutive = 0;
    } else {
      consecutive++;
      maxConsecutive = Math.max(maxConsecutive, consecutive);
    }
  }
  if (maxConsecutive > 12) score -= (maxConsecutive - 12) * 5;

  // Bonus: has both [Verse] and [Chorus] type headers
  const hasVerse = headers.some(h => /verse/i.test(h));
  const hasChorus = headers.some(h => /chorus/i.test(h));
  if (hasVerse && hasChorus) score += 30;

  // Bonus: reasonable total length (not too short, not suspiciously long)
  const nonEmpty = lines.filter(l => l.trim() !== '' && !headerPattern.test(l.trim())).length;
  if (nonEmpty >= 15 && nonEmpty <= 120) score += 10;

  return score;
}

/**
 * Clean up lyrics without guessing structure.
 * Only normalizes what's already there — no inventing headers.
 * - Normalizes existing section headers to [Bracket] format
 * - Ensures blank lines between sections
 * - Removes junk/metadata lines
 */
function cleanLyrics(raw) {
  if (!raw) return raw;

  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const junkPatterns = [
    /^\d+\s*contributors?$/i,
    /^.*embed$/i,
    /^.*you might also like.*$/i,
    /^paroles de la chanson.*$/i,
    /^lyrics licensed.*$/i,
    /^source\s*:.*$/i,
    /^writer\(s\).*$/i,
    /^lyricist\s*:.*$/i,
    /^songwriter\s*:.*$/i,
    /^\d+\s*contributors?/i,
    /^translations?$/i,
    /^(Français|Português|Italiano|Deutsch|Español|Українська|Русский)/i,
    /Read More$/i,
    /^This song is (mainly |)about/i,
    /^See .* Live$/i,
    /^Get tickets/i,
    /^\d+Embed$/i,
  ];

  let lines = text.split('\n');

  // Remove junk lines
  lines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines
    return !junkPatterns.some(p => p.test(trimmed));
  });

  // Normalize existing section headers to consistent [Bracket] format
  lines = lines.map(line => {
    const trimmed = line.trim();

    // Already in [bracket] format — normalize capitalization
    const bracketMatch = trimmed.match(/^\[(.+?)\]$/);
    if (bracketMatch) {
      const label = bracketMatch[1].trim();
      return `[${label.charAt(0).toUpperCase() + label.slice(1)}]`;
    }

    // Unbracketed headers like "Verse 1:", "Chorus:", "Bridge:" (standalone on their own line)
    const headerMatch = trimmed.match(/^(verse\s*\d*|chorus\s*\d*|bridge\s*\d*|outro|intro|pre[- ]?chorus\s*\d*|refrain|hook|interlude\s*\d*|solo|coda|post[- ]?chorus)\s*:?\s*$/i);
    if (headerMatch) {
      const label = headerMatch[1].replace(/\s+/g, ' ').trim();
      return `[${label.charAt(0).toUpperCase() + label.slice(1)}]`;
    }

    return line;
  });

  // Ensure blank lines before section headers
  const result = [];
  for (let j = 0; j < lines.length; j++) {
    const trimmed = lines[j].trim();

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      if (result.length > 0 && result[result.length - 1].trim() !== '') {
        result.push('');
      }
      result.push(trimmed);
      continue;
    }

    result.push(lines[j]);
  }

  // Collapse 3+ consecutive blank lines down to 1
  let final = result.join('\n').replace(/\n{3,}/g, '\n\n');
  final = final.trim();

  return final;
}

/**
 * Fallback: add section labels to lyrics that have NO headers.
 * Groups lines by blank-line separators, detects repeated groups as [Chorus],
 * labels unique groups as [Verse 1], [Verse 2], etc.
 * Only called when no source provided any structure.
 */
function addStructureLabels(lyrics) {
  const lines = lyrics.split('\n');

  // Split into groups separated by blank lines
  const groups = [];
  let current = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) {
        groups.push(current);
        current = [];
      }
    } else {
      current.push(line.trim());
    }
  }
  if (current.length > 0) groups.push(current);

  if (groups.length <= 1) return lyrics; // Nothing to structure

  // Normalize a group to a comparison key (lowercase, no punctuation)
  const groupKey = (g) => g.map(l => l.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()).join('|');

  // Count how many times each group pattern appears
  const keyCounts = {};
  const groupKeys = groups.map(g => groupKey(g));
  groupKeys.forEach(k => { keyCounts[k] = (keyCounts[k] || 0) + 1; });

  // Groups appearing 2+ times are chorus candidates
  const repeatedKeys = new Set(
    Object.entries(keyCounts).filter(([, c]) => c >= 2).map(([k]) => k)
  );

  // Build output with labels
  let verseNum = 1;
  let chorusCount = 0;
  const output = [];

  for (let i = 0; i < groups.length; i++) {
    const key = groupKeys[i];
    const isChorus = repeatedKeys.has(key);

    if (output.length > 0) output.push(''); // blank line before section

    if (isChorus) {
      chorusCount++;
      output.push('[Chorus]');
    } else {
      output.push(`[Verse ${verseNum}]`);
      verseNum++;
    }

    for (const line of groups[i]) {
      output.push(line);
    }
  }

  return output.join('\n');
}

/**
 * Pick best version from multiple sources.
 * If the best version still has no section headers, apply structure detection as fallback.
 */
function pickBestVersion(versions) {
  if (versions.length === 0) return null;
  if (versions.length === 1) {
    const cleaned = cleanLyrics(versions[0].lyrics);
    const score = scoreStructure(cleaned);
    if (score < 10) {
      console.log(`[lyrics] No structure found, applying fallback labeling`);
      return addStructureLabels(cleaned);
    }
    return cleaned;
  }

  // Clean all versions first
  const cleaned = versions.map(v => ({
    ...v,
    cleaned: cleanLyrics(v.lyrics),
    score: scoreStructure(cleanLyrics(v.lyrics))
  }));

  // Sort by structure score, best first
  cleaned.sort((a, b) => b.score - a.score);

  console.log(`[lyrics] Source scores: ${cleaned.map(v => `${v.source}=${v.score}`).join(', ')}`);

  const best = cleaned[0];

  // If even the best version has no real structure, apply fallback labeling
  if (best.score < 10) {
    console.log(`[lyrics] Best score too low (${best.score}), applying fallback labeling`);
    return addStructureLabels(best.cleaned);
  }

  return best.cleaned;
}

/**
 * Fetch BPM for a song from GetSongBPM.com (scrape) or estimate from genre defaults.
 * Returns a number (BPM) or null.
 */
async function fetchBPM(artist, title) {
  // Try getsongbpm.com search
  try {
    const query = artist ? `${artist} ${title}` : title;
    const searchUrl = `https://getsongbpm.com/search?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LiveLyrics/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);
      // Look for BPM in search results
      const bpmText = $('.column .num').first().text().trim();
      const bpm = parseInt(bpmText);
      if (bpm && bpm > 40 && bpm < 250) {
        console.log(`[bpm] Found ${bpm} BPM for "${title}"`);
        return bpm;
      }
    }
  } catch (e) {
    console.log(`[bpm] getsongbpm.com failed: ${e.message}`);
  }

  // Try Genius metadata (sometimes has BPM in song description)
  try {
    const query = artist ? `${artist} ${title}` : title;
    const searchUrl = `https://api.genius.com/search?q=${encodeURIComponent(query)}`;
    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${GENIUS_TOKEN}` },
      signal: AbortSignal.timeout(5000)
    });
    if (searchRes.ok) {
      const data = await searchRes.json();
      const hit = data.response?.hits?.[0]?.result;
      if (hit) {
        // Check if song has BPM in its metadata or featured text
        const songUrl = `https://api.genius.com/songs/${hit.id}`;
        const songRes = await fetch(songUrl, {
          headers: { 'Authorization': `Bearer ${GENIUS_TOKEN}` },
          signal: AbortSignal.timeout(5000)
        });
        if (songRes.ok) {
          const songData = await songRes.json();
          const desc = songData.response?.song?.description?.plain || '';
          const bpmMatch = desc.match(/(\d{2,3})\s*(?:BPM|bpm|beats?\s*per\s*min)/);
          if (bpmMatch) {
            const bpm = parseInt(bpmMatch[1]);
            if (bpm > 40 && bpm < 250) {
              console.log(`[bpm] Found ${bpm} BPM from Genius metadata for "${title}"`);
              return bpm;
            }
          }
        }
      }
    }
  } catch (e) {
    console.log(`[bpm] Genius BPM lookup failed: ${e.message}`);
  }

  // Default: estimate based on common rock/pop tempo (120 BPM)
  console.log(`[bpm] No BPM found for "${title}", defaulting to 120`);
  return 120;
}

// Lyrics fetching endpoint
app.get('/api/lyrics', async (req, res) => {
  const { artist, title } = req.query;

  if (!title) {
    return res.status(400).json({ error: 'Song title is required' });
  }

  try {
    console.log(`[lyrics] Searching all sources: "${title}"${artist ? ` by ${artist}` : ' (no artist)'}`);

    // Fetch lyrics, BPM, and synced timestamps ALL in parallel
    const [allResults, bpm, syncData] = await Promise.all([
      fetchAllSources(artist, title),
      fetchBPM(artist, title),
      fetchSyncedLyrics(artist, title)
    ]);
    console.log(`[lyrics] Got ${allResults.length} result(s) for "${title}"`);

    // If no lyrics results, retry with cleaned title
    let finalResults = allResults;
    if (finalResults.length === 0) {
      const cleanTitle = title.replace(/['']/g, '').replace(/[^a-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleanTitle !== title) {
        console.log(`[lyrics] Retrying with cleaned title: "${cleanTitle}"`);
        finalResults = await fetchAllSources(artist, cleanTitle);
        console.log(`[lyrics] Retry got ${finalResults.length} result(s)`);
      }
    }

    if (finalResults.length > 0) {
      const bestLyrics = pickBestVersion(finalResults);
      console.log(`[lyrics] Picked best version for "${title}" by ${artist}`);

      const response = { lyrics: bestLyrics, artist, title, bpm };
      if (syncData) {
        response.syncedLines = syncData.syncedLines;
        response.duration = syncData.duration;
      }
      return res.json(response);
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

// Returns a small HTML page that clears IndexedDB + localStorage and confirms
app.get('/api/reset-all', (req, res) => {
  res.send(`<!DOCTYPE html><html><body style="background:#0f172a;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
<div id="msg">Clearing all data...</div>
<script>
(async()=>{
  const msg = document.getElementById('msg');
  try {
    localStorage.removeItem('livelyrics_data');
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase('livelyrics_cache');
      req.onsuccess = resolve;
      req.onerror = reject;
      req.onblocked = resolve;
    });
    msg.innerHTML = '<h2 style="color:#4ade80">All data cleared!</h2><p>Song list, lyrics cache, and library have been wiped.</p><p>Close this tab and reopen the app.</p>';
  } catch(e) {
    msg.innerHTML = '<h2 style="color:#f87171">Error: ' + e.message + '</h2>';
  }
})();
</script></body></html>`);
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
