const MR_BASE = 'https://mangareader-api.vercel.app';

let currentManga = null;
let currentExternalUrl = '';
let currentPages = [];
let currentPageIndex = 0;
let currentChapterSlug = '';

let trendingItems = [];
let trendingNext = null;
let featuredItems = [];
let featuredNext = null;

async function apiGet(path){
  const res = await fetch(`${MR_BASE}${path}`);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getTrending(){
  const data = await apiGet('/api/v1/trending');
  trendingNext = data.next || null;
  return data.data || [];
}

async function getFeatured(){
  const data = await apiGet('/api/v1/featured');
  featuredNext = data.next || null;
  return data.data || [];
}

async function searchTitles(q){
  const data = await apiGet(`/api/v1/search/${encodeURIComponent(q)}`);
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
    img.src=m.cover; img.alt=m.title;
    img.onclick=()=>openReaderBySlug(m.slug, m);
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
    img.src=m.cover; img.alt=m.title;
    img.onclick=()=>openReaderBySlug(m.slug, m);
    const meta=document.createElement('div'); meta.className='meta';
    const title=document.createElement('div'); title.className='title'; title.textContent=m.title;
    meta.appendChild(title);
    card.appendChild(img); card.appendChild(meta);
    grid.appendChild(card);
  });
}

async function openReaderBySlug(slug, fallback){
  const d = await getDetails(slug);
  currentManga = d;
  document.getElementById('reader-cover').src = d.cover || fallback?.cover || '';
  document.getElementById('reader-title').textContent = d.title || fallback?.title || '';
  document.getElementById('reader-description').textContent = d.synopsis || '';

  // Populate chapters if provided (expects d.chapters as array with slug/number)
  const chapterSel = document.getElementById('chapter');
  const pageSel = document.getElementById('page');
  chapterSel.innerHTML = '';
  pageSel.innerHTML = '';

  if (Array.isArray(d.chapters) && d.chapters.length) {
    d.chapters.forEach(ch => {
      const opt=document.createElement('option');
      opt.value = ch.slug || ch.id || '';
      opt.textContent = ch.number ? `Ch. ${ch.number}` : (ch.title || 'Chapter');
      chapterSel.appendChild(opt);
    });
    const first = d.chapters[0];
    if (first?.slug || first?.id) {
      await loadChapterPages(first.slug || first.id);
      chapterSel.value = first.slug || first.id;
    }
  } else {
    // If chapters not available yet, clear stage
    document.getElementById('reader-image').src = '';
  }

  document.getElementById('reader-modal').style.display = 'flex';
}

async function loadChapterPages(chSlug){
  currentChapterSlug = chSlug;
  currentPages = await getChapterPages(chSlug);
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
  const id=document.getElementById('chapter').value;
  if (id) loadChapterPages(id);
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
    img.src=m.cover; img.alt=m.title;
    img.onclick=()=>{ closeSearchModal(); openReaderBySlug(m.slug, m); };
    box.appendChild(img);
  });
}

function openSearchModal(){ const m=document.getElementById('search-modal'); m.style.display='flex'; setTimeout(()=>document.getElementById('search-input').focus(),0); }
function closeSearchModal(){ const m=document.getElementById('search-modal'); m.style.display='none'; document.getElementById('search-results').innerHTML=''; }

async function init(){
  const [t, f] = await Promise.all([getTrending(), getFeatured()]);
  trendingItems = t.slice();
  featuredItems = f.slice();
  renderTrending(trendingItems);
  renderUpdates(featuredItems);
}

init();

// Filters and pagination
function updateRatingLabel(val){ const el=document.getElementById('filter-rating-value'); if(el) el.textContent = String(val); }

function applyFilters(){
  const type = document.getElementById('filter-type').value;
  const lang = document.getElementById('filter-lang').value;
  const minRating = parseInt(document.getElementById('filter-rating').value||'0',10);
  const genreText = (document.getElementById('filter-genre').value||'').toLowerCase();
  const matches = (m)=>{
    const passType = (type==='all') || (m.type?.toLowerCase?.()===type);
    const passLang = (lang==='all') || (m.langs||[]).map(x=>String(x).toLowerCase()).includes(lang);
    const passRating = (typeof m.rating==='number') ? (m.rating>=minRating) : true;
    const passGenre = !genreText || (m.genres||[]).some(g=>String(g).toLowerCase().includes(genreText));
    return passType && passLang && passRating && passGenre;
  };
  const filtered = trendingItems.filter(matches);
  renderTrending(filtered);
}

let debounceTimer = null;
function debouncedApplyFilters(){ clearTimeout(debounceTimer); debounceTimer = setTimeout(applyFilters, 250); }

async function loadMoreTrending(){
  if (!trendingNext) return;
  const url = new URL(trendingNext);
  const path = url.pathname + url.search;
  const data = await apiGet(path);
  trendingNext = data.next || null;
  const more = data.data || [];
  trendingItems = trendingItems.concat(more);
  applyFilters();
}

async function loadMoreUpdates(){
  if (!featuredNext) return;
  const url = new URL(featuredNext);
  const path = url.pathname + url.search;
  const data = await apiGet(path);
  featuredNext = data.next || null;
  const more = data.data || [];
  featuredItems = featuredItems.concat(more);
  renderUpdates(featuredItems);
}

