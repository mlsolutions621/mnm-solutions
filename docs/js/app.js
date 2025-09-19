/* js/app.js - MangaStream Frontend (Remodified)
- Accessibility-friendly modal open/close helpers
- Client-side genre index for fast genre filtering
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

// Search paging state
let searchPaging = {
  sourceItems: [],
  matches: [],
  candidates: [],
  scanIndex: 0,
  page: 0,
  finished: false,
  loading: false
};

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
  searchPaging = { sourceItems: [], matches: [], candidates: [], scanIndex: 0, page: 0, finished: false, loading: false };
  isSearchFilterActive = searchActiveGenreFilters.size > 0;
  updateSearchProgress();
  const loadBtn = document.getElementById('search-load-more');
  if (loadBtn) loadBtn.style.display = 'none';

  // Use accessibility helper
  openModalById("search-modal", "#search-input");
}

function closeSearchModal() {
  // Reset search state before closing for a clean next-open
  isSearchFilterActive = false;
  searchActiveGenreFilters.clear();
  searchPaging = { sourceItems: [], matches: [], candidates: [], scanIndex: 0, page: 0, finished: false, loading: false };
  const box = document.getElementById('search-results');
  if (box) box.innerHTML = '';
  const prog = document.getElementById('search-progress');
  if (prog) prog.textContent = '';

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
      return;
    }
    isLoadingSearch = true;
    try {
      // Reset paging for new search term
      searchPaging = { sourceItems: [], matches: [], candidates: [], scanIndex: 0, page: 0, finished: false, loading: false };
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
  if (searchPaging.finished) {
    el.textContent = `Showing ${searchPaging.matches.length} result${searchPaging.matches.length !== 1 ? 's' : ''}.`;
  } else if (searchPaging.matches.length > 0) {
    el.textContent = `Showing ${searchPaging.matches.length} result${searchPaging.matches.length !== 1 ? 's' : ''}...`;
  } else if (isLoadingSearch || searchPaging.loading) {
    el.textContent = 'Searching...';
  } else {
    el.textContent = '';
  }
}

// --- Optimized populateSearchResultsFromFilters using Index ---
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

  // --- Fast Path for Genre Filtering ---
  if (isSearchFilterActive && searchActiveGenreFilters.size > 0) {
    console.log('[Search] Applying genre filters using index...');
    const activeFiltersArray = Array.from(searchActiveGenreFilters);

    // 1. Compute Candidate Manga IDs using Index Intersection (AND logic)
    let candidateIdsSet = null;
    for (const genreKey of activeFiltersArray) {
      const idsForGenre = genreIndex.get(genreKey) || new Set();
      if (candidateIdsSet === null) {
        candidateIdsSet = new Set(idsForGenre); // Initialize with first set
      } else {
        // Intersect with subsequent sets (manga must match ALL selected genres)
        candidateIdsSet = new Set([...candidateIdsSet].filter(id => idsForGenre.has(id)));
      }
      // Optimization: Early exit if intersection becomes empty
      if (candidateIdsSet.size === 0) break;
    }

    // If no candidates after intersection, show empty results
    if (!candidateIdsSet || candidateIdsSet.size === 0) {
       box.innerHTML = '<p class="muted">No manga found matching all selected genres.</p>';
       // Hide load more, update progress, etc.
       const loadBtn = document.getElementById('search-load-more');
       if (loadBtn) loadBtn.style.display = 'none';
       updateSearchProgress(); // Implement this if needed
       return;
    }

    console.log('[Search] Candidate IDs identified:', candidateIdsSet.size);

    // 2. Separate Candidates into Immediate (inline genres) and Deferred (need details)
    const immediateMatches = []; // Items with inline genres that match
    const deferredCandidateIds = new Set(); // IDs of items lacking inline genres but are candidates

    for (const item of items) { // Iterate items from search results or allMangaItems
      if (!candidateIdsSet.has(item.id)) continue; // Not a candidate, skip

      // Check if item has inline genres
      if (Array.isArray(item.genres) && item.genres.length > 0) {
        // Check if its inline genres satisfy the filters
        const itemGenreKeys = item.genres.map(g => genreKeyFromName(g)).filter(Boolean);
        const matchesFilter = activeFiltersArray.every(filterKey => itemGenreKeys.includes(filterKey));
        if (matchesFilter) {
          immediateMatches.push(item);
        }
        // If it matches the candidate ID but doesn't match filter via inline genres,
        // it means index was wrong or genres changed - less likely, but possible data inconsistency.
        // We could log this or handle differently, but usually index reflects inline data.
      } else {
        // Item lacks inline genres but is a candidate ID -> needs detail fetch
        deferredCandidateIds.add(item.id);
      }
    }

    console.log('[Search] Immediate matches:', immediateMatches.length, 'Deferred candidates:', deferredCandidateIds.size);

    // 3. Render Immediate Matches First (provides instant feedback)
    renderSearchResults(immediateMatches, box); // Helper function to render an array of items

    // 4. Fetch Details for Deferred Candidates (if any)
    if (deferredCandidateIds.size > 0) {
      // Optional: Show a "Loading more..." indicator appended to the box
      const loadingIndicator = document.createElement('p');
      loadingIndicator.id = 'deferred-loading-indicator';
      loadingIndicator.className = 'muted';
      loadingIndicator.textContent = 'Loading more matching results...';
      box.appendChild(loadingIndicator);

      (async () => {
        try {
          // Fetch details concurrently with controlled limit
          const detailsMap = await fetchDetailsConcurrent(Array.from(deferredCandidateIds), { concurrency: 6 }); // Use helper below

          const deferredMatches = [];
          // Filter fetched details by genre
          for (const [id, details] of detailsMap.entries()) {
            if (!details || !Array.isArray(details.genres)) continue;
            const detailGenreKeys = details.genres.map(g => genreKeyFromName(g)).filter(Boolean);
            const matchesFilter = activeFiltersArray.every(filterKey => detailGenreKeys.includes(filterKey));
            if (matchesFilter) {
              deferredMatches.push(details);
            }
          }

          console.log('[Search] Deferred matches found:', deferredMatches.length);
          // Render the deferred matches (append them)
          renderSearchResults(deferredMatches, box);

        } catch (err) {
          console.error('[Search] Error fetching deferred details:', err);
          // Optional: Update UI to show error for deferred loading
          const errorEl = document.createElement('p');
          errorEl.className = 'muted';
          errorEl.textContent = 'Failed to load some additional results.';
          box.appendChild(errorEl);
        } finally {
          // Remove loading indicator
          const indicator = document.getElementById('deferred-loading-indicator');
          if (indicator) indicator.remove();
          // Hide load more button if this was a one-off load
          const loadBtn = document.getElementById('search-load-more');
          if (loadBtn) loadBtn.style.display = 'none';
           updateSearchProgress();
        }
      })();
    } else {
        // No deferred items, hide load more if shown
        const loadBtn = document.getElementById('search-load-more');
        if (loadBtn) loadBtn.style.display = 'none';
        updateSearchProgress();
    }

    return; // Exit early, fast path handled
  }
  // --- End Fast Path ---

  // --- Fallback: No active filters or only search term ---
  // ... (Your existing logic for rendering 'items' without genre filtering using renderSearchResults) ...
  renderSearchResults(items, box);
  const loadBtn = document.getElementById('search-load-more');
  if (loadBtn) loadBtn.style.display = 'none';
  updateSearchProgress();
  // --- End Fallback ---
}

/**
 * Helper to render an array of manga items into the search results container.
 * @param {Array} items - Array of manga item objects.
 * @param {HTMLElement} container - The search results container element.
 */
function renderSearchResults(items, container) {
    if (!container) return;
    // If appending, don't clear innerHTML. If replacing initial content, clear it first.
    // Assuming we append deferred results, we might not clear here if called after immediate render.
    // Let's assume this function handles both: clear if empty, append otherwise.
    // For simplicity here, let's assume it's used to render a batch:
    if (container.innerHTML === '' || container.children.length === 0) {
         container.innerHTML = ''; // Clear if explicitly needed
    }
    if (!items || items.length === 0) {
         // Only show 'no results' if container is effectively empty and we are rendering the first batch
         if (container.innerHTML === '') {
             container.innerHTML = '<p class="muted">No results found.</p>';
         }
         return;
    }

    items.forEach(m => {
        // Avoid duplicate rendering if ID already exists (could happen with append logic)
        // Simple check, could be more robust
        if (container.querySelector(`img[data-manga-id="${m.id}"]`)) return;

        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = m.image || '';
        img.alt = m.title || '';
        img.title = m.title || '';
        img.style.cursor = 'pointer';
        // Store ID for potential duplicate check
        img.setAttribute('data-manga-id', m.id);
        img.onclick = () => {
            closeSearchModal();
            openDetailsModal(m.id, m);
        };
        container.appendChild(img);
    });
}
// --- End Search and Filter ---

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

// --- Pagination ---
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
// --- End Pagination ---

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
// It should close the filter modal and apply the selected filters.
function applyFilterFromModal() {
  // Use the new accessibility helper to close the filter modal
  closeModalById("filter-modal"); // This replaces the old closeFilterModal()

  // --- Logic previously inside applyFilterFromModal ---
  const searchModal = document.getElementById('search-modal');
  const isSearchOpen = searchModal && window.getComputedStyle(searchModal).display !== 'none';

  if (isSearchOpen) {
    // If search modal is open, activate search filters and refresh search results
    console.log('[app.js] Filter applied while search modal open — refreshing search results.');
    console.log('[app.js] Current search filters:', Array.from(searchActiveGenreFilters));
    isSearchFilterActive = searchActiveGenreFilters.size > 0;
    searchPaging.page = 0; // Reset to first page when applying filters
    populateSearchResultsFromFilters();
  } else {
    // If search modal is closed, apply filters to the main trending view
    console.log('[app.js] Filter applied — applying to main trending view.');
    // Assuming applyGenreFilters exists and handles main view filtering
    if (typeof applyGenreFilters === 'function') {
        applyGenreFilters();
    } else {
        console.warn('[app.js] applyGenreFilters function not found. Falling back to basic filter logic.');
        // Basic fallback logic if applyGenreFilters is missing
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
  // Note: updateGenreButtonStates() is not needed here as the modal is closing.
  // It's called when the modal opens or filters are cleared.
  // --- End Logic ---
}
// --- Ensure it's exposed to the window object ---
window.applyFilterFromModal = applyFilterFromModal; // <-- MAKE SURE THIS LINE IS PRESENT
window.closeReader = closeReader;
// --- End Init ---
