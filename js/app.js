// Use MangaHook's public deployment
const MR_BASE = 'https://mangahook-api.vercel.app';

let currentManga = null;
let currentExternalUrl = '';
let currentPages = [];
let currentPageIndex = 0;
let currentChapterSlug = '';

let trendingItems = [];
let trendingNext = null;
let featuredItems = [];
let featuredNext = null;
let searchNext = null;
let isLoadingTrending = false;
let isLoadingUpdates = false;
let isLoadingSearch = false;

async function apiGet(path){
  // Accept either absolute URL or path relative to MR_BASE
  const base = MR_BASE.endsWith('/') ? MR_BASE.slice(0, -1) : MR_BASE;
  const url = path.startsWith('http') ? path : (path.startsWith('/') ? `${base}${path}` : `${base}/${path}`);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    const err = new Error(`HTTP ${res.status} ${url} ${text ? '- '+text.slice(0,120) : ''}`);
    err.status = res.status;
    throw err;
  }
  return res.json().catch(()=>{ throw new Error('Invalid JSON from '+url); });
}

/*
  Helper: try multiple endpoints (in order) until one returns useful data.
  endpoints: array of path strings (relative or absolute)
  validator: function(data) -> boolean (true if this response is usable)
*/
async function tryEndpoints(endpoints, validator = null){
  for (const p of endpoints){
    try {
      const d = await apiGet(p);
      if (!validator || validator(d)) return d;
    } catch (e) {
      // continue to next
      console.warn('endpoint failed', p, e && e.message);
    }
  }
  throw new Error('All endpoints failed: ' + endpoints.join(','));
}

/* TRENDING / FEATURED / SEARCH */

// MangaHook README shows /api/mangaList returning { mangaList: [...] }
async function getTrending(){
  try {
    const data = await tryEndpoints([
      '/api/mangaList',
      '/api/all',              // possible fallback
      '/api/latest'            // another common name
    ], d => Array.isArray(d.mangaList) || Array.isArray(d.data) || Array.isArray(d));
    // Normalize
    return (data.mangaList || data.data || data) || [];
  } catch (e) {
    console.error('getTrending error', e);
    return [];
  }
}

async function getFeatured(){
  // We'll treat featured as latest updates; use same endpoint or fallback
  try {
    const data = await tryEndpoints([
      '/api/mangaList',
      '/api/latest-updates',
      '/api/latest'
    ], d => Array.isArray(d.mangaList) || Array.isArray(d.data) || Array.isArray(d));
    return (data.mangaList || data.data || data) || [];
  } catch (e) {
    console.error('getFeatured error', e);
    return [];
  }
}

let searchPage = 1;
let lastSearchQuery = '';
async function searchTitles(q, page = 1){
  lastSearchQuery = q;
  searchPage = page;
  // MangaHook claims to support search; try common search endpoints and fall back to client-side filter
  try {
    const data = await tryEndpoints([
      `/api/search?keyword=${encodeURIComponent(q)}&page=${page}`,
      `/api/search?query=${encodeURIComponent(q)}&page=${page}`,
      `/api/mangaList?page=${page}&keyword=${encodeURIComponent(q)}`,
      `/api/mangaList?page=${page}`
    ], d => Array.isArray(d.mangaList) || Array.isArray(d.data) || Array.isArray(d));
    // compute next if metadata available
    if (data.metaData && typeof data.metaData.totalPages === 'number') {
      searchNext = (page < data.metaData.totalPages) ? `/api/search?keyword=${encodeURIComponent(q)}&page=${page+1}` : null;
    } else if (data.totalPages && page < data.totalPages) {
      searchNext = `/api/search?keyword=${encodeURIComponent(q)}&page=${page+1}`;
    } else {
      searchNext = null;
    }
    const items = (data.mangaList || data.data || data) || [];
    // If we received a full list (mangaList) but it's unfiltered, attempt client-side filter when proper search endpoint missing
    if (!/search/i.test(data._endpoint || '') && q && !/search\?/.test(JSON.stringify(data))) {
      const ql = q.toLowerCase();
      return items.filter(m => (m.title || m.name || '').toLowerCase().includes(ql));
    }
    return items;
  } catch (e) {
    console.error('searchTitles error', e);
    // as a last resort, return empty
    return [];
  }
}

/* DETAILS & CHAPTERS */

// Try to retrieve details by common endpoints. Validator expects object with title or id.
async function getDetails(slug){
  // slug may be an id or slug string
  try {
    const endpoints = [
      `/api/manga/${encodeURIComponent(slug)}`,
      `/api/mangaDetail/${encodeURIComponent(slug)}`,
      `/api/mangaDetail?id=${encodeURIComponent(slug)}`,
      `/api/getManga/${encodeURIComponent(slug)}`,
      `/api/mangaList` // fallback: search by id in list
    ];
    const data = await tryEndpoints(endpoints, d => (d && (d.title || d.manga || d.id || d.mangaList)));
    // If we got a list from mangaList, find the item
    if (Array.isArray(data.mangaList)) {
      const found = data.mangaList.find(x => String(x.id) === String(slug) || String(x.title).toLowerCase() === String(slug).toLowerCase());
      if (found) return found;
    }
    // If the response wraps object in { manga: {...} } or { data: {...} }
    return data.manga || data.data || data;
  } catch (e) {
    console.error('getDetails error', e);
    return null;
  }
}

// Try to fetch chapters for a manga id
async function getChapters(id){
  try {
    const endpoints = [
      `/api/chapters?mangaId=${encodeURIComponent(id)}`,
      `/api/chapters/${encodeURIComponent(id)}`,
      `/api/chapterList?mangaId=${encodeURIComponent(id)}`,
      `/api/manga/${encodeURIComponent(id)}`, // some responses include chapters
      `/api/mangaDetail/${encodeURIComponent(id)}`
    ];
    const data = await tryEndpoints(endpoints, d => Array.isArray(d.chapters) || Array.isArray(d.chapterList) || Array.isArray(d.data) || Array.isArray(d.manga?.chapters));
    // Normalize
    const chapters = d => d.chapters || d.chapterList || d.data || d.manga?.chapters || null;
    const chs = chapters(data);
    if (Array.isArray(chs)) return chs;
    // if the returned object contains numeric keys or nested structure, try to map
    if (Array.isArray(data)) return data;
    return [];
  } catch (e) {
    console.error('getChapters error', e);
    return [];
  }
}

// Get images for a chapter
async function getChapterPages(chapterSlug){
  try {
    const endpoints = [
      `/api/chapter/${encodeURIComponent(chapterSlug)}`,
      `/api/read/${encodeURIComponent(chapterSlug)}`,
      `/api/chapterList/${encodeURIComponent(chapterSlug)}`,
      `/api/getChapter?chapter=${encodeURIComponent(chapterSlug)}`
    ];
    const data = await tryEndpoints(endpoints, d => Array.isArray(d.pages) || Array.isArray(d.images) || Array.isArray(d.data));
    // common shapes: { pages: [url,...] } or { images: [...] } or array directly
    if (Array.isArray(data.pages)) return data.pages;
    if (Array.isArray(data.images)) return data.images;
    if (Array.isArray(data.data)) return data.data.map(p => p.url || p);
    if (Array.isArray(data)) return data;
    return [];
  } catch (e) {
    console.error('getChapterPages error', e);
    return [];
  }
}

/* The rest of your UI code can stay the same but we call the new functions above. */
/* ---- (unchanged UI parts below) ---- */

function renderTrending(items){
  const list=document.getElementById('manga-list');
  if (!list) return;
  list.innerHTML='';
  items.forEach(m=>{
    const img=document.createElement('img');
    img.src=(m.image || m.cover || m.img || m.thumbnail || '');
    img.alt=(m.title || m.name || '');
    img.onclick=()=>openReaderInfo(m.id || m.title || m.slug || m.url, m);
    list.appendChild(img);
  });
}

function renderUpdates(items){
  const grid=document.getElementById('updates-list');
  if (!grid) return;
  grid.innerHTML='';
  items.forEach(m=>{
    const card=document.createElement('div');
    card.className='card';
    const img=document.createElement('img');
    img.src=(m.image || m.cover || m.img || '');
    img.alt=(m.title || m.name);
    img.onclick=()=>openReaderInfo(m.id || m.title || m.slug || m.url, m);
    const meta=document.createElement('div'); meta.className='meta';
    const title=document.createElement('div'); title.className='title'; title.textContent=(m.title || m.name);
    meta.appendChild(title);
    card.appendChild(img); card.appendChild(meta);
    grid.appendChild(card);
  });
}

async function getInfo(id){
  return await getDetails(id);
}

async function openReaderInfo(id, fallback){
  const d = await getInfo(id);
  if (!d) {
    alert('Could not load manga info.');
    return;
  }
  currentManga = d;
  document.getElementById('reader-cover').src = d.image || d.cover || fallback?.cover || fallback?.image || '';
  document.getElementById('reader-title').textContent = d.title || fallback?.title || fallback?.name || '';
  document.getElementById('reader-description').textContent = d.description || d.synopsis || '';

  const chapterSel = document.getElementById('chapter');
  const pageSel = document.getElementById('page');
  if (chapterSel) chapterSel.innerHTML = '';
  if (pageSel) pageSel.innerHTML = '';

  const chs = await getChapters(d.id || id);
  const chaptersArr = (chs || []).slice().sort((a,b)=>{
    // try to guess order by chapterNumber or by reverse
    const na = parseFloat(a.chapterNumber ?? a.chapter ?? a.num ?? a.index ?? a.order ?? 0);
    const nb = parseFloat(b.chapterNumber ?? b.chapter ?? b.num ?? b.index ?? b.order ?? 0);
    return (nb - na);
  });
  if (chapterSel && Array.isArray(chaptersArr)) {
    chaptersArr.forEach(ch => {
      const opt=document.createElement('option');
      // normalize chapter identity
      const chapId = ch.id || ch.chapter || ch.slug || ch.name || ch.chapterNumber;
      opt.value = JSON.stringify({ mangaId: d.id || id, chapterId: chapId, chapterNumber: ch.chapterNumber || ch.chapter || ch.num || '' });
      opt.textContent = `Ch. ${ch.chapterNumber ?? ch.chapter ?? ch.num ?? chapId}` + (ch.lang ? ` (${ch.lang})` : '');
      chapterSel.appendChild(opt);
    });
    if (chaptersArr.length) {
      chapterSel.value = JSON.stringify({ mangaId: d.id || id, chapterId: chaptersArr[0].id || chaptersArr[0].chapter || chaptersArr[0].slug || chaptersArr[0].chapterNumber });
      const c = JSON.parse(chapterSel.value);
      await loadChapterPagesNode(c.mangaId || c.id || id, chaptersArr[0].lang || 'en', c.chapterNumber || c.chapterId || c.chapterId);
    }
  }

  document.getElementById('reader-modal').style.display = 'flex';
}

async function loadChapterPagesNode(mangaId, lang, chapterNumber){
  // If we have a chapter id string (chapterNumber may actually be slug)
  const chapterId = chapterNumber || lang;
  let pages = [];
  // Try the typical chapter endpoints
  try {
    // try chapter slug first
    pages = await getChapterPages(chapterId);
    if (!pages.length) {
      // some APIs expect mangaId + chapterNumber
      pages = await tryEndpoints([
        `/api/read/${encodeURIComponent(mangaId)}/${encodeURIComponent(lang)}/${encodeURIComponent(chapterNumber)}`,
        `/api/read?mangaId=${encodeURIComponent(mangaId)}&chapter=${encodeURIComponent(chapterNumber)}`
      ], d => Array.isArray(d.data) || Array.isArray(d.pages) || Array.isArray(d.images))
        .then(d => d.data || d.pages || d.images || []);
    }
  } catch (e) {
    console.warn('loadChapterPagesNode fallback failed', e);
    pages = [];
  }
  currentPages = pages.map(p => (typeof p === 'string' ? p : (p.url || p.image || ''))).filter(Boolean);
  currentPageIndex = 0;
  const pageSel = document.getElementById('page');
  if (pageSel) pageSel.innerHTML = '';
  currentPages.forEach((_, i)=>{
    const o=document.createElement('option'); o.value=String(i); o.textContent=`Page ${i+1}`; pageSel.appendChild(o);
  });
  if (currentPages.length) {
    pageSel.value = '0';
    document.getElementById('reader-image').src = currentPages[0];
  } else {
    document.getElementById('reader-image').src = '';
  }
}

/* pagination / navigation functions (unchanged) */
function changeChapter(){ const raw=document.getElementById('chapter').value; if(!raw) return; const c=JSON.parse(raw); loadChapterPagesNode(c.mangaId || c.id, c.lang || 'en', c.chapterNumber || c.chapterId || c.chapterId); }
function changePage(){ const idx=parseInt(document.getElementById('page').value||'0',10); currentPageIndex = isNaN(idx) ? 0 : idx; const url = currentPages[currentPageIndex]; if (url) document.getElementById('reader-image').src = url; }
function prevPage(){ if (!currentPages.length) return; currentPageIndex = Math.max(0, currentPageIndex - 1); document.getElementById('page').value = String(currentPageIndex); changePage(); }
function nextPage(){ if (!currentPages.length) return; currentPageIndex = Math.min(currentPages.length - 1, currentPageIndex + 1); document.getElementById('page').value = String(currentPageIndex); changePage(); }
function closeReader(){ document.getElementById('reader-modal').style.display='none'; }

async function searchManga(){
  const q=document.getElementById('search-input').value.trim();
  const box=document.getElementById('search-results'); if(!q){ box.innerHTML=''; return; }
  const items = await searchTitles(q);
  box.innerHTML='';
  items.forEach(m=>{
    const img=document.createElement('img');
    img.src=(m.image||m.cover||m.img||m.thumbnail); img.alt=(m.title||m.name||'');
    img.onclick=()=>{ closeSearchModal(); openReaderInfo(m.id || m.title || m.slug || m.url, m); };
    box.appendChild(img);
  });
  document.getElementById('search-load-more').style.display = searchNext ? 'inline-block' : 'none';
  createObserver('sentinel-search', loadMoreSearch);
}

async function loadMoreSearch(){
  if (!searchNext || isLoadingSearch) return; isLoadingSearch = true;
  try {
    const url = new URL(searchNext, MR_BASE);
    const path = url.pathname + url.search;
    const data = await apiGet(path);
    searchNext = data.next || null;
    const items = data.mangaList || data.data || data || [];
    const box=document.getElementById('search-results');
    items.forEach(m=>{
      const img=document.createElement('img');
      img.src=(m.image||m.cover||m.img||m.thumbnail); img.alt=(m.title||m.name||'');
      img.onclick=()=>{ closeSearchModal(); openReaderInfo(m.id || m.title || m.slug || m.url, m); };
      box.appendChild(img);
    });
    document.getElementById('search-load-more').style.display = searchNext ? 'inline-block' : 'none';
  } catch (e) {
    console.error('loadMoreSearch error', e);
  }
  isLoadingSearch = false;
}

function openSearchModal(){ const m=document.getElementById('search-modal'); if(m){ m.style.display='flex'; setTimeout(()=>document.getElementById('search-input').focus(),0); } }
function closeSearchModal(){ const m=document.getElementById('search-modal'); if(m){ m.style.display='none'; document.getElementById('search-results').innerHTML=''; } }

async function init(){
  const [t, f] = await Promise.all([getTrending(), getFeatured()]);
  trendingItems = t.slice();
  featuredItems = f.slice();
  renderTrending(trendingItems);
  renderUpdates(featuredItems);
  createObserver('sentinel-trending', loadMoreTrending);
  createObserver('sentinel-updates', loadMoreUpdates);
}

init();

// Filters and pagination helpers (unchanged)
function updateRatingLabel(val){ const el=document.getElementById('filter-rating-value'); if(el) el.textContent = String(val); }
function applyFilters(){ /* keep your original filter logic (use trendingItems array) */ /* ... */ }
let debounceTimer = null;
function debouncedApplyFilters(){ clearTimeout(debounceTimer); debounceTimer = setTimeout(applyFilters, 250); }

async function loadMoreTrending(){
  if (isLoadingTrending) return; isLoadingTrending = true;
  window._browsePage = (window._browsePage||1) + 1;
  try {
    const data = await apiGet(`/api/mangaList?page=${window._browsePage}`);
    const more = (data.mangaList || data.data || data) || [];
    trendingItems = trendingItems.concat(more);
    applyFilters();
  } catch (e) {
    console.warn('loadMoreTrending failed', e);
  }
  isLoadingTrending = false;
}

async function loadMoreUpdates(){
  if (isLoadingUpdates) return; isLoadingUpdates = true;
  window._updatesPage = (window._updatesPage||1) + 1;
  try {
    const data = await apiGet(`/api/mangaList?page=${window._updatesPage}`);
    const more = (data.mangaList || data.data || data) || [];
    featuredItems = featuredItems.concat(more);
    renderUpdates(featuredItems);
  } catch (e) {
    console.warn('loadMoreUpdates failed', e);
  }
  isLoadingUpdates = false;
}

function createObserver(targetId, callback){
  const el = document.getElementById(targetId);
  if (!el) return;
  const io = new IntersectionObserver((entries)=>{ entries.forEach(entry=>{ if (entry.isIntersecting) callback(); }); });
  io.observe(el);
}
