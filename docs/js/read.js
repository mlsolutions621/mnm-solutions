// js/read.js - Dedicated Manga Reader (Long Strip/Webtoon Style)
// Uses the same proxy logic as app.js

const API_BASE = (window.MR_BASE_OVERRIDE ? window.MR_BASE_OVERRIDE : 'https://gomanga-api.vercel.app/api').replace(/\/+$/, '');

let currentPages = []; // This will now hold URLs for ALL images in the chapter
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

// --- NEW FUNCTION: Render all images in a long strip ---
function renderLongStrip(imageUrls) {
  const container = document.getElementById('reader-content');
  if (!container) {
    console.error('[read.js] Reader content container not found');
    return;
  }

  // Clear previous content
  container.innerHTML = '';

  // Create a wrapper div for all images
  const stripWrapper = document.createElement('div');
  stripWrapper.id = 'manga-strip';
  stripWrapper.style.display = 'flex';
  stripWrapper.style.flexDirection = 'column';
  stripWrapper.style.alignItems = 'center';
  stripWrapper.style.gap = '10px'; // Space between images

  imageUrls.forEach((url, index) => {
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Page ${index + 1}`;
    img.style.width = '100%';
    img.style.maxWidth = '1000px'; // Optional: Cap the width
    img.style.height = 'auto';
    img.style.borderRadius = '8px';
    img.style.display = 'block';
    img.loading = 'lazy'; // Lazy load for performance
    stripWrapper.appendChild(img);
  });

  container.appendChild(stripWrapper);
  console.log(`[read.js] Rendered ${imageUrls.length} images in long strip.`);
}

// --- NEW FUNCTION: Zoom for Long Strip ---
function setStripZoom(level) {
    const strip = document.getElementById('manga-strip');
    if (strip) {
        strip.style.transform = `scale(${level})`;
        strip.style.transformOrigin = 'top center';
        // Adjust container overflow if needed
        const container = document.getElementById('reader-content');
        if (container) {
            container.style.overflowX = level > 1 ? 'auto' : 'hidden';
        }
    }
}

// --- NEW VARIABLES for Strip Zoom ---
let stripZoomLevel = 1;

function zoomIn() {
    stripZoomLevel = Math.min(stripZoomLevel + 0.25, 3);
    console.log('[read.js] Zooming strip in. New level:', stripZoomLevel);
    setStripZoom(stripZoomLevel);
}

function zoomOut() {
    stripZoomLevel = Math.max(stripZoomLevel - 0.25, 0.5);
    console.log('[read.js] Zooming strip out. New level:', stripZoomLevel);
    setStripZoom(stripZoomLevel);
}

// Fullscreen (logic remains the same)
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
  console.log('[read.js] Initializing reader (Long Strip Mode)...');
  const params = new URLSearchParams(window.location.search);
  const mangaId = params.get('mangaId');
  const chapterId = params.get('chapterId');

  if (!mangaId || !chapterId) {
    const msg = 'Invalid reader parameters. Missing mangaId or chapterId.';
    console.error('[read.js]', msg);
    alert(msg);
    return;
  }

  console.log('[read.js] Parameters - Manga:', mangaId, 'Chapter:', chapterId);

  try {
    currentPages = await getChapterPages(mangaId, chapterId);
    if (currentPages.length === 0) {
      const msg = 'No pages found for this chapter, or failed to load them.';
      console.warn('[read.js]', msg);
      alert(msg);
      return;
    }
    console.log(`[read.js] Loaded ${currentPages.length} pages.`);
    // Instead of loading one image, render all in a strip
    renderLongStrip(currentPages);
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
// Note: prevPage and nextPage are no longer relevant in this mode
// window.prevPage = prevPage; // Removed
// window.nextPage = nextPage; // Removed
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.toggleFullscreen = toggleFullscreen;
