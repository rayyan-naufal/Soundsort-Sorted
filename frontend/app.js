// ==========================================================================
// SoundSort AI — Next-Gen Frontend Controller & Music Studio State
// ==========================================================================

const API_BASE = '/api';

// Application State
const state = {
  allTracks: [],
  tracks: [],
  allMainGenres: [],
  allSubgenres: [],
  allVibes: [],
  systemStatus: null,
  settings: null,
  viewMode: 'grid', // 'grid' | 'table' | 'compact'
  selectedTrackIds: new Set(),
  soundEnabled: localStorage.getItem('soundsort_sound') !== 'false',
  insightsOpen: false,
  activeVibeFilter: '',
  collapsedCards: new Set(),
  customPlaylistSelectedMode: false,
  filters: {
    search: '',
    mainGenre: '',
    subGenre: '',
    status: '', // '' | 'needs_ai' | 'classified' | 'synced' | 'not_synced'
    sort: 'subgenre_asc'
  }
};

let currentCustomMatchedTracks = [];

// Safe Default Vinyl Thumbnail SVG
const DEFAULT_THUMB_SVG = 'data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="%2364748b" stroke-width="1.8"%3E%3Ccircle cx="12" cy="12" r="10" stroke="%23334155" fill="%23111422"/%3E%3Ccircle cx="12" cy="12" r="4" stroke="%2300f2fe" fill="%231e293b"/%3E%3Ccircle cx="12" cy="12" r="1.5" fill="%2300f2fe"/%3E%3C/svg%3E';

function getSafeThumb(url) {
  if (!url || typeof url !== 'string' || url.trim() === '' || url.includes('"') || url.includes('<')) {
    return DEFAULT_THUMB_SVG;
  }
  return encodeURI(url.trim());
}

const DEMO_TRACKS_INPUT = `https://open.spotify.com/track/1Qrg8KqiBpW477faSu8NnW
Skrillex & Fred again.. - Rumble
KSLV Noh - Disaster
Bicep - Glue
American Football - Never Meant
Lorna Shore - To the Hellfire
Gunna - fukumean
Peggy Gou - (It Goes Like) Nanana
Deftones - Be Quiet and Drive (Far Away)
Sub Focus & Dimension - Desire
Charli xcx - Von dutch
Overmono - Good Lies
Tatsuro Yamashita - Sparkle
Ken Carson - Overseas
Massive Attack - Teardrop
Fred again.. - Billie (loving arms)
Kavinsky - Nightcall
Bring Me The Horizon - Can You Feel My Heart
Mura Masa - Lovesick
Aphex Twin - Alberto Balsalm`;

// ==========================================================================
// Web Audio Synthesizer (UI Sound Effects)
// ==========================================================================
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playUiSound(type = 'click') {
  if (!state.soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.05);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'import') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'delete') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.1);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  } catch (e) {
    // Audio context may not be allowed prior to user interaction
  }
}

// ==========================================================================
// Canvas Audio Visualizer
// ==========================================================================
let visualizerAnimationId = null;
let isAiClassifying = false;

function initVisualizer() {
  const canvas = document.getElementById('audioVisualizerCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const barCount = 14;
  const bars = Array.from({ length: barCount }, () => Math.random() * 0.4 + 0.1);

  function renderVisualizer() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = canvas.width / barCount - 2;

    for (let i = 0; i < barCount; i++) {
      // Dynamic height modulation
      const target = isAiClassifying 
        ? Math.random() * 0.9 + 0.1 
        : Math.sin(Date.now() * 0.003 + i) * 0.25 + 0.35;
      
      bars[i] += (target - bars[i]) * 0.2;
      const h = Math.max(2, bars[i] * canvas.height);
      const x = i * (barWidth + 2) + 1;
      const y = canvas.height - h;

      // Color gradient per bar
      const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
      grad.addColorStop(0, '#00f2fe');
      grad.addColorStop(0.5, '#9d4edd');
      grad.addColorStop(1, '#ff007f');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, barWidth, h, 2) : ctx.rect(x, y, barWidth, h);
      ctx.fill();
    }

    visualizerAnimationId = requestAnimationFrame(renderVisualizer);
  }

  renderVisualizer();
}

// ==========================================================================
// Dynamic Genre Visual Palette
// ==========================================================================
function getGenreTheme(genreName) {
  if (!genreName) return { dot: '#9d4edd', gradient: 'var(--gradient-cyan-purple)' };
  const lower = genreName.toLowerCase();

  if (lower.includes('synth') || lower.includes('cyber') || lower.includes('retro')) {
    return { dot: '#00f2fe', gradient: 'linear-gradient(135deg, #00f2fe 0%, #ff007f 100%)' };
  }
  if (lower.includes('techno') || lower.includes('rave') || lower.includes('acid') || lower.includes('house')) {
    return { dot: '#10b981', gradient: 'linear-gradient(135deg, #10b981 0%, #00f2fe 100%)' };
  }
  if (lower.includes('rock') || lower.includes('metal') || lower.includes('punk') || lower.includes('grunge')) {
    return { dot: '#ef4444', gradient: 'linear-gradient(135deg, #ef4444 0%, #f59e0b 100%)' };
  }
  if (lower.includes('phonk') || lower.includes('trap') || lower.includes('bass') || lower.includes('drill')) {
    return { dot: '#9d4edd', gradient: 'linear-gradient(135deg, #9d4edd 0%, #ff007f 100%)' };
  }
  if (lower.includes('pop') || lower.includes('indie') || lower.includes('k-pop') || lower.includes('indo')) {
    return { dot: '#ec4899', gradient: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)' };
  }
  if (lower.includes('lo-fi') || lower.includes('chill') || lower.includes('ambient') || lower.includes('r&b')) {
    return { dot: '#38bdf8', gradient: 'linear-gradient(135deg, #38bdf8 0%, #818cf8 100%)' };
  }
  if (lower.includes('latin') || lower.includes('afro') || lower.includes('reggae') || lower.includes('funk')) {
    return { dot: '#f59e0b', gradient: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)' };
  }

  // Deterministic color hash fallback
  let hash = 0;
  for (let i = 0; i < genreName.length; i++) {
    hash = genreName.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return {
    dot: `hsl(${hue}, 85%, 60%)`,
    gradient: `linear-gradient(135deg, hsl(${hue}, 85%, 60%) 0%, hsl(${(hue + 45) % 360}, 85%, 50%) 100%)`
  };
}

// ==========================================================================
// DOM Elements Cache
// ==========================================================================
const elements = {
  // Brand & Utility
  btnToggleSound: document.getElementById('btnToggleSound'),
  soundIcon: document.getElementById('soundIcon'),
  btnOpenShortcuts: document.getElementById('btnOpenShortcuts'),
  btnToggleInsights: document.getElementById('btnToggleInsights'),
  btnCloseInsights: document.getElementById('btnCloseInsights'),
  insightsPanel: document.getElementById('insightsPanel'),
  shortcutsModal: document.getElementById('shortcutsModal'),

  // Status Chips & AI
  geminiStatusChip: document.getElementById('geminiStatusChip'),
  ytStatusChip: document.getElementById('ytStatusChip'),
  activeModelTag: document.getElementById('activeModelTag'),

  // Stats Counters
  statTotalTracks: document.getElementById('statTotalTracks'),
  statClassified: document.getElementById('statClassified'),
  statClassifiedPct: document.getElementById('statClassifiedPct'),
  statSubgenres: document.getElementById('statSubgenres'),
  statSynced: document.getElementById('statSynced'),
  statSyncedPct: document.getElementById('statSyncedPct'),

  // Importer
  importInput: document.getElementById('importInput'),
  dropzoneWrapper: document.getElementById('dropzoneWrapper'),
  dropOverlay: document.getElementById('dropOverlay'),
  importCounterHint: document.getElementById('importCounterHint'),
  fileUploadInput: document.getElementById('fileUploadInput'),
  btnUploadCsv: document.getElementById('btnUploadCsv'),
  btnImport: document.getElementById('btnImport'),
  importSpinner: document.getElementById('importSpinner'),
  btnLoadSample: document.getElementById('btnLoadSample'),
  btnImportYtLikes: document.getElementById('btnImportYtLikes'),
  btnClearTracks: document.getElementById('btnClearTracks'),
  sourceBadgesContainer: document.getElementById('sourceBadgesContainer'),

  // AI Hub & Streaming
  btnClassify: document.getElementById('btnClassify'),
  btnClassifyText: document.getElementById('btnClassifyText'),
  classifySpinner: document.getElementById('classifySpinner'),
  chkOnlyUncategorized: document.getElementById('chkOnlyUncategorized'),
  aiLiveTicker: document.getElementById('aiLiveTicker'),
  aiLiveTickerText: document.getElementById('aiLiveTickerText'),
  aiProgressWrapper: document.getElementById('aiProgressWrapper'),
  aiProgressLabel: document.getElementById('aiProgressLabel'),
  aiProgressPercent: document.getElementById('aiProgressPercent'),
  aiProgressBarFill: document.getElementById('aiProgressBarFill'),
  aiProgressSubtext: document.getElementById('aiProgressSubtext'),
  aiProgressEta: document.getElementById('aiProgressEta'),

  // Insights Drawer
  genreDistBar: document.getElementById('genreDistBar'),
  genreDistLegend: document.getElementById('genreDistLegend'),
  vibeCloudContainer: document.getElementById('vibeCloudContainer'),
  healthClassifiedRatio: document.getElementById('healthClassifiedRatio'),
  healthClassifiedBar: document.getElementById('healthClassifiedBar'),
  healthSyncedRatio: document.getElementById('healthSyncedRatio'),
  healthSyncedBar: document.getElementById('healthSyncedBar'),

  // Curation Studio
  filterSearch: document.getElementById('filterSearch'),
  btnSearchClear: document.getElementById('btnSearchClear'),
  filterMainGenre: document.getElementById('filterMainGenre'),
  filterSubGenre: document.getElementById('filterSubGenre'),
  filterStatus: document.getElementById('filterStatus'),
  filterSort: document.getElementById('filterSort'),
  btnViewGrid: document.getElementById('btnViewGrid'),
  btnViewTable: document.getElementById('btnViewTable'),
  btnViewCompact: document.getElementById('btnViewCompact'),
  btnSelectAllToolbar: document.getElementById('btnSelectAllToolbar'),
  studioContent: document.getElementById('studioContent'),
  btnOpenMergeModal: document.getElementById('btnOpenMergeModal'),
  btnOpenCustomPlaylistModal: document.getElementById('btnOpenCustomPlaylistModal'),

  // Batch Action Bar
  batchActionBar: document.getElementById('batchActionBar'),
  batchCountBadge: document.getElementById('batchCountBadge'),
  btnBatchMove: document.getElementById('btnBatchMove'),
  btnBatchVibe: document.getElementById('btnBatchVibe'),
  btnBatchSync: document.getElementById('btnBatchSync'),
  btnBatchDelete: document.getElementById('btnBatchDelete'),
  btnBatchClear: document.getElementById('btnBatchClear'),

  // Batch Modals
  batchMoveModal: document.getElementById('batchMoveModal'),
  batchMoveCount: document.getElementById('batchMoveCount'),
  inputBatchMoveTarget: document.getElementById('inputBatchMoveTarget'),
  batchSubgenresDatalist: document.getElementById('batchSubgenresDatalist'),
  btnConfirmBatchMove: document.getElementById('btnConfirmBatchMove'),

  batchVibeModal: document.getElementById('batchVibeModal'),
  batchVibeCount: document.getElementById('batchVibeCount'),
  inputBatchVibeTag: document.getElementById('inputBatchVibeTag'),
  btnConfirmBatchVibe: document.getElementById('btnConfirmBatchVibe'),

  // Custom Playlist Modal
  customPlaylistModal: document.getElementById('customPlaylistModal'),
  inputCustomPlaylistTitle: document.getElementById('inputCustomPlaylistTitle'),
  selectCustomMainGenre: document.getElementById('selectCustomMainGenre'),
  selectCustomSubGenre: document.getElementById('selectCustomSubGenre'),
  inputCustomVibeQuery: document.getElementById('inputCustomVibeQuery'),
  customMatchedCount: document.getElementById('customMatchedCount'),
  customMatchedList: document.getElementById('customMatchedList'),
  btnCreateCustomPlaylist: document.getElementById('btnCreateCustomPlaylist'),
  customPlaylistSpinner: document.getElementById('customPlaylistSpinner'),

  // Settings Modal
  btnOpenSettings: document.getElementById('btnOpenSettings'),
  settingsModal: document.getElementById('settingsModal'),
  inputGeminiKey: document.getElementById('inputGeminiKey'),
  selectGeminiModel: document.getElementById('selectGeminiModel'),
  inputYtHeaders: document.getElementById('inputYtHeaders'),
  btnConnectYT: document.getElementById('btnConnectYT'),
  ytAuthIndicator: document.getElementById('ytAuthIndicator'),
  inputPlaylistPrefix: document.getElementById('inputPlaylistPrefix'),
  btnSaveSettings: document.getElementById('btnSaveSettings'),

  // Edit Track Modal
  editTrackModal: document.getElementById('editTrackModal'),
  editTrackId: document.getElementById('editTrackId'),
  editTrackDisplay: document.getElementById('editTrackDisplay'),
  editTrackSubgenre: document.getElementById('editTrackSubgenre'),
  editSubgenresDatalist: document.getElementById('editSubgenresDatalist'),
  editTrackMainGenre: document.getElementById('editTrackMainGenre'),
  editTrackVibe: document.getElementById('editTrackVibe'),
  btnSaveTrackEdit: document.getElementById('btnSaveTrackEdit'),

  // Merge Modal
  mergeModal: document.getElementById('mergeModal'),
  selectMergeSource: document.getElementById('selectMergeSource'),
  inputMergeTarget: document.getElementById('inputMergeTarget'),
  existingSubgenresList: document.getElementById('existingSubgenresList'),
  btnConfirmMerge: document.getElementById('btnConfirmMerge'),

  // Sync Modal & Footer
  btnOpenSyncModal: document.getElementById('btnOpenSyncModal'),
  syncModal: document.getElementById('syncModal'),
  syncSubgenresList: document.getElementById('syncSubgenresList'),
  syncSummaryNote: document.getElementById('syncSummaryNote'),
  btnSelectAllSync: document.getElementById('btnSelectAllSync'),
  btnDeselectAllSync: document.getElementById('btnDeselectAllSync'),
  btnStartSync: document.getElementById('btnStartSync'),
  syncSpinner: document.getElementById('syncSpinner'),
  syncProgressBox: document.getElementById('syncProgressBox'),
  syncProgressBar: document.getElementById('syncProgressBar'),
  syncStatusMsg: document.getElementById('syncStatusMsg'),
  syncResultsLog: document.getElementById('syncResultsLog'),
  syncBarTitle: document.getElementById('syncBarTitle'),
  syncBarDesc: document.getElementById('syncBarDesc'),

  toastContainer: document.getElementById('toastContainer')
};

// ==========================================================================
// Initialization & Lifecycle
// ==========================================================================
async function initApp() {
  setupEventListeners();
  initVisualizer();
  updateSoundButtonUi();
  await loadSettings();
  await refreshAll();
}

async function refreshAll() {
  await loadStatus();
  await loadTracks();
}

function updateSoundButtonUi() {
  if (elements.soundIcon) {
    elements.soundIcon.textContent = state.soundEnabled ? '🔊' : '🔇';
  }
}

// ==========================================================================
// API Calls & Data Loaders
// ==========================================================================
async function loadStatus() {
  try {
    const res = await fetch(`${API_BASE}/status`);
    if (!res.ok) return;
    const data = await res.json();
    state.systemStatus = data;

    // Update Status Chips
    updateChip(elements.geminiStatusChip, data.gemini_configured, 'Gemini AI Ready', 'Gemini Not Set');
    updateChip(elements.ytStatusChip, data.ytmusic_connected, 'YT Music Connected', 'YT Music Offline');

    // Update Stats Counters with percentages
    const total = data.total_tracks || 0;
    const classified = data.classified_tracks || 0;
    const synced = data.synced_tracks || 0;

    elements.statTotalTracks.textContent = total;
    elements.statClassified.textContent = classified;
    elements.statSubgenres.textContent = data.total_subgenres || 0;
    elements.statSynced.textContent = synced;

    const classifiedPct = total > 0 ? Math.round((classified / total) * 100) : 0;
    const syncedPct = total > 0 ? Math.round((synced / total) * 100) : 0;

    if (elements.statClassifiedPct) elements.statClassifiedPct.textContent = `${classifiedPct}%`;
    if (elements.statSyncedPct) elements.statSyncedPct.textContent = `${syncedPct}%`;

    // Update Sync Bar
    if (data.total_subgenres > 0) {
      elements.syncBarTitle.textContent = `${data.total_subgenres} Sub-genres Categorized`;
      elements.syncBarDesc.textContent = `${total} songs ready for direct YouTube Music playlist creation.`;
    } else {
      elements.syncBarTitle.textContent = 'Ready to Create Playlists';
      elements.syncBarDesc.textContent = 'Import songs & run AI classification to generate sub-genre playlists.';
    }
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

async function loadSettings() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    if (!res.ok) return;
    const data = await res.json();
    state.settings = data;

    if (data.gemini_model) {
      elements.selectGeminiModel.value = data.gemini_model;
      elements.activeModelTag.textContent = data.gemini_model;
    }
    if (data.playlist_prefix) {
      elements.inputPlaylistPrefix.value = data.playlist_prefix;
    }
    if (data.masked_gemini_key) {
      elements.inputGeminiKey.placeholder = `Current Key: ${data.masked_gemini_key}`;
    }

    updateYTAuthBadge(data.ytmusic_connected);
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

async function loadTracks() {
  try {
    const res = await fetch(`${API_BASE}/tracks`);
    if (!res.ok) throw new Error('Failed to load tracks');
    const allTracks = await res.json();
    state.allTracks = allTracks;

    // Build master list of unique genres and vibes
    state.allMainGenres = Array.from(new Set(allTracks.map(t => t.main_genre).filter(Boolean))).sort();
    state.allSubgenres = Array.from(new Set(allTracks.map(t => t.sub_genre).filter(Boolean))).sort();
    
    // Extract unique vibes
    const vibeSet = new Set();
    allTracks.forEach(t => {
      if (t.vibe) {
        t.vibe.split(',').forEach(v => {
          const trimmed = v.trim();
          if (trimmed) vibeSet.add(trimmed);
        });
      }
    });
    state.allVibes = Array.from(vibeSet).sort();

    // Populate batch datalists
    updateBatchSubgenresDatalist();

    // Populate dropdowns & insights
    updateGenreFilterDropdowns();
    updateLibraryInsights();

    // Apply current search/filters and render
    applyFiltersAndRender();
  } catch (err) {
    console.error('Error loading tracks:', err);
    showToast('Failed to load tracks', 'error');
  }
}

function updateBatchSubgenresDatalist() {
  if (elements.batchSubgenresDatalist) {
    elements.batchSubgenresDatalist.innerHTML = state.allSubgenres.map(s => `<option value="${escapeHtml(s)}">`).join('');
  }
}

function updateGenreFilterDropdowns() {
  const mainSelect = elements.filterMainGenre;
  const currentMain = state.filters.mainGenre || '';

  mainSelect.innerHTML = '<option value="">All Main Genres</option>';
  state.allMainGenres.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    mainSelect.appendChild(opt);
  });
  mainSelect.value = currentMain;

  const subSelect = elements.filterSubGenre;
  const currentSub = state.filters.subGenre || '';

  let availableSubs = state.allTracks;
  if (currentMain) {
    availableSubs = availableSubs.filter(t => t.main_genre === currentMain);
  }
  const uniqueSubs = Array.from(new Set(availableSubs.map(t => t.sub_genre).filter(Boolean))).sort();

  subSelect.innerHTML = '<option value="">All Sub-genres</option>';
  uniqueSubs.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    subSelect.appendChild(opt);
  });
  subSelect.value = uniqueSubs.includes(currentSub) ? currentSub : '';
}

// ==========================================================================
// Filtering, Sorting & View State
// ==========================================================================
function applyFiltersAndRender() {
  let filtered = [...state.allTracks];

  // 1. Text Search
  const query = (state.filters.search || '').toLowerCase().trim();
  if (query) {
    filtered = filtered.filter(t => 
      (t.title && t.title.toLowerCase().includes(query)) ||
      (t.artist && t.artist.toLowerCase().includes(query)) ||
      (t.sub_genre && t.sub_genre.toLowerCase().includes(query)) ||
      (t.main_genre && t.main_genre.toLowerCase().includes(query)) ||
      (t.vibe && t.vibe.toLowerCase().includes(query))
    );
  }

  // 2. Main Genre Filter
  if (state.filters.mainGenre) {
    filtered = filtered.filter(t => t.main_genre === state.filters.mainGenre);
  }

  // 3. Sub-genre Filter
  if (state.filters.subGenre) {
    filtered = filtered.filter(t => t.sub_genre === state.filters.subGenre);
  }

  // 4. Status Filter
  if (state.filters.status) {
    if (state.filters.status === 'needs_ai') {
      filtered = filtered.filter(t => !t.sub_genre || t.sub_genre === 'General' || t.main_genre === 'Uncategorized');
    } else if (state.filters.status === 'classified') {
      filtered = filtered.filter(t => t.sub_genre && t.sub_genre !== 'General' && t.main_genre !== 'Uncategorized');
    } else if (state.filters.status === 'synced') {
      filtered = filtered.filter(t => t.is_synced);
    } else if (state.filters.status === 'not_synced') {
      filtered = filtered.filter(t => !t.is_synced);
    }
  }

  // 5. Active Vibe Filter (from Insights Vibe Cloud)
  if (state.activeVibeFilter) {
    filtered = filtered.filter(t => t.vibe && t.vibe.toLowerCase().includes(state.activeVibeFilter.toLowerCase()));
  }

  // 6. Sorting
  const sortMode = state.filters.sort || 'subgenre_asc';
  filtered.sort((a, b) => {
    if (sortMode === 'title_asc') return (a.title || '').localeCompare(b.title || '');
    if (sortMode === 'title_desc') return (b.title || '').localeCompare(a.title || '');
    if (sortMode === 'artist_asc') return (a.artist || '').localeCompare(b.artist || '');
    if (sortMode === 'vibe_asc') return (a.vibe || '').localeCompare(b.vibe || '');
    if (sortMode === 'newest') return (b.created_at || 0) - (a.created_at || 0);
    // Default: subgenre_asc
    const subA = a.sub_genre || 'Uncategorized';
    const subB = b.sub_genre || 'Uncategorized';
    return subA.localeCompare(subB);
  });

  state.tracks = filtered;
  updateBatchActionBar();
  renderStudioContent();
}

// ==========================================================================
// Library Insights & Analytics Drawer
// ==========================================================================
function updateLibraryInsights() {
  const all = state.allTracks;
  if (!all || all.length === 0) {
    if (elements.genreDistBar) elements.genreDistBar.innerHTML = '';
    if (elements.genreDistLegend) elements.genreDistLegend.innerHTML = '<span style="color:var(--text-muted);font-size:0.75rem;">No tracks loaded yet.</span>';
    if (elements.vibeCloudContainer) elements.vibeCloudContainer.innerHTML = '<span class="vibe-cloud-empty">Classify tracks with AI to generate vibe intelligence.</span>';
    return;
  }

  // 1. Top Subgenres Distribution
  const genreCounts = {};
  all.forEach(t => {
    const s = t.sub_genre || 'Uncategorized';
    genreCounts[s] = (genreCounts[s] || 0) + 1;
  });

  const sortedGenres = Object.entries(genreCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8); // Top 8

  const total = all.length;
  let barHtml = '';
  let legendHtml = '';

  sortedGenres.forEach(([genre, count]) => {
    const pct = Math.max(2, Math.round((count / total) * 100));
    const theme = getGenreTheme(genre);

    barHtml += `<div class="genre-bar-segment" style="width: ${pct}%; background: ${theme.gradient};" title="${escapeHtml(genre)}: ${count} songs (${pct}%)"></div>`;
    const isChipActive = state.filters.subGenre === genre;
    legendHtml += `
      <div class="legend-chip ${isChipActive ? 'active' : ''}" data-genre="${escapeHtml(genre)}">
        <span class="legend-color-dot" style="background: ${theme.dot};"></span>
        <span>${escapeHtml(genre)}: <strong>${count}</strong></span>
      </div>
    `;
  });

  elements.genreDistBar.innerHTML = barHtml;
  elements.genreDistLegend.innerHTML = legendHtml;

  // Add click listeners to legend chips to filter
  elements.genreDistLegend.querySelectorAll('.legend-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const g = chip.getAttribute('data-genre');
      if (state.filters.subGenre === g) {
        state.filters.subGenre = '';
        elements.filterSubGenre.value = '';
        chip.classList.remove('active');
      } else {
        state.filters.subGenre = g;
        const matchingTrack = state.allTracks.find(t => t.sub_genre === g);
        if (matchingTrack && state.filters.mainGenre && matchingTrack.main_genre !== state.filters.mainGenre) {
          state.filters.mainGenre = '';
          elements.filterMainGenre.value = '';
        }
        updateGenreFilterDropdowns();
        elements.filterSubGenre.value = g;
      }
      applyFiltersAndRender();
      updateLibraryInsights();
      playUiSound('click');
    });
  });

  // 2. Vibe Cloud
  const vibeCounts = {};
  all.forEach(t => {
    if (t.vibe) {
      t.vibe.split(',').forEach(v => {
        const item = v.trim();
        if (item) {
          vibeCounts[item] = (vibeCounts[item] || 0) + 1;
        }
      });
    }
  });

  const sortedVibes = Object.entries(vibeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18);

  if (sortedVibes.length === 0) {
    elements.vibeCloudContainer.innerHTML = '<span class="vibe-cloud-empty">Run AI classification to discover vibe tags across your songs.</span>';
  } else {
    elements.vibeCloudContainer.innerHTML = sortedVibes.map(([vibe, count]) => {
      const isActive = state.activeVibeFilter.toLowerCase() === vibe.toLowerCase();
      return `
        <span class="vibe-pill ${isActive ? 'active' : ''}" data-vibe="${escapeHtml(vibe)}">
          <span>✨ ${escapeHtml(vibe)}</span>
          <span class="vibe-pill-count">(${count})</span>
        </span>
      `;
    }).join('');

    elements.vibeCloudContainer.querySelectorAll('.vibe-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const v = pill.getAttribute('data-vibe');
        if (state.activeVibeFilter.toLowerCase() === v.toLowerCase()) {
          state.activeVibeFilter = '';
          pill.classList.remove('active');
        } else {
          state.activeVibeFilter = v;
          elements.vibeCloudContainer.querySelectorAll('.vibe-pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
        }
        applyFiltersAndRender();
        playUiSound('click');
      });
    });
  }

  // 3. Health Metrics
  const classifiedCount = all.filter(t => t.sub_genre && t.sub_genre !== 'General' && t.main_genre !== 'Uncategorized').length;
  const syncedCount = all.filter(t => t.is_synced).length;

  const classPct = total > 0 ? Math.round((classifiedCount / total) * 100) : 0;
  const syncPct = total > 0 ? Math.round((syncedCount / total) * 100) : 0;

  elements.healthClassifiedRatio.textContent = `${classifiedCount} / ${total} (${classPct}%)`;
  elements.healthClassifiedBar.style.width = `${classPct}%`;

  elements.healthSyncedRatio.textContent = `${syncedCount} / ${total} (${syncPct}%)`;
  elements.healthSyncedBar.style.width = `${syncPct}%`;
}

// ==========================================================================
// UI Rendering: Curation Studio (Grid / Table / Compact)
// ==========================================================================
function renderStudioContent() {
  const container = elements.studioContent;
  container.innerHTML = '';

  if (!state.tracks || state.tracks.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎵</div>
        <h3>No tracks match your current filters</h3>
        <p>Try clearing filters or click <strong>✨ Demo</strong> to load sample tracks!</p>
      </div>
    `;
    return;
  }

  if (state.viewMode === 'grid') {
    renderSubgenreGrid(container);
  } else if (state.viewMode === 'table') {
    renderTableView(container);
  } else {
    renderCompactView(container);
  }
}

// -------------------------------------------------------------
// View 1: Sub-genre Group Cards (Grid)
// -------------------------------------------------------------
function renderSubgenreGrid(container) {
  const groups = {};
  state.tracks.forEach(track => {
    const sub = track.sub_genre || 'Uncategorized';
    if (!groups[sub]) {
      groups[sub] = {
        subGenre: sub,
        mainGenre: track.main_genre || 'General',
        tracks: []
      };
    }
    groups[sub].tracks.push(track);
  });

  const grid = document.createElement('div');
  grid.className = 'subgenre-grid';

  const sortedSubgenres = Object.keys(groups).sort((a, b) => {
    if (a === 'Uncategorized') return 1;
    if (b === 'Uncategorized') return -1;
    return a.localeCompare(b);
  });

  sortedSubgenres.forEach(subName => {
    const group = groups[subName];
    const theme = getGenreTheme(group.subGenre);
    const card = document.createElement('div');
    card.className = 'subgenre-card';
    card.style.setProperty('--card-accent-gradient', theme.gradient);
    card.style.setProperty('--card-dot-color', theme.dot);

    const isCollapsed = state.collapsedCards.has(subName);

    // Card Header
    const header = document.createElement('div');
    header.className = 'subgenre-card-header';
    header.innerHTML = `
      <div class="subgenre-name-group">
        <input type="checkbox" class="subgenre-card-checkbox" title="Select all songs in this sub-genre">
        <span class="genre-dot"></span>
        <div class="subgenre-title-wrapper">
          <span class="subgenre-title" title="${escapeHtml(group.subGenre)}">${escapeHtml(group.subGenre)}</span>
          <span class="main-genre-pill">${escapeHtml(group.mainGenre)}</span>
        </div>
      </div>
      <div class="subgenre-card-tools">
        <span class="subgenre-count">${group.tracks.length}</span>
        <button class="card-action-btn btn-card-sync" title="Export this sub-genre directly to YouTube Music">🚀</button>
        <button class="card-action-btn btn-card-rename" title="Rename sub-genre">✏️</button>
        <button class="card-action-btn btn-card-collapse" title="Collapse / Expand card">${isCollapsed ? '▼' : '▲'}</button>
      </div>
    `;

    // Subgenre Card Body
    const body = document.createElement('div');
    body.className = 'subgenre-card-body';
    if (isCollapsed) body.classList.add('hidden');

    group.tracks.forEach(track => {
      const row = document.createElement('div');
      const isSelected = state.selectedTrackIds.has(track.id);
      row.className = `track-row ${isSelected ? 'selected' : ''}`;
      row.setAttribute('data-id', track.id);

      const thumbUrl = getSafeThumb(track.thumbnail);
      const sourceBadge = getSourceBadgeHtml(track.source_platform);
      const ytQuery = encodeURIComponent(`${track.artist} - ${track.title}`);
      const ytSearchUrl = `https://music.youtube.com/search?q=${ytQuery}`;

      row.innerHTML = `
        <input type="checkbox" class="track-checkbox" ${isSelected ? 'checked' : ''}>
        <div class="track-thumb-wrapper">
          <img class="track-thumb" src="${thumbUrl}" alt="Cover" loading="lazy">
        </div>
        <div class="track-info">
          <div class="track-title" title="${escapeHtml(track.title)}">${escapeHtml(track.title)}</div>
          <div class="track-artist" title="${escapeHtml(track.artist)}">${escapeHtml(track.artist)}</div>
        </div>
        <div class="track-meta-pills">
          ${track.vibe ? `<span class="vibe-tag" title="Click to filter by vibe: ${escapeHtml(track.vibe)}">${escapeHtml(track.vibe)}</span>` : ''}
          ${sourceBadge}
        </div>
        <div class="track-actions">
          <a href="${ytSearchUrl}" target="_blank" rel="noopener" class="action-btn-sm btn-preview-listen" title="Listen / Search on YouTube Music">▶</a>
          <button class="action-btn-sm btn-edit" title="Edit sub-genre">✏️</button>
          <button class="action-btn-sm btn-delete" title="Remove song">&times;</button>
        </div>
      `;

      // Safe image fallback
      const img = row.querySelector('.track-thumb');
      if (img) img.onerror = () => { img.src = DEFAULT_THUMB_SVG; };

      // Row Selection
      const cb = row.querySelector('.track-checkbox');
      cb.addEventListener('change', (e) => {
        toggleTrackSelection(track.id, e.target.checked);
        row.classList.toggle('selected', e.target.checked);
      });

      // Vibe tag click filter
      const vibeTag = row.querySelector('.vibe-tag');
      if (vibeTag) {
        vibeTag.addEventListener('click', (e) => {
          e.stopPropagation();
          const v = track.vibe.split(',')[0].trim();
          state.activeVibeFilter = v;
          applyFiltersAndRender();
          playUiSound('click');
        });
      }

      // Actions
      row.querySelector('.btn-edit').addEventListener('click', (e) => {
        e.stopPropagation();
        promptEditTrackGenre(track);
      });
      row.querySelector('.btn-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        handleDeleteTrack(track.id);
      });

      body.appendChild(row);
    });

    // Card Header Checkbox (Select all tracks in this card)
    const cardCb = header.querySelector('.subgenre-card-checkbox');
    const allSelectedInCard = group.tracks.every(t => state.selectedTrackIds.has(t.id));
    cardCb.checked = allSelectedInCard && group.tracks.length > 0;
    cardCb.addEventListener('change', (e) => {
      const checked = e.target.checked;
      group.tracks.forEach(t => toggleTrackSelection(t.id, checked));
      applyFiltersAndRender();
      playUiSound('click');
    });

    // Card Actions
    header.querySelector('.btn-card-sync').addEventListener('click', (e) => {
      e.stopPropagation();
      handleQuickExportSubgenre(group.subGenre);
    });
    header.querySelector('.btn-card-rename').addEventListener('click', (e) => {
      e.stopPropagation();
      handleRenameSubgenre(group.subGenre);
    });
    header.querySelector('.btn-card-collapse').addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.collapsedCards.has(subName)) {
        state.collapsedCards.delete(subName);
      } else {
        state.collapsedCards.add(subName);
      }
      renderStudioContent();
    });

    card.appendChild(header);
    card.appendChild(body);
    grid.appendChild(card);
  });

  container.appendChild(grid);
}

// -------------------------------------------------------------
// View 2: Detailed Table View
// -------------------------------------------------------------
function renderTableView(container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'studio-table-container';

  let html = `
    <table class="studio-table">
      <thead>
        <tr>
          <th style="width: 38px;"><input type="checkbox" id="tableMasterCheckbox"></th>
          <th style="width: 40px;">#</th>
          <th>Track & Artist</th>
          <th>Main Genre</th>
          <th>Sub-genre</th>
          <th>Vibe Mood</th>
          <th>Source</th>
          <th style="text-align: right; width: 90px;">Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  state.tracks.forEach((track, i) => {
    const isSelected = state.selectedTrackIds.has(track.id);
    const thumbUrl = getSafeThumb(track.thumbnail);
    const sourceBadge = getSourceBadgeHtml(track.source_platform);
    const ytQuery = encodeURIComponent(`${track.artist} - ${track.title}`);
    const ytSearchUrl = `https://music.youtube.com/search?q=${ytQuery}`;

    html += `
      <tr data-id="${track.id}" class="${isSelected ? 'selected' : ''}">
        <td><input type="checkbox" class="track-checkbox" ${isSelected ? 'checked' : ''} data-id="${track.id}"></td>
        <td style="color: var(--text-muted);">${i + 1}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${thumbUrl}" class="table-track-thumb" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover;" loading="lazy">
            <div style="min-width: 0;">
              <div style="font-weight: 600; font-size: 0.9rem; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px;">${escapeHtml(track.title)}</div>
              <div style="font-size: 0.77rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 280px;">${escapeHtml(track.artist)}</div>
            </div>
          </div>
        </td>
        <td><span class="main-genre-pill">${escapeHtml(track.main_genre || 'Uncategorized')}</span></td>
        <td>
          <input type="text" class="inline-genre-edit" value="${escapeHtml(track.sub_genre || '')}" data-id="${track.id}">
        </td>
        <td><span class="vibe-tag" title="Vibe: ${escapeHtml(track.vibe || '')}">${escapeHtml(track.vibe || '-')}</span></td>
        <td>${sourceBadge}</td>
        <td style="text-align: right;">
          <a href="${ytSearchUrl}" target="_blank" rel="noopener" class="action-btn-sm btn-preview-listen" title="Listen on YouTube Music">▶</a>
          <button class="action-btn-sm btn-edit" title="Edit track details" data-id="${track.id}">✏️</button>
          <button class="action-btn-sm btn-delete" title="Delete" data-id="${track.id}">&times;</button>
        </td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('.table-track-thumb').forEach(img => {
    img.onerror = () => { img.src = DEFAULT_THUMB_SVG; };
  });

  const trackMap = new Map(state.tracks.map(t => [t.id, t]));

  // Table Master Checkbox
  const masterCb = wrapper.querySelector('#tableMasterCheckbox');
  const allSelected = state.tracks.length > 0 && state.tracks.every(t => state.selectedTrackIds.has(t.id));
  masterCb.checked = allSelected;
  masterCb.addEventListener('change', (e) => {
    const checked = e.target.checked;
    state.tracks.forEach(t => toggleTrackSelection(t.id, checked));
    renderStudioContent();
    playUiSound('click');
  });

  // Delegated change listener for row checkboxes and inline edits
  wrapper.addEventListener('change', async (e) => {
    if (e.target.classList.contains('track-checkbox')) {
      const tid = e.target.getAttribute('data-id');
      toggleTrackSelection(tid, e.target.checked);
      const tr = e.target.closest('tr');
      if (tr) tr.classList.toggle('selected', e.target.checked);
    } else if (e.target.classList.contains('inline-genre-edit')) {
      const trackId = e.target.getAttribute('data-id');
      const newSub = e.target.value.trim();
      if (newSub) {
        await updateTrackField(trackId, { sub_genre: newSub });
      }
    }
  });

  // Delegated click listener for edit & delete buttons
  wrapper.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-edit');
    if (editBtn) {
      e.stopPropagation();
      const tid = editBtn.getAttribute('data-id');
      const track = trackMap.get(tid);
      if (track) openEditTrackModal(track);
      return;
    }

    const delBtn = e.target.closest('.btn-delete');
    if (delBtn) {
      e.stopPropagation();
      const tid = delBtn.getAttribute('data-id');
      handleDeleteTrack(tid);
      return;
    }
  });

  container.appendChild(wrapper);
}

// -------------------------------------------------------------
// View 3: Compact Density View
// -------------------------------------------------------------
function renderCompactView(container) {
  const list = document.createElement('div');
  list.className = 'compact-list';

  const trackMap = new Map(state.tracks.map(t => [t.id, t]));

  state.tracks.forEach(track => {
    const isSelected = state.selectedTrackIds.has(track.id);
    const row = document.createElement('div');
    row.className = `compact-row ${isSelected ? 'selected' : ''}`;
    row.setAttribute('data-id', track.id);

    const sourceBadge = getSourceBadgeHtml(track.source_platform);
    const ytQuery = encodeURIComponent(`${track.artist} - ${track.title}`);
    const ytSearchUrl = `https://music.youtube.com/search?q=${ytQuery}`;

    row.innerHTML = `
      <input type="checkbox" class="track-checkbox" ${isSelected ? 'checked' : ''} data-id="${track.id}">
      <div class="compact-title-group">
        <span class="compact-title">${escapeHtml(track.title)}</span>
        <span class="compact-artist">&bull; ${escapeHtml(track.artist)}</span>
      </div>
      <span class="main-genre-pill">${escapeHtml(track.sub_genre || 'Uncategorized')}</span>
      ${track.vibe ? `<span class="vibe-tag">${escapeHtml(track.vibe)}</span>` : ''}
      ${sourceBadge}
      <div class="track-actions">
        <a href="${ytSearchUrl}" target="_blank" rel="noopener" class="action-btn-sm btn-preview-listen" title="Listen on YouTube Music">▶</a>
        <button class="action-btn-sm btn-edit" title="Edit track" data-id="${track.id}">✏️</button>
        <button class="action-btn-sm btn-delete" title="Remove track" data-id="${track.id}">&times;</button>
      </div>
    `;

    list.appendChild(row);
  });

  // Delegated event handling for compact list (fast, scalable)
  list.addEventListener('change', (e) => {
    if (e.target.classList.contains('track-checkbox')) {
      const tid = e.target.getAttribute('data-id');
      toggleTrackSelection(tid, e.target.checked);
      const row = e.target.closest('.compact-row');
      if (row) row.classList.toggle('selected', e.target.checked);
    }
  });

  list.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.btn-edit');
    if (editBtn) {
      e.stopPropagation();
      const tid = editBtn.getAttribute('data-id');
      const track = trackMap.get(tid);
      if (track) openEditTrackModal(track);
      return;
    }

    const delBtn = e.target.closest('.btn-delete');
    if (delBtn) {
      e.stopPropagation();
      const tid = delBtn.getAttribute('data-id');
      handleDeleteTrack(tid);
      return;
    }
  });

  container.appendChild(list);
}

function getSourceBadgeHtml(platform) {
  if (platform === 'spotify') return '<span class="badge badge-spotify">Spotify</span>';
  if (platform === 'soundcloud') return '<span class="badge badge-soundcloud">SoundCloud</span>';
  if (platform === 'youtube') return '<span class="badge badge-yt">YT</span>';
  if (platform === 'csv') return '<span class="badge badge-csv">CSV</span>';
  return '<span class="badge badge-text">Manual</span>';
}

function updateChip(chipEl, isOnline, onlineText, offlineText) {
  const dot = chipEl.querySelector('.status-dot');
  const label = chipEl.querySelector('.chip-label');
  if (isOnline) {
    dot.className = 'status-dot dot-online';
    label.textContent = onlineText;
  } else {
    dot.className = 'status-dot dot-offline';
    label.textContent = offlineText;
  }
}

function updateYTAuthBadge(isConnected) {
  if (isConnected) {
    elements.ytAuthIndicator.innerHTML = '<span class="auth-status-badge badge-connected">✓ Connected to YouTube Music</span>';
  } else {
    elements.ytAuthIndicator.innerHTML = '<span class="auth-status-badge badge-disconnected">&times; Not Connected</span>';
  }
}

// ==========================================================================
// Multi-Select & Floating Batch Action Bar
// ==========================================================================
function toggleTrackSelection(trackId, isSelected) {
  if (isSelected) {
    state.selectedTrackIds.add(trackId);
  } else {
    state.selectedTrackIds.delete(trackId);
  }
  updateBatchActionBar();
}

function updateBatchActionBar() {
  const count = state.selectedTrackIds.size;
  if (count > 0) {
    elements.batchActionBar.classList.remove('hidden');
    elements.batchCountBadge.textContent = count;
  } else {
    elements.batchActionBar.classList.add('hidden');
  }
}

function clearAllSelections() {
  state.selectedTrackIds.clear();
  updateBatchActionBar();
  renderStudioContent();
  playUiSound('click');
}

// -------------------------------------------------------------
// Batch Operations Handlers
// -------------------------------------------------------------
function openBatchMoveModal() {
  const count = state.selectedTrackIds.size;
  if (count === 0) return;
  elements.batchMoveCount.textContent = count;
  elements.inputBatchMoveTarget.value = '';
  openModal('batchMoveModal');
}

async function handleConfirmBatchMove() {
  const targetSub = elements.inputBatchMoveTarget.value.trim();
  if (!targetSub) {
    showToast('Please type or select a target sub-genre.', 'info');
    return;
  }

  const trackIds = Array.from(state.selectedTrackIds);
  try {
    const res = await fetch(`${API_BASE}/tracks/batch-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_ids: trackIds,
        updates: { sub_genre: targetSub }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Batch update failed');

    showToast(`✓ Moved ${data.updated_count} tracks to "${targetSub}"!`, 'success');
    closeModal('batchMoveModal');
    clearAllSelections();
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openBatchVibeModal() {
  const count = state.selectedTrackIds.size;
  if (count === 0) return;
  elements.batchVibeCount.textContent = count;
  elements.inputBatchVibeTag.value = '';
  openModal('batchVibeModal');
}

async function handleConfirmBatchVibe() {
  const vibeTag = elements.inputBatchVibeTag.value.trim();
  if (!vibeTag) {
    showToast('Please enter a vibe tag.', 'info');
    return;
  }

  const trackIds = Array.from(state.selectedTrackIds);
  try {
    const res = await fetch(`${API_BASE}/tracks/batch-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        track_ids: trackIds,
        updates: { vibe: vibeTag }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Batch vibe failed');

    showToast(`✓ Tagged ${data.updated_count} tracks with "${vibeTag}"!`, 'success');
    closeModal('batchVibeModal');
    clearAllSelections();
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleBatchDelete() {
  const count = state.selectedTrackIds.size;
  if (count === 0) return;
  if (!confirm(`Are you sure you want to delete ${count} selected tracks?`)) return;

  const trackIds = Array.from(state.selectedTrackIds);
  try {
    const res = await fetch(`${API_BASE}/tracks/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track_ids: trackIds })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Batch delete failed');

    playUiSound('delete');
    showToast(`Deleted ${data.deleted_count} tracks`, 'info');
    clearAllSelections();
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function handleBatchExportToCustom() {
  const count = state.selectedTrackIds.size;
  if (count === 0) return;

  openCustomPlaylistModal(true);
  elements.inputCustomPlaylistTitle.value = `SoundSort Mix (${count} tracks)`;
  updateCustomPlaylistPreview();
}

// ==========================================================================
// Importer & Ingestion Handlers
// ==========================================================================
function updateImportInputCounter() {
  const text = elements.importInput.value.trim();
  if (!text) {
    elements.importCounterHint.textContent = '0 tracks detected in input';
    return;
  }
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  elements.importCounterHint.textContent = `${lines.length} lines / tracks detected`;
}

async function handleImport() {
  const text = elements.importInput.value.trim();
  if (!text) {
    showToast('Please paste track links, CSV data, or drop a file.', 'info');
    return;
  }

  elements.importSpinner.classList.remove('hidden');
  elements.btnImport.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/tracks/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input_text: text })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Import failed');

    playUiSound('import');
    showToast(`🎉 Successfully extracted ${data.newly_added} new tracks!`, 'success');
    elements.importInput.value = '';
    updateImportInputCounter();
    await refreshAll();
  } catch (err) {
    showToast(err.message || 'Import error', 'error');
  } finally {
    elements.importSpinner.classList.add('hidden');
    elements.btnImport.disabled = false;
  }
}

async function handleFileUpload(file) {
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  elements.importSpinner.classList.remove('hidden');
  elements.btnImport.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/tracks/import/file`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'File import failed');

    playUiSound('import');
    showToast(`🎉 Imported ${data.newly_added} tracks from ${file.name}!`, 'success');
    elements.importInput.value = '';
    updateImportInputCounter();
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    elements.importSpinner.classList.add('hidden');
    elements.btnImport.disabled = false;
    elements.fileUploadInput.value = '';
  }
}

async function handleImportYtLikes() {
  if (!state.systemStatus?.ytmusic_connected) {
    openModal('settingsModal');
    showToast('Please connect your YouTube Music account in Settings first.', 'info');
    return;
  }

  elements.btnImportYtLikes.disabled = true;
  elements.btnImportYtLikes.textContent = '⏳ Fetching Liked Songs...';

  try {
    const res = await fetch(`${API_BASE}/tracks/import/yt-likes`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to fetch Liked Songs');

    playUiSound('import');
    showToast(`🎉 Imported ${data.newly_added} liked songs from YouTube Music!`, 'success');
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    elements.btnImportYtLikes.disabled = false;
    elements.btnImportYtLikes.textContent = '❤️ YT Music Likes';
  }
}

// ==========================================================================
// AI Classification & Streaming Engine
// ==========================================================================
async function handleClassify() {
  if (state.allTracks.length === 0) {
    showToast('No tracks to classify! Import some tracks first.', 'info');
    return;
  }

  const onlyUncategorized = elements.chkOnlyUncategorized ? elements.chkOnlyUncategorized.checked : true;
  const unclassifiedCount = state.allTracks.filter(t => !t.sub_genre || t.sub_genre === 'General' || t.main_genre === 'Uncategorized').length;

  if (onlyUncategorized && unclassifiedCount === 0) {
    showToast('🎉 All tracks are already categorized! Uncheck the speed boost option if you wish to re-classify everything.', 'info');
    return;
  }

  const targetCount = onlyUncategorized ? unclassifiedCount : state.allTracks.length;

  // Show UI live progress wrapper & ticker
  isAiClassifying = true;
  elements.aiProgressWrapper.classList.remove('hidden');
  elements.aiLiveTicker.classList.remove('hidden');
  elements.aiProgressBarFill.style.width = '0%';
  elements.aiProgressPercent.textContent = '0%';
  elements.aiProgressLabel.textContent = `✨ Initializing AI Classifier for ${targetCount} tracks...`;
  elements.aiProgressSubtext.textContent = `0 / ${targetCount} tracks analyzed`;
  elements.aiLiveTickerText.textContent = `Connecting to Gemini AI Engine...`;

  elements.classifySpinner.classList.remove('hidden');
  elements.btnClassify.disabled = true;
  elements.btnClassifyText.textContent = 'Classifying in progress...';

  try {
    const response = await fetch(`${API_BASE}/tracks/classify/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ only_uncategorized: onlyUncategorized })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      if (errData.detail?.includes('API Key is missing') || response.status === 400) {
        openModal('settingsModal');
        throw new Error('Please enter your Gemini API Key in Settings first!');
      }
      throw new Error(errData.detail || 'Classification failed');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.replace(/^data:\s*/, '').trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);

          if (event.type === 'start') {
            elements.aiProgressLabel.textContent = `Categorizing in micro-batches of ${event.batch_size}...`;
            elements.aiProgressSubtext.textContent = `0 / ${event.total} tracks`;
          } else if (event.type === 'progress') {
            elements.aiProgressBarFill.style.width = `${event.percent}%`;
            elements.aiProgressPercent.textContent = `${event.percent}%`;
            elements.aiProgressLabel.textContent = `✨ Analyzing with ${event.model_used || 'Gemini'}...`;
            elements.aiProgressSubtext.textContent = `${event.processed} / ${event.total} tracks categorized (${event.percent}%)`;

            // Live updates to ticker with last classified song
            if (event.batch_tracks && event.batch_tracks.length > 0) {
              const lastTrack = event.batch_tracks[event.batch_tracks.length - 1];
              elements.aiLiveTickerText.textContent = `Classified: "${lastTrack.title}" &rarr; ${lastTrack.sub_genre} (${lastTrack.vibe || 'Musical'})`;

              // Merge in-memory
              const updatedMap = new Map(event.batch_tracks.map(t => [t.id, t]));
              state.allTracks = state.allTracks.map(t => updatedMap.has(t.id) ? updatedMap.get(t.id) : t);
              
              state.allMainGenres = Array.from(new Set(state.allTracks.map(t => t.main_genre).filter(Boolean))).sort();
              state.allSubgenres = Array.from(new Set(state.allTracks.map(t => t.sub_genre).filter(Boolean))).sort();
              updateGenreFilterDropdowns();
              updateLibraryInsights();

              const classifiedCount = state.allTracks.filter(t => t.sub_genre && t.sub_genre !== 'General' && t.main_genre !== 'Uncategorized').length;
              elements.statClassified.textContent = classifiedCount;
              elements.statSubgenres.textContent = state.allSubgenres.length;

              applyFiltersAndRender();
            }
          } else if (event.type === 'error') {
            throw new Error(event.message || 'Error occurred during classification');
          } else if (event.type === 'complete') {
            elements.aiProgressBarFill.style.width = '100%';
            elements.aiProgressPercent.textContent = '100%';
            elements.aiProgressLabel.textContent = '✓ AI Classification Complete!';
            elements.aiLiveTickerText.textContent = `✓ Successfully categorized ${event.total_classified} songs!`;
            playUiSound('success');
            showToast(`🎉 Successfully classified ${event.total_classified} songs!`, 'success');
          }
        } catch (e) {
          console.warn('Event parse warning:', e);
        }
      }
    }

    await refreshAll();
  } catch (err) {
    elements.aiProgressLabel.textContent = `❌ ${err.message}`;
    showToast(err.message, 'error');
  } finally {
    isAiClassifying = false;
    elements.classifySpinner.classList.add('hidden');
    elements.btnClassify.disabled = false;
    elements.btnClassifyText.textContent = '✨ Run AI Sub-genre Classifier';
    setTimeout(() => {
      elements.aiProgressWrapper.classList.add('hidden');
      elements.aiLiveTicker.classList.add('hidden');
    }, 6000);
  }
}

// ==========================================================================
// Track Editing & Deletion
// ==========================================================================
function openEditTrackModal(track) {
  if (!track) return;
  elements.editTrackId.value = track.id;
  elements.editTrackDisplay.textContent = `${track.title} — ${track.artist}`;
  elements.editTrackSubgenre.value = track.sub_genre || '';
  elements.editTrackVibe.value = track.vibe || '';

  // Main genre dropdown
  elements.editTrackMainGenre.innerHTML = '<option value="">Uncategorized</option>';
  state.allMainGenres.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    elements.editTrackMainGenre.appendChild(opt);
  });
  elements.editTrackMainGenre.value = track.main_genre || '';

  // Subgenres datalist autocomplete
  if (elements.editSubgenresDatalist) {
    elements.editSubgenresDatalist.innerHTML = state.allSubgenres.map(s => `<option value="${escapeHtml(s)}"></option>`).join('');
  }

  openModal('editTrackModal');
  setTimeout(() => elements.editTrackSubgenre.focus(), 150);
}

async function handleSaveTrackEdit() {
  const trackId = elements.editTrackId.value;
  if (!trackId) return;

  const sub = elements.editTrackSubgenre.value.trim();
  const main = elements.editTrackMainGenre.value.trim();
  const vibe = elements.editTrackVibe.value.trim();

  const updates = {};
  if (sub) updates.sub_genre = sub;
  if (main) updates.main_genre = main;
  if (vibe) updates.vibe = vibe;

  try {
    const res = await fetch(`${API_BASE}/tracks/${trackId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error('Update failed');
    playUiSound('success');
    showToast('✓ Track updated successfully!', 'success');
    closeModal('editTrackModal');
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function promptEditTrackGenre(track) {
  openEditTrackModal(track);
}

async function updateTrackField(trackId, updates) {
  try {
    const res = await fetch(`${API_BASE}/tracks/${trackId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error('Update failed');
    showToast('Updated sub-genre', 'success');
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleDeleteTrack(trackId) {
  try {
    const res = await fetch(`${API_BASE}/tracks/${trackId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    playUiSound('delete');
    showToast('Track removed', 'info');
    state.selectedTrackIds.delete(trackId);
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleClearAll() {
  if (state.allTracks.length === 0) return;
  if (!confirm('Are you sure you want to clear all tracks from the library?')) return;

  try {
    const res = await fetch(`${API_BASE}/tracks`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Clear failed');
    playUiSound('delete');
    showToast('All tracks cleared', 'info');
    clearAllSelections();
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================================================
// Card-Level Actions (Export Subgenre & Rename)
// ==========================================================================
async function handleQuickExportSubgenre(subgenre) {
  if (!state.systemStatus?.ytmusic_connected) {
    openModal('settingsModal');
    showToast('Please connect your YouTube Music account in Settings first.', 'info');
    return;
  }

  showToast(`🚀 Exporting "${subgenre}" to YouTube Music...`, 'info');

  try {
    const res = await fetch(`${API_BASE}/ytmusic/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subgenres: [subgenre],
        playlist_prefix: elements.inputPlaylistPrefix.value || 'SS: '
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Sync failed');

    const pl = data.playlists[0];
    if (pl && pl.playlist_url) {
      playUiSound('success');
      showToast(`🎉 Created playlist "${pl.playlist_title}" with ${pl.added_count} tracks!`, 'success');
      window.open(pl.playlist_url, '_blank');
    } else {
      showToast('Playlist synced!', 'success');
    }
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function handleRenameSubgenre(oldSubgenre) {
  openMergeModal(oldSubgenre);
}

// ==========================================================================
// Merge Subgenres Modal
// ==========================================================================
function openMergeModal(prefillSource = '') {
  const subgenres = (state.systemStatus?.subgenres || []).filter(Boolean);
  if (subgenres.length === 0) {
    showToast('No sub-genres to merge yet.', 'info');
    return;
  }

  elements.selectMergeSource.innerHTML = '';
  elements.existingSubgenresList.innerHTML = '';

  subgenres.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    elements.selectMergeSource.appendChild(opt);

    const dataOpt = document.createElement('option');
    dataOpt.value = s;
    elements.existingSubgenresList.appendChild(dataOpt);
  });

  if (prefillSource && subgenres.includes(prefillSource)) {
    elements.selectMergeSource.value = prefillSource;
  }
  elements.inputMergeTarget.value = '';
  openModal('mergeModal');
  setTimeout(() => elements.inputMergeTarget.focus(), 150);
}

async function handleConfirmMerge() {
  const source = elements.selectMergeSource.value;
  const target = elements.inputMergeTarget.value.trim();

  if (!source || !target) {
    showToast('Please specify both source and target sub-genres.', 'info');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/genres/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        old_subgenre: source,
        new_subgenre: target
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Merge failed');

    playUiSound('success');
    showToast(data.message || 'Merged sub-genres successfully!', 'success');
    closeModal('mergeModal');
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ==========================================================================
// YouTube Music Sync Modal
// ==========================================================================
function openSyncModal() {
  if (state.allTracks.length === 0) {
    showToast('No tracks in library to sync!', 'info');
    return;
  }

  const subgenres = (state.systemStatus?.subgenres || []).filter(Boolean);
  const container = elements.syncSubgenresList;
  container.innerHTML = '';

  const counts = {};
  state.allTracks.forEach(t => {
    const s = t.sub_genre || 'General';
    counts[s] = (counts[s] || 0) + 1;
  });

  subgenres.forEach(subName => {
    const count = counts[subName] || 0;
    const item = document.createElement('label');
    item.className = 'sync-subgenre-item';
    item.innerHTML = `
      <input type="checkbox" value="${escapeHtml(subName)}" checked>
      <span class="sync-item-label">${escapeHtml(subName)}</span>
      <span class="sync-item-badge">${count} songs</span>
    `;
    container.appendChild(item);
  });

  updateSyncSelectionSummary();
  elements.syncProgressBox.classList.add('hidden');
  elements.syncResultsLog.innerHTML = '';
  elements.syncProgressBar.style.width = '0%';
  openModal('syncModal');
}

function updateSyncSelectionSummary() {
  const checked = elements.syncSubgenresList.querySelectorAll('input[type="checkbox"]:checked').length;
  elements.syncSummaryNote.textContent = `${checked} playlists selected`;
}

async function handleStartSync() {
  const checkedInputs = elements.syncSubgenresList.querySelectorAll('input[type="checkbox"]:checked');
  const selectedSubgenres = Array.from(checkedInputs).map(cb => cb.value);

  if (selectedSubgenres.length === 0) {
    showToast('Please select at least one sub-genre to export.', 'info');
    return;
  }

  if (!state.systemStatus?.ytmusic_connected) {
    closeModal('syncModal');
    openModal('settingsModal');
    showToast('Please connect your YouTube Music account in Settings first.', 'info');
    return;
  }

  elements.syncSpinner.classList.remove('hidden');
  elements.btnStartSync.disabled = true;
  elements.syncProgressBox.classList.remove('hidden');
  elements.syncStatusMsg.textContent = `Creating ${selectedSubgenres.length} playlists on YouTube Music...`;
  elements.syncProgressBar.style.width = '20%';

  try {
    const res = await fetch(`${API_BASE}/ytmusic/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subgenres: selectedSubgenres,
        playlist_prefix: elements.inputPlaylistPrefix.value || 'SS: '
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Sync failed');

    elements.syncProgressBar.style.width = '100%';
    elements.syncStatusMsg.textContent = `✓ Successfully exported ${data.playlists.length} playlists!`;

    let logHtml = '';
    data.playlists.forEach(pl => {
      if (pl.success !== false) {
        logHtml += `
          <div class="sync-log-success" style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
            ✓ <strong>${escapeHtml(pl.playlist_title)}</strong>: ${pl.added_count}/${pl.total_requested} tracks &bull;
            <a href="${pl.playlist_url}" target="_blank" rel="noopener">Open in YouTube Music &rarr;</a>
          </div>
        `;
      } else {
        logHtml += `<div style="color: #ef4444; padding: 4px 0;">&times; Failed for ${escapeHtml(pl.subgenre)}: ${pl.error}</div>`;
      }
    });

    elements.syncResultsLog.innerHTML = logHtml;
    playUiSound('success');
    showToast('Playlists created in YouTube Music!', 'success');
    await refreshAll();
  } catch (err) {
    elements.syncStatusMsg.textContent = `Sync Error: ${err.message}`;
    showToast(err.message, 'error');
  } finally {
    elements.syncSpinner.classList.add('hidden');
    elements.btnStartSync.disabled = false;
  }
}

// ==========================================================================
// Custom Playlist Builder Modal
// ==========================================================================
function openCustomPlaylistModal(fromBatch = false) {
  if (state.allTracks.length === 0) {
    showToast('Import songs first to build a custom playlist.', 'info');
    return;
  }

  state.customPlaylistSelectedMode = fromBatch && state.selectedTrackIds.size > 0;

  const mainSelect = elements.selectCustomMainGenre;
  mainSelect.innerHTML = '<option value="">All Main Genres</option>';
  state.allMainGenres.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    mainSelect.appendChild(opt);
  });

  updateCustomSubgenreDropdown();

  if (!fromBatch) {
    elements.inputCustomPlaylistTitle.value = '';
  }
  elements.inputCustomVibeQuery.value = '';
  
  updateCustomPlaylistPreview();
  openModal('customPlaylistModal');
}

function updateCustomSubgenreDropdown() {
  const selectedMain = elements.selectCustomMainGenre.value;
  const subSelect = elements.selectCustomSubGenre;
  
  let availableSubs = state.allTracks;
  if (selectedMain) {
    availableSubs = availableSubs.filter(t => t.main_genre === selectedMain);
  }
  const uniqueSubs = Array.from(new Set(availableSubs.map(t => t.sub_genre).filter(Boolean))).sort();

  subSelect.innerHTML = '<option value="">All Sub-genres</option>';
  uniqueSubs.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s;
    subSelect.appendChild(opt);
  });
}

function updateCustomPlaylistPreview() {
  const selectedMain = elements.selectCustomMainGenre.value;
  const selectedSub = elements.selectCustomSubGenre.value;
  const rawVibe = (elements.inputCustomVibeQuery.value || '').trim();

  let pool = state.customPlaylistSelectedMode 
    ? Array.from(state.selectedTrackIds).map(id => state.allTracks.find(t => t.id === id)).filter(Boolean)
    : state.allTracks;

  if (selectedMain) {
    pool = pool.filter(t => t.main_genre === selectedMain);
  }
  if (selectedSub) {
    pool = pool.filter(t => t.sub_genre === selectedSub);
  }
  if (rawVibe) {
    // Split into tokens by comma to support multi-keyword mood presets (e.g. "High Energy, Aggressive")
    const tokens = rawVibe.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (tokens.length > 0) {
      pool = pool.filter(t => {
        const v = (t.vibe || '').toLowerCase();
        const sub = (t.sub_genre || '').toLowerCase();
        const main = (t.main_genre || '').toLowerCase();
        const title = (t.title || '').toLowerCase();
        const artist = (t.artist || '').toLowerCase();
        return tokens.some(token => 
          v.includes(token) || 
          sub.includes(token) || 
          main.includes(token) || 
          title.includes(token) || 
          artist.includes(token)
        );
      });
    }
  }

  currentCustomMatchedTracks = pool;
  renderCustomMatchedPreview(pool);
}

function renderCustomMatchedPreview(tracks) {
  elements.customMatchedCount.textContent = tracks.length;

  if (tracks.length === 0) {
    elements.customMatchedList.innerHTML = '<div style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 14px;">No songs match current filters.</div>';
    return;
  }

  elements.customMatchedList.innerHTML = tracks.slice(0, 100).map((t, idx) => `
    <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.035); font-size: 0.8rem;">
      <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%;">
        <strong>${idx + 1}. ${escapeHtml(t.title)}</strong> <span style="color: var(--text-muted); font-size: 0.74rem;">&bull; ${escapeHtml(t.artist)}</span>
      </div>
      <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
        <span class="vibe-tag" style="font-size: 0.62rem;">${escapeHtml(t.sub_genre || t.main_genre || 'Music')}</span>
        <button class="action-btn-sm btn-custom-remove" data-id="${t.id}" title="Exclude from playlist" style="font-size: 1rem; width: 20px; height: 20px;">&times;</button>
      </div>
    </div>
  `).join('');

  if (tracks.length > 100) {
    elements.customMatchedList.innerHTML += `<div style="text-align: center; font-size: 0.74rem; color: var(--text-muted); padding: 6px;">...and ${tracks.length - 100} more songs</div>`;
  }

  elements.customMatchedList.querySelectorAll('.btn-custom-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tid = btn.getAttribute('data-id');
      currentCustomMatchedTracks = currentCustomMatchedTracks.filter(t => t.id !== tid);
      renderCustomMatchedPreview(currentCustomMatchedTracks);
    });
  });
}

async function handleCreateCustomPlaylist() {
  if (!state.systemStatus?.ytmusic_connected) {
    openModal('settingsModal');
    showToast('Please connect your YouTube Music account in Settings first.', 'info');
    return;
  }

  const title = elements.inputCustomPlaylistTitle.value.trim();
  if (!title) {
    showToast('Please enter a title for your playlist.', 'error');
    elements.inputCustomPlaylistTitle.focus();
    return;
  }

  if (currentCustomMatchedTracks.length === 0) {
    showToast('No matching songs to add. Please adjust your filters.', 'error');
    return;
  }

  elements.customPlaylistSpinner.classList.remove('hidden');
  elements.btnCreateCustomPlaylist.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/ytmusic/custom-playlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title,
        description: `Custom curated with SoundSort AI (${currentCustomMatchedTracks.length} tracks)`,
        track_ids: currentCustomMatchedTracks.map(t => t.id)
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to create playlist');

    playUiSound('success');
    showToast(`🎉 Playlist "${title}" created with ${data.added_count} songs!`, 'success');
    closeModal('customPlaylistModal');
    
    if (data.playlist_url) {
      window.open(data.playlist_url, '_blank');
    }
    await refreshAll();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    elements.customPlaylistSpinner.classList.add('hidden');
    elements.btnCreateCustomPlaylist.disabled = false;
  }
}

// ==========================================================================
// Settings & YouTube Music Setup Handlers
// ==========================================================================
async function handleSaveSettings() {
  const geminiKey = elements.inputGeminiKey.value.trim();
  const model = elements.selectGeminiModel.value;
  const prefix = elements.inputPlaylistPrefix.value;

  try {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gemini_api_key: geminiKey || undefined,
        gemini_model: model,
        playlist_prefix: prefix
      })
    });
    if (!res.ok) throw new Error('Failed to save settings');
    playUiSound('success');
    showToast('Settings saved successfully!', 'success');
    closeModal('settingsModal');
    await loadSettings();
    await loadStatus();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleConnectYT() {
  const raw = elements.inputYtHeaders.value.trim();
  if (!raw) {
    showToast('Please paste the YouTube Music browser request headers.', 'info');
    return;
  }

  elements.btnConnectYT.disabled = true;
  elements.btnConnectYT.textContent = 'Connecting...';

  try {
    const res = await fetch(`${API_BASE}/ytmusic/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headers_raw: raw })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Connection failed');

    playUiSound('success');
    showToast('YouTube Music connected successfully!', 'success');
    elements.inputYtHeaders.value = '';
    await loadSettings();
    await loadStatus();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    elements.btnConnectYT.disabled = false;
    elements.btnConnectYT.textContent = 'Connect YouTube Music';
  }
}

// ==========================================================================
// Modal & Utility Helpers
// ==========================================================================
function openModal(modalId) {
  document.getElementById(modalId)?.classList.remove('hidden');
}

function closeModal(modalId) {
  document.getElementById(modalId)?.classList.add('hidden');
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// Event Listeners Setup
// ==========================================================================
function setupEventListeners() {
  // Sound Toggle
  if (elements.btnToggleSound) {
    elements.btnToggleSound.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      localStorage.setItem('soundsort_sound', String(state.soundEnabled));
      updateSoundButtonUi();
      if (state.soundEnabled) playUiSound('click');
      showToast(state.soundEnabled ? 'UI Sound Effects: ON' : 'UI Sound Effects: MUTED', 'info');
    });
  }

  // Keyboard Shortcuts Modal
  if (elements.btnOpenShortcuts) {
    elements.btnOpenShortcuts.addEventListener('click', () => openModal('shortcutsModal'));
  }

  // Insights Toggle
  if (elements.btnToggleInsights) {
    elements.btnToggleInsights.addEventListener('click', () => {
      state.insightsOpen = !state.insightsOpen;
      elements.insightsPanel.classList.toggle('hidden', !state.insightsOpen);
      if (state.insightsOpen) updateLibraryInsights();
      playUiSound('click');
    });
  }
  if (elements.btnCloseInsights) {
    elements.btnCloseInsights.addEventListener('click', () => {
      state.insightsOpen = false;
      elements.insightsPanel.classList.add('hidden');
      playUiSound('click');
    });
  }

  // Importer
  elements.btnImport.addEventListener('click', handleImport);
  elements.btnImportYtLikes.addEventListener('click', handleImportYtLikes);
  elements.btnUploadCsv.addEventListener('click', () => elements.fileUploadInput.click());
  elements.fileUploadInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFileUpload(file);
  });

  // Drag and Drop on textarea / dropzone
  const dropzone = elements.dropzoneWrapper;
  const dropOverlay = elements.dropOverlay;

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropOverlay.classList.remove('hidden');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropOverlay.classList.add('hidden');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropOverlay.classList.add('hidden');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  });

  elements.importInput.addEventListener('input', updateImportInputCounter);

  // Demo tracks loader
  elements.btnLoadSample.addEventListener('click', () => {
    elements.importInput.value = DEMO_TRACKS_INPUT;
    updateImportInputCounter();
    playUiSound('click');
    showToast('Demo tracks loaded into input! Click "Extract & Import" to proceed.', 'info');
  });

  elements.btnClearTracks.addEventListener('click', handleClearAll);

  // Interactive source badges
  if (elements.sourceBadgesContainer) {
    elements.sourceBadgesContainer.querySelectorAll('.badge-interactive').forEach(badge => {
      badge.addEventListener('click', () => {
        const src = badge.getAttribute('data-source');
        if (src === 'csv') {
          elements.fileUploadInput.click();
        } else if (src === 'yt') {
          handleImportYtLikes();
        } else if (src === 'spotify') {
          elements.importInput.value = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M\n';
          updateImportInputCounter();
          showToast('Sample Spotify playlist link inserted!', 'info');
        } else if (src === 'soundcloud') {
          elements.importInput.value = 'https://soundcloud.com/skrillex/sets/quest-for-fire\n';
          updateImportInputCounter();
          showToast('Sample SoundCloud set link inserted!', 'info');
        } else {
          elements.importInput.value = 'Skrillex & Fred again.. - Rumble\nOvermono - Good Lies\nPeggy Gou - (It Goes Like) Nanana\n';
          updateImportInputCounter();
          showToast('Sample track text inserted!', 'info');
        }
        playUiSound('click');
      });
    });
  }

  // AI Classification
  elements.btnClassify.addEventListener('click', handleClassify);

  // Model Tag click -> open settings
  elements.activeModelTag.addEventListener('click', () => openModal('settingsModal'));

  // Search & Filter
  elements.filterSearch.addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    if (elements.btnSearchClear) {
      elements.btnSearchClear.classList.toggle('hidden', !e.target.value);
    }
    applyFiltersAndRender();
  });

  if (elements.btnSearchClear) {
    elements.btnSearchClear.addEventListener('click', () => {
      elements.filterSearch.value = '';
      state.filters.search = '';
      elements.btnSearchClear.classList.add('hidden');
      applyFiltersAndRender();
      elements.filterSearch.focus();
    });
  }

  elements.filterMainGenre.addEventListener('change', (e) => {
    state.filters.mainGenre = e.target.value;
    state.filters.subGenre = '';
    updateGenreFilterDropdowns();
    applyFiltersAndRender();
    playUiSound('click');
  });

  elements.filterSubGenre.addEventListener('change', (e) => {
    state.filters.subGenre = e.target.value;
    applyFiltersAndRender();
    playUiSound('click');
  });

  if (elements.filterStatus) {
    elements.filterStatus.addEventListener('change', (e) => {
      state.filters.status = e.target.value;
      applyFiltersAndRender();
      playUiSound('click');
    });
  }

  if (elements.filterSort) {
    elements.filterSort.addEventListener('change', (e) => {
      state.filters.sort = e.target.value;
      applyFiltersAndRender();
      playUiSound('click');
    });
  }

  // View Mode Toggles
  elements.btnViewGrid.addEventListener('click', () => {
    state.viewMode = 'grid';
    elements.btnViewGrid.classList.add('active');
    elements.btnViewTable.classList.remove('active');
    if (elements.btnViewCompact) elements.btnViewCompact.classList.remove('active');
    renderStudioContent();
    playUiSound('click');
  });

  elements.btnViewTable.addEventListener('click', () => {
    state.viewMode = 'table';
    elements.btnViewTable.classList.add('active');
    elements.btnViewGrid.classList.remove('active');
    if (elements.btnViewCompact) elements.btnViewCompact.classList.remove('active');
    renderStudioContent();
    playUiSound('click');
  });

  if (elements.btnViewCompact) {
    elements.btnViewCompact.addEventListener('click', () => {
      state.viewMode = 'compact';
      elements.btnViewCompact.classList.add('active');
      elements.btnViewGrid.classList.remove('active');
      elements.btnViewTable.classList.remove('active');
      renderStudioContent();
      playUiSound('click');
    });
  }

  // Select All Toolbar Button
  if (elements.btnSelectAllToolbar) {
    elements.btnSelectAllToolbar.addEventListener('click', () => {
      const allSelected = state.tracks.length > 0 && state.tracks.every(t => state.selectedTrackIds.has(t.id));
      if (allSelected) {
        state.selectedTrackIds.clear();
        elements.btnSelectAllToolbar.innerHTML = '<span>☑ Select All</span>';
      } else {
        state.tracks.forEach(t => state.selectedTrackIds.add(t.id));
        elements.btnSelectAllToolbar.innerHTML = '<span>☐ Deselect All</span>';
      }
      updateBatchActionBar();
      renderStudioContent();
      playUiSound('click');
    });
  }

  // Batch Action Bar
  elements.btnBatchClear.addEventListener('click', clearAllSelections);
  elements.btnBatchMove.addEventListener('click', openBatchMoveModal);
  elements.btnConfirmBatchMove.addEventListener('click', handleConfirmBatchMove);
  elements.btnBatchVibe.addEventListener('click', openBatchVibeModal);
  elements.btnConfirmBatchVibe.addEventListener('click', handleConfirmBatchVibe);
  elements.btnBatchDelete.addEventListener('click', handleBatchDelete);
  elements.btnBatchSync.addEventListener('click', handleBatchExportToCustom);

  // Vibe Presets in Batch Modal
  document.querySelectorAll('.vibe-preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      elements.inputBatchVibeTag.value = chip.getAttribute('data-vibe');
      playUiSound('click');
    });
  });

  // Modals Open / Close
  elements.btnOpenSettings.addEventListener('click', () => openModal('settingsModal'));
  elements.btnOpenMergeModal.addEventListener('click', openMergeModal);
  elements.btnOpenSyncModal.addEventListener('click', openSyncModal);
  elements.btnOpenCustomPlaylistModal.addEventListener('click', openCustomPlaylistModal);

  // Custom Playlist Filtering & Mood Presets
  elements.selectCustomMainGenre.addEventListener('change', () => {
    updateCustomSubgenreDropdown();
    updateCustomPlaylistPreview();
  });
  elements.selectCustomSubGenre.addEventListener('change', updateCustomPlaylistPreview);
  elements.inputCustomVibeQuery.addEventListener('input', updateCustomPlaylistPreview);
  elements.btnCreateCustomPlaylist.addEventListener('click', handleCreateCustomPlaylist);

  document.querySelectorAll('.mood-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      elements.inputCustomPlaylistTitle.value = chip.getAttribute('data-title');
      elements.inputCustomVibeQuery.value = chip.getAttribute('data-vibe');
      updateCustomPlaylistPreview();
      playUiSound('click');
    });
  });

  // Modal Close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      closeModal(modalId);
      playUiSound('click');
    });
  });

  // Edit Track Save
  if (elements.btnSaveTrackEdit) {
    elements.btnSaveTrackEdit.addEventListener('click', handleSaveTrackEdit);
  }

  // Settings Save & Connect
  elements.btnSaveSettings.addEventListener('click', handleSaveSettings);
  elements.btnConnectYT.addEventListener('click', handleConnectYT);

  // Merge Subgenres
  elements.btnConfirmMerge.addEventListener('click', handleConfirmMerge);

  // Sync Modal Checkbox helpers
  elements.btnSelectAllSync.addEventListener('click', () => {
    elements.syncSubgenresList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    updateSyncSelectionSummary();
  });
  elements.btnDeselectAllSync.addEventListener('click', () => {
    elements.syncSubgenresList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    updateSyncSelectionSummary();
  });
  elements.syncSubgenresList.addEventListener('change', updateSyncSelectionSummary);
  elements.btnStartSync.addEventListener('click', handleStartSync);

  // Global Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    // If typing in an input/textarea or editable element
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;

    if (e.key === 'Escape') {
      const openModalEl = document.querySelector('.modal-backdrop:not(.hidden)');
      if (openModalEl) {
        closeAllModals();
        return;
      }
      if (state.selectedTrackIds.size > 0) {
        clearAllSelections();
        return;
      }
      return;
    }

    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      const openModalEl = document.querySelector('.modal-backdrop:not(.hidden)');
      if (openModalEl) {
        const id = openModalEl.id;
        if (id === 'customPlaylistModal') elements.btnCreateCustomPlaylist.click();
        else if (id === 'batchMoveModal') elements.btnConfirmBatchMove.click();
        else if (id === 'batchVibeModal') elements.btnConfirmBatchVibe.click();
        else if (id === 'settingsModal') elements.btnSaveSettings.click();
        else if (id === 'mergeModal') elements.btnConfirmMerge.click();
        else if (id === 'editTrackModal' && elements.btnSaveTrackEdit) elements.btnSaveTrackEdit.click();
        return;
      }

      if (elements.importInput.value.trim()) {
        handleImport();
      } else {
        handleClassify();
      }
      return;
    }

    if (!isInput) {
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        openModal('shortcutsModal');
      } else if (e.key === '/') {
        e.preventDefault();
        elements.filterSearch.focus();
      } else if (e.key.toLowerCase() === 'g') {
        elements.btnViewGrid.click();
      } else if (e.key.toLowerCase() === 't') {
        elements.btnViewTable.click();
      } else if (e.key.toLowerCase() === 'c') {
        if (elements.btnViewCompact) elements.btnViewCompact.click();
      } else if (e.key.toLowerCase() === 'i') {
        if (elements.btnToggleInsights) elements.btnToggleInsights.click();
      } else if (e.key.toLowerCase() === 'b') {
        openCustomPlaylistModal();
      } else if (e.key.toLowerCase() === 'm') {
        openMergeModal();
      } else if (e.key.toLowerCase() === 's') {
        if (elements.btnToggleSound) elements.btnToggleSound.click();
      }
    }
  });
}

// Run on page load
document.addEventListener('DOMContentLoaded', initApp);
