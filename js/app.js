const MR_BASE = 'https://mangareaderto-api.vercel.app/api/v1';

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
  const base = MR_BASE.endsWith('/') ? MR_BASE.slice(0, -1) : MR_BASE;
  const url = path.startsWith('http') ? path : `${base}${path}`;
  const res = await fetch(url);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getTrending(){
  const data = await apiGet('/trending');
  return (data.data || data) || [];
}

async function getFeatured(){
  const data = await apiGet('/latest-updates');
  return (data.data || data) || [];
}

let searchPage = 1;
let lastSearchQuery = '';
async function searchTitles(q, page=1){
  lastSearchQuery = q;
  searchPage = page;
  const data = await apiGet(`/search?keyword=${encodeURIComponent(q)}&page=${page}`);
  // This API reports totalPages; compute next
  searchNext = (data.totalPages && page < data.totalPages) ? `/search?keyword=${encodeURIComponent(q)}&page=${page+1}` : null;
  return data.data || [];
}

async function getDetails(slug){
  return await apiGet(`/api/v1/manga/${encodeURIComponent(slug)}`);
}

async function getChapterPages(chapterSlug){
  // Assumes chapter endpoint returns { pages: [url, ...] }
  const data = await apiGet(`/api/v1/chapter/${encodeURIComponent(chapterSlug)}`);
  return data.pages || [];
}

function renderTrending(items){
  const list=document.getElementById('manga-list');
  list.innerHTML='';
  items.forEach(m=>{
    const img=document.createElement('img');
    img.src=(m.cover || m.image) ; img.alt=(m.title || m.name);
    img.onclick=()=>openReaderInfo(m.id || m.slug || m.url, m);
    list.appendChild(img);
  });
}

function renderUpdates(items){
  const grid=document.getElementById('updates-list');
  grid.innerHTML='';
  items.forEach(m=>{
    const card=document.createElement('div');
    card.className='card';
    const img=document.createElement('img');
    img.src=(m.cover || m.image); img.alt=(m.title || m.name);
    img.onclick=()=>openReaderInfo(m.id || m.slug || m.url, m);
    const meta=document.createElement('div'); meta.className='meta';
    const title=document.createElement('div'); title.className='title'; title.textContent=(m.title || m.name);
    meta.appendChild(title);
    card.appendChild(img); card.appendChild(meta);
    grid.appendChild(card);
  });
}

async function getInfo(id){
  return await apiGet(`/info/${encodeURIComponent(id)}`);
}

async function getChapters(id){
  return await apiGet(`/chapters/${encodeURIComponent(id)}`);
}

async function openReaderInfo(id, fallback){
  const d = await getInfo(id);
  currentManga = d;
  document.getElementById('reader-cover').src = d.cover || fallback?.cover || fallback?.image || '';
  document.getElementById('reader-title').textContent = d.title || fallback?.title || fallback?.name || '';
  document.getElementById('reader-description').textContent = d.description || d.synopsis || '';

  // Populate chapters via /chapters/:id
  const chapterSel = document.getElementById('chapter');
  const pageSel = document.getElementById('page');
  chapterSel.innerHTML = '';
  pageSel.innerHTML = '';

  const chs = await getChapters(d.id || id);
  const chaptersArr = (chs.data || chs) || [];
  chaptersArr.forEach(ch => {
    const opt=document.createElement('option');
    // Node API uses { chapterNumber, lang, id }
    opt.value = JSON.stringify({ id: d.id || id, chapterNumber: ch.chapterNumber, lang: ch.lang || 'en' });
    opt.textContent = `Ch. ${ch.chapterNumber} (${ch.lang || 'en'})`;
    chapterSel.appendChild(opt);
  });
  if (chaptersArr.length) {
    chapterSel.value = JSON.stringify({ id: d.id || id, chapterNumber: chaptersArr[0].chapterNumber, lang: chaptersArr[0].lang || 'en' });
    const c = JSON.parse(chapterSel.value);
    await loadChapterPagesNode(c.id, c.lang, c.chapterNumber);
  }

  document.getElementById('reader-modal').style.display = 'flex';
}

async function loadChapterPagesNode(id, lang, chapterNumber){
  const data = await apiGet(`/read/${encodeURIComponent(id)}/${encodeURIComponent(lang)}/${encodeURIComponent(chapterNumber)}`);
  currentPages = (data.data || []).map(p => p.url);
  currentPageIndex = 0;
  const pageSel = document.getElementById('page');
  pageSel.innerHTML = '';
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

function changeChapter(){
  const raw=document.getElementById('chapter').value;
  if (!raw) return;
  const c = JSON.parse(raw);
  loadChapterPagesNode(c.id, c.lang, c.chapterNumber);
}
function changePage(){
  const idx=parseInt(document.getElementById('page').value||'0',10);
  currentPageIndex = isNaN(idx) ? 0 : idx;
  const url = currentPages[currentPageIndex];
  if (url) document.getElementById('reader-image').src = url;
}
function prevPage(){
  if (!currentPages.length) return;
  currentPageIndex = Math.max(0, currentPageIndex - 1);
  document.getElementById('page').value = String(currentPageIndex);
  changePage();
}
function nextPage(){
  if (!currentPages.length) return;
  currentPageIndex = Math.min(currentPages.length - 1, currentPageIndex + 1);
  document.getElementById('page').value = String(currentPageIndex);
  changePage();
}

function closeReader(){ document.getElementById('reader-modal').style.display='none'; }

async function searchManga(){
  const q=document.getElementById('search-input').value.trim();
  const box=document.getElementById('search-results'); if(!q){ box.innerHTML=''; return; }
  const items = await searchTitles(q);
  box.innerHTML='';
  items.forEach(m=>{
    const img=document.createElement('img');
    img.src=(m.cover||m.image); img.alt=(m.title||m.name||'');
    img.onclick=()=>{ closeSearchModal(); openReaderInfo(m.id || m.slug || m.url, m); };
    box.appendChild(img);
  });
  document.getElementById('search-load-more').style.display = searchNext ? 'inline-block' : 'none';
}

async function loadMoreSearch(){
  if (!searchNext || isLoadingSearch) return; isLoadingSearch = true;
  const url = new URL(searchNext, MR_BASE);
  const path = url.pathname + url.search;
  const data = await apiGet(path);
  searchNext = data.next || null;
  const items = data.data || [];
  const box=document.getElementById('search-results');
  items.forEach(m=>{
    const img=document.createElement('img');
    img.src=(m.cover||m.image); img.alt=(m.title||m.name||'');
    img.onclick=()=>{ closeSearchModal(); openReaderInfo(m.id || m.slug || m.url, m); };
    box.appendChild(img);
  });
  document.getElementById('search-load-more').style.display = searchNext ? 'inline-block' : 'none';
  isLoadingSearch = false;
}

function openSearchModal(){ const m=document.getElementById('search-modal'); m.style.display='flex'; setTimeout(()=>document.getElementById('search-input').focus(),0); }
function closeSearchModal(){ const m=document.getElementById('search-modal'); m.style.display='none'; document.getElementById('search-results').innerHTML=''; }

async function init(){
  const [t, f] = await Promise.all([getTrending(), getFeatured()]);
  trendingItems = t.slice();
  featuredItems = f.slice();
  renderTrending(trendingItems);
  renderUpdates(featuredItems);
  // attach infinite scroll observers
  createObserver('sentinel-trending', loadMoreTrending);
  createObserver('sentinel-updates', loadMoreUpdates);
}

init();

// Filters and pagination
function updateRatingLabel(val){ const el=document.getElementById('filter-rating-value'); if(el) el.textContent = String(val); }

function applyFilters(){
  const type = document.getElementById('filter-type').value;
  const lang = document.getElementById('filter-lang').value;
  const minRating = parseInt(document.getElementById('filter-rating').value||'0',10);
  const genreRaw = (document.getElementById('filter-genre').value||'').toLowerCase();
  const genreTerms = genreRaw.split(',').map(s=>s.trim()).filter(Boolean);
  const sort = document.getElementById('filter-sort').value;
  const matches = (m)=>{
    const passType = (type==='all') || (m.type?.toLowerCase?.()===type);
    const passLang = (lang==='all') || (m.langs||[]).map(x=>String(x).toLowerCase()).includes(lang);
    const passRating = (typeof m.rating==='number') ? (m.rating>=minRating) : true;
    const passGenre = genreTerms.length===0 || genreTerms.every(term => (m.genres||[]).some(g=>String(g).toLowerCase().includes(term)));
    return passType && passLang && passRating && passGenre;
  };
  const filtered = trendingItems.filter(matches);
  renderTrending(filtered);
}

let debounceTimer = null;
function debouncedApplyFilters(){ clearTimeout(debounceTimer); debounceTimer = setTimeout(applyFilters, 250); }

async function loadMoreTrending(){
  if (isLoadingTrending) return; isLoadingTrending = true;
  // For Node API, trending is not paginated; fall back to browse all
  const type = document.getElementById('filter-type').value || 'all';
  const sort = document.getElementById('filter-sort').value || 'default';
  window._browsePage = (window._browsePage||1) + 1;
  const query = type==='all' ? 'all' : type;
  const data = await apiGet(`/all/${encodeURIComponent(query)}?sort=${encodeURIComponent(sort)}&page=${window._browsePage}`);
  const more = data.data || [];
  trendingItems = trendingItems.concat(more);
  applyFilters();
  isLoadingTrending = false;
}

async function loadMoreUpdates(){
  if (isLoadingUpdates) return; isLoadingUpdates = true;
  // For Node API, fallback to browse all page increment
  window._updatesPage = (window._updatesPage||1) + 1;
  const data = await apiGet(`/all/all?sort=latest&page=${window._updatesPage}`);
  const more = data.data || [];
  featuredItems = featuredItems.concat(more);
  renderUpdates(featuredItems);
  isLoadingUpdates = false;
}

// Simple IntersectionObserver helper
function createObserver(targetId, callback){
  const el = document.getElementById(targetId);
  if (!el) return;
  const io = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{ if (entry.isIntersecting) callback(); });
  });
  io.observe(el);
}

