// js/read.js - Dedicated Manga Reader (Long Strip/Webtoon Style with Chapter Selector)
// Uses the same proxy logic as app.js

// --- Configuration and Globals ---
// IMPORTANT: Fix the trailing spaces in the default API URL
const API_BASE = (window.MR_BASE_OVERRIDE
  ? window.MR_BASE_OVERRIDE.trim() // Trim spaces from the override URL
  : 'https://gomanga-api.vercel.app/api' // Fixed default URL
).replace(/\/+$/, '');

let currentMangaId = null;
let currentChapterId = null;
let mangaChapters = []; // List of chapters for the current manga
let currentPages = []; // Stores ALL image URLs for the *current* chapter
let isFullscreen = false;
let stripZoomLevel = 1;

// --- Helper: rewrite image URLs to go through worker proxy correctly ---
function proxifyUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.startsWith('/api')) {
      path = path.substring(4);
    }
    const fullPath = path + (u.search || '');
    return `${API_BASE}${fullPath}`;
  } catch (e) {
    console.warn('[read.js] Failed to proxify URL:', url, e);
    return url;
  }
}

// --- Generic API fetcher, using the proxy ---
async function apiGet(path, opts = {}) {
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
      const txt = await res.text().catch(() => '<no-body>');
      const err = `HTTP ${res.status} ${res.statusText} - ${url} - ${txt.slice(0, 200)}`;
      console.error('[read.js] API Error:', err);
      throw new Error(err);
    }
    const json = await res.json().catch(async e => {
      const txt = await res.text().catch(() => '<no-body>');
      const msg = 'Invalid JSON: ' + txt.slice(0, 200);
      console.error('[read.js] JSON Error:', msg);
      throw new Error(msg);
    });
    console.log('[read.js] API Response:', url /*, json*/);
    return json;
  } catch (err) {
    console.error('[read.js] apiGet failed', err);
    throw err;
  }
}

// --- Fetch chapter page URLs ---
async function getChapterPages(mangaId, chapterId) {
  if (!mangaId || !chapterId) {
    console.warn('[read.js] getChapterPages: Missing mangaId or chapterId');
    return [];
  }
  try {
    const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}/${encodeURIComponent(chapterId)}`);
    if (!data.imageUrls || !Array.isArray(data.imageUrls)) {
      console.warn('[read.js] Invalid API response for chapter pages', data);
      return [];
    }
    return data.imageUrls.map(url => proxifyUrl(url));
  } catch (e) {
    console.warn('[read.js] getChapterPages error', e);
    return [];
  }
}

// --- Fetch manga details (for chapters list) ---
async function getMangaDetails(mangaId) {
  if (!mangaId) {
    console.warn('[read.js] getMangaDetails: Missing mangaId');
    return null;
  }
  try {
    const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}`);
    if (!data.id) {
      console.warn('[read.js] Manga not found or invalid API response', data);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[read.js] getMangaDetails error', e);
    return null;
  }
}

// --- MODIFIED: Render all images in a long strip ---
function renderLongStrip(imageUrls) {
  const container = document.getElementById('reader-content');
  if (!container) {
    console.error('[read.js] Reader content container not found');
    alert('Reader error: Content container missing.');
    return;
  }

  // Clear previous content (including the placeholder img)
  container.innerHTML = '';

  if (imageUrls.length === 0) {
    container.innerHTML = '<p style="color: red;">No images found for this chapter.</p>';
    return;
  }

  // Create a wrapper div for all images
  const stripWrapper = document.createElement('div');
  stripWrapper.id = 'manga-strip';
  // --- Styles for Long Strip ---
  stripWrapper.style.display = 'flex';
  stripWrapper.style.flexDirection = 'column';
  stripWrapper.style.alignItems = 'center';
  stripWrapper.style.gap = '15px'; // Space between images
  // ----------------------------

  imageUrls.forEach((url, index) => {
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Page ${index + 1}`;
    // --- Styles for Individual Images ---
    img.style.width = '100%';
    img.style.maxWidth = '1000px'; // Optional: Cap the width
    img.style.height = 'auto';
    img.style.borderRadius = '8px';
    img.style.display = 'block';
    // ------------------------------------
    img.loading = 'lazy'; // Lazy load for performance
    stripWrapper.appendChild(img);
  });

  container.appendChild(stripWrapper);
  console.log(`[read.js] Rendered ${imageUrls.length} images in long strip.`);
  // Apply current zoom level after rendering
  setStripZoom(stripZoomLevel);
}


// --- Populate the chapter selector dropdown ---
function populateChapterSelector(chaptersArray, currentChapterId) {
  const selector = document.getElementById('chapter-selector');
  const titleDisplay = document.getElementById('manga-title-display');
  if (!selector) {
    console.error('[read.js] Chapter selector element not found');
    return;
  }

  selector.innerHTML = '';
  selector.disabled = true; // Disable while populating

  if (!chaptersArray || chaptersArray.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No chapters available';
    selector.appendChild(option);
    if (titleDisplay) titleDisplay.textContent = 'Unknown Manga';
    return;
  }

  // Reverse chapters to show latest first, like in app.js popup
  const reversedChapters = [...chaptersArray].reverse();

  reversedChapters.forEach((ch) => {
    const option = document.createElement('option');
    option.value = ch.chapterId;
    option.textContent = `Ch. ${ch.chapterId}`;
    if (ch.chapterId == currentChapterId) {
      option.selected = true;
    }
    selector.appendChild(option);
  });

  selector.disabled = false;
  console.log(`[read.js] Chapter selector populated with ${reversedChapters.length} chapters.`);
}

// --- MODIFIED: Zoom for Long Strip ---
function setStripZoom(level) {
  const strip = document.getElementById('manga-strip');
  if (strip) {
    strip.style.transform = `scale(${level})`;
    strip.style.transformOrigin = 'top center';
    const container = document.getElementById('reader-content');
    if (container) {
      // Allow horizontal scroll if zoomed in, always allow vertical
      container.style.overflowX = level > 1 ? 'auto' : 'hidden';
      container.style.overflowY = 'auto'; // Ensure vertical scrolling
    }
  }
}

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

// --- Fullscreen ---
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

// --- Chapter Navigation using Selector ---
function prevChapter() {
  const selector = document.getElementById('chapter-selector');
  if (!selector || selector.disabled) return;

  const currentSelectedIndex = selector.selectedIndex;
  // List is reversed in the selector, so Prev Chapter is the *next* option
  if (currentSelectedIndex < selector.options.length - 1) {
    selector.selectedIndex = currentSelectedIndex + 1;
    onChapterSelect();
  } else {
    alert("This is the first chapter.");
  }
}

function nextChapter() {
  const selector = document.getElementById('chapter-selector');
  if (!selector || selector.disabled) return;

  const currentSelectedIndex = selector.selectedIndex;
  // List is reversed in the selector, so Next Chapter is the *previous* option
  if (currentSelectedIndex > 0) {
    selector.selectedIndex = currentSelectedIndex - 1;
    onChapterSelect();
  } else {
    alert("This is the last chapter.");
  }
}

// Handler for when user selects a chapter from the dropdown
async function onChapterSelect() {
  const selector = document.getElementById('chapter-selector');
  if (!selector || selector.disabled) return;

  const selectedOption = selector.options[selector.selectedIndex];
  const newChapterId = selectedOption.value;

  if (!newChapterId || newChapterId === currentChapterId) {
    return;
  }

  // Update global state
  currentChapterId = newChapterId;

  // Update URL without reloading the whole page
  const url = new URL(window.location);
  url.searchParams.set('chapterId', currentChapterId);
  // Reset page param when changing chapters
  url.searchParams.delete('page');
  window.history.replaceState({}, '', url);

  // Reload the chapter content
  await loadCurrentChapter();
}

// --- MODIFIED: Load the currently selected chapter (for Long Strip) ---
async function loadCurrentChapter() {
  if (!currentMangaId || !currentChapterId) {
    console.error('[read.js] Cannot load chapter: Missing mangaId or chapterId');
    return;
  }

  console.log(`[read.js] Loading chapter ${currentChapterId} for manga ${currentMangaId} (Long Strip)`);
  try {
    // Show loading indicator
    const container = document.getElementById('reader-content');
    if (container) {
      container.innerHTML = '<p style="color:white;">Loading chapter...</p>';
    }

    currentPages = await getChapterPages(currentMangaId, currentChapterId);

    if (currentPages.length === 0) {
      const msg = 'Failed to load pages for this chapter.';
      console.warn('[read.js]', msg);
      if (container) {
        container.innerHTML = `<p style="color:red;">${msg}</p>`;
      }
      return;
    }

    // --- KEY CHANGE: Call renderLongStrip instead of updateReaderImage ---
    renderLongStrip(currentPages);
    // Reset zoom for new chapter
    stripZoomLevel = 1;
    // setStripZoom is called inside renderLongStrip now

  } catch (e) {
    console.error('[read.js] Failed to load chapter', e);
    const msg = 'Failed to load chapter. Please try again.';
    const container = document.getElementById('reader-content');
    if (container) {
      container.innerHTML = `<p style="color:red;">${msg}</p>`;
    }
    alert(msg);
  }
}


// --- Initialize reader ---
async function initReader() {
  console.log('[read.js] Initializing reader (Long Strip with Chapter Selector)...');
  const params = new URLSearchParams(window.location.search);
  currentMangaId = params.get('mangaId');
  currentChapterId = params.get('chapterId');
  // `page` parameter is ignored in long strip mode

  if (!currentMangaId || !currentChapterId) {
    const msg = 'Invalid reader parameters. Missing mangaId or chapterId.';
    console.error('[read.js]', msg);
    alert(msg);
    return;
  }

  console.log('[read.js] Parameters - Manga:', currentMangaId, 'Chapter:', currentChapterId);

  try {
    // --- 1. Fetch manga details to get chapters list ---
    console.log('[read.js] Fetching manga details for chapter list and title...');
    const mangaDetails = await getMangaDetails(currentMangaId);
    if (!mangaDetails) {
      throw new Error('Could not load manga details.');
    }

    mangaChapters = mangaDetails.chapters && Array.isArray(mangaDetails.chapters) ? mangaDetails.chapters : [];

    const titleDisplay = document.getElementById('manga-title-display');
    if (titleDisplay) {
      titleDisplay.textContent = mangaDetails.title || 'Loading...';
    }

    // --- 2. Populate the chapter selector ---
    populateChapterSelector(mangaChapters, currentChapterId);

    // --- 3. Load the initial chapter content (Long Strip) ---
    await loadCurrentChapter();

  } catch (e) {
    console.error('[read.js] Failed to initialize reader', e);
    alert('Failed to initialize reader. Check console for details.');
  }
}

// --- Start ---
document.addEventListener('DOMContentLoaded', () => {
  console.log('[read.js] DOM Content Loaded. Starting init...');
  initReader();
});

// --- Expose functions for inline onclick attributes in read.html ---
// Note: prevPage/nextPage are removed as they are for single image mode
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.toggleFullscreen = toggleFullscreen;
window.prevChapter = prevChapter;
window.nextChapter = nextChapter;
window.onChapterSelect = onChapterSelect; // Needed for <select onchange>
