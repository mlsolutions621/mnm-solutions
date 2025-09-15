// js/read.js - Dedicated Manga Reader (Chapter Selector Navigation)
// Compatible with the updated read.html structure
// Uses the same proxy logic as app.js

// --- Configuration and Globals ---
const API_BASE = (window.MR_BASE_OVERRIDE 
    ? window.MR_BASE_OVERRIDE.trim()
    : 'https://gomanga-api.vercel.app/api'
).replace(/\/+$/, '');

let currentMangaId = null;
let currentChapterId = null;
let mangaChapters = [];       // List of chapters for the current manga
let currentPages = [];        // Stores ALL image URLs for the *current* chapter
let currentPageIndex = 0;     // Index of the currently displayed image within the current chapter
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
  } catch(e) {
    console.warn('[read.js] Failed to proxify URL:', url, e);
    return url;
  }
}

// --- Generic API fetcher, using the proxy ---
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

// --- Update the single image displayed in the reader ---
function updateReaderImage() {
  const img = document.getElementById('reader-image');
  if (!img) {
    console.error('[read.js] Reader image element not found');
    return;
  }
  
  if (currentPages.length === 0) {
      img.src = '';
      img.alt = 'No pages loaded';
      return;
  }

  const src = currentPages[currentPageIndex] || '';
  console.log(`[read.js] Updating image to page ${currentPageIndex + 1}/${currentPages.length}:`, src);
  img.src = src;
  img.alt = `Manga Page ${currentPageIndex + 1} - Chapter ${currentChapterId}`;
  setSingleImageZoom(stripZoomLevel); // Apply current zoom level
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

    reversedChapters.forEach((ch, index) => {
        const option = document.createElement('option');
        option.value = ch.chapterId;
        option.textContent = `Ch. ${ch.chapterId}`; // Customize label as needed
        if (ch.chapterId == currentChapterId) {
            option.selected = true;
        }
        selector.appendChild(option);
    });
    
    selector.disabled = false;
    console.log(`[read.js] Chapter selector populated with ${reversedChapters.length} chapters.`);
}

// --- Zoom (applies CSS transform to the single image) ---
function setSingleImageZoom(level) {
    const img = document.getElementById('reader-image');
    if (img) {
        img.style.transform = `scale(${level})`;
        img.style.transformOrigin = 'center center';
        const container = document.getElementById('reader-content');
        if (container) {
            container.style.overflow = level > 1 ? 'auto' : 'hidden'; // Allow scroll if zoomed
        }
    }
}

function zoomIn() {
    stripZoomLevel = Math.min(stripZoomLevel + 0.25, 3);
    console.log('[read.js] Zooming image in. New level:', stripZoomLevel);
    setSingleImageZoom(stripZoomLevel);
}

function zoomOut() {
    stripZoomLevel = Math.max(stripZoomLevel - 0.25, 0.5);
    console.log('[read.js] Zooming image out. New level:', stripZoomLevel);
    setSingleImageZoom(stripZoomLevel);
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
function findChapterIndexById(chapterId) {
    // Find the index in the original (non-reversed) chapters list
    return mangaChapters.findIndex(ch => ch.chapterId == chapterId);
}

function prevChapter() {
    const selector = document.getElementById('chapter-selector');
    if (!selector || selector.disabled) return;

    const currentSelectedIndex = selector.selectedIndex;
    if (currentSelectedIndex < selector.options.length - 1) { // -1 because list is reversed
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
    if (currentSelectedIndex > 0) { // > 0 because list is reversed
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

    // Update URL without reloading
    const url = new URL(window.location);
    url.searchParams.set('chapterId', currentChapterId);
    // Reset page param when changing chapters
    url.searchParams.delete('page'); 
    window.history.replaceState({}, '', url);

    // Load the new chapter
    await loadCurrentChapter();
}

// --- Load the currently selected chapter ---
async function loadCurrentChapter() {
    if (!currentMangaId || !currentChapterId) {
        console.error('[read.js] Cannot load chapter: Missing mangaId or chapterId');
        return;
    }

    console.log(`[read.js] Loading chapter ${currentChapterId} for manga ${currentMangaId}`);
    try {
        const container = document.getElementById('reader-content');
        if (container) {
            container.innerHTML = '<p style="color:white;">Loading chapter...</p><img id="reader-image" alt="Manga page" />';
        }

        currentPages = await getChapterPages(currentMangaId, currentChapterId);
        currentPageIndex = 0; // Reset to first page of new chapter
        
        if (currentPages.length === 0) {
            const msg = 'Failed to load pages for this chapter.';
            console.warn('[read.js]', msg);
            if (container) {
                container.innerHTML = `<p style="color:red;">${msg}</p><img id="reader-image" alt="Manga page" />`;
            }
            updateReaderImage(); // Update to show error state
            return;
        }
        
        updateReaderImage();
        stripZoomLevel = 1; // Reset zoom
        setSingleImageZoom(stripZoomLevel);
        
    } catch (e) {
        console.error('[read.js] Failed to load chapter', e);
        const msg = 'Failed to load chapter. Please try again.';
        const container = document.getElementById('reader-content');
        if (container) {
             container.innerHTML = `<p style="color:red;">${msg}</p><img id="reader-image" alt="Manga page" />`;
        }
        alert(msg);
    }
}

// --- Page Navigation (still available if needed) ---
function prevPage() {
  console.log('[read.js] prevPage called');
  if (currentPages.length === 0) return;
  if (currentPageIndex > 0) {
    currentPageIndex--;
    updateReaderImage();
  } else {
    // Optionally, go to previous chapter here if at page 1
    // alert("This is the first page. Use 'Prev Chapter' button.");
    prevChapter(); // Automatically go to previous chapter
  }
}

function nextPage() {
  console.log('[read.js] nextPage called');
  if (currentPages.length === 0) return;
  if (currentPageIndex < currentPages.length - 1) {
    currentPageIndex++;
    updateReaderImage();
  } else {
    // Optionally, go to next chapter here if at last page
    // alert("This is the last page. Use 'Next Chapter' button.");
    nextChapter(); // Automatically go to next chapter
  }
}

// --- Initialize reader ---
async function initReader() {
  console.log('[read.js] Initializing reader (Chapter Selector Navigation)...');
  const params = new URLSearchParams(window.location.search);
  currentMangaId = params.get('mangaId');
  currentChapterId = params.get('chapterId');
  const pageParam = params.get('page');

  if (!currentMangaId || !currentChapterId) {
    const msg = 'Invalid reader parameters. Missing mangaId or chapterId.';
    console.error('[read.js]', msg);
    alert(msg);
    return;
  }

  const initialPageIndex = parseInt(pageParam || '0', 10);
  console.log('[read.js] Parameters - Manga:', currentMangaId, 'Chapter:', currentChapterId, 'Initial Page:', initialPageIndex);

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

    // --- 3. Load the initial chapter content ---
    await loadCurrentChapter();
    
    // --- 4. Set initial page if specified and valid ---
    if (initialPageIndex > 0 && initialPageIndex < currentPages.length) {
        currentPageIndex = initialPageIndex;
        updateReaderImage();
    }

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
window.prevPage = prevPage;
window.nextPage = nextPage;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.toggleFullscreen = toggleFullscreen;
window.prevChapter = prevChapter;
window.nextChapter = nextChapter;
window.onChapterSelect = onChapterSelect;
