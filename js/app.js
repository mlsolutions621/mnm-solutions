/* js/app.js
   Drop-in for your provided HTML/CSS.
   Replace MR_BASE_OVERRIDE from console if you need to point to a different host:
   window.MR_BASE_OVERRIDE = 'https://your-proxy-or-api.com'
*/

const MR_BASE = (window.MR_BASE_OVERRIDE || 'https://mangahook-api.vercel.app').replace(/\/+$/, '');

let currentManga = null;
let currentPages = [];
let currentPageIndex = 0;

let trendingItems = [];
let featuredItems = [];
let searchNext = null;
let isLoadingTrending = false;
let isLoadingUpdates = false;
let isLoadingSearch = false;

///// small UI status overlay /////
function showStatus(msg, isError = false, persist = false){
  console[isError ? 'error' : 'log']('[MANGA]', msg);
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
  if (!persist && !isError) setTimeout(()=>{ if (el && el.textContent === msg) el.remove(); }, 4000);
}

///// network helpers /////
async function apiGet(path, opts = {}){
  const url = path.startsWith('http') ? path : (path.startsWith('/') ? `${MR_BASE}${path}` : `${MR_BASE}/${path}`);
  showStatus('Fetching: ' + url);
  try {
    const res = await fetch(url, Object.assign({ cache: 'no-cache' }, opts));
    if (!res.ok) {
      const text = await res.text().catch(()=>'<no-body>');
      const err = `HTTP ${res.status} ${res.statusText} - ${url} - ${text.slice(0,200)}`;
      showStatus(err, true, true);
      throw new Error(err);
    }
    const json = await res.json().catch(async e=>{
      const txt = await res.text().catch(()=>'<no-body>');
      const msg = 'Invalid JSON from ' + url + ': ' + txt.slice(0,200);
      showStatus(msg, true, true);
      throw new Error(msg);
    });
    console.log('[apiGet]', url, json);
    return json;
  } catch (err) {
    // Common cause: CORS; surface friendly message
    if (err instanceof TypeError && /failed to fetch/i.test(String(err))) {
      showStatus('Network/CORS error when contacting API. Open console for details.', true, true);
    } else {
      showStatus('Request failed: ' + (err.message || err), true, true);
    }
    throw err;
  }
}

/* try several endpoints in order until one returns useful data */
async function tryEndpoints(endpoints, validator = null){
  for (const p of endpoints){
    try {
      const d = await apiGet(p);
      if (!validator || validator(d)) {
        // attach endpoint used for diagnostics
        if (d && typeof d === 'object') d._endpoint = p;
        return d;
      }
    } catch (e){
      console.warn('endpoint failed', p, e && e.message);
      // try next
    }
  }
  throw new Error('All endpoints failed: ' + endpoints.join(','));
}

///// SAMPLE fallback so UI shows something even with a dead API /////
const SAMPLE_ITEMS = [
  { id: 's1', title: 'Sample Manga A', image: 'https://via.placeholder.com/280x420?text=Manga+A' },
  { id: 's2', title: 'Sample Manga B', image: 'https://via.placeholder.com/280x420?text=Manga+B' },
  { id: 's3', title: 'Sample Manga C', image: 'https://via.placeholder.com/280x420?text=Manga+C' }
];

///// data fetchers (robust / tolerant) /////
async function getTrending(){
  try {
    const data = await tryEndpoints([
      '/api/mangaList',
      '/api/mangaList?page=1',
      '/api/latest',
      '/api/latest-updates',
      '/api/all'
    ], d => Array.isArray(d.mangaList) || Array.isArray(d.data) || Array.isArray(d));
    if (Array.isArray(data.mangaList)) return data.mangaList;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    // try to find first array property
    for (const k of Object.keys(data||{})) {
      if (Array.isArray(data[k])) return data[k];
    }
  } catch (e) {
    console.warn('getTrending fallback', e);
  }
  showStatus('Falling back to sample trending items.', true);
  return SAMPLE_ITEMS;
}

async function getFeatured(){
  try {
    const data = await tryEndpoints([
      '/api/latest-updates',
      '/api/mangaList',
      '/api/latest'
    ], d => Array.isArray(d.data) || Array.isArray(d.mangaList) || Array.isArray(d));
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.mangaList)) return data.mangaList;
    if (Array.isArray(data)) return data;
    for (const k of Object.keys(data||{})) {
      if (Array.isArray(data[k])) return data[k];
    }
  } catch (e) {
    console.warn('getFeatured fallback', e);
  }
  return SAMPLE_ITEMS;
}

let lastSearchQuery = '', searchPage = 1;
async function searchTitles(q, page=1){
  lastSearchQuery = q;
  searchPage = page;
  if (!q) return [];
  try {
    const data = await tryEndpoints([
      `/api/search?keyword=${encodeURIComponent(q)}&page=${page}`,
      `/api/search?query=${encodeURIComponent(q)}&page=${page}`,
      `/api/mangaList?page=${page}`
    ], d => Array.isArray(d.data) || Array.isArray(d.mangaList) || Array.isArray(d));
    // compute searchNext if present
    if (data.totalPages && page < data.totalPages) {
      searchNext = `/api/search?keyword=${encodeURIComponent(q)}&page=${page+1}`;
    } else if (data.metaData && data.metaData.totalPages && page < data.metaData.totalPages) {
      searchNext = `/api/search?keyword=${encodeURIComponent(q)}&page=${page+1}`;
    } else {
      searchNext = null;
    }
    const list = data.data || data.mangaList || data;
    // if this was an unfiltered list, do client-side filter
    if (Array.isArray(list) && !/search/i.test(data._endpoint || '')) {
      const ql = q.toLowerCase();
      return list.filter(m => (m.title || m.name || '').toLowerCase().includes(ql));
    }
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('searchTitles fallback', e);
    return [];
  }
}

async function getDetails(slug){
  if (!slug) return null;
  try {
    const endpoints = [
      `/api/manga/${encodeURIComponent(slug)}`,
      `/api/mangaDetail/${encodeURIComponent(slug)}`,
      `/api/getManga/${encodeURIComponent(slug)}`,
      `/api/mangaList`
    ];
    const data = await tryEndpoints(endpoints, d => d && (d.title || d.manga || d.mangaList || d.data));
    if (Array.isArray(data.mangaList)) {
      return data.mangaList.find(x => String(x.id) === String(slug) || String(x.title).toLowerCase() === String(slug).toLowerCase()) || null;
    }
    return data.manga || data.data || data;
  } catch (e) {
    console.warn('getDetails failed', e);
    return null;
  }
}

async function getChapters(id){
  if (!id) return [];
  try {
    const endpoints = [
      `/api/chapters?mangaId=${encodeURIComponent(id)}`,
      `/api/chapters/${encodeURIComponent(id)}`,
      `/api/chapterList?mangaId=${encodeURIComponent(id)}`,
      `/api/manga/${encodeURIComponent(id)}`
    ];
    const data = await tryEndpoints(endpoints, d => Array.isArray(d.chapters) || Array.isArray(d.chapterList) || Array.isArray(d.data) || Array.isArray(d));
    if (Array.isArray(data.chapters)) return data.chapters;
    if (Array.isArray(data.chapterList)) return data.chapterList;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data)) return data;
    // no chapters found
    return [];
  } catch (e) {
    console.warn('getChapters fallback', e);
    return [];
  }
}

async function getChapterPages(chapterSlug){
  if (!chapterSlug) return [];
  try {
    const endpoints = [
      `/api/chapter/${encodeURIComponent(chapterSlug)}`,
      `/api/read/${encodeURIComponent(chapterSlug)}`,
      `/api/getChapter?chapter=${encodeURIComponent(chapterSlug)}`,
      `/api/chapterList/${encodeURIComponent(chapterSlug)}`
    ];
    const data = await tryEndpoints(endpoints, d => Array.isArray(d.pages) || Array.isArray(d.images) || Array.isArray(d.data) || Array.isArray(d));
    if (Array.isArray(data.pages)) return data.pages;
    if (Array.isArray(data.images)) return data.images;
    if (Array.isArray(data.data)) return data.data.map(x => x.url || x);
    if (Array.isArray(data)) return data;
    return [];
  } catch (e) {
    console.warn('getChapterPages failed', e);
    return [];
  }
}

///// UI renderers (use your HTML IDs) /////
function renderTrending(items){
  const list = document.getElementById('manga-list');
  if (!list) { showStatus('Missing container #manga-list', true); return; }
  list.innerHTML = '';
  items.forEach(m=>{
    const img = document.createElement('img');
    img.src = (m.image || m.cover || m.img || m.thumbnail || '');
    img.alt = (m.title || m.name || '');
    img.style.width = '160px';
    img.style.height = 'auto';
    img.style.objectFit = 'cover';
    img.onclick = ()=> openReaderInfo(m.id || m.title || m.slug || m.url, m);
    list.appendChild(img);
  });
}

function renderUpdates(items){
  const grid = document.getElementById('updates-list');
  if (!grid) { showStatus('Missing container #updates-list', true); return; }
  grid.innerHTML = '';
  items.forEach(m=>{
    const card = document.createElement('div');
    card.className = 'card';
    const img = document.createElement('img');
    img.src = (m.image || m.cover || m.img || '');
    img.alt = (m.title || m.name || '');
    img.onclick = ()=> openReaderInfo(m.id || m.title || m.slug || m.url, m);
    const meta = document.createElement('div'); meta.className = 'meta';
    const title = document.createElement('div'); title.className = 'title'; title.textContent = (m.title || m.name || '');
    meta.appendChild(title);
    card.appendChild(img); card.appendChild(meta);
    grid.appendChild(card);
  });
}

async function openReaderInfo(id, fallback){
  const d = await getDetails(id) || fallback || { title: fallback?.title || id, image: fallback?.image || '' };
  if (!d) return showStatus('Unable to load manga info', true);
  currentManga = d;
  const cover = document.getElementById('reader-cover');
  const title = document.getElementById('reader-title');
  const desc = document.getElementById('reader-description');
  if (cover) cover.src = d.image || d.cover || fallback?.image || '';
  if (title) title.textContent = d.title || d.name || id;
  if (desc) desc.textContent = d.description || d.synopsis || '';
  // populate chapters
  const chapterSel = document.getElementById('chapter');
  const pageSel = document.getElementById('page');
  if (chapterSel) chapterSel.innerHTML = '';
  if (pageSel) pageSel.innerHTML = '';
  try {
    const chs = await getChapters(d.id || id);
    const chaptersArr = (Array.isArray(chs) ? chs : []).slice().sort((a,b)=> {
      const na = parseFloat(a.chapterNumber ?? a.chapter ?? a.num ?? a.index ?? 0) || 0;
      const nb = parseFloat(b.chapterNumber ?? b.chapter ?? b.num ?? b.index ?? 0) || 0;
      return nb - na;
    });
    if (chapterSel && chaptersArr.length) {
      chaptersArr.forEach(ch => {
        const opt = document.createElement('option');
        const chapId = ch.id || ch.chapter || ch.slug || ch.name || ch.chapterNumber;
        opt.value = JSON.stringify({ mangaId: d.id || id, chapterId: chapId, chapterNumber: ch.chapterNumber || ch.chapter || ch.num || '' });
        opt.textContent = `Ch. ${ch.chapterNumber ?? ch.chapter ?? ch.num ?? chapId}` + (ch.lang ? ` (${ch.lang})` : '');
        chapterSel.appendChild(opt);
      });
      // auto-load first chapter
      const first = JSON.parse(chapterSel.value || chapterSel.options[0].value);
      await loadChapterPagesNode(first.mangaId || first.id || id, first.chapterId || first.chapterNumber);
    } else {
      // fallback: set a single sample option so UI doesn't break
      if (chapterSel) {
        const o = document.createElement('option'); o.value = JSON.stringify({ mangaId: d.id || id, chapterId: 'sample-ch1' }); o.textContent = 'Ch. 1 (sample)';
        chapterSel.appendChild(o);
      }
      currentPages = [d.image || fallback?.image || 'https://via.placeholder.com/800x1200?text=Page+1'];
      currentPageIndex = 0;
      updateReaderImage();
    }
  } catch (e) {
    console.warn('openReaderInfo chapters failed', e);
    // fallback
    currentPages = [d.image || fallback?.image || 'https://via.placeholder.com/800x1200?text=Page+1'];
    currentPageIndex = 0;
    updateReaderImage();
  }
  const modal = document.getElementById('reader-modal');
  if (modal) modal.style.display = 'flex';
}

async function loadChapterPagesNode(mangaId, chapterIdOrNumber){
  try {
    // Try chapter slug first
    let pages = await getChapterPages(chapterIdOrNumber).catch(()=>[]);
    if (!pages.length) {
      // try read endpoint with mangaId + chapter
      const p = await tryEndpoints([
        `/api/read/${encodeURIComponent(mangaId)}/${encodeURIComponent(chapterIdOrNumber)}`,
        `/api/read?mangaId=${encodeURIComponent(mangaId)}&chapter=${encodeURIComponent(chapterIdOrNumber)}`
      ], d => Array.isArray(d.data) || Array.isArray(d.pages) || Array.isArray(d.images));
      pages = p.data || p.pages || p.images || [];
    }
    // normalize
    currentPages = (pages || []).map(x => (typeof x === 'string' ? x : (x.url || x.image || ''))).filter(Boolean);
    currentPageIndex = 0;
    // populate page select
    const pageSel = document.getElementById('page');
    if (pageSel) {
      pageSel.innerHTML = '';
      currentPages.forEach((_, i) => {
        const o = document.createElement('option'); o.value = String(i); o.textContent = `Page ${i+1}`; pageSel.appendChild(o);
      });
    }
    updateReaderImage();
  } catch (e) {
    console.warn('loadChapterPagesNode failed', e);
    currentPages = [];
    updateReaderImage();
  }
}

function updateReaderImage(){
  const img = document.getElementById('reader-image');
  const pageSel = document.getElementById('page');
  if (pageSel && currentPages.length) pageSel.value = String(currentPageIndex);
  if (img) img.src = currentPages[currentPageIndex] || '';
}

function changeChapter(){ const raw = document.getElementById('chapter')?.value; if (!raw) return; const c = JSON.parse(raw); loadChapterPagesNode(c.mangaId || c.id, c.chapterId || c.chapterNumber || c.chapterId); }
function changePage(){ const idx = parseInt(document.getElementById('page')?.value || '0', 10); currentPageIndex = isNaN(idx) ? 0 : idx; updateReaderImage(); }
function prevPage(){ if (!currentPages.length) return; currentPageIndex = Math.max(0, currentPageIndex - 1); updateReaderImage(); if (document.getElementById('page')) document.getElementById('page').value = String(currentPageIndex); }
function nextPage(){ if (!currentPages.length) return; currentPageIndex = Math.min(currentPages.length - 1, currentPageIndex + 1); updateReaderImage(); if (document.getElementById('page')) document.getElementById('page').value = String(currentPageIndex); }
function closeReader(){ const modal = document.getElementById('reader-modal'); if (modal) modal.style.display = 'none'; }

///// Search modal helpers /////
function openSearchModal(){ const m = document.getElementById('search-modal'); if (m) { m.style.display = 'flex'; setTimeout(()=>document.getElementById('search-input')?.focus(), 50); } }
function closeSearchModal(){ const m = document.getElementById('search-modal'); if (m) { m.style.display = 'none'; const box = document.getElementById('search-results'); if (box) box.innerHTML = ''; } }

let searchDebounce = null;
async function searchManga(){
  const q = document.getElementById('search-input')?.value?.trim() || '';
  const box = document.getElementById('search-results');
  if (!q) { if (box) box.innerHTML = ''; return; }
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(async ()=>{
    try {
      const items = await searchTitles(q, 1);
      if (!box) return;
      box.innerHTML = '';
      items.forEach(m=>{
        const img = document.createElement('img');
        img.src = (m.image || m.cover || m.img || m.thumbnail || '');
        img.alt = (m.title || m.name || '');
        img.onclick = ()=> { closeSearchModal(); openReaderInfo(m.id || m.title || m.slug || m.url, m); };
        box.appendChild(img);
      });
      document.getElementById('search-load-more').style.display = searchNext ? 'inline-block' : 'none';
      createObserver('sentinel-search', loadMoreSearch);
    } catch (e) {
      console.warn('searchManga failed', e);
    }
  }, 260);
}

async function loadMoreSearch(){
  if (!searchNext || isLoadingSearch) return;
  isLoadingSearch = true;
  try {
    const url = new URL(searchNext, MR_BASE);
    const path = url.pathname + url.search;
    const data = await apiGet(path);
    searchNext = data.next || null;
    const items = data.mangaList || data.data || data || [];
    const box = document.getElementById('search-results');
    if (!box) return;
    items.forEach(m=>{
      const img = document.createElement('img');
      img.src = (m.image || m.cover || m.img || m.thumbnail || '');
      img.alt = (m.title || m.name || '');
      img.onclick = ()=> { closeSearchModal(); openReaderInfo(m.id || m.title || m.slug || m.url, m); };
      box.appendChild(img);
    });
    document.getElementById('search-load-more').style.display = searchNext ? 'inline-block' : 'none';
  } catch (e) {
    console.warn('loadMoreSearch failed', e);
  }
  isLoadingSearch = false;
}

///// Filters (uses trendingItems as source) /////
function updateRatingLabel(val){ const el = document.getElementById('filter-rating-value'); if (el) el.textContent = String(val); }
function applyFilters(){
  const type = document.getElementById('filter-type')?.value || 'all';
  const lang = document.getElementById('filter-lang')?.value || 'all';
  const minRating = parseInt(document.getElementById('filter-rating')?.value || '0', 10);
  const genreRaw = (document.getElementById('filter-genre')?.value || '').toLowerCase();
  const genreTerms = genreRaw.split(',').map(s=>s.trim()).filter(Boolean);
  const sort = document.getElementById('filter-sort')?.value || 'default';
  const matches = (m) => {
    const passType = (type === 'all') || (String(m.type || '').toLowerCase() === type);
    const passLang = (lang === 'all') || ((m.langs || m.language || []).map?.(x=>String(x).toLowerCase?.())?.includes(lang) ?? (String(m.lang || '').toLowerCase() === lang));
    const passRating = (typeof m.rating === 'number') ? (m.rating >= minRating) : true;
    const passGenre = genreTerms.length === 0 || genreTerms.every(term => (m.genres || []).some(g=>String(g).toLowerCase().includes(term)));
    return passType && passLang && passRating && passGenre;
  };
  const filtered = (Array.isArray(trendingItems) ? trendingItems : []).filter(matches);
  // TODO: sort if needed (basic)
  renderTrending(filtered);
}

let filtersDebounce = null;
function debouncedApplyFilters(){ if (filtersDebounce) clearTimeout(filtersDebounce); filtersDebounce = setTimeout(applyFilters, 200); }

///// infinite loading for trending & updates /////
async function loadMoreTrending(){
  if (isLoadingTrending) return;
  isLoadingTrending = true;
  window._browsePage = (window._browsePage || 1) + 1;
  try {
    const data = await apiGet(`/api/mangaList?page=${window._browsePage}`).catch(()=>null);
    const more = data ? (data.mangaList || data.data || data || []) : [];
    trendingItems = trendingItems.concat(more);
    applyFilters();
  } catch (e) {
    console.warn('loadMoreTrending failed', e);
  }
  isLoadingTrending = false;
}

async function loadMoreUpdates(){
  if (isLoadingUpdates) return;
  isLoadingUpdates = true;
  window._updatesPage = (window._updatesPage || 1) + 1;
  try {
    const data = await apiGet(`/api/mangaList?page=${window._updatesPage}`).catch(()=>null);
    const more = data ? (data.mangaList || data.data || data || []) : [];
    featuredItems = featuredItems.concat(more);
    renderUpdates(featuredItems);
  } catch (e) {
    console.warn('loadMoreUpdates failed', e);
  }
  isLoadingUpdates = false;
}

///// IntersectionObserver helper /////
function createObserver(targetId, callback){
  const el = document.getElementById(targetId);
  if (!el) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => { if (entry.isIntersecting) callback(); });
  }, { rootMargin: '200px' });
  io.observe(el);
}

///// handy API testing function (run from console) /////
window.testApi = async function testApi(endpoint = '/api/mangaList'){
  try {
    showStatus('Testing API: ' + endpoint, false, true);
    const res = await apiGet(endpoint);
    console.log('testApi response:', res);
    showStatus('API responded; see console.log for object', false, true);
    return res;
  } catch (e) {
    console.error('testApi failed', e);
    showStatus('API test failed - check console for details', true, true);
    return null;
  }
};

///// initialization (run after DOM ready) /////
async function init(){
  showStatus('Initializing MangaStream client...');
  try {
    const [t, f] = await Promise.all([getTrending(), getFeatured()]);
    trendingItems = Array.isArray(t) ? t : SAMPLE_ITEMS;
    featuredItems = Array.isArray(f) ? f : SAMPLE_ITEMS;
    renderTrending(trendingItems);
    renderUpdates(featuredItems);
    createObserver('sentinel-trending', loadMoreTrending);
    createObserver('sentinel-updates', loadMoreUpdates);
    showStatus('Ready — if UI is empty, open console and run window.testApi() to inspect API responses.');
  } catch (e) {
    console.error('init failed', e);
    renderTrending(SAMPLE_ITEMS);
    renderUpdates(SAMPLE_ITEMS);
    showStatus('Initialized with fallback content (see console).', true, true);
  }
}

document.addEventListener('DOMContentLoaded', ()=>{ setTimeout(init, 120); });

/* expose functions used by inline HTML attributes so they exist in global scope */
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.searchManga = searchManga;
window.openReaderInfo = openReaderInfo;
window.closeReader = closeReader;
window.changeChapter = changeChapter;
window.changePage = changePage;
window.prevPage = prevPage;
window.nextPage = nextPage;
window.updateRatingLabel = updateRatingLabel;
window.applyFilters = applyFilters;
window.debouncedApplyFilters = debouncedApplyFilters;
window.loadMoreTrending = loadMoreTrending;
window.loadMoreUpdates = loadMoreUpdates;
window.loadMoreSearch = loadMoreSearch;
