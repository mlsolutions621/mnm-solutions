/* js/app.js - MangaStream Frontend (Directly using GOMANGA-API endpoints)
   API root: https://gomanga-api.vercel.app/api
*/

const API_BASE = (window.MR_BASE_OVERRIDE ? window.MR_BASE_OVERRIDE : 'https://gomanga-api.vercel.app/api').replace(/\/+$/, '');

let currentManga = null, currentPages = [], currentPageIndex = 0;
let trendingItems = [], featuredItems = [], allMangaItems = [], filteredMangaItems = [];
let isLoadingSearch = false, isLoadingTrending = false, isLoadingUpdates = false;
let genreMap = {};
let activeGenreFilters = new Set(); // Track active genre filters

// --- For Details Modal ---
let currentDetailsMangaId = null;
let firstChapterIdForDetails = null;

// Helper: rewrite image URLs to go through worker proxy correctly
function proxifyUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.startsWith('/api')) {
      path = path.substring(4);
    }
    return `${API_BASE}${path}${u.search}`;
  } catch (e) {
    return url;
  }
}

// Cache for chapter images to avoid repeated requests
const chapterImageCache = new Map();

function showStatus(msg, isError = false, persist = false) {
  console[isError ? 'error' : 'log']('[MANGASTREAM]', msg);
  // Removed UI display for security
}

async function apiGet(path, opts = {}) {
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const url = `${API_BASE}${normalizedPath}`;
  console.log('[apiGet] Fetching:', url); // Only log to console

  try {
    const res = await fetch(url, Object.assign({
      cache: 'no-cache',
      mode: 'cors',
      headers: { 'Accept': 'application/json' }
    }, opts));
    if (!res.ok) {
      const txt = await res.text().catch(() => '<no-body>');
      const err = `HTTP ${res.status} ${res.statusText} - ${url} - ${txt.slice(0, 200)}`;
      showStatus(err, true, true);
      throw new Error(err);
    }
    const json = await res.json().catch(async e => {
      const txt = await res.text().catch(() => '<no-body>');
      const msg = 'Invalid JSON: ' + txt.slice(0, 200);
      showStatus(msg, true, true);
      throw new Error(msg);
    });
    console.log('[apiGet]', url, json);
    return json;
  } catch (err) {
    console.error('[apiGet] failed', err);
    if (err instanceof TypeError && /failed to fetch/i.test(String(err))) {
      showStatus('Network/CORS error contacting the API. The API must allow cross-origin requests for this page to work.', true, true);
    } else {
      showStatus('Request failed: ' + (err.message || err), true, true);
    }
    throw err;
  }
}

/* ---- FETCHERS (direct to GOMANGA-API) ---- */

async function getTrending() {
  try {
    const data = await apiGet('/manga-list/1');
    if (!data.data || !Array.isArray(data.data)) return [];
    return data.data.map(m => ({
      id: m.id,
      title: m.title,
      image: proxifyUrl(m.imgUrl),
      latestChapter: m.latestChapter,
      description: m.description,
      genres: m.genres || [] // Include genres if available
    }));
  } catch (e) {
    console.warn('getTrending failed', e);
    return [];
  }
}

async function getFeatured() {
  try {
    const data = await apiGet('/manga-list/2');
    if (!data.data || !Array.isArray(data.data)) return [];
    return data.data.map(m => ({
      id: m.id,
      title: m.title,
      image: proxifyUrl(m.imgUrl),
      latestChapter: m.latestChapter,
      description: m.description,
      genres: m.genres || [] // Include genres if available
    }));
  } catch (e) {
    console.warn('getFeatured failed', e);
    return [];
  }
}

async function searchTitles(q) {
  if (!q) return [];
  try {
    const searchQuery = encodeURIComponent(q.replace(/\s+/g, '_'));
    const data = await apiGet(`/search/${searchQuery}`);
    if (!data.manga || !Array.isArray(data.manga)) return [];
    return data.manga.map(m => ({
      id: m.id,
      title: m.title,
      image: proxifyUrl(m.imgUrl),
      latestChapter: m.latestChapters && m.latestChapters[0] ? m.latestChapters[0].chapter : null,
      authors: m.authors,
      views: m.views,
      genres: m.genres || [] // Include genres if available
    }));
  } catch (e) {
    console.warn('searchTitles failed', e);
    return [];
  }
}

async function loadGenres() {
  try {
    const data = await apiGet('/genre');
    if (Array.isArray(data)) {
      genreMap = Object.fromEntries(data.map(g => [g.id, g.name]));
    }
  } catch (e) {
    console.warn('Failed to load genres', e);
  }
}

async function getInfo(mangaId) {
  if (!mangaId) return null;
  try {
    const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}`);
    if (!data.id) throw new Error('Manga not found');

    // Map genre IDs to readable names
    const genreNames = (data.genres || []).map(id => genreMap[id] || `Genre ${id}`).filter(Boolean);

    return {
      id: data.id,
      title: data.title,
      image: proxifyUrl(data.imageUrl),
      author: data.author,
      status: data.status,
      lastUpdated: data.lastUpdated,
      views: data.views,
      genres: genreNames,
      rating: data.rating,
      chapters: data.chapters && Array.isArray(data.chapters) ? data.chapters.map(ch => ({
        chapterId: ch.chapterId,
        views: ch.views,
        uploaded: ch.uploaded,
        timestamp: ch.timestamp
      })) : []
    };
  } catch (e) {
    console.warn('getInfo failed', e);
    return null;
  }
}

async function getChapterPages(mangaId, chapterId) {
  if (!mangaId || !chapterId) return [];

  const cacheKey = `${mangaId}:${chapterId}`;
  if (chapterImageCache.has(cacheKey)) {
    return chapterImageCache.get(cacheKey);
  }

  try {
    const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}/${encodeURIComponent(chapterId)}`);
    if (!data.imageUrls || !Array.isArray(data.imageUrls)) return [];

    const proxiedUrls = data.imageUrls.map(proxifyUrl);
    chapterImageCache.set(cacheKey, proxiedUrls);
    return proxiedUrls;
  } catch (e) {
    console.warn('getChapterPages error', e);
    return [];
  }
}

/* ---- UI rendering ---- */

function renderTrending(items) {
  const list = document.getElementById('manga-list');
  if (!list) { console.warn('Missing container #manga-list'); return; }
  list.innerHTML = '';
  items.forEach(m => {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || '';
    img.alt = m.title || '';
    img.title = m.title || '';
    img.style.cursor = 'pointer';
    // --- MODIFIED: Open Details Modal ---
    img.onclick = () => openDetailsModal(m.id, m);
    list.appendChild(img);
  });
}

function renderUpdates(items) {
  const grid = document.getElementById('updates-list');
  if (!grid) { console.warn('Missing container #updates-list'); return; }
  grid.innerHTML = '';
  items.forEach(m => {
    const card = document.createElement('div'); card.className = 'card';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || '';
    img.alt = m.title || '';
    // --- MODIFIED: Open Details Modal ---
    img.onclick = () => openDetailsModal(m.id, m);
    const meta = document.createElement('div'); meta.className = 'meta';
    const title = document.createElement('div'); title.className = 'title'; title.textContent = m.title || '';
    const chap = document.createElement('div'); chap.className = 'muted'; chap.style.fontSize = '13px'; chap.textContent = m.latestChapter || '';
    meta.appendChild(title);
    meta.appendChild(chap);
    card.appendChild(img); card.appendChild(meta); grid.appendChild(card);
  });
}

// --- MODIFIED: Load all chapter pages and render them as a long strip in the popup ---
async function loadChapterPages(mangaId, chapterId) {
  console.log(`[app.js] Loading pages for chapter ${chapterId} of manga ${mangaId} (Popup)`);
  const arr = await getChapterPages(mangaId, chapterId);
  currentPages = (Array.isArray(arr) ? arr : []);

  console.log(`[app.js] Loaded ${currentPages.length} pages for popup.`);
  updateReaderImage(); // This will now render the strip
}

// --- MODIFIED: Update the reader image area in the popup to show a long strip ---
function updateReaderImage() {
  // Target the scrollable area inside the reader modal
  const stage = document.querySelector('#reader-modal .reader-stage');
  if (!stage) {
    console.error('[app.js] Reader stage element not found in popup');
    // Fallback to old method if stage not found (shouldn't happen with correct HTML)
    const img = document.getElementById('reader-image');
    if (img) {
      img.src = currentPages[currentPageIndex] || '';
      img.alt = `${currentManga?.title || 'Manga'} - Chapter Preview`;
    }
    return;
  }

  // Clear previous content
  stage.innerHTML = '';

  if (currentPages.length === 0) {
    stage.innerHTML = '<p style="color: red;">No pages available for this chapter.</p>';
    return;
  }

  // Create a wrapper div for all images
  const stripWrapper = document.createElement('div');
  stripWrapper.id = 'manga-strip-popup';
  stripWrapper.style.display = 'flex';
  stripWrapper.style.flexDirection = 'column';
  stripWrapper.style.alignItems = 'center';
  stripWrapper.style.gap = '10px'; // Space between images

  currentPages.forEach((url, index) => {
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Page ${index + 1}`;
    img.style.width = '100%';
    img.style.maxWidth = '800px'; // Adjust as needed for popup width
    img.style.height = 'auto';
    img.style.borderRadius = '4px';
    img.style.display = 'block';
    img.loading = 'lazy';
    stripWrapper.appendChild(img);
  });

  stage.appendChild(stripWrapper);
  console.log('[app.js] Rendered chapter pages as a long strip in the popup modal.');
}


function changeChapter() {
  const raw = document.getElementById('chapter')?.value;
  if (!raw) return;
  const c = JSON.parse(raw);
  loadChapterPages(c.mangaId, c.chapterId);
}

// Get current chapter index
function getCurrentChapterIndex() {
  const chapterSel = document.getElementById('chapter');
  return chapterSel ? chapterSel.selectedIndex : -1;
}

// Navigate to previous chapter
function prevChapter() {
  const chapterSel = document.getElementById('chapter');
  if (!chapterSel || chapterSel.selectedIndex <= 0) return;

  chapterSel.selectedIndex -= 1;
  changeChapter();
}

// Navigate to next chapter
function nextChapter() {
  const chapterSel = document.getElementById('chapter');
  if (!chapterSel || chapterSel.selectedIndex >= chapterSel.options.length - 1) return;

  chapterSel.selectedIndex += 1;
  changeChapter();
}

function openDedicatedReader() {
  const chapterSel = document.getElementById('chapter');
  const chapterRaw = chapterSel?.value;
  if (!chapterRaw) return showStatus('No chapter selected', true);

  const { mangaId, chapterId } = JSON.parse(chapterRaw);

  // Construct correct path for docs folder
  const basePath = window.location.pathname.includes('/docs/')
    ? window.location.origin + '/mnm-solutions/docs/'
    : window.location.origin + '/mnm-solutions/';

  const url = new URL('read.html', basePath);
  url.searchParams.set('mangaId', mangaId);
  url.searchParams.set('chapterId', chapterId);
  url.searchParams.set('page', 0);

  window.location.href = url.toString();
}

function closeReader() {
  const modal = document.getElementById('reader-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

// --- NEW: Details Modal Functions ---
async function openDetailsModal(mangaId, fallbackData) {
  console.log(`[app.js] Opening details modal for manga: ${mangaId}`);
  const mangaData = await getInfo(mangaId) || fallbackData || null;

  if (!mangaData) {
    showStatus('Could not load manga details', true);
    return;
  }

  currentDetailsMangaId = mangaData.id;

  // --- Determine the first chapter ID ---
  firstChapterIdForDetails = null;
  if (mangaData.chapters && Array.isArray(mangaData.chapters) && mangaData.chapters.length > 0) {
    const sortedChapters = [...mangaData.chapters].sort((a, b) => {
      const numA = parseFloat(a.chapterId);
      const numB = parseFloat(b.chapterId);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return String(a.chapterId).localeCompare(String(b.chapterId));
    });
    firstChapterIdForDetails = sortedChapters[0]?.chapterId || null;
    console.log(`[app.js] First chapter ID determined: ${firstChapterIdForDetails}`);
  } else {
    console.warn(`[app.js] No chapters found for manga ${mangaId}`);
  }

  document.getElementById('details-cover').src = mangaData.image || fallbackData?.image || '';
  document.getElementById('details-title').textContent = mangaData.title || 'Unknown Title';
  document.getElementById('details-description').textContent = mangaData.genres && mangaData.genres.length
    ? mangaData.genres.join(' • ')
    : mangaData.description || mangaData.status || 'No description available.';

  const modal = document.getElementById('details-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
}

function closeDetailsModal() {
  const modal = document.getElementById('details-modal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
  currentDetailsMangaId = null;
  firstChapterIdForDetails = null;
}

function openDedicatedReaderFromDetails() {
  if (!currentDetailsMangaId) {
    showStatus('No manga selected for reading', true);
    return;
  }
  if (!firstChapterIdForDetails) {
    showStatus('No chapters found for this manga', true);
    return;
  }

  console.log(`[app.js] Opening dedicated reader for ${currentDetailsMangaId}, chapter ${firstChapterIdForDetails}`);

  const basePath = window.location.pathname.includes('/docs/')
    ? window.location.origin + '/mnm-solutions/docs/'
    : window.location.origin + '/mnm-solutions/';

  const url = new URL('read.html', basePath);
  url.searchParams.set('mangaId', currentDetailsMangaId);
  url.searchParams.set('chapterId', firstChapterIdForDetails);
  url.searchParams.set('page', 0);

  window.location.href = url.toString();
}
// --- END NEW: Details Modal Functions ---

/* Search UI & helpers */
function debounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

async function searchManga() {
  const q = document.getElementById('search-input')?.value?.trim();
  const box = document.getElementById('search-results');
  if (!q) { if (box) box.innerHTML = ''; return; }
  try {
    isLoadingSearch = true;
    const items = await searchTitles(q);
    if (!box) return;
    box.innerHTML = '';
    (items || []).forEach(m => {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = m.image || '';
      img.alt = m.title || '';
      img.title = m.title || '';
      img.onclick = () => {
        closeSearchModal();
        // --- MODIFIED: Open Details Modal for search results ---
        openDetailsModal(m.id, m);
      };
      box.appendChild(img);
    });
    const loadMoreBtn = document.getElementById('search-load-more');
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
  } catch (e) { console.warn('searchManga failed', e); }
  finally { isLoadingSearch = false; }
}

const searchMangaDebounced = debounce(searchManga, 420);
function loadMoreSearch() { showStatus('Load more not available for search.', true); }
function openSearchModal() { const m = document.getElementById('search-modal'); if (m) { m.style.display = 'flex'; setTimeout(() => document.getElementById('search-input')?.focus(), 100); } }
function closeSearchModal() { const m = document.getElementById('search-modal'); if (m) { m.style.display = 'none'; document.getElementById('search-results').innerHTML = ''; } }

/* observers and loading more trending/updates */
function createObserver(targetId, callback) {
  const el = document.getElementById(targetId);
  if (!el) return;
  const io = new IntersectionObserver(entries => { entries.forEach(e => { if (e.isIntersecting) callback(); }); }, { rootMargin: '200px' });
  io.observe(el);
}

async function loadMoreTrending() {
  if (isLoadingTrending) return;
  isLoadingTrending = true;
  window._browsePage = (window._browsePage || 1) + 1;
  try {
    const data = await apiGet(`/manga-list/${window._browsePage}`);
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid data format');
    }
    const more = data.data.map(m => ({
      id: m.id,
      title: m.title,
      image: proxifyUrl(m.imgUrl),
      latestChapter: m.latestChapter,
      description: m.description,
      genres: m.genres || []
    }));
    trendingItems = trendingItems.concat(more);
    allMangaItems = [...trendingItems, ...featuredItems];
    applyGenreFilters(); // Re-apply filters if any
    if (data.pagination && data.pagination.length > 0) {
      const totalPages = data.pagination[data.pagination.length - 1];
      if (window._browsePage >= totalPages) {
        const loadMoreBtn = document.getElementById('load-more');
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      }
    }
  } catch (e) {
    console.warn('loadMoreTrending failed', e);
  }
  isLoadingTrending = false;
}

async function loadMoreUpdates() {
  if (isLoadingUpdates) return;
  isLoadingUpdates = true;
  window._updatesPage = (window._updatesPage || 1) + 1;
  try {
    const data = await apiGet(`/manga-list/${window._updatesPage}`);
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error('Invalid data format');
    }
    const more = data.data.map(m => ({
      id: m.id,
      title: m.title,
      image: proxifyUrl(m.imgUrl),
      latestChapter: m.latestChapter,
      description: m.description,
      genres: m.genres || []
    }));
    featuredItems = featuredItems.concat(more);
    allMangaItems = [...trendingItems, ...featuredItems];
    renderUpdates(featuredItems);
    if (data.pagination && data.pagination.length > 0) {
      const totalPages = data.pagination[data.pagination.length - 1];
      if (window._updatesPage >= totalPages) {
        const loadMoreBtn = document.getElementById('load-more-updates');
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      }
    }
  } catch (e) {
    console.warn('loadMoreUpdates failed', e);
  }
  isLoadingUpdates = false;
}

/* ---- Genre Filter Functions ---- */

// Toggle genre filter section visibility
function toggleGenreFilters() {
  const section = document.getElementById('genre-filter-section');
  if (section) {
    section.style.display = section.style.display === 'none' ? 'block' : 'none';
  }
}

// Create genre buttons
function createGenreButtons() {
  const container = document.getElementById('genre-buttons-container');
  if (!container) return;

  container.innerHTML = '';

  // Get all unique genres from manga items
  const allGenres = new Set();
  allMangaItems.forEach(item => {
    if (item.genres && Array.isArray(item.genres)) {
      item.genres.forEach(genre => allGenres.add(genre));
    }
  });

  // Sort genres alphabetically
  const sortedGenres = Array.from(allGenres).sort();

  // Create a button for each genre
  sortedGenres.forEach(genre => {
    const button = document.createElement('button');
    button.className = 'genre-btn';
    button.textContent = genre;
    button.onclick = () => toggleGenreFilter(genre);
    container.appendChild(button);
  });

  updateGenreButtonStates();
}

// Toggle a genre filter
function toggleGenreFilter(genre) {
  if (activeGenreFilters.has(genre)) {
    activeGenreFilters.delete(genre);
  } else {
    activeGenreFilters.add(genre);
  }

  updateGenreButtonStates();
  applyGenreFilters();
}

// Update visual state of genre buttons
function updateGenreButtonStates() {
  const buttons = document.querySelectorAll('.genre-btn');
  buttons.forEach(button => {
    if (activeGenreFilters.has(button.textContent)) {
      button.classList.add('active');
    } else {
      button.classList.remove('active');
    }
  });

  // Update active filters display
  const activeFiltersEl = document.getElementById('active-filters');
  if (activeFiltersEl) {
    if (activeGenreFilters.size > 0) {
      activeFiltersEl.textContent = `Active filters: ${Array.from(activeGenreFilters).join(', ')}`;
    } else {
      activeFiltersEl.textContent = '';
    }
  }
}

// Apply genre filters to manga list
function applyGenreFilters() {
  if (activeGenreFilters.size === 0) {
    renderTrending(allMangaItems);
    return;
  }

  const filtered = allMangaItems.filter(manga => {
    if (!manga.genres || !Array.isArray(manga.genres)) return false;
    return manga.genres.some(genre => activeGenreFilters.has(genre));
  });

  renderTrending(filtered);
}

// Clear all genre filters
function clearGenreFilters() {
  activeGenreFilters.clear();
  updateGenreButtonStates();
  applyGenreFilters();
}

/* init */
async function init() {
  try {
    await loadGenres();
    const [t, f] = await Promise.all([getTrending(), getFeatured()]);
    trendingItems = Array.isArray(t) ? t : [];
    featuredItems = Array.isArray(f) ? f : [];
    allMangaItems = [...trendingItems, ...featuredItems];
    filteredMangaItems = [...allMangaItems];
    renderTrending(allMangaItems);
    renderUpdates(featuredItems);
    createObserver('sentinel-trending', loadMoreTrending);
    createObserver('sentinel-updates', loadMoreUpdates);

    // Create genre buttons after loading data
    createGenreButtons();
  } catch (e) {
    console.error('init failed', e);
    renderTrending([]);
    renderUpdates([]);
  }
}

document.addEventListener('DOMContentLoaded', () => setTimeout(init, 120));

/* expose functions used by inline HTML */
window.searchManga = searchManga;
window.searchMangaDebounced = searchMangaDebounced;
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
// window.openReaderInfo = openReaderInfo; // Removed from global exposure as it's not used by title clicks
// window.closeReader = closeReader;       // Removed from global exposure as it's not used by title clicks
window.changeChapter = changeChapter;
window.prevChapter = prevChapter;
window.nextChapter = nextChapter;
window.loadMoreTrending = loadMoreTrending;
window.loadMoreUpdates = loadMoreUpdates;
window.loadMoreSearch = loadMoreSearch;
window.openDedicatedReader = openDedicatedReader;
window.toggleGenreFilters = toggleGenreFilters;
window.clearGenreFilters = clearGenreFilters;
// --- NEW EXPOSED FUNCTIONS ---
window.openDetailsModal = openDetailsModal;
window.closeDetailsModal = closeDetailsModal;
window.openDedicatedReaderFromDetails = openDedicatedReaderFromDetails;
