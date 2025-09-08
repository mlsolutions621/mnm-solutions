/* js/app.js - MangaStream Frontend (Connected to YOUR Render API)
   Backend: https://mnm-solutions.onrender.com
*/

const MR_BASE = (window.MR_BASE_OVERRIDE || 'https://mnm-solutions.onrender.com').replace(/\/+$/, '');

let currentManga = null, currentPages = [], currentPageIndex = 0;
let trendingItems = [], featuredItems = [], searchNext = null;
let isLoadingSearch = false, isLoadingTrending = false, isLoadingUpdates = false;

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
  const url = path.startsWith('http') ? path : (path.startsWith('/') ? `${MR_BASE}${path}` : `${MR_BASE}/${path}`);
  showStatus('Fetching: ' + url);
  try {
    const res = await fetch(url, Object.assign({cache:'no-cache'}, opts));
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
    if (err instanceof TypeError && /failed to fetch/i.test(String(err))) {
      showStatus('Network/CORS error when contacting MangaStream API. See console.', true, true);
    } else {
      showStatus('Request failed: ' + (err.message || err), true, true);
    }
    throw err;
  }
}

/* ---- FETCHERS (CONNECTED TO YOUR API) ---- */

// Dummy for now — you can implement later
async function getTrending(){
  return [
    { id: 'a-returners-magic-should-be-special-manga', title: 'A Returner\'s Magic Should Be Special', image: 'https://www.mangaread.org/wp-content/uploads/2023/04/download-150x150.jpeg' },
    { id: 'solo-leveling', title: 'Solo Leveling', image: 'https://via.placeholder.com/280x420?text=Solo+Leveling' }
  ];
}

// Dummy for now — you can implement later
async function getFeatured(){
  return [
    { id: 'a-returners-magic-should-be-special-manga', title: 'A Returner\'s Magic Should Be Special', image: 'https://www.mangaread.org/wp-content/uploads/2023/04/download-150x150.jpeg' },
    { id: 'solo-leveling', title: 'Solo Leveling', image: 'https://via.placeholder.com/280x420?text=Solo+Leveling' }
  ];
}

// Dummy for now — you can implement search later
async function searchTitles(q, page = 1){
  if (!q) return [];
  // You can implement real search later via your backend
  return [
    { id: 'a-returners-magic-should-be-special-manga', title: 'A Returner\'s Magic Should Be Special', image: 'https://www.mangaread.org/wp-content/uploads/2023/04/download-150x150.jpeg' }
  ];
}

// Dummy — since your backend doesn't have /api/manga/:id yet
async function getInfo(id){
  return {
    id: id,
    title: id.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
    image: 'https://www.mangaread.org/wp-content/uploads/2023/04/download-150x150.jpeg',
    description: 'Description not available yet. This is a placeholder.'
  };
}

// ✅ CONNECTED TO YOUR BACKEND
async function getChapters(mangaSlug) {
  if (!mangaSlug) return [];
  try {
    const data = await apiGet(`/api/chapters/${encodeURIComponent(mangaSlug)}?start=1&end=50`);
    if (!data.success) throw new Error(data.error);
    return data.chapters.map((link, idx) => ({
      id: `ch-${idx}`,
      slug: link.trim(), // 👈 CRITICAL: Clean whitespace
      chapterNumber: link.match(/chapter-(\d+)/i)?.[1] || `Chapter ${idx + 1}`
    }));
  } catch(e){ console.warn('getChapters error', e); }
  return [];
}

// ✅ CONNECTED TO YOUR BACKEND
async function getChapterPages(chapterLink) {
  if (!chapterLink) return [];
  try {
    const res = await fetch(`${MR_BASE}/api/chapter/images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_link: chapterLink })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.images || [];
  } catch(e){ console.warn('getChapterPages error', e); }
  return [];
}

/* ---- UI rendering ---- */

function renderTrending(items){
  const list = document.getElementById('manga-list');
  if (!list) { showStatus('Missing container #manga-list', true); return; }
  list.innerHTML = '';
  items.forEach(m=>{
    const img = document.createElement('img');
    img.src = m.image || m.cover || m.img || '';
    img.alt = m.title || m.name || '';
    img.style.cursor = 'pointer';
    img.onclick = ()=> openReaderInfo(m.id || m.slug || m.url, m);
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
    img.src = m.image || m.cover || m.img || '';
    img.alt = m.title || m.name || '';
    img.onclick = ()=> openReaderInfo(m.id || m.slug || m.url, m);
    const meta = document.createElement('div'); meta.className='meta';
    const title = document.createElement('div'); title.className='title'; title.textContent = m.title || m.name || '';
    meta.appendChild(title);
    card.appendChild(img); card.appendChild(meta); grid.appendChild(card);
  });
}

async function openReaderInfo(id, fallback){
  const d = await getInfo(id) || fallback || null;
  if (!d) return showStatus('Could not load manga info', true);
  currentManga = d;
  document.getElementById('reader-cover').src = d.image || d.cover || fallback?.image || '';
  document.getElementById('reader-title').textContent = d.title || d.name || '';
  document.getElementById('reader-description').textContent = d.description || d.synopsis || '';
  const chapterSel = document.getElementById('chapter'); if (chapterSel) chapterSel.innerHTML = '';
  const pageSel = document.getElementById('page'); if (pageSel) pageSel.innerHTML = '';
  const chs = await getChapters(d.id || id);
  const chaptersArr = Array.isArray(chs) ? chs : [];
  chaptersArr.forEach(ch=>{
    const opt = document.createElement('option');
    const label = ch.chapterNumber || ch.chapter || ch.name || ch.title || ch.slug || '—';
    opt.value = JSON.stringify({ id: d.id || id, slug: ch.slug, chapterNumber: ch.chapterNumber || ch.chapter || '' });
    opt.textContent = `Ch. ${label}`;
    chapterSel.appendChild(opt);
  });
  if (chaptersArr.length) {
    chapterSel.value = chapterSel.options[0].value;
    const first = JSON.parse(chapterSel.value);
    await loadChapterPagesNode(first.slug || first.chapterNumber);
  } else {
    currentPages = [ d.image || fallback?.image || 'https://via.placeholder.com/800x1200?text=No+pages' ];
    currentPageIndex = 0;
    updateReaderImage();
  }
  const modal = document.getElementById('reader-modal'); if (modal) modal.style.display = 'flex';
}

async function loadChapterPagesNode(chapterSlug){
  const arr = await getChapterPages(chapterSlug);
  currentPages = (Array.isArray(arr) ? arr.map(x => (typeof x === 'string' ? x : (x.url || x.image || ''))).filter(Boolean) : []);
  currentPageIndex = 0;
  const pageSel = document.getElementById('page');
  if (pageSel) { pageSel.innerHTML = ''; currentPages.forEach((_,i)=>{ const o=document.createElement('option'); o.value=String(i); o.textContent=`Page ${i+1}`; pageSel.appendChild(o); }); }
  updateReaderImage();
}

function updateReaderImage(){
  const img = document.getElementById('reader-image');
  if (img) img.src = currentPages[currentPageIndex] || '';
  const pageSel = document.getElementById('page');
  if (pageSel) pageSel.value = String(currentPageIndex || 0);
}

function changeChapter(){ const raw=document.getElementById('chapter')?.value; if (!raw) return; const c = JSON.parse(raw); loadChapterPagesNode(c.slug || c.chapterNumber); }
function changePage(){ const idx = parseInt(document.getElementById('page')?.value || '0',10); currentPageIndex = isNaN(idx) ? 0 : idx; updateReaderImage(); }
function prevPage(){ if (!currentPages.length) return; currentPageIndex = Math.max(0, currentPageIndex-1); updateReaderImage(); }
function nextPage(){ if (!currentPages.length) return; currentPageIndex = Math.min(currentPages.length-1, currentPageIndex+1); updateReaderImage(); }
function closeReader(){ const modal = document.getElementById('reader-modal'); if (modal) modal.style.display='none'; }

/* Search UI */
async function searchManga(){
  const q = document.getElementById('search-input')?.value?.trim();
  const box = document.getElementById('search-results');
  if (!q) { if (box) box.innerHTML = ''; return; }
  try {
    const items = await searchTitles(q, 1);
    if (!box) return;
    box.innerHTML = '';
    (items || []).forEach(m=>{
      const img = document.createElement('img');
      img.src = m.image || m.cover || m.img || '';
      img.alt = m.title || m.name || '';
      img.onclick = ()=> { closeSearchModal(); openReaderInfo(m.id || m.slug || m.url, m); };
      box.appendChild(img);
    });
    document.getElementById('search-load-more').style.display = searchNext ? 'inline-block' : 'none';
    createObserver('sentinel-search', loadMoreSearch);
  } catch(e){ console.warn('searchManga failed', e); }
}

async function loadMoreSearch(){
  if (!searchNext || isLoadingSearch) return;
  isLoadingSearch = true;
  try {
    const url = new URL(searchNext, MR_BASE);
    const path = url.pathname + url.search;
    const data = await apiGet(path);
    searchNext = data.next || null;
    const items = data.data || data.mangaList || data || [];
    const box = document.getElementById('search-results'); if (!box) return;
    (items || []).forEach(m=>{
      const img = document.createElement('img');
      img.src = m.image || m.cover || '';
      img.alt = m.title || m.name || '';
      img.onclick = ()=> { closeSearchModal(); openReaderInfo(m.id || m.slug || m.url, m); };
      box.appendChild(img);
    });
  } catch(e){ console.warn('loadMoreSearch failed', e); }
  isLoadingSearch = false;
}

function openSearchModal(){ const m=document.getElementById('search-modal'); if(m){m.style.display='flex'; setTimeout(()=>document.getElementById('search-input')?.focus(),50);} }
function closeSearchModal(){ const m=document.getElementById('search-modal'); if(m){m.style.display='none'; document.getElementById('search-results').innerHTML='';} }

/* observers and loading more trending/updates */
function createObserver(targetId, callback){
  const el = document.getElementById(targetId);
  if (!el) return;
  const io = new IntersectionObserver(entries => { entries.forEach(e=>{ if (e.isIntersecting) callback(); }); }, { rootMargin: '200px' });
  io.observe(el);
}

async function loadMoreTrending(){
  if (isLoadingTrending) return; isLoadingTrending = true;
  window._browsePage = (window._browsePage||1) + 1;
  try {
    const data = await apiGet(`/api/mangaList?page=${window._browsePage}`).catch(()=>null);
    const more = data ? (data.mangaList || data.data || data || []) : [];
    trendingItems = trendingItems.concat(more);
    renderTrending(trendingItems);
  } catch(e){ console.warn('loadMoreTrending failed', e); }
  isLoadingTrending = false;
}

async function loadMoreUpdates(){
  if (isLoadingUpdates) return; isLoadingUpdates = true;
  window._updatesPage = (window._updatesPage||1) + 1;
  try {
    const data = await apiGet(`/api/mangaList?page=${window._updatesPage}`).catch(()=>null);
    const more = data ? (data.mangaList || data.data || data || []) : [];
    featuredItems = featuredItems.concat(more);
    renderUpdates(featuredItems);
  } catch(e){ console.warn('loadMoreUpdates failed', e); }
  isLoadingUpdates = false;
}

/* PDF Download Function */
async function downloadCurrentChapter() {
  if (!currentManga || !document.getElementById('chapter')?.value) {
    return showStatus('No chapter selected', true);
  }

  const chSelect = document.getElementById('chapter');
  const selected = JSON.parse(chSelect.value);
  const mangaSlug = currentManga.id || currentManga.slug;

  showStatus('Preparing PDF... This may take 1-2 minutes.');

  try {
    // Start download job
    const startRes = await fetch(`${MR_BASE}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manga_name: mangaSlug,
        chapter_link: selected.slug
      })
    });
    const startData = await startRes.json();
    if (!startData.success) throw new Error(startData.error);

    const jobId = startData.job_id;

    // Poll status every 5 seconds
    let status = 'started';
    while (status === 'started' || status === 'queued') {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await fetch(`${MR_BASE}/api/download/status/${jobId}`);
      const statusData = await statusRes.json();
      status = statusData.status;

      if (status === 'done') {
        showStatus('PDF ready! Downloading...');
        window.open(`${MR_BASE}${statusData.pdf_url}`, '_blank');
        return;
      } else if (status === 'failed') {
        throw new Error(statusData.reason);
      }
    }
  } catch (err) {
    showStatus(`Download failed: ${err.message}`, true, true);
  }
}

/* init */
async function init(){
  try {
    showStatus('Initializing MangaStream client...');
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
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.openReaderInfo = openReaderInfo;
window.closeReader = closeReader;
window.changeChapter = changeChapter;
window.changePage = changePage;
window.prevPage = prevPage;
window.nextPage = nextPage;
window.downloadCurrentChapter = downloadCurrentChapter; // Expose PDF function
