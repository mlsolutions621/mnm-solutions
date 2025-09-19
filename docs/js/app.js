/* js/app.js - MangaStream Frontend (Remodified with Paged Search)
- Accessibility-friendly modal open/close helpers
- Client-side genre index for fast genre filtering
- Paged search results with numbered navigation
- Concurrent details fetching for deferred candidates
- Ensures functions used by inline onclick handlers are exposed on window
- Keeps rate-limiting and caching already present in your original code
*/

// --- Configuration and State ---
const API_BASE = (window.MR_BASE_OVERRIDE ? window.MR_BASE_OVERRIDE.trim() : 'https://gomanga-api.vercel.app/api'.trim()).replace(/\/+$/, '');

let currentManga = null, currentPages = [], currentPageIndex = 0;
let trendingItems = [], featuredItems = [], allMangaItems = [], filteredMangaItems = [];
let isLoadingSearch = false, isLoadingTrending = false, isLoadingUpdates = false;

// Genre storage and helpers
let allGenresKeySet = new Set(); // normalized keys
let genreDisplayByKey = new Map(); // key -> display name
let genresLoadingPromise = null;
let activeGenreFilters = new Set(); // keys (normalized lowercase) - for main view

// --- Client-Side Genre Indexing ---
// Map: genreKey (string) -> Set of manga IDs (string)
const genreIndex = new Map();
// --- End Client-Side Genre Indexing ---

let initDone = false;

// Cache for manga details to avoid repeated API calls
const mangaDetailsCache = new Map();

// State for search modal to manage its own filters
let isSearchFilterActive = false;
let searchActiveGenreFilters = new Set(); // keys (normalized lowercase) - for search view

// --- Search Paging State ---
let searchPaging = {
  sourceItems: [], // Items from initial search or allMangaItems
  matches: [], // Accumulated list of items that pass the filter
  candidates: [], // IDs of items without inline genres that are candidates
  scanIndex: 0, // Index in sourceItems up to which we've scanned
  page: 0, // Number of pages worth of matches we've tried to load (e.g., if pageSize=10, page=2 means we tried to load 20 matches)
  currentPage: 1, // Currently displayed page number (1-based)
  pageSize: 10, // Number of items per page
  finished: false, // whether we've scanned all candidates
  loading: false // whether currently fetching details
};

// --- Accessibility Helpers for Modals ---
// Store the element that opened the modal for focus restoration
let lastFocusedElement = null;

/**
 * Opens a modal by ID with improved accessibility.
 * @param {string} modalId - The ID of the modal element.
 * @param {string} [focusSelector] - Optional CSS selector for the element inside the modal to focus.
 *                                   If not provided, attempts to focus the first focusable element.
 */
function openModalById(modalId, focusSelector = null) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.warn(`Modal with ID '${modalId}' not found.`);
    return;
  }

  // Store the element that currently has focus (the trigger)
  lastFocusedElement = document.activeElement;

  // Make the modal visible and available to screen readers
  modal.style.display = 'flex'; // Or 'block', depending on your CSS
  modal.setAttribute('aria-hidden', 'false');
  // Add ARIA attributes if not present in HTML
  if (!modal.hasAttribute('role')) {
    modal.setAttribute('role', 'dialog');
  }
  if (!modal.hasAttribute('aria-modal')) {
    modal.setAttribute('aria-modal', 'true');
  }

  // Prevent background scrolling
  document.body.classList.add('modal-open');

  // Move focus into the modal
  let elementToFocus = null;
  if (focusSelector) {
    elementToFocus = modal.querySelector(focusSelector);
  }
  // If no specific selector or element not found, find the first focusable element
  if (!elementToFocus) {
    elementToFocus = getFirstFocusableElement(modal);
  }
  // If still no focusable element, focus the modal itself (requires tabindex="-1")
  if (!elementToFocus) {
    elementToFocus = modal;
    // Ensure modal itself is focusable if it needs to receive focus as a fallback
    if (modal.tabIndex === -1 || modal.tabIndex >= 0) {
        // Already focusable
    } else {
        modal.tabIndex = -1; // Make it programmatically focusable temporarily
        // Optional: Remove tabindex on close if it was added here
        modal._tempTabIndexAdded = true;
    }
  }

  if (elementToFocus) {
    // Use setTimeout to ensure the element is rendered and focusable
    setTimeout(() => {
       elementToFocus.focus();
       // Optional: Add focus trap here if implemented
    }, 0);
  }
}

/**
 * Closes a modal by ID with improved accessibility.
 * @param {string} modalId - The ID of the modal element.
 */
function closeModalById(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.warn(`Modal with ID '${modalId}' not found.`);
    return;
  }

  // 1. Move focus away from elements inside the modal *before* hiding it
  //    a. Try to restore focus to the element that opened it
  if (lastFocusedElement && document.contains(lastFocusedElement)) {
    lastFocusedElement.focus();
  } else {
    //    b. Fallback: Move focus to a logical part of the main content
    //       Ensure your main content area has a landmark role or is focusable.
    const mainContent = document.querySelector('main') || document.querySelector('[role="main"]');
    if (mainContent) {
      // Ensure it's focusable if it's not naturally (e.g., a div)
      if (mainContent.tabIndex < 0 && mainContent !== document.body) {
        mainContent.tabIndex = -1; // Temporarily make focusable
        mainContent.focus();
        // Optional cleanup: mainContent.removeAttribute('tabindex'); after focus if desired
      } else {
         mainContent.focus();
      }
    } else {
      //       c. Ultimate fallback: focus the body (less ideal for keyboard users)
       // Ensure body is focusable for this fallback (set once on init if needed)
       if (document.body.tabIndex < 0) {
           document.body.tabIndex = -1; // Should ideally be set once during app init
       }
       document.body.focus();
    }
  }

  // Clear the stored reference
  lastFocusedElement = null;

  // 2. Blur any element inside the modal that might still conceptually hold focus
  //    (This step is often handled by moving focus, but can be explicit)
  const activeElement = document.activeElement;
  if (activeElement && modal.contains(activeElement)) {
    activeElement.blur();
  }

  // 3. Now it's safe to hide the modal
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
  // Clean up temporary tabindex if added
  if (modal._tempTabIndexAdded) {
      modal.removeAttribute('tabindex');
      delete modal._tempTabIndexAdded;
  }

  // Allow background scrolling again
  document.body.classList.remove('modal-open');
  // Optional: Remove focus trap if implemented
}

/**
 * Helper function to find the first focusable element within a container.
 * @param {HTMLElement} container - The element to search within.
 * @returns {HTMLElement|null} - The first focusable element, or null if none found.
 */
function getFirstFocusableElement(container) {
  if (!container) return null;
  // Define selectors for focusable elements
  // Note: :not([disabled]) is often implied for form controls, but explicit check is safer
  // Exclude elements with negative tabindex explicitly
  const selectors =
    'button:not([disabled]), [href]:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled]), [contenteditable]:not([contenteditable="false"])';

  const nodes = Array.from(container.querySelectorAll(selectors));
  for (const n of nodes) {
    // Basic visible check (offsetWidth/Height or getClientRects)
    if (n.offsetWidth > 0 || n.offsetHeight > 0 || n.getClientRects().length > 0) {
      return n;
    }
  }
  return null; // No focusable element found
}
// --- End Accessibility Helpers ---

// --- Genre Indexing ---
/**
 * Builds or rebuilds the client-side genre index.
 * @param {Array} items - Array of manga item objects (from API, potentially with inline genres).
 */
function buildGenreIndex(items) {
  console.log('[Indexing] Rebuilding genre index...');
  genreIndex.clear(); // Clear previous index

  (items || []).forEach(item => {
    if (!item || !item.id) return; // Skip invalid items

    // Index based on inline genres if available
    if (Array.isArray(item.genres) && item.genres.length) {
      item.genres.forEach(rawGenre => {
        if (!rawGenre) return;
        const genreKey = genreKeyFromName(rawGenre); // Your existing normalization function
        if (!genreKey) return;
        if (!genreIndex.has(genreKey)) {
          genreIndex.set(genreKey, new Set());
        }
        genreIndex.get(genreKey).add(item.id);
      });
    }
    // Optional: Seed index with keys from genreDisplayByKey for completeness
    // (handles cases where an API genre list item might not appear in any manga yet)
    // for (const key of genreDisplayByKey.keys()) {
    //   if (!genreIndex.has(key)) genreIndex.set(key, new Set());
    // }
  });
  console.log('[Indexing] Genre index built with', genreIndex.size, 'genres.');
}
// --- End Genre Indexing ---

// --- Concurrent Details Fetching ---
/**
 * Fetches details for multiple manga IDs concurrently with a limit.
 * Uses getCachedMangaDetails for built-in rate limiting and caching.
 * @param {string[]} ids - Array of manga IDs.
 * @param {Object} options - Options.
 * @param {number} options.concurrency - Maximum number of concurrent requests.
 * @returns {Promise<Map<string, Object>>} Map of ID to fetched details object.
 */
async function fetchDetailsConcurrent(ids, { concurrency = 6 } = {}) {
  const results = new Map();
  let index = 0; // Shared index for workers

  // Worker function that fetches items from the shared index
  const worker = async () => {
    while (index < ids.length) {
      const currentIndex = index++; // Atomically get and increment
      const id = ids[currentIndex];
      if (!id) continue; // Skip if ID is somehow invalid at this point

      try {
        // Use getCachedMangaDetails for built-in caching and rate limiting
        const details = await getCachedMangaDetails(id);
        if (details) {
          results.set(id, details);
        } else {
          console.warn('[Fetch] No details returned for ID:', id);
        }
      } catch (error) {
        // Handle individual fetch errors gracefully
        console.warn('[Fetch] Error fetching details for ID:', id, error);
        // Optionally, decide whether to retry or store error state in results map
        // results.set(id, { error: error.message }); // Example of storing error
      }
    }
  };

  // Create and run worker pool
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, ids.length); i++) {
    workers.push(worker());
  }

  // Wait for all workers to complete
  await Promise.all(workers);

  return results;
}
// --- End Concurrent Details Fetching ---


let currentDetailsMangaId = null;
let firstChapterIdForDetails = null;

// Rate limiting for API calls
const API_RATE_LIMIT = 100; // milliseconds between calls
let lastApiCall = 0;

// --- Fetchers ---
async function getTrending() {
  try {
    const data = await rateLimitedApiGet('/manga-list/1');
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
    const data = await rateLimitedApiGet('/manga-list/2');
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

async function getUpdates() {
  try {
    const data = await rateLimitedApiGet('/manga-list/3');
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
    console.warn('getUpdates failed', e);
    return [];
  }
}

async function getMangaDetails(mangaId) {
  try {
    const data = await rateLimitedApiGet(`/manga/${mangaId}`);
    if (!data) return null;
    return {
      id: data.id,
      title: data.title,
      image: proxifyUrl(data.imgUrl),
      description: data.description,
      status: data.status,
      views: data.views,
      authors: data.authors,
      genres: data.genres || [],
      rating: data.rating,
      lastUpdated: data.lastUpdated,
      chapters: Array.isArray(data.chapters) ? data.chapters.map(c => ({
        chapterId: c.chapterNumber,
        title: c.title,
        views: c.views,
        uploaded: c.uploaded
      })) : []
    };
  } catch (e) {
    console.warn('getMangaDetails failed', e);
    return null;
  }
}

async function getChapterPages(mangaId, chapterId) {
  try {
    const data = await rateLimitedApiGet(`/manga/${mangaId}/${chapterId}`);
    if (!data || !Array.isArray(data.images)) return [];
    return data.images.map(url => proxifyUrl(url));
  } catch (e) {
    console.warn('getChapterPages failed', e);
    return [];
  }
}

// --- Caching Layer for Details ---
async function getCachedMangaDetails(mangaId) {
  if (mangaDetailsCache.has(mangaId)) {
    return mangaDetailsCache.get(mangaId);
  }
  const details = await getMangaDetails(mangaId);
  if (details) {
    mangaDetailsCache.set(mangaId, details);
  }
  return details;
}
// --- End Caching Layer ---

// --- API Helpers ---
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
// --- End API Helpers ---

// --- UI Renderers ---
function renderTrending(items) {
  const container = document.getElementById('manga-list');
  if (!container) { console.warn('Missing container #manga-list'); return; }
  container.innerHTML = '';
  (items || []).forEach(m => {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || '';
    img.alt = m.title || '';
    img.title = m.title || '';
    img.onclick = () => openDetailsModal(m.id, m);
    container.appendChild(img);
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
    meta.appendChild(title); meta.appendChild(chap);
    card.appendChild(img); card.appendChild(meta);
    grid.appendChild(card);
  });
}

function showStatus(msg, isError = false, persist = false) {
  console[isError ? 'error' : 'log']('[MANGASTREAM]', msg);
}
// --- End UI Renderers ---

// --- Modal Handlers ---
function openSearchModal() {
  // Reset/clear search state if needed
  document.getElementById('search-input').value = '';
  document.getElementById('search-results').innerHTML = '';
  document.getElementById('search-active-filters').textContent = '';
  // Reset paging state
  searchPaging = {
    sourceItems: [],
    matches: [],
    candidates: [],
    scanIndex: 0,
    page: 0,
    currentPage: 1,
    pageSize: 10, // Ensure pageSize is reset if changed elsewhere
    finished: false,
    loading: false
  };
  isSearchFilterActive = searchActiveGenreFilters.size > 0;
  updateSearchProgress();
  const loadBtn = document.getElementById('search-load-more');
  if (loadBtn) loadBtn.style.display = 'none';
  const paginationContainer = document.getElementById('search-pagination');
  if (paginationContainer) paginationContainer.innerHTML = '';

  // Use accessibility helper
  openModalById("search-modal", "#search-input");
}

function closeSearchModal() {
  // Reset search state before closing for a clean next-open
  isSearchFilterActive = false;
  searchActiveGenreFilters.clear();
  searchPaging = {
    sourceItems: [],
    matches: [],
    candidates: [],
    scanIndex: 0,
    page: 0,
    currentPage: 1,
    pageSize: 10,
    finished: false,
    loading: false
  };
  const box = document.getElementById('search-results');
  if (box) box.innerHTML = '';
  const prog = document.getElementById('search-progress');
  if (prog) prog.textContent = '';
  const paginationContainer = document.getElementById('search-pagination');
  if (paginationContainer) paginationContainer.innerHTML = '';

  // Use accessibility helper
  closeModalById("search-modal");
}

// Keep the older-named helpers for compatibility with existing HTML onclick handlers
function openFilterModal() {
  populateFilterCheckboxes();
  // Use accessibility helper
  openModalById("filter-modal");
}

function closeFilterModal() {
  // Use accessibility helper
  closeModalById("filter-modal");
}

function openDetailsModal(mangaId, fallbackData) {
  currentDetailsMangaId = mangaId;
  firstChapterIdForDetails = null;
  const modal = document.getElementById('details-modal');
  if (!modal) return;

  const content = modal.querySelector('.modal-content');
  if (content) content.innerHTML = '<p class="muted">Loading...</p>';

  // Use accessibility helper
  openModalById("details-modal");

  getCachedMangaDetails(mangaId).then(mangaData => {
    if (!mangaData || currentDetailsMangaId !== mangaId) return;
    const cl = document.createElement('div');
    cl.style.borderTop = '1px solid rgba(255,255,255,.07)';
    cl.style.marginTop = '16px';
    cl.style.paddingTop = '16px';
    (mangaData.chapters || []).forEach(ch => {
      const div = document.createElement('div');
      div.style.borderBottom = '1px solid rgba(255,255,255,.05)';
      div.style.padding = '10px 0';
      div.style.cursor = 'pointer';
      div.innerHTML = `<span style="font-weight:600">Chapter ${ch.chapterId}</span><span class="muted" style="float:right;font-size:.85rem">${ch.uploaded || ch.timestamp || 'N/A'}</span><br/><span class="muted" style="font-size:.8rem">Views: ${ch.views || 'N/A'}</span>`;
      div.onclick = () => {
        loadChapterPages(mangaData.id, ch.chapterId);
        // Use accessibility helper for reader
        openModalById("reader-modal");
      };
      cl.appendChild(div);
    });
    if (cl.lastChild) cl.lastChild.style.borderBottom = 'none';
    const genresHtml = (mangaData.genres || []).map(g => `<span class="genre-pill">${g}</span>`).join(' ');
    const html = `
      <button class="close" onclick="closeDetailsModal()" aria-label="Close">×</button>
      <div style="display:flex;gap:16px;flex-wrap:wrap;padding:16px">
        <img src="${mangaData.image}" alt="${mangaData.title}" style="width:160px;height:240px;object-fit:cover;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.6);">
        <div style="flex:1;min-width:240px">
          <h2 style="margin:0 0 8px">${mangaData.title}</h2>
          <p class="muted" style="margin:4px 0;font-size:.9rem">Author: ${mangaData.authors || 'Unknown'}</p>
          <p class="muted" style="margin:4px 0;font-size:.9rem">Status: ${mangaData.status || 'Unknown'}</p>
          <div id="details-genres" style="margin:8px 0;display:flex;flex-wrap:wrap;gap:6px">${genresHtml}</div>
        </div>
      </div>
      <div style="padding:16px">
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:15px;font-size:.9rem">
          <span class="muted">Last Updated: ${mangaData.lastUpdated || 'N/A'}</span>
          <span class="muted">Views: ${mangaData.views || 'N/A'}</span>
          <span class="muted">Rating: ${mangaData.rating || 'N/A'}</span>
        </div>
        <p style="line-height:1.6;margin-bottom:16px">${mangaData.description || 'No description available.'}</p>
        <h4 style="margin:16px 0 10px">Chapters</h4>
        ${cl.innerHTML}
      </div>
    `;
    if (content) content.innerHTML = html;
    if (mangaData.chapters && mangaData.chapters.length > 0) {
      firstChapterIdForDetails = mangaData.chapters[0].chapterId;
    }
  }).catch(err => {
    console.error('Failed to load manga details', err);
    const content = modal.querySelector('.modal-content');
    if (content) content.innerHTML = '<p class="muted">Failed to load details.</p>';
  });
}

function closeDetailsModal() {
  currentDetailsMangaId = null;
  // Use accessibility helper
  closeModalById("details-modal");
}

function openDedicatedReaderFromDetails() {
  if (!currentDetailsMangaId || !firstChapterIdForDetails) return showStatus('No chapter available', true);
  const basePath = window.location.pathname.includes('/docs/') ?
    window.location.origin + '/mnm-solutions/docs/' :
    window.location.origin + '/mnm-solutions/';
  const url = new URL('read.html', basePath);
  url.searchParams.set('mangaId', currentDetailsMangaId);
  url.searchParams.set('chapterId', firstChapterIdForDetails);
  url.searchParams.set('page', 0);
  window.location.href = url.toString();
}

function closeReader() {
  // Use accessibility helper
  closeModalById("reader-modal");
  // reset reader state if desired
  currentPages = [];
  currentPageIndex = 0;
}
// --- End Modal Handlers ---

// --- Search and Filter ---
async function searchManga(q) {
  if (!q) return [];
  try {
    const data = await rateLimitedApiGet(`/search/${encodeURIComponent(q)}`);
    if (!data.data || !Array.isArray(data.data)) return [];
    const searchResults = data.data.map(m => ({
      id: m.id,
      title: m.title,
      image: proxifyUrl(m.imgUrl),
      description: m.description,
      latestChapter: m.latestChapters && m.latestChapters.length > 0 ? m.latestChapters[0].chapter : null,
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

// Debounced search function (using a simple implementation)
let searchTimeout;
function performSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const input = document.getElementById('search-input');
    const q = input ? input.value.trim() : '';
    if (!q) {
      document.getElementById('search-results').innerHTML = '';
      const loadBtn = document.getElementById('search-load-more');
      if (loadBtn) loadBtn.style.display = 'none';
      updateSearchProgress();
      const paginationContainer = document.getElementById('search-pagination');
      if (paginationContainer) paginationContainer.innerHTML = '';
      return;
    }
    isLoadingSearch = true;
    try {
      // Reset paging for new search term
      searchPaging = {
        sourceItems: [],
        matches: [],
        candidates: [],
        scanIndex: 0,
        page: 0,
        currentPage: 1,
        pageSize: 10,
        finished: false,
        loading: false
      };
      await populateSearchResultsFromFilters();
    } finally {
      isLoadingSearch = false;
    }
  }, 300); // 300ms delay
}
window.searchMangaDebounced = performSearch; // Expose for inline use if needed

function updateSearchProgress() {
  const el = document.getElementById('search-progress');
  if (!el) return;
  const totalPages = Math.ceil(searchPaging.matches.length / searchPaging.pageSize);
  if (searchPaging.finished) {
    el.textContent = `Showing ${searchPaging.matches.length} result${searchPaging.matches.length !== 1 ? 's' : ''}.`;
  } else if (searchPaging.matches.length > 0) {
    el.textContent = `Showing ${searchPaging.matches.length} result${searchPaging.matches.length !== 1 ? 's' : ''} (Page ${searchPaging.currentPage} of ${totalPages || '?'})...`;
  } else if (isLoadingSearch || searchPaging.loading) {
    el.textContent = 'Searching...';
  } else {
    el.textContent = '';
  }
}

// --- Paged Search Logic ---
/**
 * Ensures that searchPaging.matches contains at least `desiredCount` items
 * that match the active filters by scanning sourceItems and fetching details if needed.
 */
async function fillMatchesToCount(desiredCount) {
  if (searchPaging.matches.length >= desiredCount || searchPaging.finished) {
    return;
  }

  console.log(`[Search] fillMatchesToCount: need ${desiredCount}, have ${searchPaging.matches.length}`);

  const activeFiltersArray = Array.from(searchActiveGenreFilters);
  if (activeFiltersArray.length === 0) return; // Shouldn't happen if filters are active

  while (searchPaging.matches.length < desiredCount && !searchPaging.finished && searchPaging.scanIndex < searchPaging.sourceItems.length) {
    const batchStartIndex = searchPaging.scanIndex;
    const batchSize = Math.min(50, searchPaging.sourceItems.length - searchPaging.scanIndex); // Process in small batches
    const batchItems = searchPaging.sourceItems.slice(batchStartIndex, batchStartIndex + batchSize);
    searchPaging.scanIndex += batchSize;

    console.log(`[Search] Scanning batch ${Math.floor(batchStartIndex / batchSize) + 1} (${batchItems.length} items)`);

    const immediateMatches = [];
    const batchCandidateIds = [];

    for (const item of batchItems) {
      if (Array.isArray(item.genres) && item.genres.length > 0) {
        // Check inline genres
        const itemGenreKeys = item.genres.map(g => genreKeyFromName(g)).filter(Boolean);
        const matchesFilter = activeFiltersArray.every(filterKey => itemGenreKeys.includes(filterKey));
        if (matchesFilter) {
          immediateMatches.push(item);
        }
      } else if (item.id) {
        // Item lacks inline genres, add ID to candidates for detail fetch
        batchCandidateIds.push(item.id);
      }
    }

    // Add immediate matches
    searchPaging.matches.push(...immediateMatches);
    console.log(`[Search] Batch immediate matches: ${immediateMatches.length}`);

    // Fetch details for candidates in this batch if needed
    if (batchCandidateIds.length > 0 && searchPaging.matches.length < desiredCount) {
      searchPaging.loading = true;
      updateSearchProgress();
      try {
        console.log(`[Search] Fetching details for ${batchCandidateIds.length} candidates...`);
        const detailsMap = await fetchDetailsConcurrent(batchCandidateIds, { concurrency: 6 });

        // Evaluate fetched details
        for (const id of batchCandidateIds) {
          const d = detailsMap.get(id);
          if (!d) continue;
          const keys = Array.isArray(d.genres) ? d.genres.map(genreKeyFromName).filter(Boolean) : [];
          if (keys.some(k => searchActiveGenreFilters.has(k))) {
            // prefer pushing the full detail object for better display
            searchPaging.matches.push(d);
            if (searchPaging.matches.length >= desiredCount) break;
          }
        }
      } catch (err) {
        console.error('[Search] Error fetching details for batch:', err);
      } finally {
        searchPaging.loading = false;
        updateSearchProgress();
      }
    }

    // If we've scanned all source items and there's no more candidates to process, mark finished
    if (searchPaging.scanIndex >= searchPaging.sourceItems.length) {
      searchPaging.finished = true;
      console.log('[Search] Finished scanning all source items.');
    }
  }
}

/**
 * Renders the items for a specific page number.
 * @param {number} pageNumber - The 1-based page number to render.
 */
async function renderMatchesForPage(pageNumber) {
  const pageSize = searchPaging.pageSize;
  const startIndex = (pageNumber - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  const totalPages = Math.ceil(searchPaging.matches.length / pageSize);

  console.log(`[Search] renderMatchesForPage: Page ${pageNumber}, Start: ${startIndex}, End: ${endIndex}, Total Pages: ${totalPages}`);

  // Ensure we have enough matches loaded for this page
  const desiredCount = endIndex;
  if (searchPaging.matches.length < desiredCount && !searchPaging.finished) {
    await fillMatchesToCount(desiredCount);
  }

  const box = document.getElementById('search-results');
  if (!box) return;

  box.innerHTML = ''; // Clear previous results

  const itemsToRender = searchPaging.matches.slice(startIndex, endIndex);

  if (itemsToRender.length === 0) {
    if (searchPaging.matches.length === 0 && searchPaging.finished) {
      box.innerHTML = '<p class="muted">No manga found matching the selected filters.</p>';
    } else {
      box.innerHTML = '<p class="muted">No results for this page.</p>';
    }
    return;
  }

  itemsToRender.forEach(m => {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || '';
    img.alt = m.title || '';
    img.title = m.title || '';
    img.style.cursor = 'pointer';
    img.onclick = () => {
      closeSearchModal();
      openDetailsModal(m.id, m);
    };
    box.appendChild(img);
  });

  searchPaging.currentPage = pageNumber;
  updateSearchProgress();
  renderPagination(); // Update pagination controls
}

/**
 * Renders the pagination controls (arrows, page numbers).
 */
function renderPagination() {
  const container = document.getElementById('search-pagination');
  if (!container) {
    console.warn('Missing search pagination container');
    return;
  }

  const totalPages = Math.ceil(searchPaging.matches.length / searchPaging.pageSize);
  const currentPage = searchPaging.currentPage;

  container.innerHTML = ''; // Clear previous pagination

  if (totalPages <= 1) {
    return; // No need for pagination
  }

  const paginationDiv = document.createElement('div');
  paginationDiv.style.display = 'flex';
  paginationDiv.style.justifyContent = 'center';
  paginationDiv.style.alignItems = 'center';
  paginationDiv.style.gap = '8px';
  paginationDiv.style.marginTop = '12px';
  paginationDiv.setAttribute('role', 'navigation');
  paginationDiv.setAttribute('aria-label', 'Search results pagination');

  // Previous Button
  const prevButton = document.createElement('button');
  prevButton.className = 'btn btn-ghost small';
  prevButton.textContent = '←';
  prevButton.setAttribute('aria-label', 'Previous page');
  if (currentPage <= 1) {
    prevButton.disabled = true;
  } else {
    prevButton.onclick = () => gotoSearchPage(currentPage - 1);
  }
  paginationDiv.appendChild(prevButton);

  // Page Numbers (show current page +/- 1)
  const startPage = Math.max(1, currentPage - 1);
  const endPage = Math.min(totalPages, currentPage + 1);

  for (let i = startPage; i <= endPage; i++) {
    const pageButton = document.createElement('button');
    pageButton.className = 'btn small';
    if (i === currentPage) {
      pageButton.classList.add('btn-primary'); // Or add specific CSS for active state
      pageButton.style.background = 'linear-gradient(90deg, var(--accent), var(--accent-2))'; // Example highlight
      pageButton.disabled = true; // Current page button is disabled
      pageButton.setAttribute('aria-current', 'page');
    } else {
      pageButton.onclick = () => gotoSearchPage(i);
    }
    pageButton.textContent = i;
    pageButton.setAttribute('aria-label', `Page ${i}`);
    paginationDiv.appendChild(pageButton);
  }

  // Next Button
  const nextButton = document.createElement('button');
  nextButton.className = 'btn btn-ghost small';
  nextButton.textContent = '→';
  nextButton.setAttribute('aria-label', 'Next page');
  if (currentPage >= totalPages) {
    nextButton.disabled = true;
  } else {
    nextButton.onclick = () => gotoSearchPage(currentPage + 1);
  }
  paginationDiv.appendChild(nextButton);

  container.appendChild(paginationDiv);
}

/**
 * Navigates to a specific page number, loading more results if necessary.
 * @param {number} pageNumber - The 1-based page number to go to.
 */
async function gotoSearchPage(pageNumber) {
  const totalPages = Math.ceil(searchPaging.matches.length / searchPaging.pageSize);
  console.log(`[Search] gotoSearchPage: Requested Page ${pageNumber}, Current Total Pages: ${totalPages}`);

  if (pageNumber < 1) pageNumber = 1;
  // Don't prevent going to a page beyond current total if we haven't finished scanning
  // The render function will handle loading more if needed.

  const desiredCount = pageNumber * searchPaging.pageSize;
  if (searchPaging.matches.length < desiredCount && !searchPaging.finished) {
    searchPaging.loading = true;
    updateSearchProgress();
    try {
      await fillMatchesToCount(desiredCount);
    } catch (err) {
      console.error('[Search] Error in gotoSearchPage while filling matches:', err);
    } finally {
      searchPaging.loading = false;
      updateSearchProgress();
    }
  }

  // Re-calculate totalPages after potential loading
  const newTotalPages = Math.ceil(searchPaging.matches.length / searchPaging.pageSize);
  let finalPageNumber = pageNumber;
  if (pageNumber > newTotalPages && newTotalPages > 0) {
    finalPageNumber = newTotalPages; // Clamp to last available page if requested page was too high
  }

  renderMatchesForPage(finalPageNumber);
}
// --- End Paged Search Logic ---

// --- Genre Helpers ---
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
    if (Array.isArray(item.genres)) {
      item.genres.forEach(g => {
        const key = genreKeyFromName(g);
        if (key) {
          allGenresKeySet.add(key);
          if (!genreDisplayByKey.has(key)) genreDisplayByKey.set(key, g);
        }
      });
    }
  });
}

function populateFilterCheckboxes() {
  const container = document.getElementById('filter-checkboxes');
  if (!container) return;
  container.innerHTML = '';
  if (allGenresKeySet.size === 0) {
    container.innerHTML = '<p class="muted">No genres available.</p>';
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'filter-checkbox-grid';
  const entries = Array.from(allGenresKeySet).map(k => ({ key: k, display: genreDisplayByKey.get(k) || k }));
  entries.sort((a, b) => a.display.localeCompare(b.display));
  entries.forEach(e => {
    const label = document.createElement('label');
    label.className = 'filter-checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = e.key;
    // Set initial checked state based on context (search vs main)
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
      // Update UI to reflect change
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
  // Hint text based on context
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';
  hint.textContent = isSearchOpen ?
    'Select genres to filter search results. Apply filters to see results.' :
    'Select genres to filter the main trending view.';
  container.appendChild(hint);
}

function updateGenreButtonStates() {
  // Update filter checkboxes in filter modal based on current filter state
  const checkboxes = document.querySelectorAll('#filter-checkboxes input[type="checkbox"]');
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';
  checkboxes.forEach(cb => {
    if (isSearchOpen) {
      cb.checked = searchActiveGenreFilters.has(cb.value);
    } else {
      cb.checked = activeGenreFilters.has(cb.value);
    }
  });
}

function toggleGenreFilters(key) {
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';
  if (isSearchOpen) {
    if (searchActiveGenreFilters.has(key)) {
      searchActiveGenreFilters.delete(key);
    } else {
      searchActiveGenreFilters.add(key);
    }
    isSearchFilterActive = searchActiveGenreFilters.size > 0;
    searchPaging.page = 0; // Reset to first page when toggling filters
    searchPaging.currentPage = 1;
    populateSearchResultsFromFilters();
  } else {
    if (activeGenreFilters.has(key)) {
      activeGenreFilters.delete(key);
    } else {
      activeGenreFilters.add(key);
    }
    applyGenreFilters();
  }
  updateGenreButtonStates();
}

function applyGenreFilters() {
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';
  if (isSearchOpen) {
    // If search modal is open, activate search filters and refresh search results
    console.log('[app.js] Filter applied while search modal open — refreshing search results.');
    console.log('[app.js] Current search filters:', Array.from(searchActiveGenreFilters));
    isSearchFilterActive = searchActiveGenreFilters.size > 0;
    searchPaging.page = 0; // Reset to first page when applying filters
    searchPaging.currentPage = 1;
    populateSearchResultsFromFilters();
  } else {
    // If search modal is closed, apply filters to the main trending view
    console.log('[app.js] Filter applied — applying to main trending view.');
    filteredMangaItems = allMangaItems.filter(m => {
      if (activeGenreFilters.size === 0) return true;
      if (!Array.isArray(m.genres) || m.genres.length === 0) return false;
      return m.genres.some(g => {
        const k = genreKeyFromName(g);
        return k && activeGenreFilters.has(k);
      });
    });
    renderTrending(filteredMangaItems);
  }
  updateGenreButtonStates();
}

function clearFiltersFromModal() {
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';
  if (isSearchOpen) {
    // If search modal is open, clear search filters and refresh search results
    console.log('[app.js] Filters cleared while search modal open — refreshing search results.');
    searchActiveGenreFilters.clear();
    isSearchFilterActive = false;
    searchPaging.page = 0; // Reset to first page
    searchPaging.currentPage = 1;
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
// --- End Genre Helpers ---

// --- Pagination (Trending/Updates) ---
async function loadMoreTrending() {
  if (isLoadingTrending) return;
  isLoadingTrending = true;
  const btn = document.getElementById('load-more');
  if (btn) {
    const originalText = btn.textContent;
    btn.textContent = 'Loading...';
    btn.disabled = true;
  }
  try {
    // Simple pagination logic - assumes API supports page numbers
    // You might need to adjust this based on your API's pagination method
    const nextPage = Math.floor(trendingItems.length / 20) + 1; // Assuming 20 items per page
    const data = await getTrending(); // Modify getTrending to accept a page parameter if needed
    if (data && data.length > 0) {
      trendingItems = [...trendingItems, ...data];
      allMangaItems = [...trendingItems, ...featuredItems];
      // --- Update Index ---
      buildGenreIndex(allMangaItems);
      // --- End Update Index ---
      if (activeGenreFilters.size > 0) {
        applyGenreFilters(); // Re-apply filters to include new items
      } else {
        renderTrending(trendingItems);
      }
    } else {
      // No more items
      if (btn) btn.style.display = 'none';
    }
  } catch (e) {
    console.error('loadMoreTrending failed', e);
  } finally {
    isLoadingTrending = false;
    if (btn) {
      btn.textContent = 'Load More';
      btn.disabled = false;
    }
  }
}

async function loadMoreUpdates() {
  if (isLoadingUpdates) return;
  isLoadingUpdates = true;
  const btn = document.getElementById('load-more-updates');
  if (btn) {
    const originalText = btn.textContent;
    btn.textContent = 'Loading...';
    btn.disabled = true;
  }
  try {
    // Simple pagination logic - assumes API supports page numbers
    // You might need to adjust this based on your API's pagination method
    const nextPage = Math.floor(featuredItems.length / 20) + 1; // Assuming 20 items per page
    const data = await getFeatured(); // Modify getFeatured to accept a page parameter if needed
    if (data && data.length > 0) {
      featuredItems = [...featuredItems, ...data];
      allMangaItems = [...trendingItems, ...featuredItems];
       // --- Update Index ---
       buildGenreIndex(allMangaItems);
       // --- End Update Index ---
      renderUpdates(featuredItems);
    } else {
      // No more items
      if (btn) btn.style.display = 'none';
    }
  } catch (e) {
    console.error('loadMoreUpdates failed', e);
  } finally {
    isLoadingUpdates = false;
    if (btn) {
      btn.textContent = 'Load More';
      btn.disabled = false;
    }
  }
}
// --- End Pagination (Trending/Updates) ---

// --- Reader ---
async function loadChapterPages(mangaId, chapterId) {
  const arr = await getChapterPages(mangaId, chapterId);
  currentPages = (Array.isArray(arr) ? arr : []);
  currentPageIndex = 0; // Reset to first page
  updateReaderImage();
}

function updateReaderImage() {
  const stage = document.querySelector('#reader-modal .reader-stage');
  if (!stage) return;
  stage.innerHTML = '';
  if (currentPages.length === 0) {
    stage.innerHTML = '<p class="muted">No pages to display.</p>';
    return;
  }
  if (currentPageIndex >= currentPages.length) {
    stage.innerHTML = '<p class="muted">End of chapter.</p>';
    return;
  }
  const img = document.createElement('img');
  img.id = 'reader-image';
  img.src = currentPages[currentPageIndex];
  img.alt = `Page ${currentPageIndex + 1}`;
  img.style.maxWidth = '100%';
  img.style.height = 'auto';
  img.style.display = 'block';
  stage.appendChild(img);
}

function changeChapter() {
  const raw = document.getElementById('chapter')?.value;
  if (!raw) return;
  const c = JSON.parse(raw);
  loadChapterPages(c.mangaId, c.chapterId);
}

function openDedicatedReader() {
  const sel = document.getElementById('chapter');
  const raw = sel?.value;
  if (!raw) return showStatus('No chapter selected', true);
  const { mangaId, chapterId } = JSON.parse(raw);
  const basePath = window.location.pathname.includes('/docs/') ?
    window.location.origin + '/mnm-solutions/docs/' :
    window.location.origin + '/mnm-solutions/';
  const url = new URL('read.html', basePath);
  url.searchParams.set('mangaId', mangaId);
  url.searchParams.set('chapterId', chapterId);
  url.searchParams.set('page', 0);
  window.location.href = url.toString();
}
// --- End Reader ---

// --- Search Populate (Entry Point for Filtered Search) ---
async function populateSearchResultsFromFilters() {
  const input = document.getElementById('search-input');
  const q = input ? input.value.trim() : '';
  const box = document.getElementById('search-results');
  if (!box) return;

  let items = [];
  if (q) {
    items = await searchManga(q);
  } else {
    items = [...allMangaItems];
  }

  // Update active filters display
  const activeFiltersDisplay = document.getElementById('search-active-filters');
  if (activeFiltersDisplay) {
    if (searchActiveGenreFilters.size > 0) {
      const names = Array.from(searchActiveGenreFilters).map(k => genreDisplayByKey.get(k) || k).join(', ');
      activeFiltersDisplay.textContent = `Filters: ${names}`;
    } else {
      activeFiltersDisplay.textContent = '';
    }
  }

  // --- Paged Path for Genre Filtering ---
  if (isSearchFilterActive && searchActiveGenreFilters.size > 0) {
    console.log('[Search] Applying paged genre filters...');
    // Reset matches and candidates for new filter application
    searchPaging.sourceItems = items;
    searchPaging.matches = [];
    searchPaging.candidates = [];
    searchPaging.scanIndex = 0;
    searchPaging.page = 0; // Reset internal page counter
    searchPaging.currentPage = 1; // Reset displayed page number
    searchPaging.finished = false;
    searchPaging.loading = false;

    // Hide the old "Load More" button if it exists
    const loadBtn = document.getElementById('search-load-more');
    if (loadBtn) loadBtn.style.display = 'none';

    // Render the first page of results
    await renderMatchesForPage(1);

    return; // Exit early, paged path handled
  }
  // --- End Paged Path ---

  // --- Fallback: No active filters or only search term ---
  // This would revert to the old non-paged display if needed, but with filters active, paged is used.
  // For simplicity, let's clear and show a message or handle differently if filters are off but search is on.
  if (!isSearchFilterActive && q) {
     // Just search term, no filters - could show all results, or implement simple paging here too.
     // For now, let's just render the search results directly (old way) if no filters.
     box.innerHTML = '';
     if (!items || items.length === 0) {
         box.innerHTML = '<p class="muted">No results found.</p>';
         return;
     }
     items.forEach(m => {
         const img = document.createElement('img');
         img.loading = 'lazy';
         img.src = m.image || '';
         img.alt = m.title || '';
         img.title = m.title || '';
         img.style.cursor = 'pointer';
         img.onclick = () => {
             closeSearchModal();
             openDetailsModal(m.id, m);
         };
         box.appendChild(img);
     });
     // Hide pagination if shown
     const paginationContainer = document.getElementById('search-pagination');
     if (paginationContainer) paginationContainer.innerHTML = '';
     updateSearchProgress();
     const loadBtn = document.getElementById('search-load-more');
     if (loadBtn) loadBtn.style.display = 'none';
  } else {
      // Fallback if somehow neither path is taken correctly
      box.innerHTML = '<p class="muted">No results to display.</p>';
      const paginationContainer = document.getElementById('search-pagination');
      if (paginationContainer) paginationContainer.innerHTML = '';
      updateSearchProgress();
      const loadBtn = document.getElementById('search-load-more');
      if (loadBtn) loadBtn.style.display = 'none';
  }
  // --- End Fallback ---
}
// --- End Search Populate ---

// --- Init ---
async function init() {
  try {
    // Ensure document.body can receive focus for fallback scenarios (Accessibility)
    if (document.body.tabIndex === undefined || document.body.tabIndex < 0) {
        document.body.tabIndex = -1;
        document.body.style.outline = 'none'; // Visually hide focus outline if body gets focus
    }

    loadGenres().catch(() => {});
    const [t, f] = await Promise.all([getTrending(), getFeatured()]);
    trendingItems = Array.isArray(t) ? t : [];
    featuredItems = Array.isArray(f) ? f : [];
    allMangaItems = [...trendingItems, ...featuredItems];
    // --- Build Initial Index ---
    buildGenreIndex(allMangaItems);
    // --- End Build Initial Index ---
    if (allGenresKeySet.size === 0) populateGenresFromMangaItems();
    renderTrending(allMangaItems);
    renderUpdates(featuredItems);
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
// window.searchMangaDebounced = performSearch; // Already assigned above
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.changeChapter = function(){
  const raw = document.getElementById('chapter')?.value;
  if(!raw) return;
  const c = JSON.parse(raw);
  loadChapterPages(c.mangaId, c.chapterId);
};
window.loadMoreTrending = loadMoreTrending;
window.loadMoreUpdates = loadMoreUpdates;
window.loadMoreSearch = async function() {
  // This function might not be used directly anymore with paged search,
  // but kept for potential compatibility or if "Load More" is needed elsewhere.
  // For the paged search, navigation is handled by gotoSearchPage/renderMatchesForPage.
  console.log('[Search] loadMoreSearch called - this might be deprecated with paged search.');
  const loadBtn = document.getElementById('search-load-more');
  if (loadBtn) {
    const spinner = document.getElementById('search-load-more-spinner');
    const text = document.getElementById('search-load-more-text');
    if (spinner) spinner.style.display = 'inline-block';
    if (text) text.textContent = 'Loading…';
    loadBtn.disabled = true;
  }
  try {
    if (typeof window._loadNextSearchPage === 'function') {
      await window._loadNextSearchPage();
    } else {
      // If paging not initialized, call populate to init
      await populateSearchResultsFromFilters();
    }
  } finally {
    const loadBtn = document.getElementById('search-load-more');
    const spinner = document.getElementById('search-load-more-spinner');
    const text = document.getElementById('search-load-more-text');
    if (spinner) spinner.style.display = 'none';
    if (text) text.textContent = 'Load more';
    if (loadBtn) loadBtn.disabled = false;
    updateSearchProgress();
  }
};
window.openDedicatedReader = function(){
  const sel = document.getElementById('chapter');
  const raw = sel?.value;
  if(!raw) return showStatus('No chapter selected', true);
  const {mangaId, chapterId} = JSON.parse(raw);
  const basePath = window.location.pathname.includes('/docs/') ?
    window.location.origin + '/mnm-solutions/docs/' :
    window.location.origin + '/mnm-solutions/';
  const url = new URL('read.html', basePath);
  url.searchParams.set('mangaId', mangaId);
  url.searchParams.set('chapterId', chapterId);
  url.searchParams.set('page', 0);
  window.location.href = url.toString();
};
window.toggleGenreFilters = toggleGenreFilters;
window.clearGenreFilters = clearFiltersFromModal;
window.openDetailsModal = openDetailsModal;
window.closeDetailsModal = closeDetailsModal;
window.openDedicatedReaderFromDetails = openDedicatedReaderFromDetails;
window.openFilterModal = openFilterModal;
window.closeFilterModal = closeFilterModal;
// --- Updated applyFilterFromModal function ---
// This function is called when the user clicks "Apply" in the filter modal.
function applyFilterFromModal() {
  // Use the new accessibility helper to close the filter modal
  closeModalById("filter-modal");

  // --- Logic previously inside applyFilterFromModal ---
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';

  if (isSearchOpen) {
    // If search modal is open, activate search filters and refresh search results
    console.log('[app.js] Filter applied while search modal open — refreshing search results.');
    console.log('[app.js] Current search filters:', Array.from(searchActiveGenreFilters));
    isSearchFilterActive = searchActiveGenreFilters.size > 0;
    searchPaging.page = 0; // Reset to first page when applying filters
    searchPaging.currentPage = 1;
    populateSearchResultsFromFilters();
  } else {
    // If search modal is closed, apply filters to the main trending view
    console.log('[app.js] Filter applied — applying to main trending view.');
    if (typeof applyGenreFilters === 'function') {
        applyGenreFilters();
    } else {
        console.warn('[app.js] applyGenreFilters function not found. Falling back to basic filter logic.');
        filteredMangaItems = allMangaItems.filter(m => {
          if (activeGenreFilters.size === 0) return true;
          if (!Array.isArray(m.genres) || m.genres.length === 0) return false;
          return m.genres.some(g => {
            const k = genreKeyFromName(g);
            return k && activeGenreFilters.has(k);
          });
        });
        renderTrending(filteredMangaItems);
    }
  }
  // --- End Logic ---
}
// --- Ensure it's exposed to the window object ---
window.applyFilterFromModal = applyFilterFromModal;
window.closeReader = closeReader;
// --- End Init ---
