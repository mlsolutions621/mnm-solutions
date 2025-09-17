/* js/app.js - MangaStream Frontend (Directly using GOMANGA-API endpoints)
   API root: https://gomanga-api.vercel.app/api   
*/
const API_BASE = (window.MR_BASE_OVERRIDE ? window.MR_BASE_OVERRIDE : 'https://gomanga-api.vercel.app/api   ').replace(/\/+$/, '');

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
    const data = await apiGet('/manga-list/1');
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
    const data = await apiGet('/manga-list/2');
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
    const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}`);
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
    const data = await apiGet(`/search/${searchQuery}`);
    if (!data.manga || !Array.isArray(data.manga)) return [];
    
    // Convert search results to the same format as other manga items
    const searchResults = data.manga.map(m => ({
      id: m.id, 
      title: m.title, 
      image: proxifyUrl(m.imgUrl || m.image),
      latestChapter: m.latestChapters && m.latestChapters[0] ? m.latestChapters[0].chapter : null,
      authors: m.authors, 
      views: m.views, 
      genres: m.genres || [] // This might be empty, but we'll handle it in filtering
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
      const data = await apiGet('/genre');
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

/* ---- UI renderers ---- */
function renderTrending(items) {
  // This function now only renders the main Trending section
  // It is completely independent of any search modal filters
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

// Populate search results from either API search or allMangaItems, and apply searchActiveGenreFilters if any
async function populateSearchResultsFromFilters() {
  const box = document.getElementById('search-results');
  if (!box) return;
  const q = document.getElementById('search-input')?.value?.trim();
  try {
    box.innerHTML = '<p class="muted">Loading results…</p>';
    let items = [];
    if (q) {
      items = await searchTitles(q);
    } else {
      items = [...allMangaItems]; // Use full list if no search term
    }

    // Apply filters ONLY if search filter is active
    if (isSearchFilterActive && searchActiveGenreFilters.size > 0) {
      console.log('[app.js] Applying search modal genre filters:', Array.from(searchActiveGenreFilters));
      
      // For search results, we need to fetch full manga details to get genres
      if (q) {
        // Filter search results by fetching full details
        const filteredItems = [];
        for (const item of items) {
          try {
            const fullDetails = await getCachedMangaDetails(item.id);
            if (fullDetails && fullDetails.genres && Array.isArray(fullDetails.genres)) {
              const mangaGenreKeys = fullDetails.genres.map(genreKeyFromName).filter(Boolean);
              const matches = mangaGenreKeys.some(k => searchActiveGenreFilters.has(k));
              if (matches) {
                console.log('[app.js] Match found for', fullDetails.title, 'with genres:', mangaGenreKeys);
                filteredItems.push(fullDetails);
              }
            }
          } catch (e) {
            console.warn('Failed to get details for', item.id, e);
            // Still include the item if we can't get details
            if (item.genres && Array.isArray(item.genres)) {
              const mangaGenreKeys = item.genres.map(genreKeyFromName).filter(Boolean);
              const matches = mangaGenreKeys.some(k => searchActiveGenreFilters.has(k));
              if (matches) {
                filteredItems.push(item);
              }
            }
          }
        }
        items = filteredItems;
      } else {
        // For non-search results (trending/featured), use existing genres
        items = items.filter(m => {
          if (!m.genres || !Array.isArray(m.genres)) {
            console.log('[app.js] No genres for', m.title);
            return false;
          }
          // Normalize all manga genres to lowercase keys for comparison
          const mangaGenreKeys = m.genres.map(genreKeyFromName).filter(Boolean);
          console.log('[app.js] Manga genres for', m.title, ':', mangaGenreKeys);
          // Check if any of the manga's genre keys match active filters
          const matches = mangaGenreKeys.some(k => searchActiveGenreFilters.has(k));
          if (matches) {
            console.log('[app.js] Match found for', m.title, 'with genres:', mangaGenreKeys);
          }
          return matches;
        });
      }
    }

    if (!items || items.length === 0) { 
      box.innerHTML = '<p class="muted">No results found.</p>'; 
      console.log('[app.js] No items after filtering');
      return; 
    }

    console.log('[app.js] Items after filtering:', items.length);

    box.innerHTML = '';
    items.forEach(m => {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = m.image || '';
      img.alt = m.title || '';
      img.title = m.title || '';
      img.style.cursor = 'pointer';
      img.onclick = () => { closeSearchModal(); openDetailsModal(m.id, m); };
      box.appendChild(img);
    });
  } catch (e) {
    console.warn('populateSearchResultsFromFilters failed', e);
    if (box) box.innerHTML = '<p class="muted">Error loading results.</p>';
  } finally {
    // Always hide load more button in search results
    const loadBtn = document.getElementById('search-load-more');
    if (loadBtn) loadBtn.style.display = 'none';
  }
}

// Debounced search input handler (typing)
const performSearch = debounce(() => { populateSearchResultsFromFilters(); }, 420);

// Main function used by search input's oninput (keeps compatibility)
async function searchManga() {
  await populateSearchResultsFromFilters();
}

/* ---- Modal open/close for search ---- */
function openSearchModal() {
  const m = document.getElementById('search-modal');
  if (m) {
    m.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Prevent background scroll
    setTimeout(() => {
      const input = document.getElementById('search-input');
      if (input) input.focus();
      // populate results (empty query => shows all or filtered)
      populateSearchResultsFromFilters();
      // Update filter modal checkboxes to reflect current search filters
      updateGenreButtonStates();
    }, 80);
  }
}

function closeSearchModal() {
  const m = document.getElementById('search-modal');
  if (m) {
    m.style.display = 'none';
    document.body.style.overflow = ''; // Restore background scroll
    const box = document.getElementById('search-results');
    if (box) box.innerHTML = '';
    const input = document.getElementById('search-input');
    if (input) input.value = '';
    // Reset search filter state when closing
    isSearchFilterActive = false;
    searchActiveGenreFilters.clear();
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
    const data = await apiGet(`/manga-list/${window._browsePage}`);
    if (!data.data || !Array.isArray(data.data)) throw new Error('Invalid data format');
    const more = data.data.map(m => ({ id: m.id, title: m.title, image: proxifyUrl(m.imgUrl), latestChapter: m.latestChapter, description: m.description, genres: m.genres || [] }));
    trendingItems = trendingItems.concat(more);
    allMangaItems = [...trendingItems, ...featuredItems];
    populateGenresFromMangaItems();
    // Render the updated full list (unfiltered by main filters)
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
    const data = await apiGet(`/manga-list/${window._updatesPage}`);
    if (!data.data || !Array.isArray(data.data)) throw new Error('Invalid data format');
    const more = data.data.map(m => ({ id: m.id, title: m.title, image: proxifyUrl(m.imgUrl), latestChapter: m.latestChapter, description: m.description, genres: m.genres || [] }));
    featuredItems = featuredItems.concat(more);
    allMangaItems = [...trendingItems, ...featuredItems];
    populateGenresFromMangaItems();
    // Render the updated featured list (unfiltered)
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
  document.body.style.overflow = 'hidden'; // Prevent background scroll
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

  // Extract all unique genres from all manga items and from genre API set
  const allGenres = new Map(); // key -> display

  // First use existing genreDisplayByKey (loaded from /genre API)
  if (genreDisplayByKey && genreDisplayByKey.size > 0) {
    for (const [key, display] of genreDisplayByKey.entries()) {
      if (key) allGenres.set(key, display);
    }
  }

  // Then populate from inline manga items (so we don't miss any)
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

  // If still empty, try loading from API (best-effort)
  if (allGenres.size === 0) {
    try {
      await loadGenres();
      for (const [k, v] of genreDisplayByKey.entries()) allGenres.set(k, v);
    } catch (e) {
      /* ignore */
    }
  }

  if (allGenres.size === 0) {
    container.innerHTML = '<p class="muted">No genres available.</p>';
    return;
  }

  // Convert to sorted array by display name
  const entries = Array.from(allGenres.entries()).map(([key, display]) => ({ key, display }));
  entries.sort((a,b) => a.display.localeCompare(b.display, undefined, { sensitivity: 'base' }));

  // Build checkboxes
  container.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'filter-checkbox-grid';

  entries.forEach(e => {
    const label = document.createElement('label');
    label.className = 'filter-checkbox';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = e.key;                 // use normalized key as value
    cb.id = `filter_genre_${e.key}`;

    // Determine which filter set to check against based on context
    const searchModal = document.getElementById('search-modal');
    const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';
    if (isSearchOpen) {
        // If search modal is open, check against search filters
        if (searchActiveGenreFilters.has(e.key)) cb.checked = true;
    } else {
        // If main view, check against main filters
        if (activeGenreFilters.has(e.key)) cb.checked = true;
    }

    cb.onchange = function(evt) {
      const v = evt.target.value;
      const searchModal = document.getElementById('search-modal');
      const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';

      console.log('[app.js] Checkbox changed:', v, 'checked:', evt.target.checked, 'isSearchOpen:', isSearchOpen);

      if (isSearchOpen) {
          // If search modal is open, modify search filters
          if (evt.target.checked) {
            searchActiveGenreFilters.add(v);
            console.log('[app.js] Added to search filters:', v, 'new size:', searchActiveGenreFilters.size);
          } else {
            searchActiveGenreFilters.delete(v);
            console.log('[app.js] Removed from search filters:', v, 'new size:', searchActiveGenreFilters.size);
          }
      } else {
          // If main view, modify main filters
          if (evt.target.checked) {
            activeGenreFilters.add(v);
            console.log('[app.js] Added to main filters:', v, 'new size:', activeGenreFilters.size);
          } else {
            activeGenreFilters.delete(v);
            console.log('[app.js] Removed from main filters:', v, 'new size:', activeGenreFilters.size);
          }
      }
      updateGenreButtonStates(); // Update UI to reflect change
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
  // Hint text based on context
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';
  if (isSearchOpen) {
      hint.textContent = 'Select genres and click Apply to filter search results.';
  } else {
      hint.textContent = 'Select genres and click Apply to filter the Trending list.';
  }
  container.appendChild(hint);

  updateGenreButtonStates(); // Initial UI update
}

function updateGenreButtonStates() {
  const checkboxes = document.querySelectorAll('#filter-checkboxes input[type="checkbox"]');
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';

  checkboxes.forEach(cb => {
      if (isSearchOpen) {
          // Update based on search filters if search modal is open
          cb.checked = searchActiveGenreFilters.has(cb.value);
      } else {
          // Update based on main filters if main view
          cb.checked = activeGenreFilters.has(cb.value);
      }
  });

  // Update active filters display (if element exists)
  const activeFiltersEl = document.getElementById('search-active-filters'); // Check KB for correct ID
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
    // Normalize all manga genres to lowercase keys for comparison
    const mangaGenreKeys = m.genres.map(genreKeyFromName).filter(Boolean);
    // Check if any of the manga's genre keys match active filters
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
    // If search modal is open, activate search filters and refresh search results
    console.log('[app.js] Filter applied while search modal open — refreshing search results.');
    console.log('[app.js] Current search filters:', Array.from(searchActiveGenreFilters));
    isSearchFilterActive = searchActiveGenreFilters.size > 0;
    populateSearchResultsFromFilters();
  } else {
    // If search modal is closed, apply filters to the main trending view
    console.log('[app.js] Filter applied — applying to main trending view.');
    applyGenreFilters();
  }
}

function clearFiltersFromModal() {
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';

  if (isSearchOpen) {
    // If search modal is open, clear search filters and refresh search results
    console.log('[app.js] Filters cleared while search modal open — refreshing search results.');
    searchActiveGenreFilters.clear();
    isSearchFilterActive = false;
    populateSearchResultsFromFilters();
  } else {
    // If search modal is closed, clear main filters and reset trending view
    console.log('[app.js] Filters cleared — resetting main trending view.');
    activeGenreFilters.clear();
    renderTrending(allMangaItems); // Show all trending items
  }

  // Update filter modal checkboxes to reflect cleared state
  updateGenreButtonStates();

  // Uncheck all checkboxes in the filter modal UI
  const checkboxes = document.querySelectorAll('#filter-checkboxes input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = false);
}

/* ---- Reader close function ---- */
function closeReader() {
  const modal = document.getElementById('reader-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = ''; // Restore background scroll
  // reset reader state if desired
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
    // Render initial lists (unfiltered)
    renderTrending(allMangaItems);
    renderUpdates(featuredItems);
    createObserver('sentinel-trending', loadMoreTrending);
    createObserver('sentinel-updates', loadMoreUpdates);
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
window.searchMangaDebounced = performSearch; // Use the debounced version
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.changeChapter = function(){ const raw = document.getElementById('chapter')?.value; if(!raw) return; const c = JSON.parse(raw); loadChapterPages(c.mangaId, c.chapterId); };
window.loadMoreTrending = loadMoreTrending;
window.loadMoreUpdates = loadMoreUpdates;
window.loadMoreSearch = function(){ showStatus('Load more not available for search.', true); };
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
