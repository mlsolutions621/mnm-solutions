/* js/app.js - MangaStream Frontend (Directly using GOMANGA-API endpoints)
   API root: https://gomanga-api.vercel.app/api
*/

const API_BASE = (window.MR_BASE_OVERRIDE ? window.MR_BASE_OVERRIDE : 'https://gomanga-api.vercel.app/api').replace(/\/+$/, '');

let currentManga = null, currentPages = [], currentPageIndex = 0;
let trendingItems = [], featuredItems = [];
let isLoadingSearch = false, isLoadingTrending = false, isLoadingUpdates = false;

// Genre mapping (id → name)
let genreMap = {};

// Helper: rewrite image URLs to go through worker proxy correctly
function proxifyUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.startsWith('/api')) {
      path = path.substring(4);
    }
    return `${API_BASE}${path}${u.search}`;
  } catch(e) {
    return url;
  }
}

// Cache for chapter images to avoid repeated requests
const chapterImageCache = new Map();

function showStatus(msg, isError = false, persist = false){
  console[isError ? 'error' : 'log']('[MANGASTREAM]', msg);
  let el = document.getElementById('manga-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'manga-status';
    el.style.position = 'fixed';
    el.style.left = '12px';
    el.style.bottom = '12px';
    el.style.zIndex = 9999;
    el.style.padding = '8px 10px';
    el.style.borderRadius = '8px';
    el.style.fontFamily = 'Inter, system-ui, sans-serif';
    el.style.fontSize = '12px';
    el.style.maxWidth = '380px';
    el.style.boxShadow = '0 8px 20px rgba(0,0,0,.4)';
    document.body.appendChild(el);
  }
  el.style.background = isError ? '#ffefef' : '#eef9ff';
  el.style.color = isError ? '#660000' : '#08304d';
  el.textContent = msg;
  if (!persist && !isError) setTimeout(()=>{ if (el && el.textContent === msg) el.remove(); }, 3500);
}

async function apiGet(path, opts = {}){
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const url = `${API_BASE}${normalizedPath}`;
  console.log('[apiGet] Fetching:', url); // ← Only log to console

  try {
    const res = await fetch(url, Object.assign({
      cache: 'no-cache',
      mode: 'cors',
      headers: { 'Accept': 'application/json' }
    }, opts));
    if (!res.ok) {
      const txt = await res.text().catch(()=>'<no-body>');
      const err = `HTTP ${res.status} ${res.statusText} - ${url} - ${txt.slice(0,200)}`;
      showStatus(err, true, true);
      throw new Error(err);
    }
    const json = await res.json().catch(async e=>{
      const txt = await res.text().catch(()=>'<no-body>');
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
      description: m.description
    }));
  } catch (e) {
    console.warn('getTrending failed', e);
    showStatus('Failed to load trending manga.', true);
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
      description: m.description
    }));
  } catch (e) {
    console.warn('getFeatured failed', e);
    showStatus('Failed to load featured manga.', true);
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
      views: m.views
    }));
  } catch (e) {
    console.warn('searchTitles failed', e);
    showStatus('Search failed. Please try again.', true);
    return [];
  }
}

async function loadGenres() {
  try {
    const data = await apiGet('/genre');
    if (Array.isArray(data)) {
      genreMap = Object.fromEntries(
        data.map(g => [g.id, g.name])
      );
    }
  } catch (e) {
    console.warn('Failed to load genres', e);
  }
}

async function getInfo(mangaId) {
  if (!mangaId) return null;
  try {
    const data = await apiGet(`/manga/${encodeURIComponent(mangaId)}`);
    if (!data.id) throw new Error('Manga not found');

    // Map genre IDs to readable names
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
      chapters: data.chapters && Array.isArray(data.chapters) ? data.chapters.map(ch => ({
        chapterId: ch.chapterId,
        views: ch.views,
        uploaded: ch.uploaded,
        timestamp: ch.timestamp
      })) : []
    };
  } catch (e) {
    console.warn('getInfo failed', e);
    showStatus('Failed to load manga details.', true);
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
    showStatus('Failed to load chapter pages.', true);
    return [];
  }
}

/* ---- UI rendering ---- */

function renderTrending(items){
  const list = document.getElementById('manga-list');
  if (!list) { showStatus('Missing container #manga-list', true); return; }
  list.innerHTML = '';
  items.forEach(m=>{
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || '';
    img.alt = m.title || '';
    img.title = m.title || '';
    img.style.cursor = 'pointer';
    img.onclick = ()=> openReaderInfo(m.id, m);
    list.appendChild(img);
  });
}

function renderUpdates(items){
  const grid = document.getElementById('updates-list');
  if (!grid) { showStatus('Missing container #updates-list', true); return; }
  grid.innerHTML = '';
  items.forEach(m=>{
    const card = document.createElement('div'); card.className = 'card';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || '';
    img.alt = m.title || '';
    img.onclick = ()=> openReaderInfo(m.id, m);
    const meta = document.createElement('div'); meta.className='meta';
    const title = document.createElement('div'); title.className='title'; title.textContent = m.title || '';
    const chap = document.createElement('div'); chap.className='muted'; chap.style.fontSize='13px'; chap.textContent = m.latestChapter || '';
    meta.appendChild(title);
    meta.appendChild(chap);
    card.appendChild(img); card.appendChild(meta); grid.appendChild(card);
  });
}

async function openReaderInfo(mangaId, fallback){
  const d = await getInfo(mangaId) || fallback || null;
  if (!d) return showStatus('Could not load manga info', true);
  currentManga = d;
  document.getElementById('reader-cover').src = d.image || fallback?.image || '';
  document.getElementById('reader-title').textContent = d.title || '';
  document.getElementById('reader-description').textContent = d.genres && d.genres.length
    ? d.genres.join(' • ')
    : d.status || '';

  const chapterSel = document.getElementById('chapter'); if (chapterSel) chapterSel.innerHTML = '';
  const pageSel = document.getElementById('page'); if (pageSel) pageSel.innerHTML = '';

  const chaptersArr = Array.isArray(d.chapters) ? d.chapters.slice().reverse() : [];

  if (chaptersArr.length === 0) {
    showStatus('No chapters available for this manga.', true);
  }

  chaptersArr.forEach(ch=>{
    const opt = document.createElement('option');
    const label = ch.chapterId || 'Unknown';
    opt.value = JSON.stringify({
      mangaId: d.id,
      chapterId: ch.chapterId
    });
    opt.textContent = `Ch. ${label}`;
    chapterSel.appendChild(opt);
  });

  if (chaptersArr.length) {
    chapterSel.selectedIndex = 0;
    const first = JSON.parse(chapterSel.value);
    await loadChapterPages(first.mangaId, first.chapterId);
  } else {
    currentPages = [ proxifyUrl(d.image || fallback?.image || 'https://via.placeholder.com/800x1200?text=No+pages') ];
    currentPageIndex = 0;
    updateReaderImage();
  }

  const modal = document.getElementById('reader-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden'; // 🔒 Prevent background scroll
  }
}

async function loadChapterPages(mangaId, chapterId){
  const arr = await getChapterPages(mangaId, chapterId);
  currentPages = (Array.isArray(arr) ? arr : []);
  currentPageIndex = 0;

  const pageSel = document.getElementById('page');
  if (pageSel) {
    pageSel.innerHTML = '';
    currentPages.forEach((_, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `Page ${i + 1}`;
      pageSel.appendChild(o);
    });
  }

  updateReaderImage();
}

function updateReaderImage(){
  const img = document.getElementById('reader-image');
  if (img) {
    img.src = currentPages[currentPageIndex] || '';
    img.alt = `${currentManga?.title || 'Manga'} - Page ${currentPageIndex + 1}`;
  }
  const pageSel = document.getElementById('page');
  if (pageSel) pageSel.value = String(currentPageIndex || 0);
}

function changeChapter(){
  const raw = document.getElementById('chapter')?.value;
  if (!raw) return;
  const c = JSON.parse(raw);
  loadChapterPages(c.mangaId, c.chapterId);
}

function changePage(){
  const idx = parseInt(document.getElementById('page')?.value || '0',10);
  currentPageIndex = isNaN(idx) ? 0 : idx;
  updateReaderImage();
}

function prevPage(){
  if (!currentPages.length) return;
  currentPageIndex = Math.max(0, currentPageIndex-1);
  updateReaderImage();
}

function nextPage(){
  if (!currentPages.length) return;
  currentPageIndex = Math.min(currentPages.length-1, currentPageIndex+1);
  updateReaderImage();
}

function openDedicatedReader() {
  const chapterSel = document.getElementById('chapter');
  const chapterRaw = chapterSel?.value;
  if (!chapterRaw) return showStatus('No chapter selected', true);

  const { mangaId, chapterId } = JSON.parse(chapterRaw);
  const pageIndex = 0; // start page

  // Build repo-aware base path:
  // - If the current pathname is like "/mnm-solutions/" or "/mnm-solutions/index.html",
  //   the first non-empty segment will be "mnm-solutions" and we'll use "/mnm-solutions/" as base.
  // - Otherwise we fall back to root "/".
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  let repoBase = '/';
  if (pathParts.length > 0) {
    repoBase = '/' + pathParts[0] + '/';
  }

  const url = new URL(repoBase + 'read.html', window.location.origin);
  url.searchParams.set('mangaId', mangaId);
  url.searchParams.set('chapterId', chapterId);
  url.searchParams.set('page', pageIndex);

  window.location.href = url.toString();
}


function closeReader(){
  const modal = document.getElementById('reader-modal');
  if (modal) modal.style.display='none';
  document.body.style.overflow = ''; // ✅ Re-enable scroll
}

/* Search UI & helpers */
function debounce(fn, wait) {
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(()=>fn.apply(this,args), wait);
  };
}

async function searchManga(){
  const q = document.getElementById('search-input')?.value?.trim();
  const box = document.getElementById('search-results');
  if (!q) { if (box) box.innerHTML = ''; return; }
  try {
    isLoadingSearch = true;
    const items = await searchTitles(q);
    if (!box) return;
    box.innerHTML = '';
    (items || []).forEach(m=>{
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = m.image || '';
      img.alt = m.title || '';
      img.title = m.title || '';
      img.onclick = ()=> {
        closeSearchModal();
        openReaderInfo(m.id, m);
      };
      box.appendChild(img);
    });
    const loadMoreBtn = document.getElementById('search-load-more');
    if (loadMoreBtn) loadMoreBtn.style.display = 'none';
  } catch(e){ console.warn('searchManga failed', e); showStatus('Search error', true); }
  finally { isLoadingSearch = false; }
}

const searchMangaDebounced = debounce(searchManga, 420);
function loadMoreSearch(){ showStatus('Load more not available for search.', true); }
function openSearchModal(){ const m=document.getElementById('search-modal'); if(m){m.style.display='flex'; setTimeout(()=>document.getElementById('search-input')?.focus(),100);} }
function closeSearchModal(){ const m=document.getElementById('search-modal'); if(m){m.style.display='none'; document.getElementById('search-results').innerHTML='';} }

/* observers and loading more trending/updates */
function createObserver(targetId, callback){
  const el = document.getElementById(targetId);
  if (!el) return;
  const io = new IntersectionObserver(entries => { entries.forEach(e=>{ if (e.isIntersecting) callback(); }); }, { rootMargin: '200px' });
  io.observe(el);
}

async function loadMoreTrending(){
  if (isLoadingTrending) return;
  isLoadingTrending = true;
  window._browsePage = (window._browsePage||1) + 1;
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
      description: m.description
    }));
    trendingItems = trendingItems.concat(more);
    renderTrending(trendingItems);
    if (data.pagination && data.pagination.length > 0) {
      const totalPages = data.pagination[data.pagination.length - 1];
      if (window._browsePage >= totalPages) {
        const loadMoreBtn = document.getElementById('load-more');
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      }
    }
  } catch(e){
    console.warn('loadMoreTrending failed', e);
    showStatus('Failed to load more trending manga.', true);
  }
  isLoadingTrending = false;
}

async function loadMoreUpdates(){
  if (isLoadingUpdates) return;
  isLoadingUpdates = true;
  window._updatesPage = (window._updatesPage||1) + 1;
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
      description: m.description
    }));
    featuredItems = featuredItems.concat(more);
    renderUpdates(featuredItems);
    if (data.pagination && data.pagination.length > 0) {
      const totalPages = data.pagination[data.pagination.length - 1];
      if (window._updatesPage >= totalPages) {
        const loadMoreBtn = document.getElementById('load-more-updates');
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
      }
    }
  } catch(e){
    console.warn('loadMoreUpdates failed', e);
    showStatus('Failed to load more updates.', true);
  }
  isLoadingUpdates = false;
}

/* init */
async function init(){
  try {
    await loadGenres(); // ← Load genres first
    const [t,f] = await Promise.all([getTrending(), getFeatured()]);
    trendingItems = Array.isArray(t) ? t : [];
    featuredItems = Array.isArray(f) ? f : [];
    renderTrending(trendingItems);
    renderUpdates(featuredItems);
    createObserver('sentinel-trending', loadMoreTrending);
    createObserver('sentinel-updates', loadMoreUpdates);
    showStatus('Ready — Enjoy reading!');
  } catch(e){
    console.error('init failed', e);
    renderTrending([]);
    renderUpdates([]);
    showStatus('Initialization failed — check console', true, true);
  }
}

document.addEventListener('DOMContentLoaded', ()=>setTimeout(init, 120));

/* expose functions used by inline HTML */
window.searchManga = searchManga;
window.searchMangaDebounced = searchMangaDebounced;
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.openReaderInfo = openReaderInfo;
window.closeReader = closeReader;
window.changeChapter = changeChapter;
window.changePage = changePage;
window.prevPage = prevPage;
window.nextPage = nextPage;
window.loadMoreTrending = loadMoreTrending;
window.loadMoreUpdates = loadMoreUpdates;
window.loadMoreSearch = loadMoreSearch;
window.openDedicatedReader = openDedicatedReader;


