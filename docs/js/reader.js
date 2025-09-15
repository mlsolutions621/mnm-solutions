/* js/reader.js - Dedicated Manga Reader */
const API_BASE = (window.MR_BASE_OVERRIDE ? window.MR_BASE_OVERRIDE : 'https://gomanga-api.vercel.app/api').replace(/\/+$/, '');

let currentManga = null, currentPages = [], currentPageIndex = 0;
let chapterId = null;

// Parse URL parameters
function getUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    mangaId: params.get('mangaId'),
    chapterId: params.get('chapterId')
  };
}

function showStatus(msg, isError = false) {
  console[isError ? 'error' : 'log']('[READER]', msg);
  const statusEl = document.getElementById('reader-status');
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.style.display = 'block';
  if (!isError) setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}

async function apiGet(path, opts = {}) {
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const url = `${API_BASE}${normalizedPath}`;
  try {
    const res = await fetch(url, Object.assign({
      cache: 'no-cache',
      mode: 'cors',
      headers: { 'Accept': 'application/json' }
    }, opts));
    if (!res.ok) {
      const txt = await res.text().catch(() => '<no-body>');
      const err = `HTTP ${res.status} ${res.statusText} - ${url} - ${txt.slice(0,200)}`;
      showStatus(err, true);
      throw new Error(err);
    }
    return await res.json();
  } catch (err) {
    console.error('[apiGet] failed', err);
    showStatus('Request failed: ' + (err.message || err), true);
    throw err;
  }
}

async function loadMangaDetails(mangaId) {
  try {
    const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}`);
    if (!data.id) throw new Error('Manga not found');
    
    currentManga = {
      id: data.id,
      title: data.title,
      image: data.imageUrl,
      author: data.author,
      status: data.status,
      lastUpdated: data.lastUpdated,
      views: data.views,
      genres: data.genres,
      rating: data.rating,
      chapters: data.chapters && Array.isArray(data.chapters) ? data.chapters : []
    };
    
    document.getElementById('reader-title').textContent = currentManga.title;
    
    // Load first chapter if no specific chapter is provided
    if (!chapterId && currentManga.chapters.length > 0) {
      chapterId = currentManga.chapters[0].chapterId;
    }
    
    return currentManga;
  } catch (e) {
    console.warn('loadMangaDetails failed', e);
    showStatus('Failed to load manga details.', true);
    return null;
  }
}

async function loadChapterPages() {
  if (!chapterId) return;
  
  try {
    const data = await apiGet(`/manga/${encodeURIComponent(currentManga.id)}/${encodeURIComponent(chapterId)}`);
    if (!data.imageUrls || !Array.isArray(data.imageUrls)) {
      showStatus('No pages found for this chapter.', true);
      return;
    }
    
    currentPages = data.imageUrls;
    currentPageIndex = 0;
    renderPages();
    updatePageInfo();
  } catch (e) {
    console.warn('loadChapterPages error', e);
    showStatus('Failed to load chapter pages.', true);
  }
}

function renderPages() {
  const pagesContainer = document.getElementById('reader-pages');
  pagesContainer.innerHTML = '';
  
  currentPages.forEach((url, index) => {
    const pageDiv = document.createElement('div');
    pageDiv.className = 'reader-page-item';
    
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Page ${index + 1}`;
    img.loading = 'lazy';
    img.style.width = '100%';
    img.style.maxHeight = '90vh';
    img.style.objectFit = 'contain';
    img.style.display = 'block';
    
    pageDiv.appendChild(img);
    pagesContainer.appendChild(pageDiv);
  });
  
  // Scroll to first page
  pagesContainer.scrollTop = 0;
}

function updatePageInfo() {
  const pageInfo = document.getElementById('page-info');
  if (pageInfo) {
    pageInfo.textContent = `Page ${currentPageIndex + 1} of ${currentPages.length}`;
  }
}

function prevPage() {
  if (currentPageIndex > 0) {
    currentPageIndex--;
    updatePageInfo();
    scrollToPage(currentPageIndex);
  }
}

function nextPage() {
  if (currentPageIndex < currentPages.length - 1) {
    currentPageIndex++;
    updatePageInfo();
    scrollToPage(currentPageIndex);
  }
}

function scrollToPage(index) {
  const pagesContainer = document.getElementById('reader-pages');
  const pageItems = pagesContainer.querySelectorAll('.reader-page-item');
  if (pageItems[index]) {
    pageItems[index].scrollIntoView({ behavior: 'smooth' });
  }
}

function goBackToHome() {
  window.location.href = '/';
}

// Keyboard navigation
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') prevPage();
  if (e.key === 'ArrowRight') nextPage();
});

// Initialize reader
async function initReader() {
  const params = getUrlParams();
  
  if (!params.mangaId) {
    showStatus('No manga ID provided', true);
    return;
  }
  
  try {
    await loadMangaDetails(params.mangaId);
    await loadChapterPages();
  } catch (e) {
    console.error('Reader initialization failed', e);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initReader);
