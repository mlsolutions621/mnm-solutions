/* js/app.js - MangaStream Frontend (Directly using GOMANGA-API endpoints)
   API root: https://gomanga-api.vercel.app/api
*/
const API_BASE = (window.MR_BASE_OVERRIDE ? window.MR_BASE_OVERRIDE : 'https://gomanga-api.vercel.app/api').replace(/\/+$/, '');
let currentManga = null, currentPages = [], currentPageIndex = 0;
let trendingItems = [], featuredItems = [], allMangaItems = [], filteredMangaItems = [];
let isLoadingSearch = false, isLoadingTrending = false, isLoadingUpdates = false;
let genreMap = {};
let activeGenreFilters = new Set();
let currentDetailsMangaId = null;
let firstChapterIdForDetails = null;

// --- Genre Set for Filter Modal ---
let allGenresSet = new Set(); // Global Set to store unique genre names for filtering

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
      genres: m.genres || []
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
      genres: m.genres || []
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
      genres: m.genres || []
    }));
  } catch (e) {
    console.warn('searchTitles failed', e);
    return [];
  }
}

// --- REPLACED: loadGenres now populates allGenresSet from API (with fallback) ---
async function loadGenres() {
  try {
    const data = await apiGet('/genre');
    console.log('[app.js] Genre data loaded:', data);
    if (data && Array.isArray(data.genre)) {
      allGenresSet.clear();
      data.genre.forEach(g => {
        if (g) {
          const name = String(g).replace(/^genre\s*[:\-\s]*/i, '').trim();
          if (name) allGenresSet.add(name);
        }
      });
      console.log('[app.js] allGenresSet populated from API:', allGenresSet);
    } else if (Array.isArray(data)) {
      allGenresSet.clear();
      data.forEach(item => {
        let name = null;
        if (typeof item === 'string') name = item;
        else if (item && (item.name || item.genre)) name = item.name || item.genre;
        if (name) {
          const cleaned = String(name).replace(/^genre\s*[:\-\s]*/i, '').trim();
          if (cleaned) allGenresSet.add(cleaned);
        }
      });
      console.log('[app.js] allGenresSet populated from array response:', allGenresSet);
    } else {
      console.warn('[app.js] Unexpected genre data format:', data);
      populateGenresFromMangaItems();
    }
  } catch (e) {
    console.warn('[app.js] Failed to load genres from API endpoint', e);
    populateGenresFromMangaItems();
  }
}
// --- END REPLACED ---

// --- ADD THIS NEW FUNCTION ---
// Helper to populate allGenresSet from existing manga data if /genre API fails
function populateGenresFromMangaItems() {
  console.log('[app.js] Falling back to populating genres from manga items.');
  allGenresSet.clear(); // Clear before re-populating
  allMangaItems.forEach(item => {
    if (item.genres && Array.isArray(item.genres)) {
      item.genres.forEach(g => {
        if (!g) return;
        // sanitize same as details modal: remove leading "genre"
        const name = String(g).replace(/^genre\s*[:\-\s]*/i, '').trim();
        if (name) allGenresSet.add(name);
      });
    }
  });
  console.log('[app.js] allGenresSet populated from manga items (fallback):', allGenresSet);
}
// --- END ADD ---

async function getInfo(mangaId) {
  if (!mangaId) return null;
  try {
    const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}`);
    if (!data.id) throw new Error('Manga not found');
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
      description: data.description,
      summary: data.summary,
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
  updateReaderImage();
}

// --- MODIFIED: Update the reader image area in the popup to show a long strip ---
function updateReaderImage() {
  const stage = document.querySelector('#reader-modal .reader-stage');
  if (!stage) {
    console.error('[app.js] Reader stage element not found in popup');
    const img = document.getElementById('reader-image');
    if (img) {
      img.src = currentPages[currentPageIndex] || '';
      img.alt = `${currentManga?.title || 'Manga'} - Chapter Preview`;
    }
    return;
  }
  stage.innerHTML = '';
  if (currentPages.length === 0) {
    stage.innerHTML = '<p style="color: red;">No pages available for this chapter.</p>';
    return;
  }
  const stripWrapper = document.createElement('div');
  stripWrapper.id = 'manga-strip-popup';
  stripWrapper.style.display = 'flex';
  stripWrapper.style.flexDirection = 'column';
  stripWrapper.style.alignItems = 'center';
  stripWrapper.style.gap = '10px';
  currentPages.forEach((url, index) => {
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Page ${index + 1}`;
    img.style.width = '100%';
    img.style.maxWidth = '800px';
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

function getCurrentChapterIndex() {
  const chapterSel = document.getElementById('chapter');
  return chapterSel ? chapterSel.selectedIndex : -1;
}

function openDedicatedReader() {
  const chapterSel = document.getElementById('chapter');
  const chapterRaw = chapterSel?.value;
  if (!chapterRaw) return showStatus('No chapter selected', true);
  const { mangaId, chapterId } = JSON.parse(chapterRaw);
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

/* ---- Details Modal (Enhanced) ---- */
async function openDetailsModal(mangaId, fallbackData) {
  console.log(`[app.js] Opening details modal for manga: ${mangaId}`);
  const mangaData = await getInfo(mangaId) || fallbackData || null;
  if (!mangaData) {
    showStatus('Could not load manga details', true);
    return;
  }
  currentDetailsMangaId = mangaData.id;
  firstChapterIdForDetails = null;
  if (mangaData.chapters && Array.isArray(mangaData.chapters) && mangaData.chapters.length > 0) {
      const sortedChapters = [...mangaData.chapters].sort((a, b) => {
          const numA = parseFloat(a.chapterId);
          const numB = parseFloat(b.chapterId);
          if (!isNaN(numA) && !isNaN(numB)) {
              return numA - numB;
          }
          return String(a.chapterId).localeCompare(String(b.chapterId), undefined, { numeric: true, sensitivity: 'base' });
      });
      firstChapterIdForDetails = sortedChapters[0]?.chapterId || null;
      console.log(`[app.js] First chapter ID determined: ${firstChapterIdForDetails}`);
  } else {
      console.warn(`[app.js] No chapters found for manga ${mangaId}`);
  }

  const modalContent = document.querySelector('#details-modal .modal-content');
  if (!modalContent) {
      console.error('[app.js] Details modal content container not found');
      showStatus('Error displaying manga details', true);
      return;
  }

  modalContent.innerHTML = `
    <button class="close" onclick="closeDetailsModal()" aria-label="Close">×</button>
    <div class="reader-head" style="padding: 16px; border-bottom: 1px solid rgba(255,255,255,.05);">
      <div class="reader-meta">
        <img id="details-cover" src="${mangaData.image || fallbackData?.image || ''}" alt="Cover" style="width: 80px; height: 110px; border-radius: 8px; object-fit: cover;" />
        <div>
          <h3 id="details-title" style="margin: 0 0 8px;">${mangaData.title || 'Unknown Title'}</h3>
          <p class="muted" style="margin: 4px 0; font-size: 0.9rem;">Author: ${mangaData.author || 'Unknown'}</p>
          <p class="muted" style="margin: 4px 0; font-size: 0.9rem;">Status: ${mangaData.status || 'Unknown'}</p>
          <div id="details-genres" style="margin: 8px 0; display:flex; flex-wrap:wrap; gap:6px;">
          </div>
        </div>
      </div>
    </div>
    <div style="padding: 16px;">
      <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 15px; font-size: 0.9rem;">
        <span class="muted">Last Updated: ${mangaData.lastUpdated || 'N/A'}</span>
        <span class="muted">Views: ${mangaData.views || 'N/A'}</span>
        <span class="muted">Rating: ${mangaData.rating || 'N/A'}</span>
      </div>
      <p id="details-description-main" style="margin: 16px 0; line-height: 1.6;">
        ${mangaData.description || mangaData.summary || 'No description available for this manga.'}
      </p>
      <h4 style="margin: 20px 0 10px;">Chapters</h4>
      <div id="details-chapter-list" style="max-height: 300px; overflow-y: auto; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 10px;">
        <p style="color: var(--muted); text-align: center;">Loading chapters...</p>
      </div>
      <div style="margin-top:14px; display:flex; justify-content:flex-end; gap:8px;">
        <button class="btn" onclick="openDedicatedReaderFromDetails()">📖 Read Manga</button>
      </div>
    </div>
  `;

  const genresContainer = modalContent.querySelector('#details-genres');
  if (genresContainer && mangaData.genres && Array.isArray(mangaData.genres) && mangaData.genres.length > 0) {
      genresContainer.innerHTML = '';
      const used = new Set();
      mangaData.genres.forEach(genreRaw => {
          if (!genreRaw) return;
          let genre = String(genreRaw).trim();
          genre = genre.replace(/^genre\s*[:\-\s]*/i, '').trim();
          if (!genre) return;
          if (used.has(genre.toLowerCase())) return;
          used.add(genre.toLowerCase());
          const genreSpan = document.createElement('span');
          genreSpan.className = 'genre-pill';
          genreSpan.textContent = genre;
          genresContainer.appendChild(genreSpan);
      });
  } else if (genresContainer) {
      genresContainer.innerHTML = '<span class="muted" style="font-size: 0.8rem;">No genres listed.</span>';
  }

  const chapterListContainer = modalContent.querySelector('#details-chapter-list');
  if (chapterListContainer) {
      if (mangaData.chapters && Array.isArray(mangaData.chapters) && mangaData.chapters.length > 0) {
          const sortedChapters = [...mangaData.chapters].sort((a, b) => {
              const numA = parseFloat(a.chapterId);
              const numB = parseFloat(b.chapterId);
              if (!isNaN(numA) && !isNaN(numB)) {
                  return numB - numA;
              }
              return String(b.chapterId).localeCompare(String(a.chapterId), undefined, { numeric: true, sensitivity: 'base' });
          });
          chapterListContainer.innerHTML = '';
          const chapterList = document.createElement('div');
          sortedChapters.forEach(ch => {
              const chapterDiv = document.createElement('div');
              chapterDiv.style.padding = '8px 0';
              chapterDiv.style.borderBottom = '1px solid rgba(255,255,255,.05)';
              chapterDiv.innerHTML = `
                <span style="font-weight: 600;">Chapter ${ch.chapterId}</span>
                <span class="muted" style="float: right; font-size: 0.85rem;">${ch.uploaded || ch.timestamp || 'N/A'}</span>
                <br/>
                <span class="muted" style="font-size: 0.8rem;">Views: ${ch.views || 'N/A'}</span>
              `;
              chapterDiv.style.cursor = 'pointer';
              chapterDiv.onclick = () => {
                loadChapterPages(mangaData.id, ch.chapterId);
                const readerModal = document.getElementById('reader-modal');
                if (readerModal) { readerModal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
              };
              chapterList.appendChild(chapterDiv);
          });
          if (chapterList.lastChild) {
              chapterList.lastChild.style.borderBottom = 'none';
          }
          chapterListContainer.appendChild(chapterList);
      } else {
          chapterListContainer.innerHTML = '<p class="muted" style="text-align: center; margin: 10px 0;">No chapters found.</p>';
      }
  }

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

/* Search UI & helpers */
function debounce(fn, wait) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

// New unified search+filter rendering function
async function populateSearchResultsFromFilters() {
  const box = document.getElementById('search-results');
  if (!box) return;
  const q = document.getElementById('search-input')?.value?.trim();
  try {
    box.innerHTML = '<p class="muted">Loading results...</p>';
    let items = [];
    if (q) {
      // If there's text, use remote search (keeps previous behavior)
      items = await searchTitles(q);
    } else {
      // No query: use allMangaItems (combine trending + featured)
      items = allMangaItems || [];
    }

    // Apply genre filters if any
    if (activeGenreFilters.size > 0) {
      items = items.filter(m => {
        if (!m.genres || !Array.isArray(m.genres)) return false;
        const normalizedGenres = m.genres.map(g => {
          if (!g) return '';
          return String(g).replace(/^genre\s*[:\-\s]*/i, '').trim();
        }).filter(Boolean);
        return normalizedGenres.some(g => activeGenreFilters.has(g));
      });
    }

    // Render results
    if (!items || items.length === 0) {
      box.innerHTML = '<p class="muted">No results.</p>';
      return;
    }

    box.innerHTML = '';
    items.forEach(m => {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = m.image || '';
      img.alt = m.title || '';
      img.title = m.title || '';
      img.onclick = () => {
        closeSearchModal();
        openDetailsModal(m.id, m);
      };
      box.appendChild(img);
    });
  } catch (e) {
    console.warn('populateSearchResultsFromFilters failed', e);
    box.innerHTML = '<p class="muted">Error loading results.</p>';
  }
}

// Old searchManga now delegates to populateSearchResultsFromFilters
async function searchManga() {
  await populateSearchResultsFromFilters();
}

const searchMangaDebounced = debounce(searchManga, 420);

function loadMoreSearch() { showStatus('Load more not available for search.', true); }

function openSearchModal() {
  const m = document.getElementById('search-modal');
  if (m) {
    m.style.display = 'flex';
    setTimeout(() => {
      document.getElementById('search-input')?.focus();
      // Populate search results immediately (empty query -> show either all or filtered)
      populateSearchResultsFromFilters();
    }, 100);
  }
}

function closeSearchModal() {
  const m = document.getElementById('search-modal');
  if (m) {
    m.style.display = 'none';
    document.getElementById('search-results').innerHTML = '';
  }
}

/* ---- Observers and pagination helpers ---- */
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
    // Update the global genre set and re-apply filters
    updateAllGenresSet();
    applyGenreFilters();
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
    // Update global genre set after loading more updates
    updateAllGenresSet();
    renderUpdates(featuredItems); // Only render updates section
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

/* ---- Genre Filter Functions (modal + checklist) ---- */

// Make openFilterModal async and await checkbox creation, so the modal always shows data
async function openFilterModal() {
  const m = document.getElementById('filter-modal');
  if (!m) return;
  // Ensure checkboxes are populated when modal opens (uses latest allMangaItems / API genres)
  await createGenreCheckboxes();
  m.style.display = 'flex';
  // Optional: focus first checkbox for keyboard users
  setTimeout(() => {
    const firstCb = document.querySelector('#filter-checkboxes input[type="checkbox"]');
    if (firstCb) firstCb.focus();
  }, 50);
}
function closeFilterModal() {
  const m = document.getElementById('filter-modal');
  if (m) { m.style.display = 'none'; }
}
function toggleGenreFilters() { openFilterModal(); }

// --- REPLACED: createGenreCheckboxes is now async and ensures genres are loaded ---
async function createGenreCheckboxes() {
  const container = document.getElementById('filter-checkboxes');
  if (!container) return;

  // Show loading placeholder immediately
  container.innerHTML = '<p class="muted">Loading genres...</p>';

  // If no genres yet, try to fetch them (loadGenres will populate allGenresSet or fallback)
  if (allGenresSet.size === 0) {
    try {
      await loadGenres();
    } catch (e) {
      // loadGenres has its own fallback; ignore error here
    }
    // still empty? try populating from current manga list
    if (allGenresSet.size === 0) {
      populateGenresFromMangaItems();
    }
  }

  // If still empty after attempts, show message and return
  if (allGenresSet.size === 0) {
    container.innerHTML = '<p class="muted">No genres available.</p>';
    console.log('[app.js] createGenreCheckboxes: allGenresSet is empty after load attempts.');
    return;
  }

  // Clear previous content and build the checklist
  container.innerHTML = '';
  const sortedGenres = Array.from(allGenresSet).sort((a, b) => a.localeCompare(b));
  sortedGenres.forEach(genre => {
    const id = `filter_genre_${genre.replace(/[^a-z0-9]+/ig,'_').toLowerCase()}`;
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '10px';
    label.style.padding = '6px 0';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.value = genre;
    if (activeGenreFilters.has(genre)) cb.checked = true;

    cb.onchange = (e) => {
      if (e.target.checked) activeGenreFilters.add(genre);
      else activeGenreFilters.delete(genre);
    };

    const span = document.createElement('span');
    span.textContent = genre;

    label.appendChild(cb);
    label.appendChild(span);
    container.appendChild(label);
  });

  console.log('[app.js] Filter checkboxes created from allGenresSet.');
}
// --- END REPLACED ---

function updateGenreButtonStates() {
  const checkboxes = document.querySelectorAll('#filter-checkboxes input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = activeGenreFilters.has(cb.value);
  });
  const activeFiltersEl = document.getElementById('active-filters');
  if (activeFiltersEl) {
    if (activeGenreFilters.size > 0) {
      activeFiltersEl.textContent = `Active filters: ${Array.from(activeGenreFilters).join(', ')}`;
    } else {
      activeFiltersEl.textContent = '';
    }
  }
}

function applyGenreFilters() {
  if (activeGenreFilters.size === 0) {
    renderTrending(allMangaItems);
    return;
  }

  const filtered = allMangaItems.filter(manga => {
    if (!manga.genres || !Array.isArray(manga.genres)) return false;
    const normalizedGenres = manga.genres.map(g => {
        if (!g) return '';
        return String(g).replace(/^genre\s*[:\-\s]*/i,'').trim();
    }).filter(g => g);
    return normalizedGenres.some(genre => activeGenreFilters.has(genre));
  });

  renderTrending(filtered);
}

function applyFilterFromModal() {
  closeFilterModal();
  applyGenreFilters();
  updateGenreButtonStates();

  // ALSO: if the search modal is open, update the search results view
  const searchModal = document.getElementById('search-modal');
  if (searchModal && (getComputedStyle(searchModal).display !== 'none')) {
    populateSearchResultsFromFilters();
  }
}

function clearFiltersFromModal() {
  activeGenreFilters.clear();
  updateGenreButtonStates();
  applyGenreFilters();
  const checkboxes = document.querySelectorAll('#filter-checkboxes input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = false);

  // If search modal open, refresh results (show unfiltered)
  const searchModal = document.getElementById('search-modal');
  if (searchModal && (getComputedStyle(searchModal).display !== 'none')) {
    populateSearchResultsFromFilters();
  }
}

/* ---- Utility: keep global genre set up-to-date ---- */
function updateAllGenresSet() {
  allGenresSet.clear();
  allMangaItems.forEach(item => {
    if (item.genres && Array.isArray(item.genres)) {
      item.genres.forEach(g => {
        if (!g) return;
        const name = String(g).replace(/^genre\s*[:\-\s]*/i, '').trim();
        if (name) allGenresSet.add(name);
      });
    }
  });
  console.log('[app.js] All genres set populated (updateAllGenresSet):', allGenresSet);
}

/* ---- Init ---- */
async function init() {
  try {
    await loadGenres();
    const [t, f] = await Promise.all([getTrending(), getFeatured()]);
    trendingItems = Array.isArray(t) ? t : [];
    featuredItems = Array.isArray(f) ? f : [];
    allMangaItems = [...trendingItems, ...featuredItems];

    // If API didn't populate genres earlier, ensure our global set includes items' genres
    if (allGenresSet.size === 0) updateAllGenresSet();

    filteredMangaItems = [...allMangaItems];
    renderTrending(allMangaItems);
    renderUpdates(featuredItems);
    createObserver('sentinel-trending', loadMoreTrending);
    createObserver('sentinel-updates', loadMoreUpdates);
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
window.changeChapter = changeChapter;
window.loadMoreTrending = loadMoreTrending;
window.loadMoreUpdates = loadMoreUpdates;
window.loadMoreSearch = loadMoreSearch;
window.openDedicatedReader = openDedicatedReader;
window.toggleGenreFilters = toggleGenreFilters;
window.clearGenreFilters = clearFiltersFromModal;
window.openDetailsModal = openDetailsModal;
window.closeDetailsModal = closeDetailsModal;
window.openDedicatedReaderFromDetails = openDedicatedReaderFromDetails;
window.openFilterModal = openFilterModal;
window.closeFilterModal = closeFilterModal;
window.applyFilterFromModal = applyFilterFromModal;
window.populateSearchResultsFromFilters = populateSearchResultsFromFilters;
