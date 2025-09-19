/* js/app.js - MangaStream Frontend (Directly using GOMANGA-API endpoints)
   API root: https://gomanga-api.vercel.app/api   
*/
const API_BASE = (window.MR_BASE_OVERRIDE ? window.MR_BASE_OVERRIDE.trim() : 'https://gomanga-api.vercel.app/api'.trim()).replace(/\/+$/, '');

let currentManga = null, currentPages = [], currentPageIndex = 0;
let trendingItems = [], featuredItems = [], allMangaItems = [], filteredMangaItems = [];
let isLoadingSearch = false, isLoadingTrending = false, isLoadingUpdates = false;
let genreMap = {};
let activeGenreFilters = new Set(); // keys (normalized lowercase)
let currentDetailsMangaId = null;
let firstChapterIdForDetails = null;

// Genre storage and helpers
let allGenresKeySet = new Set();    // normalized keys
let genreDisplayByKey = new Map();  // key -> display name
let genresLoadingPromise = null;
let initDone = false;

// Cache for manga details to avoid repeated API calls
const mangaDetailsCache = new Map();

// State for search modal to manage its own filters
let isSearchFilterActive = false;
let searchActiveGenreFilters = new Set();

// Rate limiting for API calls
const API_RATE_LIMIT = 100; // milliseconds between calls
let lastApiCall = 0;

// --- Search paging state (for genre-filtered results) ---
// Added matchIds to avoid duplicates
let searchPaging = {
  sourceItems: [],     // full candidate list (either search results or allMangaItems)
  matches: [],         // collected matches (objects or details) across pages
  matchIds: new Set(), // IDs already added to matches (prevents duplicates)
  candidates: [],      // ids that require detail fetch (no inline genres)
  scanIndex: 0,        // index in sourceItems scanned so far
  page: 0,             // number of pages loaded (how many pages of matches accumulated)
  currentPage: 1,      // currently displayed page (1-based)
  pageSize: 10,        // results per page (tweakable)
  finished: false,     // whether we've scanned all candidates
  loading: false       // whether currently fetching details
};

// Batch helper: fetch details using getCachedMangaDetails() in groups
async function fetchDetailsBatchedIds(ids, { batchSize = 8, delayMs = 700 } = {}) {
  const map = new Map();
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize);
    console.log(`[app.js] fetchDetailsBatchedIds: batch ${Math.floor(offset / batchSize) + 1} (${batch.length})`);
    await Promise.all(batch.map(async id => {
      try {
        const d = await getCachedMangaDetails(id); // uses rate-limited API already
        if (d) map.set(id, d);
      } catch (err) {
        console.warn('[app.js] fetchDetailsBatchedIds failed for', id, err);
      }
    }));
    if (offset + batchSize < ids.length) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return map; // id -> details
}

function proxifyUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.startsWith('/api')) path = path.substring(4);
    return `${API_BASE}${path}${u.search}`;
  } catch (e) {
    return url;
  }
}

// Rate-limited API call function
async function rateLimitedApiGet(path, opts = {}) {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCall;
  if (timeSinceLastCall < API_RATE_LIMIT) {
    await new Promise(resolve => setTimeout(resolve, API_RATE_LIMIT - timeSinceLastCall));
  }
  lastApiCall = Date.now();
  return apiGet(path, opts);
}

const chapterImageCache = new Map();

function showStatus(msg, isError = false, persist = false) {
  console[isError ? 'error' : 'log']('[MANGASTREAM]', msg);
}

async function apiGet(path, opts = {}) {
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const url = `${API_BASE}${normalizedPath}`;
  console.log('[apiGet] Fetching:', url);
  try {
    const res = await fetch(url, Object.assign({
      cache: 'no-cache',
      mode: 'cors',
      headers: { 'Accept': 'application/json' }
    }, opts));
    if (!res.ok) {
      const txt = await res.text().catch(() => '<no-body>');
      const err = `HTTP ${res.status} ${res.statusText} - ${url} - ${txt.slice(0,200)}`;
      showStatus(err, true, true);
      throw new Error(err);
    }
    const json = await res.json().catch(async e => {
      const txt = await res.text().catch(() => '<no-body>');
      const msg = 'Invalid JSON: ' + txt.slice(0,200);
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

/* ---- Fetchers ---- */
async function getTrending() {
  try {
    const data = await rateLimitedApiGet('/manga-list/1');
    if (!data.data || !Array.isArray(data.data)) return [];
    return data.data.map(m => ({
      id: m.id, title: m.title, image: proxifyUrl(m.imgUrl),
      latestChapter: m.latestChapter, description: m.description, genres: m.genres || []
    }));
  } catch (e) {
    console.warn('getTrending failed', e);
    return [];
  }
}

async function getFeatured() {
  try {
    const data = await rateLimitedApiGet('/manga-list/2');
    if (!data.data || !Array.isArray(data.data)) return [];
    return data.data.map(m => ({
      id: m.id, title: m.title, image: proxifyUrl(m.imgUrl),
      latestChapter: m.latestChapter, description: m.description, genres: m.genres || []
    }));
  } catch (e) {
    console.warn('getFeatured failed', e);
    return [];
  }
}

// Cache manga details to avoid repeated API calls
async function getCachedMangaDetails(mangaId) {
  if (mangaDetailsCache.has(mangaId)) {
    return mangaDetailsCache.get(mangaId);
  }
  
  try {
    const data = await rateLimitedApiGet(`/manga/${encodeURIComponent(mangaId)}`);
    const mangaDetails = {
      id: data.id,
      title: data.title,
      image: proxifyUrl(data.imageUrl),
      author: data.author,
      status: data.status,
      lastUpdated: data.lastUpdated,
      views: data.views,
      genres: data.genres || [],
      rating: data.rating,
      description: data.description,
      summary: data.summary,
      chapters: data.chapters && Array.isArray(data.chapters) ? data.chapters.map(ch => ({
        chapterId: ch.chapterId, views: ch.views, uploaded: ch.uploaded, timestamp: ch.timestamp
      })) : []
    };
    
    mangaDetailsCache.set(mangaId, mangaDetails);
    return mangaDetails;
  } catch (e) {
    console.warn('getCachedMangaDetails failed for', mangaId, e);
    return null;
  }
}

async function searchTitles(q) {
  if (!q) return [];
  try {
    const searchQuery = encodeURIComponent(q.replace(/\s+/g, '_'));
    const data = await rateLimitedApiGet(`/search/${searchQuery}`);
    // API shape may vary
    const arr = data.manga || data.data || [];
    if (!Array.isArray(arr)) return [];
    // Convert to unified format
    const searchResults = arr.map(m => ({
      id: m.id,
      title: m.title,
      image: proxifyUrl(m.imgUrl || m.image),
      latestChapter: (m.latestChapters && m.latestChapters[0]) ? m.latestChapters[0].chapter : null,
      authors: m.authors,
      views: m.views,
      genres: m.genres || []
    }));
    return searchResults;
  } catch (e) {
    console.warn('searchTitles failed', e);
    return [];
  }
}

/* ---- Genres: load from API (singleton) + fallback ---- */
function normalizeGenreName(name) {
  if (!name) return '';
  return String(name).replace(/^genre\s*[:\-\s]*/i, '').trim();
}
function genreKeyFromName(name) {
  return normalizeGenreName(name).toLowerCase();
}

function loadGenres() {
  if (genresLoadingPromise) return genresLoadingPromise;
  genresLoadingPromise = (async () => {
    try {
      const data = await rateLimitedApiGet('/genre');
      console.log('[app.js] Genre data loaded:', data);
      if (data && Array.isArray(data.genre)) {
        data.genre.forEach(g => {
          if (!g) return;
          const display = normalizeGenreName(g);
          const key = genreKeyFromName(display);
          if (key) {
            allGenresKeySet.add(key);
            if (!genreDisplayByKey.has(key)) genreDisplayByKey.set(key, display);
          }
        });
      } else if (Array.isArray(data)) {
        data.forEach(item => {
          let candidate = null;
          if (typeof item === 'string') candidate = item;
          else if (item && (item.name || item.genre)) candidate = item.name || item.genre;
          if (!candidate) return;
          const display = normalizeGenreName(candidate);
          const key = genreKeyFromName(display);
          if (key) {
            allGenresKeySet.add(key);
            if (!genreDisplayByKey.has(key)) genreDisplayByKey.set(key, display);
          }
        });
      } else {
        console.warn('[app.js] Unexpected genre data format:', data);
      }
    } catch (e) {
      console.warn('[app.js] Failed to load genres from API endpoint', e);
    } finally {
      return allGenresKeySet;
    }
  })();
  return genresLoadingPromise;
}

function populateGenresFromMangaItems() {
  allMangaItems.forEach(item => {
    if (item.genres && Array.isArray(item.genres)) {
      item.genres.forEach(g => {
        if (!g) return;
        const display = normalizeGenreName(g);
        const key = genreKeyFromName(display);
        if (key) {
          allGenresKeySet.add(key);
          if (!genreDisplayByKey.has(key)) genreDisplayByKey.set(key, display);
        }
      });
    }
  });
}

/* ---- Info & chapter loaders ---- */
async function getInfo(mangaId) {
  if (!mangaId) return null;
  try {
    const data = await getCachedMangaDetails(mangaId);
    if (!data || !data.id) throw new Error('Manga not found');
    return data;
  } catch (e) {
    console.warn('getInfo failed', e);
    return null;
  }
}

async function getChapterPages(mangaId, chapterId) {
  if (!mangaId || !chapterId) return [];
  const cacheKey = `${mangaId}:${chapterId}`;
  if (chapterImageCache.has(cacheKey)) return chapterImageCache.get(cacheKey);
  try {
    const data = await rateLimitedApiGet(`/manga/${encodeURIComponent(mangaId)}/${encodeURIComponent(chapterId)}`);
    if (!data.imageUrls || !Array.isArray(data.imageUrls)) return [];
    const proxiedUrls = data.imageUrls.map(proxifyUrl);
    chapterImageCache.set(cacheKey, proxiedUrls);
    return proxiedUrls;
  } catch (e) {
    console.warn('getChapterPages error', e);
    return [];
  }
}

/* ---- UI renderers ---- */
function renderTrending(items) {
  const list = document.getElementById('manga-list');
  if (!list) { console.warn('Missing container #manga-list'); return; }
  list.innerHTML = '';
  (items || []).forEach(m => {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || '';
    img.alt = m.title || '';
    img.title = m.title || '';
    img.style.cursor = 'pointer';
    img.onclick = () => openDetailsModal(m.id, m);
    list.appendChild(img);
  });
}

function renderUpdates(items) {
  const grid = document.getElementById('updates-list');
  if (!grid) { console.warn('Missing container #updates-list'); return; }
  grid.innerHTML = '';
  (items || []).forEach(m => {
    const card = document.createElement('div'); card.className = 'card';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || '';
    img.alt = m.title || '';
    img.onclick = () => openDetailsModal(m.id, m);
    const meta = document.createElement('div'); meta.className = 'meta';
    const title = document.createElement('div'); title.className = 'title'; title.textContent = m.title || '';
    const chap = document.createElement('div'); chap.className = 'muted'; chap.style.fontSize = '13px'; chap.textContent = m.latestChapter || '';
    meta.appendChild(title);
    meta.appendChild(chap);
    card.appendChild(img); card.appendChild(meta); grid.appendChild(card);
  });
}

/* ---- Reader (long-strip) ---- */
async function loadChapterPages(mangaId, chapterId) {
  const arr = await getChapterPages(mangaId, chapterId);
  currentPages = (Array.isArray(arr) ? arr : []);
  updateReaderImage();
}

function updateReaderImage() {
  const stage = document.querySelector('#reader-modal .reader-stage');
  if (!stage) {
    const img = document.getElementById('reader-image');
    if (img) img.src = currentPages[currentPageIndex] || '';
    return;
  }
  stage.innerHTML = '';
  if (currentPages.length === 0) {
    stage.innerHTML = '<p style="color:red;">No pages available for this chapter.</p>';
    return;
  }
  const strip = document.createElement('div');
  strip.style.display = 'flex'; strip.style.flexDirection = 'column'; strip.style.gap = '10px'; strip.style.alignItems = 'center';
  currentPages.forEach((u, i) => {
    const img = document.createElement('img');
    img.src = u; img.alt = `Page ${i+1}`; img.style.width = '100%'; img.style.maxWidth = '800px'; img.style.height = 'auto'; img.loading = 'lazy';
    img.style.borderRadius = '6px';
    strip.appendChild(img);
  });
  stage.appendChild(strip);
}

/* ---- Details modal ---- */
async function openDetailsModal(mangaId, fallbackData) {
  const mangaData = await getInfo(mangaId) || fallbackData || null;
  if (!mangaData) { showStatus('Could not load manga details', true); return; }
  currentDetailsMangaId = mangaData.id;
  // find first chapter
  firstChapterIdForDetails = null;
  if (mangaData.chapters && Array.isArray(mangaData.chapters) && mangaData.chapters.length > 0) {
    const sorted = [...mangaData.chapters].sort((a,b) => {
      const na = parseFloat(a.chapterId), nb = parseFloat(b.chapterId);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a.chapterId).localeCompare(String(b.chapterId), undefined, { numeric: true });
    });
    firstChapterIdForDetails = sorted[0]?.chapterId || null;
  }

  const modalContent = document.querySelector('#details-modal .modal-content');
  if (!modalContent) { showStatus('Error displaying manga details', true); return; }

  modalContent.innerHTML = `
    <button class="close" onclick="closeDetailsModal()" aria-label="Close">×</button>
    <div class="reader-head" style="padding:16px;border-bottom:1px solid rgba(255,255,255,.05)">
      <div class="reader-meta">
        <img id="details-cover" src="${mangaData.image || fallbackData?.image || ''}" alt="Cover" style="width:80px;height:110px;border-radius:8px;object-fit:cover" />
        <div>
          <h3 style="margin:0 0 8px">${mangaData.title || 'Unknown'}</h3>
          <p class="muted" style="margin:4px 0;font-size:.9rem">Author: ${mangaData.author || 'Unknown'}</p>
          <p class="muted" style="margin:4px 0;font-size:.9rem">Status: ${mangaData.status || 'Unknown'}</p>
          <div id="details-genres" style="margin:8px 0;display:flex;flex-wrap:wrap;gap:6px"></div>
        </div>
      </div>
    </div>
    <div style="padding:16px">
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:15px;font-size:.9rem">
        <span class="muted">Last Updated: ${mangaData.lastUpdated || 'N/A'}</span>
        <span class="muted">Views: ${mangaData.views || 'N/A'}</span>
        <span class="muted">Rating: ${mangaData.rating || 'N/A'}</span>
      </div>
      <p style="margin:16px 0;line-height:1.6">${mangaData.description || mangaData.summary || 'No description available.'}</p>
      <h4 style="margin:20px 0 10px;">Chapters</h4>
      <div id="details-chapter-list" style="max-height:300px;overflow-y:auto;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:10px"></div>
      <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px">
        <button class="btn" onclick="openDedicatedReaderFromDetails()">📖 Read Manga</button>
      </div>
    </div>
  `;

  const genresContainer = modalContent.querySelector('#details-genres');
  if (genresContainer) {
    genresContainer.innerHTML = '';
    if (mangaData.genres && Array.isArray(mangaData.genres) && mangaData.genres.length > 0) {
      const used = new Set();
      mangaData.genres.forEach(raw => {
        if (!raw) return;
        const display = normalizeGenreName(raw);
        const key = genreKeyFromName(display);
        if (!display || used.has(key)) return;
        used.add(key);
        const s = document.createElement('span');
        s.className = 'genre-pill';
        s.textContent = display;
        genresContainer.appendChild(s);
      });
    } else {
      genresContainer.innerHTML = '<span class="muted" style="font-size:.8rem">No genres listed.</span>';
    }
  }

  const cl = modalContent.querySelector('#details-chapter-list');
  if (cl) {
    cl.innerHTML = '';
    if (mangaData.chapters && Array.isArray(mangaData.chapters) && mangaData.chapters.length > 0) {
      const sorted = [...mangaData.chapters].sort((a,b) => {
        const na = parseFloat(a.chapterId), nb = parseFloat(b.chapterId);
        if (!isNaN(na) && !isNaN(nb)) return nb - na;
        return String(b.chapterId).localeCompare(String(a.chapterId), undefined, { numeric: true });
      });
      sorted.forEach(ch => {
        const div = document.createElement('div');
        div.style.padding = '8px 0';
        div.style.borderBottom = '1px solid rgba(255,255,255,.05)';
        div.style.cursor = 'pointer';
        div.innerHTML = `<span style="font-weight:600">Chapter ${ch.chapterId}</span>
                         <span class="muted" style="float:right;font-size:.85rem">${ch.uploaded || ch.timestamp || 'N/A'}</span>
                         <br/><span class="muted" style="font-size:.8rem">Views: ${ch.views || 'N/A'}</span>`;
        div.onclick = () => {
          loadChapterPages(mangaData.id, ch.chapterId);
          const readerModal = document.getElementById('reader-modal');
          if (readerModal) { readerModal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
        };
        cl.appendChild(div);
      });
      if (cl.lastChild) cl.lastChild.style.borderBottom = 'none';
    } else {
      cl.innerHTML = '<p class="muted" style="text-align:center;margin:10px 0">No chapters found.</p>';
    }
  }

  const modal = document.getElementById('details-modal');
  if (modal) { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}

function closeDetailsModal() {
  const modal = document.getElementById('details-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
  currentDetailsMangaId = null;
  firstChapterIdForDetails = null;
}

function openDedicatedReaderFromDetails() {
  if (!currentDetailsMangaId) return showStatus('No manga selected for reading', true);
  if (!firstChapterIdForDetails) return showStatus('No chapters found for this manga', true);
  const basePath = window.location.pathname.includes('/docs/') ? window.location.origin + '/mnm-solutions/docs/' : window.location.origin + '/mnm-solutions/';
  const url = new URL('read.html', basePath);
  url.searchParams.set('mangaId', currentDetailsMangaId);
  url.searchParams.set('chapterId', firstChapterIdForDetails);
  url.searchParams.set('page', 0);
  window.location.href = url.toString();
}

/* ---- Search + filtering within search modal ---- */
function debounce(fn, wait) {
  let t;
  return function(...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
}

// Helper to update search progress text
function updateSearchProgress() {
  const el = document.getElementById('search-progress');
  if (!el) return;
  const shown = (searchPaging.matches.length === 0) ? 0 : Math.min(searchPaging.matches.length, searchPaging.currentPage * searchPaging.pageSize);
  const totalKnown = searchPaging.finished ? String(searchPaging.matches.length) : '?';
  el.textContent = `Showing ${shown} of ${totalKnown} matches${searchPaging.loading ? ' — fetching more…' : ''}`;
  const spinner = document.getElementById('search-load-more-spinner');
  const loadBtn = document.getElementById('search-load-more');
  if (spinner) spinner.style.display = (searchPaging.loading ? 'inline-block' : 'none');
  if (loadBtn) loadBtn.disabled = !!searchPaging.loading;
}

/* ---- New: Pagination helpers for filtered search ---- */

// Render page numbers UI (three-number window + arrows) into #search-pagination
function renderSearchPagination() {
  // Remove/hide legacy Load More button
  const loadBtn = document.getElementById('search-load-more');
  if (loadBtn) loadBtn.style.display = 'none';

  let pager = document.getElementById('search-pagination');
  const container = document.getElementById('search-results');
  if (!container) return;

  if (!pager) {
    pager = document.createElement('div');
    pager.id = 'search-pagination';
    pager.style.marginTop = '12px';
    pager.style.display = 'flex';
    pager.style.gap = '8px';
    pager.style.alignItems = 'center';
    pager.style.justifyContent = 'center';
    container.insertAdjacentElement('afterend', pager);
  }

  const cp = Math.max(1, (searchPaging.currentPage || 1));
  const knownPages = Math.max(1, Math.ceil(searchPaging.matches.length / searchPaging.pageSize));
  const finished = !!searchPaging.finished;

  // Determine three-number window
  let start = cp - 1;
  if (start < 1) start = 1;
  let end = start + 2;
  if (finished && end > knownPages) {
    end = knownPages;
    start = Math.max(1, end - 2);
  }

  // If we don't have enough known pages and not finished, show next three relative to cp
  // (this allows user to navigate forward while more results are being discovered)
  // Build pager buttons
  pager.innerHTML = '';

  const createButton = (text, disabled, handler, classes = '') => {
    const btn = document.createElement('button');
    btn.className = classes || '';
    btn.style.padding = '6px 10px';
    btn.style.borderRadius = '8px';
    btn.textContent = text;
    if (disabled) {
      btn.disabled = true;
      btn.style.opacity = '0.6';
    } else if (handler) {
      btn.addEventListener('click', handler);
    }
    return btn;
  };

  // left arrow
  const left = createButton('←', cp === 1, async () => { await gotoSearchPage(cp - 1); });
  pager.appendChild(left);

  // three numbers (if finished and less than 3 pages, only show actual pages)
  for (let n = start; n <= end; n++) {
    const isActive = n === cp;
    const btn = createButton(String(n), false, async () => { await gotoSearchPage(n); }, isActive ? 'active-page' : '');
    if (isActive) {
      btn.style.fontWeight = '700';
      btn.style.background = '#111';
      btn.style.color = '#fff';
    } else {
      btn.style.fontWeight = '600';
    }
    pager.appendChild(btn);
  }

  // right arrow
  const rightDisabled = (finished && cp >= knownPages);
  const right = createButton('→', rightDisabled, async () => { await gotoSearchPage(cp + 1); });
  pager.appendChild(right);
}

// Scan source and fetch deferred details until we've collected at least desiredCount matches (or exhausted)
async function fillMatchesToCount(desiredCount) {
  if (!Array.isArray(searchPaging.sourceItems)) return;
  const src = searchPaging.sourceItems;

  // First pass: use inline genres
  while (searchPaging.scanIndex < src.length && searchPaging.matches.length < desiredCount) {
    const it = src[searchPaging.scanIndex++];
    const inlineGenres = Array.isArray(it.genres) && it.genres.length ? it.genres : null;
    if (inlineGenres) {
      const keys = inlineGenres.map(genreKeyFromName).filter(Boolean);
      if (keys.some(k => searchActiveGenreFilters.has(k))) {
        if (!searchPaging.matchIds.has(it.id)) {
          searchPaging.matchIds.add(it.id);
          searchPaging.matches.push(it);
        }
      }
    } else {
      // mark for later detail fetching (if not already queued)
      if (!searchPaging.candidates.includes(it.id)) searchPaging.candidates.push(it.id);
    }
  }

  // If still short, fetch candidate details in batches
  while (searchPaging.matches.length < desiredCount && (searchPaging.candidates.length > 0)) {
    const batchSize = Math.min(10, searchPaging.candidates.length);
    const batchIds = searchPaging.candidates.splice(0, batchSize);
    searchPaging.loading = true;
    updateSearchProgress();

    const detailsMap = await fetchDetailsBatchedIds(batchIds, { batchSize: 6, delayMs: 600 });

    for (const id of batchIds) {
      const d = detailsMap.get(id);
      if (!d) continue;
      const keys = Array.isArray(d.genres) ? d.genres.map(genreKeyFromName).filter(Boolean) : [];
      if (keys.some(k => searchActiveGenreFilters.has(k))) {
        if (!searchPaging.matchIds.has(d.id)) {
          searchPaging.matchIds.add(d.id);
          searchPaging.matches.push(d);
          if (searchPaging.matches.length >= desiredCount) break;
        }
      }
    }

    searchPaging.loading = false;
    updateSearchProgress();
  }

  // If we've scanned all source items and no candidates left, mark finished
  if (searchPaging.scanIndex >= src.length && searchPaging.candidates.length === 0) {
    searchPaging.finished = true;
  }
  updateSearchProgress();
}

// Ensure we have matches up to pageNumber * pageSize
async function ensureMatchesForPage(pageNumber) {
  const desiredTotal = pageNumber * searchPaging.pageSize;
  if (searchPaging.matches.length >= desiredTotal) return;
  await fillMatchesToCount(desiredTotal);
  // recalc page count
  searchPaging.page = Math.floor((searchPaging.matches.length + searchPaging.pageSize - 1) / searchPaging.pageSize);
}

// Display the requested page (1-based); will fetch more if necessary
async function gotoSearchPage(pageNumber) {
  if (!pageNumber || pageNumber < 1) pageNumber = 1;
  // if page is already available, just render
  await ensureMatchesForPage(pageNumber);
  // clamp pageNumber if finished and beyond known pages
  const knownPages = Math.max(1, Math.ceil(searchPaging.matches.length / searchPaging.pageSize));
  if (searchPaging.finished && pageNumber > knownPages) pageNumber = knownPages;
  searchPaging.currentPage = pageNumber;
  renderMatchesForPage(pageNumber);
}

// Render the given page (non-overlapping slice)
function renderMatchesForPage(pageNumber) {
  const box = document.getElementById('search-results');
  if (!box) return;
  const start = (pageNumber - 1) * searchPaging.pageSize;
  const end = start + searchPaging.pageSize;
  const slice = searchPaging.matches.slice(start, end);
  box.innerHTML = '';
  if (!slice || slice.length === 0) {
    if (searchPaging.finished) box.innerHTML = '<p class="muted">No results found.</p>';
    else box.innerHTML = '<p class="muted">Loading results…</p>';
    renderSearchPagination();
    return;
  }
  slice.forEach(m => {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || m.imageUrl || '';
    img.alt = m.title || '';
    img.title = m.title || '';
    img.style.cursor = 'pointer';
    img.onclick = () => { closeSearchModal(); openDetailsModal(m.id, m); };
    box.appendChild(img);
  });
  renderSearchPagination();
  updateSearchProgress();
}

/* ---- populateSearchResultsFromFilters (UPDATED) ---- */
async function populateSearchResultsFromFilters() {
  const box = document.getElementById('search-results');
  if (!box) return;
  const q = document.getElementById('search-input')?.value?.trim();
  try {
    box.innerHTML = '<p class="muted">Loading results…</p>';
    // remove existing pager (we will recreate when needed)
    const prevPager = document.getElementById('search-pagination');
    if (prevPager) prevPager.remove();

    let items = [];
    if (q) {
      items = await searchTitles(q);
    } else {
      items = [...allMangaItems];
    }

    // update active filters display
    const activeFiltersEl = document.getElementById('search-active-filters');
    if (activeFiltersEl) {
      if (searchActiveGenreFilters.size > 0) {
        const names = Array.from(searchActiveGenreFilters).map(k => genreDisplayByKey.get(k) || k);
        activeFiltersEl.textContent = `Filters: ${names.join(', ')}`;
      } else {
        activeFiltersEl.textContent = '';
      }
    }

    // If no active genre filters -> simple render (no pagination)
    if (!isSearchFilterActive || searchActiveGenreFilters.size === 0) {
      // hide pager and load more
      const lm = document.getElementById('search-pagination'); if (lm) lm.style.display = 'none';
      const loadBtn = document.getElementById('search-load-more'); if (loadBtn) loadBtn.style.display = 'none';

      if (!items || items.length === 0) {
        box.innerHTML = '<p class="muted">No results found.</p>';
        const progress = document.getElementById('search-progress'); if (progress) progress.textContent = '';
        return;
      }
      box.innerHTML = '';
      items.forEach(m => {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = m.image || m.imageUrl || '';
        img.alt = m.title || '';
        img.title = m.title || '';
        img.style.cursor = 'pointer';
        img.onclick = () => { closeSearchModal(); openDetailsModal(m.id, m); };
        box.appendChild(img);
      });
      const progress = document.getElementById('search-progress'); if (progress) progress.textContent = '';
      return;
    }

    // --- PAGED FILTERED FLOW ---
    const maybeReset = (searchPaging.sourceItems.length !== items.length) ||
                       (searchPaging.sourceItems[0] && items[0] && searchPaging.sourceItems[0].id !== items[0].id) ||
                       (q !== (window._lastSearchQuery || ''));

    if (maybeReset) {
      searchPaging.sourceItems = items;
      searchPaging.matches = [];
      searchPaging.matchIds = new Set();
      searchPaging.candidates = [];
      searchPaging.scanIndex = 0;
      searchPaging.page = 0;
      searchPaging.currentPage = 1;
      searchPaging.finished = false;
      searchPaging.loading = false;
      window._lastSearchQuery = q || '';
      updateSearchProgress();
    }

    // Ensure first page is populated and render it
    await gotoSearchPage(1);

    // provide legacy loader to fetch the next page if needed
    window._loadNextSearchPage = async function() {
      await gotoSearchPage((searchPaging.currentPage || 1) + 1);
    };

  } catch (e) {
    console.warn('populateSearchResultsFromFilters failed', e);
    if (box) box.innerHTML = '<p class="muted">Error loading results.</p>';
  } finally {
    updateSearchProgress();
  }
}

// Debounced search input handler (typing)
const performSearch = debounce(() => {
  searchPaging.page = 0;
  searchPaging.currentPage = 1;
  populateSearchResultsFromFilters();
}, 420);

// Main function used by search input's oninput (keeps compatibility)
async function searchManga() {
  searchPaging.page = 0; // Reset to first page on new search
  await populateSearchResultsFromFilters();
}

/* ---- Modal open/close for search ---- */
function openSearchModal() {
  const m = document.getElementById('search-modal');
  if (m) {
    m.style.display = 'flex';
    m.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const input = document.getElementById('search-input');
      if (input) input.focus();
      searchPaging.page = 0;
      populateSearchResultsFromFilters();
      updateGenreButtonStates();
    }, 80);
  }
}

function closeSearchModal() {
  const m = document.getElementById('search-modal');
  if (m) {
    m.setAttribute('aria-hidden', 'true');
    m.style.display = 'none';
    document.body.style.overflow = '';
    const box = document.getElementById('search-results');
    const pagination = document.getElementById('search-pagination');
    const progress = document.getElementById('search-progress');
    if (box) box.innerHTML = '';
    if (pagination) pagination.innerHTML = '';
    if (progress) progress.textContent = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    // Reset search filter state when closing
    isSearchFilterActive = false;
    searchActiveGenreFilters.clear();
    // Reset search pagination state
    searchPaging.sourceItems = [];
    searchPaging.matches = [];
    searchPaging.matchIds = new Set();
    searchPaging.candidates = [];
    searchPaging.scanIndex = 0;
    searchPaging.page = 0;
    searchPaging.currentPage = 1;
    searchPaging.finished = false;
    searchPaging.loading = false;
  }
}

/* ---- Observers / pagination ---- */
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
    const data = await rateLimitedApiGet(`/manga-list/${window._browsePage}`);
    if (!data.data || !Array.isArray(data.data)) throw new Error('Invalid data format');
    const more = data.data.map(m => ({ id: m.id, title: m.title, image: proxifyUrl(m.imgUrl), latestChapter: m.latestChapter, description: m.description, genres: m.genres || [] }));
    trendingItems = trendingItems.concat(more);
    allMangaItems = [...trendingItems, ...featuredItems];
    populateGenresFromMangaItems();
    renderTrending(allMangaItems);
    if (data.pagination && data.pagination.length > 0) {
      const totalPages = data.pagination[data.pagination.length - 1];
      if (window._browsePage >= totalPages) {
        const loadMoreBtn = document.getElementById('load-more');
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      }
    }
  } catch (e) {
    console.warn('loadMoreTrending failed', e);
  } finally { isLoadingTrending = false; }
}

async function loadMoreUpdates() {
  if (isLoadingUpdates) return;
  isLoadingUpdates = true;
  window._updatesPage = (window._updatesPage || 1) + 1;
  try {
    const data = await rateLimitedApiGet(`/manga-list/${window._updatesPage}`);
    if (!data.data || !Array.isArray(data.data)) throw new Error('Invalid data format');
    const more = data.data.map(m => ({ id: m.id, title: m.title, image: proxifyUrl(m.imgUrl), latestChapter: m.latestChapter, description: m.description, genres: m.genres || [] }));
    featuredItems = featuredItems.concat(more);
    allMangaItems = [...trendingItems, ...featuredItems];
    populateGenresFromMangaItems();
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
  } finally { isLoadingUpdates = false; }
}

/* ---- Filter modal + checklist UI ---- */
function toggleGenreFilters() { openFilterModal(); }

async function openFilterModal() {
  const m = document.getElementById('filter-modal');
  if (!m) return;
  await createGenreCheckboxes();
  m.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(()=> {
    const first = document.querySelector('#filter-checkboxes input[type="checkbox"]');
    if (first) first.focus();
  }, 50);
}

function closeFilterModal() {
  const m = document.getElementById('filter-modal');
  if (m) m.style.display = 'none';
  document.body.style.overflow = ''; // Restore background scroll
}

async function createGenreCheckboxes() {
  const container = document.getElementById('filter-checkboxes');
  if (!container) return;

  container.innerHTML = '';

  const allGenres = new Map();

  if (genreDisplayByKey && genreDisplayByKey.size > 0) {
    for (const [key, display] of genreDisplayByKey.entries()) {
      if (key) allGenres.set(key, display);
    }
  }

  allMangaItems.forEach(item => {
    if (!item.genres || !Array.isArray(item.genres)) return;
    item.genres.forEach(raw => {
      if (!raw) return;
      const display = normalizeGenreName(raw);
      const key = genreKeyFromName(display);
      if (!key) return;
      if (!allGenres.has(key)) allGenres.set(key, display || key);
    });
  });

  if (allGenres.size === 0) {
    try {
      await loadGenres();
      for (const [k, v] of genreDisplayByKey.entries()) allGenres.set(k, v);
    } catch (e) { /* ignore */ }
  }

  if (allGenres.size === 0) {
    container.innerHTML = '<p class="muted">No genres available.</p>';
    return;
  }

  const entries = Array.from(allGenres.entries()).map(([key, display]) => ({ key, display }));
  entries.sort((a,b) => a.display.localeCompare(b.display, undefined, { sensitivity: 'base' }));

  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'filter-checkbox-grid';

  entries.forEach(e => {
    const label = document.createElement('label');
    label.className = 'filter-checkbox';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = e.key;
    cb.id = `filter_genre_${e.key}`;

    const searchModal = document.getElementById('search-modal');
    const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';
    if (isSearchOpen) {
        if (searchActiveGenreFilters.has(e.key)) cb.checked = true;
    } else {
        if (activeGenreFilters.has(e.key)) cb.checked = true;
    }

    cb.onchange = function(evt) {
      const v = evt.target.value;
      const searchModal = document.getElementById('search-modal');
      const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';

      if (isSearchOpen) {
        if (evt.target.checked) searchActiveGenreFilters.add(v);
        else searchActiveGenreFilters.delete(v);
      } else {
        if (evt.target.checked) activeGenreFilters.add(v);
        else activeGenreFilters.delete(v);
      }
      updateGenreButtonStates();
    };

    const span = document.createElement('span');
    span.className = 'filter-label-text';
    span.textContent = e.display;

    label.appendChild(cb);
    label.appendChild(span);
    grid.appendChild(label);
  });

  container.appendChild(grid);

  const hint = document.createElement('div');
  hint.className = 'filter-hint muted';
  hint.style.marginTop = '10px';
  hint.style.fontSize = '0.9rem';
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';
  hint.textContent = isSearchOpen ? 'Select genres and click Apply to filter search results.' : 'Select genres and click Apply to filter the Trending list.';
  container.appendChild(hint);

  updateGenreButtonStates();
}

function updateGenreButtonStates() {
  const checkboxes = document.querySelectorAll('#filter-checkboxes input[type="checkbox"]');
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';

  checkboxes.forEach(cb => {
    cb.checked = isSearchOpen ? searchActiveGenreFilters.has(cb.value) : activeGenreFilters.has(cb.value);
  });

  const activeFiltersEl = document.getElementById('search-active-filters');
  if (activeFiltersEl) {
    if (isSearchOpen && searchActiveGenreFilters.size > 0) {
      const names = Array.from(searchActiveGenreFilters).map(k => genreDisplayByKey.get(k) || k);
      activeFiltersEl.textContent = `Active: ${names.join(', ')}`;
    } else if (!isSearchOpen && activeGenreFilters.size > 0) {
      const names = Array.from(activeGenreFilters).map(k => genreDisplayByKey.get(k) || k);
      activeFiltersEl.textContent = `Active: ${names.join(', ')}`;
    } else {
      activeFiltersEl.textContent = '';
    }
  }
}

// Apply genre filters to the main Trending manga list
function applyGenreFilters() {
  if (activeGenreFilters.size === 0) {
    renderTrending(allMangaItems);
    return;
  }
  const filtered = allMangaItems.filter(m => {
    if (!m.genres || !Array.isArray(m.genres)) return false;
    const mangaGenreKeys = m.genres.map(genreKeyFromName).filter(Boolean);
    return mangaGenreKeys.some(k => activeGenreFilters.has(k));
  });
  renderTrending(filtered);
}

/* ---- apply/clear handlers (search-aware) ---- */
function applyFilterFromModal() {
  closeFilterModal();
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';

  if (isSearchOpen) {
    isSearchFilterActive = searchActiveGenreFilters.size > 0;
    searchPaging.page = 0;
    searchPaging.currentPage = 1;
    populateSearchResultsFromFilters();
  } else {
    applyGenreFilters();
  }
}

function clearFiltersFromModal() {
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';

  if (isSearchOpen) {
    searchActiveGenreFilters.clear();
    isSearchFilterActive = false;
    searchPaging.page = 0;
    searchPaging.currentPage = 1;
    populateSearchResultsFromFilters();
  } else {
    activeGenreFilters.clear();
    renderTrending(allMangaItems);
  }

  updateGenreButtonStates();
  const checkboxes = document.querySelectorAll('#filter-checkboxes input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = false);
}

/* ---- Reader close function ---- */
function closeReader() {
  const modal = document.getElementById('reader-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
  currentPages = [];
  currentPageIndex = 0;
}

/* ---- Init ---- */
async function init() {
  try {
    loadGenres().catch(()=>{});
    const [t,f] = await Promise.all([getTrending(), getFeatured()]);
    trendingItems = Array.isArray(t) ? t : [];
    featuredItems = Array.isArray(f) ? f : [];
    allMangaItems = [...trendingItems, ...featuredItems];
    if (allGenresKeySet.size === 0) populateGenresFromMangaItems();
    filteredMangaItems = [...allMangaItems];
    renderTrending(allMangaItems);
    renderUpdates(featuredItems);
    createObserver('sentinel-trending', loadMoreTrending);
    createObserver('sentinel-updates', loadMoreUpdates);
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.addEventListener('input', performSearch);
  } catch (e) {
    console.error('init failed', e);
    renderTrending([]);
    renderUpdates([]);
  } finally {
    initDone = true;
  }
}

document.addEventListener('DOMContentLoaded', () => setTimeout(init, 120));

/* expose to window (for inline HTML) */
window.searchManga = searchManga;
window.performSearch = performSearch;
window.searchMangaDebounced = performSearch;
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.changeChapter = function(){ const raw = document.getElementById('chapter')?.value; if(!raw) return; const c = JSON.parse(raw); loadChapterPages(c.mangaId, c.chapterId); };
window.loadMoreTrending = loadMoreTrending;
window.loadMoreUpdates = loadMoreUpdates;
window.loadMoreSearch = async function() {
  // Legacy "load more" maps to next page in the new pagination
  try {
    await gotoSearchPage((searchPaging.currentPage || 1) + 1);
  } catch (e) {
    console.warn('loadMoreSearch failed', e);
  } finally {
    updateSearchProgress();
  }
};
window.openDedicatedReader = function(){ const sel = document.getElementById('chapter'); const raw = sel?.value; if(!raw) return showStatus('No chapter selected', true); const {mangaId, chapterId} = JSON.parse(raw); const basePath = window.location.pathname.includes('/docs/') ? window.location.origin + '/mnm-solutions/docs/' : window.location.origin + '/mnm-solutions/'; const url = new URL('read.html', basePath); url.searchParams.set('mangaId', mangaId); url.searchParams.set('chapterId', chapterId); url.searchParams.set('page', 0); window.location.href = url.toString(); };
window.toggleGenreFilters = toggleGenreFilters;
window.clearGenreFilters = clearFiltersFromModal;
window.openDetailsModal = openDetailsModal;
window.closeDetailsModal = closeDetailsModal;
window.openDedicatedReaderFromDetails = openDedicatedReaderFromDetails;
window.openFilterModal = openFilterModal;
window.closeFilterModal = closeFilterModal;
window.applyFilterFromModal = applyFilterFromModal;
window.closeReader = closeReader;
