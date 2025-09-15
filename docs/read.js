// js/read.js - Dedicated Manga Reader

const API_BASE = (window.MR_BASE_OVERRIDE ? window.MR_BASE_OVERRIDE : 'https://gomanga-api.vercel.app/api').replace(/\/+$/, '');

let currentPages = [];
let currentPageIndex = 0;
let zoomLevel = 1;
let isFullscreen = false;

// Helper: rewrite image URLs to go through worker proxy correctly
function proxifyUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.startsWith('/api')) path = path.substring(4);
    return `${API_BASE}${path}${u.search}`;
  } catch(e) {
    return url;
  }
}

async function apiGet(path, opts = {}){
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const url = `${API_BASE}${normalizedPath}`;
  console.log('[read.js] Fetching:', url);
  try {
    const res = await fetch(url, Object.assign({
      cache: 'no-cache',
      mode: 'cors',
      headers: { 'Accept': 'application/json' }
    }, opts));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('apiGet failed', err);
    alert('Failed to load content. Check console.');
    throw err;
  }
}

async function getChapterPages(mangaId, chapterId) {
  try {
    const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}/${encodeURIComponent(chapterId)}`);
    if (!data.imageUrls || !Array.isArray(data.imageUrls)) return [];
    return data.imageUrls.map(proxifyUrl);
  } catch (e) {
    console.warn('getChapterPages error', e);
    return [];
  }
}

function updateReaderImage() {
  const img = document.getElementById('reader-image');
  if (!img) return;
  img.src = currentPages[currentPageIndex] || '';
  img.style.transform = `scale(${zoomLevel})`;
  img.style.transformOrigin = 'top center';
}

function prevPage() {
  if (currentPages.length === 0) return;
  currentPageIndex = Math.max(0, currentPageIndex - 1);
  updateReaderImage();
}

function nextPage() {
  if (currentPages.length === 0) return;
  currentPageIndex = Math.min(currentPages.length - 1, currentPageIndex + 1);
  updateReaderImage();
}

function zoomIn() {
  zoomLevel = Math.min(zoomLevel + 0.25, 3);
  updateReaderImage();
}

function zoomOut() {
  zoomLevel = Math.max(zoomLevel - 0.25, 0.5);
  updateReaderImage();
}

function toggleFullscreen() {
  const container = document.getElementById('reader-container');
  if (!container) return;

  if (!isFullscreen) {
    container.classList.add('fullscreen');
    document.body.style.overflow = 'hidden';
  } else {
    container.classList.remove('fullscreen');
    document.body.style.overflow = '';
  }
  isFullscreen = !isFullscreen;
}

// Initialize reader
async function initReader() {
  const params = new URLSearchParams(window.location.search);
  const mangaId = params.get('mangaId');
  const chapterId = params.get('chapterId');
  const page = params.get('page');

  if (!mangaId || !chapterId) {
    alert('Invalid reader parameters');
    window.history.back();
    return;
  }

  currentPageIndex = parseInt(page || '0', 10) || 0;

  try {
    currentPages = await getChapterPages(mangaId, chapterId);
    if (currentPages.length === 0) {
      alert('No pages found for this chapter.');
      return;
    }
    updateReaderImage();
  } catch (e) {
    console.error('Failed to load chapter', e);
    alert('Failed to load chapter. Please try again.');
  }
}

document.addEventListener('DOMContentLoaded', initReader);

// Expose for inline onclick
window.prevPage = prevPage;
window.nextPage = nextPage;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.toggleFullscreen = toggleFullscreen;
