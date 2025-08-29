/* js/app.js - MangaDex-backed client for your HTML/CSS
   Paste this over your existing js/app.js
*/

const MD_API = 'https://api.mangadex.org';

let currentManga = null;
let currentPages = [];
let currentPageIndex = 0;
let currentChapters = [];

let trendingItems = [];
let featuredItems = [];

function showStatus(msg, isError=false, persist=false){
  console[isError ? 'error' : 'log']('[MANGDEX]', msg);
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

async function mdFetch(path, opts = {}){
  const url = path.startsWith('http') ? path : (path.startsWith('/') ? `${MD_API}${path}` : `${MD_API}/${path}`);
  showStatus('Fetching: ' + url);
  try {
    const res = await fetch(url, Object.assign({cache:'no-cache'}, opts));
    if (!res.ok) {
      const txt = await res.text().catch(()=>'<no-body>');
      throw new Error(`HTTP ${res.status} ${res.statusText} - ${txt.slice(0,200)}`);
    }
    const json = await res.json();
    console.log('[mdFetch]', url, json);
    return json;
  } catch (err) {
    console.error('[mdFetch] error', err);
    if (err instanceof TypeError && /failed to fetch/i.test(String(err))) {
      showStatus('Network/CORS error when contacting MangaDex. Check console.', true, true);
    } else {
      showStatus('Request failed: ' + err.message, true, true);
    }
    throw err;
  }
}

/* Helpers to read cover filename from relationships */
function getCoverUrlFromRelationships(mangaId, relationships){
  if (!Array.isArray(relationships)) return null;
  const cover = relationships.find(r => r.type === 'cover_art' && r.attributes && r.attributes.fileName);
  if (cover && cover.attributes && cover.attributes.fileName) {
    return `https://uploads.mangadex.org/covers/${mangaId}/${cover.attributes.fileName}`;
  }
  return null;
}

/* Normalize title - prefer english, then any language */
function chooseTitle(attr){
  if (!attr) return 'Untitled';
  if (attr.title) {
    // attr.title is object: { en: '...', ja: '...', ... }
    if (attr.title.en) return attr.title.en;
    // fallback to first available
    const keys = Object.keys(attr.title);
    if (keys.length) return attr.title[keys[0]];
  }
  return attr.name || 'Untitled';
}

/* SEARCH Manga (by title) */
async function searchMangaDex(title, limit = 20){
  if (!title) return [];
  const q = `/manga?title=${encodeURIComponent(title)}&limit=${limit}&includes[]=cover_art`;
  const json = await mdFetch(q);
  const arr = (json.data || []);
  return arr.map(item => {
    const attrs = item.attributes || {};
    const id = item.id;
    const titleStr = chooseTitle(item.attributes);
    const cover = getCoverUrlFromRelationships(id, item.relationships) || '';
    const synopsis = attrs.description ? (attrs.description.en || Object.values(attrs.description)[0] || '') : '';
    const type = attrs.publicationDemographic || attrs.originalLanguage || '';
    return { id, title: titleStr, cover, synopsis, raw: item };
  });
}

/* GET manga details (includes cover) */
async function getMangaDetails(mangaId){
  const json = await mdFetch(`/manga/${encodeURIComponent(mangaId)}?includes[]=cover_art`);
  if (!json || !json.data) return null;
  const item = json.data;
  const attrs = item.attributes || {};
  const titleStr = chooseTitle(attrs);
  const cover = getCoverUrlFromRelationships(item.id, item.relationships) || '';
  const synopsis = attrs.description ? (attrs.description.en || Object.values(attrs.description)[0] || '') : '';
  return {
    id: item.id,
    title: titleStr,
    cover,
    synopsis,
    raw: item
  };
}

/* GET chapters (English by default) - returns array of { id, chapter, title, hash? } */
async function getChaptersForManga(mangaId, translatedLanguage='en', limit=500){
  // MangaDex supports multiple pages; we request with high limit (max 500 per page)
  // We'll order chapters by chapter desc (newest first)
  const url = `/chapter?manga=${encodeURIComponent(mangaId)}&translatedLanguage[]=${encodeURIComponent(translatedLanguage)}&limit=${limit}&order[chapter]=desc`;
  const json = await mdFetch(url);
  const arr = (json.data || []);
  // map to easier shape
  const chapters = arr.map(ch => {
    const a = ch.attributes || {};
    // Some chapters may have no numeric chapter (specials); use chapter or volume+title
    return {
      id: ch.id,
      chapter: a.chapter || a.externalUrl || '0',
      title: a.title || '',
      hash: a.hash || null,
      raw: ch
    };
  });
  // sort by numeric chapter if available (desc)
  chapters.sort((A,B)=>{
    const na = parseFloat(A.chapter) || 0;
    const nb = parseFloat(B.chapter) || 0;
    return nb - na;
  });
  return chapters;
}

/* GET pages for a chapter via MangaDex@Home
   Returns array of full image URLs.
*/
async function getChapterPages(chapterId){
  // Step 1: call /at-home/server/{chapterId}
  const json = await mdFetch(`/at-home/server/${encodeURIComponent(chapterId)}`);
  // expected shape: { baseUrl, chapter: { hash, data: [ filenames ] } }
  if (!json || !json.baseUrl || !json.chapter) return [];
  const base = json.baseUrl;
  const ch = json.chapter;
  const hash = ch.hash;
  const files = ch.data || [];
  // build URLs: {base}/data/{hash}/{filename}
  const urls = files.map(fname => `${base}/data/${hash}/${fname}`);
  return urls;
}

/* Small wrapper: search -> show results in UI */
async function performSearchAndRender(q){
  try {
    const items = await searchMangaDex(q);
    const box = document.getElementById('search-results');
    if (!box) return;
    box.innerHTML = '';
    items.forEach(m=>{
      const img = document.createElement('img');
      img.src = m.cover || 'https://via.placeholder.com/280x420?text=No+Cover';
      img.alt = m.title;
      img.onclick = ()=> { closeSearchModal(); openReaderInfo(m.id, m); };
      box.appendChild(img);
    });
  } catch (e) {
    console.error('performSearchAndRender', e);
    showStatus('Search failed — check console (maybe CORS?)', true, true);
  }
}

/* UI rendering for trending/updates */
function renderTrending(items){
  const list = document.getElementById('manga-list');
  if (!list) { showStatus('Missing container #manga-list', true); return; }
  list.innerHTML = '';
  items.forEach(m=>{
    const img = document.createElement('img');
    img.src = m.cover || 'https://via.placeholder.com/280x420?text=No+Cover';
    img.alt = m.title;
    img.onclick = ()=> openReaderInfo(m.id, m);
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
    img.src = m.cover || 'https://via.placeholder.com/280x420?text=No+Cover';
    img.alt = m.title;
    img.onclick = ()=> openReaderInfo(m.id, m);
    const meta = document.createElement('div'); meta.className = 'meta';
    const title = document.createElement('div'); title.className = 'title'; title.textContent = m.title;
    meta.appendChild(title);
    card.appendChild(img); card.appendChild(meta);
    grid.appendChild(card);
  });
}

/* open reader UI: fetch details, chapters, and preload first chapter pages */
async function openReaderInfo(mangaId, fallback=null){
  try {
    showStatus('Loading manga details...');
    const details = await getMangaDetails(mangaId);
    currentManga = details || fallback || { id: mangaId, title: fallback?.title || mangaId, cover: fallback?.cover || '' };
    // populate reader metadata
    const coverEl = document.getElementById('reader-cover');
    const titleEl = document.getElementById('reader-title');
    const descEl = document.getElementById('reader-description');
    if (coverEl) coverEl.src = currentManga.cover || 'https://via.placeholder.com/160x240?text=No+Cover';
    if (titleEl) titleEl.textContent = currentManga.title || 'Untitled';
    if (descEl) descEl.textContent = currentManga.synopsis || '';
    // chapters
    showStatus('Fetching chapters (English)...');
    const chs = await getChaptersForManga(currentManga.id, 'en', 500);
    currentChapters = chs;
    const chapterSel = document.getElementById('chapter');
    const pageSel = document.getElementById('page');
    if (chapterSel) chapterSel.innerHTML = '';
    if (pageSel) pageSel.innerHTML = '';
    if (Array.isArray(chs) && chs.length){
      chs.forEach(ch=>{
        const opt = document.createElement('option');
        opt.value = JSON.stringify({ chapterId: ch.id, chapterNum: ch.chapter });
        const text = `Ch. ${ch.chapter || '—'}${ ch.title ? ' — '+ch.title : '' }`;
        opt.textContent = text;
        chapterSel.appendChild(opt);
      });
      // auto-select first (newest)
      const first = JSON.parse(chapterSel.value || chapterSel.options[0].value);
      await loadChapterPagesNode(first.chapterId);
    } else {
      // no chapters found — show cover as single page
      currentPages = [currentManga.cover || 'https://via.placeholder.com/800x1200?text=No+Pages'];
      currentPageIndex = 0;
      updateReaderImage();
    }
    const modal = document.getElementById('reader-modal');
    if (modal) modal.style.display = 'flex';
  } catch (e) {
    console.error('openReaderInfo error', e);
    showStatus('Failed to open reader — see console', true, true);
  }
}

/* load pages for a chapter id */
async function loadChapterPagesNode(chapterId){
  try {
    showStatus('Getting pages for chapter...');
    const pages = await getChapterPages(chapterId);
    if (!pages || !pages.length) {
      showStatus('No pages returned for chapter.', true, true);
      currentPages = [];
    } else {
      currentPages = pages;
      showStatus(`Loaded ${pages.length} pages.`);
    }
    currentPageIndex = 0;
    // fill page select
    const pageSel = document.getElementById('page');
    if (pageSel) {
      pageSel.innerHTML = '';
      currentPages.forEach((_, i) => {
        const o = document.createElement('option'); o.value = String(i); o.textContent = `Page ${i+1}`;
        pageSel.appendChild(o);
      });
    }
    updateReaderImage();
  } catch (e) {
    console.error('loadChapterPagesNode', e);
    showStatus('Error loading chapter pages (see console).', true, true);
  }
}

function updateReaderImage(){
  const img = document.getElementById('reader-image');
  const pageSel = document.getElementById('page');
  if (pageSel && currentPages.length) pageSel.value = String(currentPageIndex);
  if (img) img.src = currentPages[currentPageIndex] || '';
}

function changeChapter(){ const raw = document.getElementById('chapter')?.value; if (!raw) return; const c = JSON.parse(raw); loadChapterPagesNode(c.chapterId); }
function changePage(){ const idx = parseInt(document.getElementById('page')?.value || '0',10); currentPageIndex = isNaN(idx) ? 0 : idx; updateReaderImage(); }
function prevPage(){ if (!currentPages.length) return; currentPageIndex = Math.max(0, currentPageIndex - 1); updateReaderImage(); if (document.getElementById('page')) document.getElementById('page').value = String(currentPageIndex); }
function nextPage(){ if (!currentPages.length) return; currentPageIndex = Math.min(currentPages.length - 1, currentPageIndex + 1); updateReaderImage(); if (document.getElementById('page')) document.getElementById('page').value = String(currentPageIndex); }
function closeReader(){ const modal = document.getElementById('reader-modal'); if (modal) modal.style.display = 'none'; }

/* Search modal helpers */
function openSearchModal(){ const m = document.getElementById('search-modal'); if (m) { m.style.display = 'flex'; setTimeout(()=>document.getElementById('search-input')?.focus(),50); } }
function closeSearchModal(){ const m = document.getElementById('search-modal'); if (m) { m.style.display = 'none'; const box = document.getElementById('search-results'); if (box) box.innerHTML = ''; } }

let searchTimer = null;
async function onSearchInput(){
  const q = document.getElementById('search-input')?.value?.trim() || '';
  const box = document.getElementById('search-results');
  if (!q) { if (box) box.innerHTML = ''; return; }
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(()=>performSearchAndRender(q), 300);
}

/* Fetch trending and featured from MD with safe fallbacks */
async function getTrendingFromMD(){
  try {
    // order by number of follows (popular). If API doesn't support ordering, this will still try.
    const json = await mdFetch(`/manga?limit=20&order[followedCount]=desc&includes[]=cover_art`);
    const arr = json.data || [];
    return arr.map(it => ({
      id: it.id,
      title: chooseTitle(it.attributes),
      cover: getCoverUrlFromRelationships(it.id, it.relationships)
    }));
  } catch (e){
    console.warn('getTrendingFromMD failed', e);
    return [];
  }
}
async function getLatestFromMD(){
  try {
    const json = await mdFetch(`/manga?limit=20&order[updatedAt]=desc&includes[]=cover_art`);
    const arr = json.data || [];
    return arr.map(it => ({
      id: it.id,
      title: chooseTitle(it.attributes),
      cover: getCoverUrlFromRelationships(it.id, it.relationships)
    }));
  } catch (e){
    console.warn('getLatestFromMD failed', e);
    return [];
  }
}

/* Initialization */
async function init(){
  showStatus('Initializing (MangaDex)…');
  try {
    const [t, f] = await Promise.all([getTrendingFromMD(), getLatestFromMD()]);
    trendingItems = t.length ? t : [
      {id:'', title:'No trending found', cover:''}
    ];
    featuredItems = f.length ? f : [
      {id:'', title:'No updates found', cover:''}
    ];
    renderTrending(trendingItems);
    renderUpdates(featuredItems);
    showStatus('Ready — use Search to find manga. Run window.testMangaDex() to debug.');
  } catch (e) {
    console.error('init failed', e);
    showStatus('Initialization failed (see console).', true, true);
  }
}

/* Quick test function to run from console: searches "One Punch Man", fetches first manga details and first chapter pages */
window.testMangaDex = async function testMangaDex(){
  try {
    console.log('Testing MangaDex API: searching One Punch Man...');
    const found = await searchMangaDex('One Punch Man', 5);
    console.log('search result:', found);
    if (!found.length) { alert('No results'); return; }
    const detail = await getMangaDetails(found[0].id);
    console.log('detail:', detail);
    const chapters = await getChaptersForManga(found[0].id, 'en', 50);
    console.log('chapters (first 10):', chapters.slice(0,10));
    if (chapters.length) {
      const pages = await getChapterPages(chapters[0].id);
      console.log('first chapter pages (first 5):', pages.slice(0,5));
      alert('MangaDex test succeeded — check console for objects');
    } else {
      alert('No chapters found for this manga in English (check console)');
    }
  } catch (e) {
    console.error('testMangaDex failed', e);
    alert('test failed — check console for details (possible CORS or network issue).');
  }
};

/* expose functions used by HTML attributes */
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.searchManga = onSearchInput;
window.openReaderInfo = openReaderInfo;
window.closeReader = closeReader;
window.changeChapter = changeChapter;
window.changePage = changePage;
window.prevPage = prevPage;
window.nextPage = nextPage;
window.updateRatingLabel = function(v){ const el=document.getElementById('filter-rating-value'); if(el) el.textContent = String(v); };
window.applyFilters = function(){ /* you can wire filters to query MD or filter local */ showStatus('Filters are UI-only with MD client (not applied).'); };

/* init after DOM ready */
document.addEventListener('DOMContentLoaded', ()=>{ setTimeout(init, 120); });
