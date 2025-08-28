const MR_BASE = 'https://mangareader-api.vercel.app';

let currentManga = null;
let currentExternalUrl = '';

async function apiGet(path){
  const res = await fetch(`${MR_BASE}${path}`);
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getTrending(){
  const data = await apiGet('/api/v1/trending');
  return data.data || [];
}

async function getFeatured(){
  const data = await apiGet('/api/v1/featured');
  return data.data || [];
}

async function searchTitles(q){
  const data = await apiGet(`/api/v1/search/${encodeURIComponent(q)}`);
  return data.data || [];
}

async function getDetails(slug){
  return await apiGet(`/api/v1/manga/${encodeURIComponent(slug)}`);
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

  // External fallback to real reader on MangaReader
  currentExternalUrl = `https://mangareader.to/manga/${slug}`;
  const btn = document.getElementById('read-external');
  if (btn) { btn.onclick = () => window.open(currentExternalUrl, '_blank'); }

  // Clear chapter/page selectors (no in-app pages without backend adapter)
  document.getElementById('chapter').innerHTML = '';
  document.getElementById('page').innerHTML = '';
  document.getElementById('reader-image').src = '';

  document.getElementById('reader-modal').style.display = 'flex';
}

function changeChapter(){}
function changePage(){}
function prevPage(){}
function nextPage(){}

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
  const [trending, featured] = await Promise.all([getTrending(), getFeatured()]);
  renderTrending(trending);
  renderUpdates(featured);
}

init();

