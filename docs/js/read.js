// js/read.js - Dedicated Manga Reader
// Uses the same proxy logic as app.js

const API_BASE = (window.MR_BASE_OVERRIDE ? window.MR_BASE_OVERRIDE : 'https://gomanga-api.vercel.app/api').replace(/\/+$/, '');

let currentPages = [];
let currentPageIndex = 0;
let zoomLevel = 1;
let isFullscreen = false;

// Helper: rewrite image URLs to go through worker proxy correctly
// This MUST match the proxifyUrl function in app.js
function proxifyUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.startsWith('/api')) {
      path = path.substring(4);
    }
    // Keep search parameters
    const fullPath = path + (u.search || '');
    return `${API_BASE}${fullPath}`;
  } catch(e) {
    return url;
  }
}

// Generic API fetcher, using the proxy
async function apiGet(path, opts = {}){
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const url = `${API_BASE}${normalizedPath}`;
  console.log('[read.js] Fetching (via proxy):', url);

  try {
    const res = await fetch(url, Object.assign({
      cache: 'no-cache',
      mode: 'cors',
      headers: { 'Accept': 'application/json' }
    }, opts));
    if (!res.ok) {
      const txt = await res.text().catch(()=>'<no-body>');
      const err = `HTTP ${res.status} ${res.statusText} - ${url} - ${txt.slice(0,200)}`;
      console.error('[read.js] API Error:', err);
      throw new Error(err);
    }
    const json = await res.json().catch(async e=>{
      const txt = await res.text().catch(()=>'<no-body>');
      const msg = 'Invalid JSON: ' + txt.slice(0,200);
      console.error('[read.js] JSON Error:', msg);
      throw new Error(msg);
    });
    console.log('[read.js] API Response:', url, json);
    return json;
  } catch (err) {
    console.error('[read.js] apiGet failed', err);
    alert('Failed to load content. Check console for details.');
    throw err;
  }
}

// Fetch chapter page URLs
async function getChapterPages(mangaId, chapterId) {
  if (!mangaId || !chapterId) {
    console.warn('[read.js] Missing mangaId or chapterId');
    return [];
  }
  try {
    // This call goes through the proxy
    const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}/${encodeURIComponent(chapterId)}`);
    if (!data.imageUrls || !Array.isArray(data.imageUrls)) {
      console.warn('[read.js] Invalid API response for chapter pages', data);
      return [];
    }
    // Proxify the image URLs before returning
    return data.imageUrls.map(url => proxifyUrl(url));
  } catch (e) {
    console.warn('[read.js] getChapterPages error', e);
    alert('Failed to load chapter pages. Check console for details.');
    return [];
  }
}

// Update the image displayed in the reader
function updateReaderImage() {
  const img = document.getElementById('reader-image');
  if (!img) {
    console.warn('[read.js] Reader image element not found');
    return;
  }
  const src = currentPages[currentPageIndex] || '';
  console.log('[read.js] Updating image to:', src);
  img.src = src;
  img.alt = `Manga Page ${currentPageIndex + 1}`;
  // Apply zoom
  img.style.transform = `scale(${zoomLevel})`;
  img.style.transformOrigin = 'top center';
}

// Navigation
function prevPage() {
  if (currentPages.length === 0) return;
  currentPageIndex = Math.max(0, currentPageIndex - 1);
  console.log('[read.js] Navigating to previous page:', currentPageIndex);
  updateReaderImage();
}

function nextPage() {
  if (currentPages.length === 0) return;
  currentPageIndex = Math.min(currentPages.length - 1, currentPageIndex + 1);
  console.log('[read.js] Navigating to next page:', currentPageIndex);
  updateReaderImage();
}

// Zoom
function zoomIn() {
  zoomLevel = Math.min(zoomLevel + 0.25, 3);
  console.log('[read.js] Zooming in. New level:', zoomLevel);
  updateReaderImage();
}

function zoomOut() {
  zoomLevel = Math.max(zoomLevel - 0.25, 0.5);
  console.log('[read.js] Zooming out. New level:', zoomLevel);
  updateReaderImage();
}

// Fullscreen
function toggleFullscreen() {
  const container = document.getElementById('reader-container');
  if (!container) {
    console.warn('[read.js] Reader container not found');
    return;
  }

  if (!isFullscreen) {
    container.classList.add('fullscreen');
    document.body.style.overflow = 'hidden';
    console.log('[read.js] Entered fullscreen mode');
  } else {
    container.classList.remove('fullscreen');
    document.body.style.overflow = '';
    console.log('[read.js] Exited fullscreen mode');
  }
  isFullscreen = !isFullscreen;
}

// Initialize reader
async function initReader() {
  console.log('[read.js] Initializing reader...');
  const params = new URLSearchParams(window.location.search);
  const mangaId = params.get('mangaId');
  const chapterId = params.get('chapterId');
  const pageParam = params.get('page');

  if (!mangaId || !chapterId) {
    const msg = 'Invalid reader parameters. Missing mangaId or chapterId.';
    console.error('[read.js]', msg);
    alert(msg);
    // Don't go back immediately, let user see the error
    // window.history.back();
    return;
  }

  currentPageIndex = parseInt(pageParam || '0', 10) || 0;
  console.log('[read.js] Parameters - Manga:', mangaId, 'Chapter:', chapterId, 'Page:', currentPageIndex);

  try {
    currentPages = await getChapterPages(mangaId, chapterId);
    if (currentPages.length === 0) {
      const msg = 'No pages found for this chapter, or failed to load them.';
      console.warn('[read.js]', msg);
      alert(msg);
      return;
    }
    console.log(`[read.js] Loaded ${currentPages.length} pages.`);
    updateReaderImage();
  } catch (e) {
    console.error('[read.js] Failed to initialize reader', e);
    alert('Failed to load chapter. Please try again. Check console for details.');
  }
}

// Wait for DOM and start
document.addEventListener('DOMContentLoaded', () => {
  console.log('[read.js] DOM Content Loaded. Starting init...');
  initReader();
});

// Expose functions for inline onclick attributes
window.prevPage = prevPage;
window.nextPage = nextPage;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.toggleFullscreen = toggleFullscreen;
