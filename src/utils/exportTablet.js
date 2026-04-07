/**
 * Generate a standalone HTML file containing the full perform mode.
 * Self-contained — no server, no internet needed.
 */
function sanitizeLyrics(lyrics) {
  if (!lyrics) return lyrics
  let lines = lyrics.split('\n')
  const firstHeader = lines.findIndex(l => l.trim().startsWith('['))
  if (firstHeader > 0) lines = lines.slice(firstHeader)
  lines = lines.filter(line => {
    const t = line.trim()
    if (!t) return true
    if (/^\d+\s*contributors?/i.test(t)) return false
    if (/^\d*\s*Embed$/i.test(t)) return false
    if (/^translations?$/i.test(t)) return false
    if (/Lyrics$/i.test(t) && t.split(' ').length <= 5) return false
    if (/Read More/i.test(t)) return false
    if (/^[A-Za-zÀ-ÿ]{25,}$/.test(t)) return false
    if (/^(Français|Português|Polski|Deutsch|Español|Italiano|Türkçe)/i.test(t)) return false
    if (/Українська|Русский|العربية|Österreichisches/i.test(t)) return false
    if (/^This song is/i.test(t)) return false
    if (/^According to/i.test(t)) return false
    if (/^The (song|track|band) (is|was|has|features|deals|explores|describes|tells)/i.test(t)) return false
    if (/^In (this|the) (song|track)/i.test(t)) return false
    if (/^(It|This) (is|was|has|became|reached|peaked)/i.test(t)) return false
    if (/^Clocking in at/i.test(t)) return false
    if (t.length > 80 && (t.split('.').length > 2 || t.split(',').length > 3)) return false
    if (/^You might also like/i.test(t)) return false
    if (/^See .* Live/i.test(t)) return false
    if (/^Get tickets/i.test(t)) return false
    if (/^How to Format/i.test(t)) return false
    if (/^Sign Up/i.test(t)) return false
    return true
  })
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function generateTabletHTML(songs, allSongs = []) {
  const cleanSongs = songs.map(s => ({ ...s, lyrics: sanitizeLyrics(s.lyrics) }))
  const cleanLibrary = (allSongs || [])
    .filter(s => s.lyrics && s.lyrics.length > 0 && !songs.some(ss => ss.id === s.id))
    .map(s => ({ ...s, lyrics: sanitizeLyrics(s.lyrics) }))
    .sort((a, b) => a.title.localeCompare(b.title))

  const songsJSON = JSON.stringify(cleanSongs).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
  const libraryJSON = JSON.stringify(cleanLibrary).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black">
<meta name="theme-color" content="#000000">
<title>LiveLyrics - Perform</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; background: #000; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; -webkit-user-select: none; user-select: none; }
#app { height: 100%; display: flex; flex-direction: column; }

/* Top bar — always visible, thin */
.topbar { background: #000; border-bottom: 1px solid rgba(255,255,255,0.05); padding: 4px 12px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.topbar-left { display: flex; align-items: center; gap: 6px; min-width: 0; flex-shrink: 1; }
.topbar-right { display: flex; align-items: center; gap: 4px; flex-shrink: 0; margin-left: auto; }
.back-btn { background: none; border: none; color: #64748b; font-size: 11px; padding: 2px 4px; cursor: pointer; }
.song-name { font-size: 14px; font-weight: 700; color: #818cf8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.song-name.surprise { color: #22d3ee; }
.song-pos { font-size: 10px; color: #475569; flex-shrink: 0; }
.surprise-label { font-size: 9px; text-transform: uppercase; letter-spacing: 1px; color: #22d3ee; flex-shrink: 0; }
.divider { width: 1px; height: 16px; background: #1e293b; margin: 0 2px; }
.tbtn { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; border: none; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.tbtn-off { background: #334155; color: #94a3b8; }
.tbtn-voice { background: #dc2626; color: #fff; }
.tbtn-auto { background: #059669; color: #fff; }
.tbtn-auto-paused { background: #d97706; color: #fff; }
.tbtn-timed { background: #9333ea; color: #fff; }
.tbtn-cloud { background: #2563eb; color: #fff; }
.tbtn-cloud-connecting { background: #ca8a04; color: #fff; }
.tbtn-lib { background: #0891b2; color: #fff; }
.tbtn-back { background: #4f46e5; color: #fff; }
.tbtn-sz { background: none; border: none; color: #64748b; font-size: 11px; width: 24px; height: 24px; cursor: pointer; }

/* Lyrics */
.lyrics { flex: 1; overflow-y: auto; padding: 0 16px 64px; -webkit-overflow-scrolling: touch; scroll-behavior: smooth; }
.lyrics-inner { max-width: 640px; margin: 0 auto; padding: 8px 0; }
.section { margin-bottom: 32px; }
.section-label { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: rgba(129,140,248,0.5); margin-bottom: 8px; font-weight: 600; }
.line { line-height: 1.6; color: #e2e8f0; transition: all 0.3s; }
.line.active { color: #fff; transform: scale(1.05); transform-origin: left; text-shadow: 0 0 30px rgba(129,140,248,0.6); background: rgba(129,140,248,0.08); margin: 2px -8px; padding: 2px 8px; border-radius: 4px; }
.line.dimmed { color: #475569; }
.spacer { height: 50vh; }
.no-lyrics { text-align: center; color: #64748b; font-size: 18px; margin-top: 64px; }

/* Bottom bar: next song + nav */
.bottom { position: absolute; bottom: 0; left: 0; right: 0; z-index: 20; }
.next-bar { text-align: center; padding: 3px 0; background: rgba(0,0,0,0.8); }
.next-label { font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: #475569; margin-right: 8px; }
.next-title { font-size: 12px; color: #94a3b8; font-weight: 500; }
.nav { background: rgba(0,0,0,0.95); padding: 6px 16px; padding-bottom: max(6px, env(safe-area-inset-bottom)); }
.nav-row { display: flex; align-items: center; justify-content: space-between; max-width: 640px; margin: 0 auto; }
.nav-btn { background: none; border: none; color: #94a3b8; font-size: 14px; font-weight: 600; padding: 8px 12px; cursor: pointer; }
.nav-btn:disabled { opacity: 0.2; }
.dots { display: flex; gap: 5px; align-items: center; overflow: hidden; max-width: 50%; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #475569; border: none; padding: 0; cursor: pointer; flex-shrink: 0; }
.dot.active { width: 10px; height: 10px; background: #6366f1; }

/* Overlays */
.overlay { position: absolute; inset: 0; z-index: 50; background: rgba(0,0,0,0.95); display: flex; flex-direction: column; }
.overlay-header { padding: 16px; border-bottom: 1px solid #1e293b; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.overlay-header h2 { font-size: 18px; font-weight: 700; }
.overlay-close { background: none; border: none; color: #94a3b8; font-size: 24px; padding: 4px 12px; cursor: pointer; }
.overlay-list { flex: 1; overflow-y: auto; padding: 8px; display: block; }
.overlay-item { width: 100%; text-align: left; padding: 10px 14px; border-radius: 8px; border: none; background: rgba(30,41,59,0.6); color: #fff; cursor: pointer; display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.overlay-item:hover { background: rgba(51,65,85,0.8); }
.overlay-item.current { background: rgba(79,70,229,0.3); border: 1px solid rgba(99,102,241,0.4); }
.overlay-num { color: #64748b; font-family: monospace; font-size: 13px; width: 24px; text-align: right; flex-shrink: 0; }
.overlay-info { flex: 1; min-width: 0; }
.overlay-title { font-size: 14px; font-weight: 500; }
.overlay-artist { font-size: 12px; color: #94a3b8; }
.overlay-badge { font-size: 10px; color: #818cf8; flex-shrink: 0; }
.overlay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; align-content: start; }
.lib-card { display: block; text-align: left; padding: 8px 12px; border-radius: 6px; border: none; background: rgba(30,41,59,0.6); color: #fff; cursor: pointer; height: auto; }
.lib-card:hover { background: rgba(51,65,85,0.8); }
.set-header { font-size: 11px; text-transform: uppercase; letter-spacing: 2px; color: #64748b; font-weight: 600; margin: 20px 0 6px; padding: 0 4px; }

@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
</head>
<body>
<div id="app"></div>
<script>
var SONGS = ${songsJSON};
var LIBRARY = ${libraryJSON};

// ============ LYRICS PARSER ============
function splitSections(lyrics) {
  if (!lyrics) return [];
  var lines = lyrics.split('\\n'), sections = [], cur = { label: '', lines: [] };
  for (var i = 0; i < lines.length; i++) {
    var t = lines[i].trim();
    var bm = t.match(/^\\[(.+?)\\]$/);
    if (bm) { if (cur.lines.length > 0) sections.push(cur); cur = { label: bm[1], lines: [] }; continue; }
    if (t === '' && cur.lines.length > 0) { cur.lines = cur.lines.filter(function(l){return l!==''}); if (cur.lines.length > 0) { sections.push(cur); cur = { label: '', lines: [] }; } continue; }
    if (t !== '') cur.lines.push(t);
  }
  if (cur.lines.length > 0) sections.push(cur);
  return sections;
}

// ============ SPEECH RECOGNITION ============
function normalize(t){return t.toLowerCase().replace(/[''\\x60]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\\s+/g,' ').trim();}
function ngrams(w,n){var r=[];for(var i=0;i<=w.length-n;i++)r.push(w.slice(i,i+n).join(' '));return r;}
function scoreMatch(tw,lw){if(!lw.length||!tw.length)return 0;var lc=0;for(var len=Math.min(lw.length,tw.length);len>=2;len--){var ln=ngrams(lw,len),tt=tw.join(' ');for(var j=0;j<ln.length;j++){if(tt.includes(ln[j])){lc=len;break;}}if(lc>0)break;}var ts=Math.min(3,lw.length,tw.length),tm=0,tl=0;if(ts>=2){var a=ngrams(lw,ts),b=ngrams(tw,ts);tl=a.length;for(var j=0;j<a.length;j++)for(var k=0;k<b.length;k++)if(a[j]===b[k]){tm++;break;}}var sig=lw.filter(function(w){return w.length>2}),wm=0;for(var j=0;j<sig.length;j++)for(var k=0;k<tw.length;k++)if(tw[k]===sig[j]||(tw[k].length>3&&sig[j].length>3&&(tw[k].includes(sig[j])||sig[j].includes(tw[k])))){wm++;break;}var ws=sig.length>0?wm/sig.length:0;return(lc/Math.max(lw.length,1))*0.5+(tl>0?tm/tl:0)*0.3+ws*0.2;}

// ============ STATE ============
var currentSongIdx = 0, fontSize = 32;
var voiceEnabled = false, autoScrollEnabled = false, autoScrollPaused = false;
var timedEnabled = false, timedRunning = false, timedStart = null, timedInterval = null, timedLineIdx = 0;
var isListening = false, currentLineIndex = 0, recognition = null, transcriptBuffer = '';
var lastMatchTime = Date.now(), lastScrollTime = 0, highWaterMark = 0;
var autoScrollInterval = null, driftInterval = null;
var librarySong = null, savedSetIdx = null;
var showSetList = false, showLibrary = false;
var allLines = [];
var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
var DEEPGRAM_KEY = '248fb866c5469f73c3955fd4347220023a577c5b';
var cloudVoiceEnabled = false, isCloudListening = false, cloudConnected = false;
var dgWs = null, dgStream = null, dgProcessor = null, dgAudioCtx = null;

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function getCurrentSong() { return librarySong || SONGS[currentSongIdx]; }

// ============ LIGHTWEIGHT LINE UPDATE (no DOM rebuild) ============
var prevActiveLineId = null;
var scrollDebounceTimer = null;
var isScrolling = false;

function updateActiveLine() {
  // Remove highlight from previous line
  if (prevActiveLineId) {
    var prev = document.getElementById(prevActiveLineId);
    if (prev) { prev.classList.remove('active'); prev.classList.add('dimmed'); }
  }
  // Add highlight to current line + dim all others
  var sections = splitSections(getCurrentSong().lyrics);
  var count = 0;
  for (var si = 0; si < sections.length; si++) {
    for (var li = 0; li < sections[si].lines.length; li++) {
      var id = 'line-' + si + '-' + li;
      var el = document.getElementById(id);
      if (count === currentLineIndex) {
        if (el) {
          el.classList.add('active');
          el.classList.remove('dimmed');
          prevActiveLineId = id;
          if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
          scrollDebounceTimer = setTimeout(function() {
            smoothScrollToLine(el);
          }, 150);
        }
      } else if (el && (voiceEnabled || cloudVoiceEnabled || timedEnabled)) {
        // Dim non-active lines when any tracking mode is on
        el.classList.add('dimmed');
      }
      count++;
    }
  }
}

function smoothScrollToLine(el) {
  var container = document.getElementById('lyrics');
  if (!container || !el) return;
  var elRect = el.getBoundingClientRect();
  var cRect = container.getBoundingClientRect();
  var targetY = cRect.top + cRect.height * 0.25;
  var diff = elRect.top - targetY;
  // Only scroll if the line is significantly off-target (>30px)
  if (Math.abs(diff) < 30) return;
  container.scrollBy({ top: diff, behavior: 'smooth' });
}

// ============ RENDER ============
function render() {
  var song = getCurrentSong();
  if (!song) return;
  var sections = splitSections(song.lyrics);
  allLines = [];
  for (var i = 0; i < sections.length; i++) for (var j = 0; j < sections[i].lines.length; j++) allLines.push(sections[i].lines[j]);

  var hasSynced = song.syncedLines && song.syncedLines.length > 0;
  var isSurprise = !!librarySong;

  // Sections HTML
  var sectionsHTML = '';
  if (sections.length === 0) { sectionsHTML = '<p class="no-lyrics">No lyrics available</p>'; }
  else {
    var gi = 0;
    for (var si = 0; si < sections.length; si++) {
      var s = sections[si], lh = '';
      if (s.label) lh += '<div class="section-label">' + esc(s.label) + '</div>';
      for (var li = 0; li < s.lines.length; li++) {
        var isActive = gi === currentLineIndex && ((voiceEnabled && isListening) || (cloudVoiceEnabled && isCloudListening) || (timedEnabled && timedRunning));
        lh += '<p class="line' + (isActive ? ' active' : '') + '" id="line-' + si + '-' + li + '" style="font-size:' + fontSize + 'px">' + esc(s.lines[li]) + '</p>';
        gi++;
      }
      sectionsHTML += '<div class="section">' + lh + '</div>';
    }
    sectionsHTML += '<div class="spacer"></div>';
  }

  // Dots
  var dotsHTML = '';
  for (var i = 0; i < SONGS.length; i++) dotsHTML += '<button class="dot' + (i === currentSongIdx && !isSurprise ? ' active' : '') + '" onclick="goToSong(' + i + ')"></button>';

  // Next song
  var nextHTML = '';
  if (!isSurprise && currentSongIdx < SONGS.length - 1) {
    nextHTML = '<div class="next-bar"><span class="next-label">Next:</span><span class="next-title">' + esc(SONGS[currentSongIdx + 1].title) + '</span></div>';
  } else if (!isSurprise) {
    nextHTML = '<div class="next-bar"><span class="next-label">Last song</span></div>';
  } else {
    nextHTML = '<div class="next-bar"><span class="next-label">Surprise song</span></div>';
  }

  // Top bar buttons
  var voiceBtn = SR ? '<button class="tbtn ' + (voiceEnabled ? 'tbtn-voice' : 'tbtn-off') + '" onclick="toggleVoice()">' + (voiceEnabled ? '\\uD83C\\uDFA4 Local' : '\\uD83C\\uDFA4 Voice') + '</button>' : '';
  var cloudBtn = '<button class="tbtn ' + (cloudVoiceEnabled ? (cloudConnected ? 'tbtn-cloud' : 'tbtn-cloud-connecting') : 'tbtn-off') + '" onclick="toggleCloudVoice()">' + (cloudVoiceEnabled ? (cloudConnected ? '\\u2601 Cloud' : '\\u2601 ...') : '\\u2601 Cloud') + '</button>';
  var autoBtn = '<button class="tbtn ' + (autoScrollEnabled ? (autoScrollPaused ? 'tbtn-auto-paused' : 'tbtn-auto') : 'tbtn-off') + '" onclick="toggleAuto()">' + (autoScrollEnabled ? (autoScrollPaused ? '\\u23F8 Paused' : '\\u25B6 Scrolling') : '\\u25B6 Auto') + '</button>';
  var timedBtn = hasSynced ? '<button class="tbtn ' + (timedEnabled ? 'tbtn-timed' : 'tbtn-off') + '" onclick="toggleTimed()">' + (timedEnabled ? '\\u23F1 Synced' : '\\u23F1 Timed') + '</button>' : '';
  var setListBtn = '<button class="tbtn tbtn-off" onclick="showSetList=true;render()">Set List</button>';
  var libraryBtn = '<button class="tbtn ' + (isSurprise ? 'tbtn-lib' : 'tbtn-off') + '" onclick="showLibrary=true;render()">\\uD83D\\uDCDA Library</button>';
  var backBtn = isSurprise ? '<button class="tbtn tbtn-back" onclick="backToSet()">\\u2190 Back to Set</button>' : '';

  document.getElementById('app').innerHTML =
    '<div class="topbar">' +
      '<div class="topbar-left">' +
        (isSurprise ? '<span class="surprise-label">Surprise</span>' : '') +
        '<span class="song-name' + (isSurprise ? ' surprise' : '') + '">' + esc(song.title) + '</span>' +
        '<span class="song-pos">' + (isSurprise ? '' : (currentSongIdx+1) + '/' + SONGS.length) + '</span>' +
      '</div>' +
      '<div class="topbar-right">' +
        '<button class="tbtn-sz" onclick="fontSize=Math.max(18,fontSize-4);render()">A-</button>' +
        '<button class="tbtn-sz" onclick="fontSize=Math.min(56,fontSize+4);render()">A+</button>' +
        '<div class="divider"></div>' +
        voiceBtn + cloudBtn + autoBtn + timedBtn +
        '<div class="divider"></div>' +
        setListBtn + libraryBtn + backBtn +
      '</div>' +
    '</div>' +
    '<div class="lyrics" id="lyrics" onclick="handleTap(event)">' +
      '<div class="lyrics-inner">' + sectionsHTML + '</div>' +
    '</div>' +
    '<div class="bottom">' + nextHTML +
      '<div class="nav"><div class="nav-row">' +
        '<button class="nav-btn" onclick="goToSong(currentSongIdx-1)"' + (currentSongIdx===0||isSurprise?' disabled':'') + '>\\u2190 Prev</button>' +
        '<div class="dots">' + dotsHTML + '</div>' +
        '<button class="nav-btn" onclick="goToSong(currentSongIdx+1)"' + (currentSongIdx===SONGS.length-1||isSurprise?' disabled':'') + '>Next \\u2192</button>' +
      '</div></div>' +
    '</div>' +
    (showSetList ? renderSetListOverlay() : '') +
    (showLibrary ? renderLibraryOverlay() : '');
}

// ============ OVERLAYS ============
function renderSetListOverlay() {
  var items = '', currentSet = null, num = 0;
  for (var i = 0; i < SONGS.length; i++) {
    var s = SONGS[i];
    if (s.setName !== currentSet) { currentSet = s.setName; items += '<div class="set-header">' + esc(currentSet) + '</div>'; }
    num++;
    var isCurrent = i === currentSongIdx && !librarySong;
    items += '<button class="overlay-item' + (isCurrent ? ' current' : '') + '" onclick="jumpToSong(' + i + ')">' +
      '<span class="overlay-num">' + num + '</span>' +
      '<div class="overlay-info"><div class="overlay-title">' + esc(s.title) + '</div>' +
      (s.artist ? '<div class="overlay-artist">' + esc(s.artist) + '</div>' : '') + '</div>' +
      (isCurrent ? '<span class="overlay-badge">Now playing</span>' : '') +
    '</button>';
  }
  return '<div class="overlay" onclick="event.stopPropagation()">' +
    '<div class="overlay-header"><h2 style="color:#818cf8">Jump to Song</h2><button class="overlay-close" onclick="showSetList=false;render()">\\u2715</button></div>' +
    '<div class="overlay-list"><div style="max-width:600px;margin:0 auto">' + items + '</div></div></div>';
}

function renderLibraryOverlay() {
  var items = '';
  for (var i = 0; i < LIBRARY.length; i++) {
    var s = LIBRARY[i];
    items += '<button class="lib-card" onclick="pickLibrarySong(' + i + ')">' +
      '<div class="overlay-title">' + esc(s.title) + '</div>' +
      (s.artist ? '<div class="overlay-artist">' + esc(s.artist) + '</div>' : '') + '</button>';
  }
  if (items === '') items = '<p style="text-align:center;color:#64748b;padding:32px">No additional songs in library</p>';
  return '<div class="overlay" onclick="event.stopPropagation()">' +
    '<div class="overlay-header"><h2 style="color:#22d3ee">Song Library</h2><button class="overlay-close" onclick="showLibrary=false;render()">\\u2715</button></div>' +
    '<div class="overlay-list"><div class="overlay-grid">' + items + '</div></div></div>';
}

// ============ NAVIGATION ============
function goToSong(idx) {
  if (idx < 0 || idx >= SONGS.length) return;
  librarySong = null; savedSetIdx = null;
  currentSongIdx = idx;
  resetScrollState();
  render();
  document.getElementById('lyrics').scrollTop = 0;
}

function jumpToSong(idx) {
  showSetList = false;
  goToSong(idx);
}

function pickLibrarySong(idx) {
  if (!librarySong) savedSetIdx = currentSongIdx;
  librarySong = Object.assign({}, LIBRARY[idx], { setName: 'Library' });
  showLibrary = false;
  resetScrollState();
  render();
  document.getElementById('lyrics').scrollTop = 0;
}

function backToSet() {
  librarySong = null;
  if (savedSetIdx !== null) currentSongIdx = savedSetIdx;
  savedSetIdx = null;
  resetScrollState();
  render();
  document.getElementById('lyrics').scrollTop = 0;
}

function resetScrollState() {
  currentLineIndex = 0; highWaterMark = 0; lastScrollTime = 0;
  transcriptBuffer = ''; lastMatchTime = Date.now();
  timedLineIdx = 0; autoScrollPaused = false;
  if (timedEnabled) { stopTimed(); startTimed(); }
  if (autoScrollEnabled) { stopAutoScroll(); startAutoScroll(); }
}

function handleTap(e) {
  if (autoScrollEnabled) {
    // Just toggle the pause state - DO NOT call render() (it would reset scroll)
    autoScrollPaused = !autoScrollPaused;
    // Update only the auto button class directly
    var btn = document.querySelector('.btn-auto, .tbtn-auto, .tbtn-auto-paused');
    if (btn) {
      btn.classList.remove('tbtn-auto', 'tbtn-auto-paused', 'tbtn-off');
      btn.classList.add('tbtn', autoScrollPaused ? 'tbtn-auto-paused' : 'tbtn-auto');
      btn.innerHTML = autoScrollPaused ? '\u23F8 Paused' : '\u25B6 Scrolling';
    }
    return;
  }
  if (!voiceEnabled && !timedEnabled && !cloudVoiceEnabled) {
    var el = document.getElementById('lyrics');
    if (el) el.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' });
  }
}

function scrollToCurrentLine() {
  var sections = splitSections(getCurrentSong().lyrics);
  var count = 0;
  for (var si = 0; si < sections.length; si++) {
    for (var li = 0; li < sections[si].lines.length; li++) {
      if (count === currentLineIndex) {
        var el = document.getElementById('line-' + si + '-' + li);
        if (el) {
          var container = document.getElementById('lyrics');
          if (container) {
            var elRect = el.getBoundingClientRect();
            var cRect = container.getBoundingClientRect();
            var targetY = cRect.top + cRect.height * 0.25;
            container.scrollBy({ top: elRect.top - targetY, behavior: 'smooth' });
          }
        }
        return;
      }
      count++;
    }
  }
}

// ============ VOICE MODE ============
function toggleVoice() {
  voiceEnabled = !voiceEnabled;
  if (voiceEnabled) { cloudVoiceEnabled = false; stopCloudVoice(); autoScrollEnabled = false; stopAutoScroll(); timedEnabled = false; stopTimed(); startVoice(); }
  else stopVoice();
  render();
}

function startVoice() {
  if (!SR || recognition) return;
  var r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-US'; r.maxAlternatives = 3;
  r.onresult = function(event) {
    var interim = '', final = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) final += event.results[i][0].transcript + ' ';
      else interim += event.results[i][0].transcript + ' ';
    }
    if (final.trim()) {
      transcriptBuffer += ' ' + final.trim();
      var bw = transcriptBuffer.trim().split(/\\s+/);
      if (bw.length > 50) transcriptBuffer = bw.slice(-50).join(' ');
    }
    var full = (transcriptBuffer + ' ' + interim).trim();
    if (full) {
      var recent = full.split(/\\s+/).slice(-20).join(' ');
      var tw = normalize(recent).split(/\\s+/).filter(function(w){return w.length>1;});
      if (tw.length >= 2) {
        var bestIdx = -1, bestScore = 0;
        var start = Math.max(0, currentLineIndex - 2);
        var end = Math.min(allLines.length, currentLineIndex + 30);
        for (var i = start; i < end; i++) {
          var lw = normalize(allLines[i]).split(/\\s+/).filter(function(w){return w.length>1;});
          if (!lw.length) continue;
          var score = scoreMatch(tw, lw);
          var dist = i - currentLineIndex;
          if (dist < 0) score *= 0.2;
          else if (dist <= 3) score += 0.15;
          else if (dist <= 8) score *= (1.0 - (dist-3)*0.04);
          else { score *= (0.8 - (dist-8)*0.03); if (score < 0.6) score *= 0.5; }
          if (dist > 0) score += 0.001/dist;
          if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
        var now = Date.now();
        if (now - lastScrollTime < 800) return;
        if (bestIdx < highWaterMark) return;
        var jumpSize = bestIdx - currentLineIndex;
        if (jumpSize > 6 && bestScore < 0.5) return;
        if (bestIdx >= 0 && bestScore >= 0.35 && bestIdx >= currentLineIndex) {
          currentLineIndex = bestIdx; highWaterMark = Math.max(highWaterMark, bestIdx);
          lastMatchTime = now; lastScrollTime = now;
          updateActiveLine();
        }
      }
    }
  };
  r.onerror = function(){};
  r.onend = function(){ if (recognition) try { r.start(); } catch(e){} };
  transcriptBuffer = ''; lastMatchTime = Date.now();
  recognition = r; r.start(); isListening = true;
  startDrift();
}

function stopVoice() {
  if (recognition) { recognition.onend = null; recognition.stop(); recognition = null; }
  isListening = false; stopDrift(); transcriptBuffer = '';
}

function startDrift() {
  if (driftInterval) return;
  driftInterval = setInterval(function() {
    if (Date.now() - lastMatchTime > 8000 && currentLineIndex < allLines.length - 1) {
      currentLineIndex++; highWaterMark = Math.max(highWaterMark, currentLineIndex);
      lastMatchTime = Date.now() - 5000;
      updateActiveLine();
    }
  }, 4000);
}
function stopDrift() { if (driftInterval) { clearInterval(driftInterval); driftInterval = null; } }

// ============ CLOUD VOICE (DEEPGRAM) ============
function toggleCloudVoice() {
  if (!cloudVoiceEnabled) {
    cloudVoiceEnabled = true;
    voiceEnabled = false; stopVoice();
    autoScrollEnabled = false; stopAutoScroll();
    timedEnabled = false; stopTimed();
    // Reset everything so old data doesn't cause immediate jumps
    transcriptBuffer = '';
    currentLineIndex = 0;
    highWaterMark = 0;
    lastScrollTime = 0;
    lastMatchTime = Date.now();
    prevActiveLineId = null;
    // Remove all dimmed/active classes
    document.querySelectorAll('.line.active,.line.dimmed').forEach(function(el) {
      el.classList.remove('active', 'dimmed');
    });
    startCloudVoice();
  } else {
    cloudVoiceEnabled = false;
    stopCloudVoice();
  }
  render();
}

var dgRecorder = null;

async function startCloudVoice() {
  try {
    // Use browser's native noise suppression - it's the best we have on tablets
    dgStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    // Build keywords from current song lyrics
    var song = getCurrentSong();
    var kw = [];
    if (song && song.lyrics) {
      var seen = {};
      song.lyrics.toLowerCase().replace(/[^a-z ]/g, '').split(/\\s+/).forEach(function(w) {
        if (w.length > 3 && !seen[w]) { seen[w] = 1; kw.push(w); }
      });
      kw = kw.slice(0, 100);
    }
    var kwParam = kw.length > 0 ? '&keywords=' + kw.map(function(w){return encodeURIComponent(w+':2')}).join('&keywords=') : '';

    // Use opus encoding — Deepgram handles it natively, no resampling needed
    // This is the approach Deepgram's official examples use
    // NO encoding parameter — let Deepgram auto-detect from the webm container
    dgWs = new WebSocket(
      'wss://api.deepgram.com/v1/listen?model=nova-2&language=en&smart_format=true&interim_results=true&utterance_end_ms=1500&vad_events=true' + kwParam,
      ['token', DEEPGRAM_KEY]
    );

    dgWs.onopen = function() {
      cloudConnected = true; render();
      try {
        // MediaRecorder with opus — browser handles all the encoding
        var mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/webm';
        }
        dgRecorder = new MediaRecorder(dgStream, { mimeType: mimeType, audioBitsPerSecond: 32000 });

        dgRecorder.ondataavailable = function(e) {
          if (dgWs && dgWs.readyState === WebSocket.OPEN && e.data.size > 0) {
            dgWs.send(e.data);
          }
        };

        // Send data every 250ms for low latency
        dgRecorder.start(250);
      } catch(err) { console.error('[cloud] Recorder setup failed:', err); }
    };

    dgWs.onmessage = function(event) {
      try {
        var data = JSON.parse(event.data);
        if (data.channel && data.channel.alternatives && data.channel.alternatives[0]) {
          var text = data.channel.alternatives[0].transcript || '';
          var isFinal = data.is_final || false;
          var dgConf = data.channel.alternatives[0].confidence || 0;
          if (text) processCloudTranscript(text, isFinal, dgConf);
        }
      } catch(e) {}
    };

    dgWs.onerror = function(err) {
      console.error('[cloud] WebSocket error:', err);
      cloudConnected = false;
      isCloudListening = false;
      cloudVoiceEnabled = false;
      render();
    };
    dgWs.onclose = function(event) {
      console.log('[cloud] WebSocket closed:', event.code, event.reason);
      cloudConnected = false;
      isCloudListening = false;
      // If it closes immediately, turn off cloud mode entirely
      if (cloudVoiceEnabled && !isCloudListening) {
        cloudVoiceEnabled = false;
      }
      render();
    };

    isCloudListening = true;
    // NO drift for cloud mode — only scroll when Deepgram hears actual singing
    render();
  } catch(e) {
    cloudVoiceEnabled = false; render();
  }
}

function processCloudTranscript(text, isFinal, dgConf) {
  // GATE 1: Ignore very low confidence (clear noise)
  if (dgConf < 0.4) return;
  // GATE 2: Ignore single-word noise bursts
  var words = text.trim().split(/\\s+/).filter(function(w){return w.length>1;});
  if (words.length < 2) return;

  if (isFinal && text.trim()) {
    transcriptBuffer += ' ' + text.trim();
    var bw = transcriptBuffer.trim().split(/\\s+/);
    if (bw.length > 50) transcriptBuffer = bw.slice(-50).join(' ');
  }
  var full = (transcriptBuffer + ' ' + text).trim();
  if (!full) return;
  var recent = full.split(/\\s+/).slice(-20).join(' ');
  var tw = normalize(recent).split(/\\s+/).filter(function(w){return w.length>1;});
  if (tw.length < 2) return;

  var bestIdx = -1, bestScore = 0;
  var start = Math.max(0, currentLineIndex - 2);
  var end = Math.min(allLines.length, currentLineIndex + 30);
  for (var i = start; i < end; i++) {
    var lw = normalize(allLines[i]).split(/\\s+/).filter(function(w){return w.length>1;});
    if (!lw.length) continue;
    var score = scoreMatch(tw, lw);
    var dist = i - currentLineIndex;
    if (dist < 0) score *= 0.2;
    else if (dist <= 3) score += 0.15;
    else if (dist <= 8) score *= (1.0 - (dist-3)*0.04);
    else { score *= (0.8 - (dist-8)*0.03); if (score < 0.6) score *= 0.5; }
    if (dist > 0) score += 0.001/dist;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  var now = Date.now();
  if (now - lastScrollTime < 800) return;
  if (bestIdx < highWaterMark) return;
  if (bestIdx - currentLineIndex > 6 && bestScore < 0.5) return;
  // Higher threshold for cloud — 0.45 instead of 0.35
  if (bestIdx >= 0 && bestScore >= 0.30 && bestIdx >= currentLineIndex) {
    currentLineIndex = bestIdx; highWaterMark = Math.max(highWaterMark, bestIdx);
    lastMatchTime = now; lastScrollTime = now;
    updateActiveLine();
  }
}

function stopCloudVoice() {
  if (dgRecorder) { try { dgRecorder.stop(); } catch(e) {} dgRecorder = null; }
  if (dgWs) { dgWs.close(); dgWs = null; }
  if (dgStream) { dgStream.getTracks().forEach(function(t){t.stop();}); dgStream = null; }
  isCloudListening = false; cloudConnected = false;
  stopDrift(); transcriptBuffer = '';
}

// ============ AUTO-SCROLL MODE ============
function toggleAuto() {
  if (!autoScrollEnabled) {
    autoScrollEnabled = true; autoScrollPaused = false;
    voiceEnabled = false; stopVoice(); timedEnabled = false; stopTimed();
    startAutoScroll();
  } else { autoScrollEnabled = false; stopAutoScroll(); }
  render();
}
function startAutoScroll() {
  stopAutoScroll();
  var bpm = getCurrentSong().bpm || 120;
  var pxPerTick = Math.max(0.3, 1.2 * (bpm / 120));
  autoScrollInterval = setInterval(function() {
    if (autoScrollPaused) return;
    var el = document.getElementById('lyrics');
    if (el) { el.scrollTop += pxPerTick; if (el.scrollTop >= el.scrollHeight - el.clientHeight) { stopAutoScroll(); autoScrollEnabled = false; render(); } }
  }, 50);
}
function stopAutoScroll() { if (autoScrollInterval) { clearInterval(autoScrollInterval); autoScrollInterval = null; } }

// ============ TIMED + VOICE MODE ============
function toggleTimed() {
  var song = getCurrentSong();
  if (!timedEnabled && song.syncedLines && song.syncedLines.length > 0) {
    timedEnabled = true; voiceEnabled = false; stopVoice(); autoScrollEnabled = false; stopAutoScroll();
    startTimed();
  } else { timedEnabled = false; stopTimed(); }
  render();
}
function startTimed() {
  stopTimed(); timedStart = Date.now(); timedLineIdx = 0; timedRunning = true; currentLineIndex = 0;
  if (SR && !recognition) startVoice(); isListening = true;
  timedInterval = setInterval(function() {
    if (!timedStart) return;
    var song = getCurrentSong(); if (!song || !song.syncedLines) return;
    var elapsed = (Date.now() - timedStart) / 1000;
    var timedPos = 0;
    for (var i = 0; i < song.syncedLines.length; i++) { if (song.syncedLines[i].time <= elapsed) timedPos = i; else break; }
    var finalIdx = Math.min(timedPos, allLines.length - 1);
    if (currentLineIndex > finalIdx && currentLineIndex <= finalIdx + 5) finalIdx = currentLineIndex;
    if (finalIdx > timedLineIdx) {
      timedLineIdx = finalIdx; currentLineIndex = finalIdx;
      highWaterMark = Math.max(highWaterMark, finalIdx);
      updateActiveLine();
    }
  }, 200);
}
function stopTimed() { timedRunning = false; timedStart = null; if (timedInterval) { clearInterval(timedInterval); timedInterval = null; } stopVoice(); }

// ============ KEYBOARD ============
document.addEventListener('keydown', function(e) {
  switch(e.key) {
    case 'ArrowRight': case 'PageDown': goToSong(currentSongIdx + 1); break;
    case 'ArrowLeft': case 'PageUp': goToSong(currentSongIdx - 1); break;
    case 'ArrowDown': case ' ':
      e.preventDefault();
      if (autoScrollEnabled) { autoScrollPaused = !autoScrollPaused; render(); break; }
      var el = document.getElementById('lyrics'); if (el) el.scrollBy({ top: window.innerHeight * 0.7, behavior: 'smooth' }); break;
    case 'ArrowUp': e.preventDefault(); var el2 = document.getElementById('lyrics'); if (el2) el2.scrollBy({ top: -window.innerHeight * 0.7, behavior: 'smooth' }); break;
  }
});

// ============ FULLSCREEN + WAKE LOCK ============
(async function() {
  try { var el = document.documentElement; if (el.requestFullscreen) await el.requestFullscreen(); else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen(); } catch(e) {}
})();

// ============ KEEP SCREEN ON — AGGRESSIVE ============
// Layer 1: Wake Lock API (works on most modern browsers)
var wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      if (wakeLock) return; // already held
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', function() { wakeLock = null; });
    }
  } catch(e) { wakeLock = null; }
}
requestWakeLock();

// Re-acquire on visibility change AND periodically (Samsung kills it randomly)
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') requestWakeLock();
});
setInterval(function() { if (!wakeLock) requestWakeLock(); }, 30000);

// Layer 2: NoSleep.js inline — uses base64 webm/mp4 video loops
// These are real encoded videos that work reliably on Samsung/iOS/Android
// Adapted from https://github.com/richtr/NoSleep.js
var WEBM_BASE64 = 'data:video/webm;base64,GkXfo0AgQoaBAUL3gQFC8oEEQvOBCEKChHdlYm1Ch4EEQoWBAhhTgGcBAAAAAAAVkhFNm3RALE27i1OrhBVJqWZTrIHfTbuMU6uEFlSua1OsggEwTbuMU6uEHFO7a1OsghV17AEAAAAAAACkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAota3VjyKJFo3BBOgBAAACkAEsbWlueoODZ4QbWKFmpX64XrDXlwpq0fv5ndcMbHbIEg==';
// NoSleep technique: trigger video play on any user interaction
var noSleepVideo = null;
var noSleepEnabled = false;
function enableNoSleep() {
  if (noSleepEnabled) return;
  noSleepEnabled = true;

  if (!noSleepVideo) {
    noSleepVideo = document.createElement('video');
    noSleepVideo.setAttribute('playsinline', '');
    noSleepVideo.setAttribute('webkit-playsinline', '');
    noSleepVideo.setAttribute('muted', '');
    noSleepVideo.setAttribute('loop', '');
    noSleepVideo.setAttribute('title', 'LiveLyrics Screen Keep-On');
    noSleepVideo.muted = true;
    noSleepVideo.volume = 0;
    noSleepVideo.src = WEBM_BASE64;
    noSleepVideo.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(noSleepVideo);
  }

  var playPromise = noSleepVideo.play();
  if (playPromise) playPromise.catch(function(){});
}

// Activate NoSleep on first user interaction (browsers require this)
document.addEventListener('click', enableNoSleep);
document.addEventListener('touchstart', enableNoSleep);

// Keep the video playing
setInterval(function() {
  if (noSleepVideo && noSleepEnabled && noSleepVideo.paused) {
    noSleepVideo.play().catch(function(){});
  }
}, 5000);

// ============ START ============
render();
</script>
</body>
</html>`
}

/**
 * Trigger download of the standalone perform file.
 */
export function exportForTablet(songs, allSongs) {
  const html = generateTabletHTML(songs, allSongs)
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'LiveLyrics-Perform.html'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
