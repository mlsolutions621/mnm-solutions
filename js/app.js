const MD_API = 'https://api.mangadex.org';
const MD_COVER = 'https://uploads.mangadex.org/covers';

let currentManga = null;
let currentChapter = null;
let currentPages = [];

function titleOf(manga){
  const a=manga?.attributes; if(!a) return 'Untitled';
  return a.title?.en || (a.altTitles?.find(t=>t.en)?.en) || Object.values(a.title||{})[0] || 'Untitled';
}

function coverFile(manga){
  const rel = manga?.relationships?.find(r=>r.type==='cover_art');
  return rel?.attributes?.fileName || '';
}

function coverUrl(manga){
  const f=coverFile(manga); if(!f) return '';
  return `${MD_COVER}/${manga.id}/${f}.256.jpg`;
}

async function fetchTrending(){
  const res = await fetch(`${MD_API}/manga?includes[]=cover_art&order[followedCount]=desc&limit=24`);
  const data = await res.json();
  return data.data || [];
}

async function fetchLatestUpdates(){
  const res = await fetch(`${MD_API}/chapter?translatedLanguage[]=en&order[readableAt]=desc&limit=24&includes[]=scanlation_group&includes[]=manga`);
  const data = await res.json();
  return data.data || [];
}

function renderTrending(items){
  const list=document.getElementById('manga-list');
  list.innerHTML='';
  items.forEach(m=>{
    const img=document.createElement('img');
    img.src=coverUrl(m);
    img.alt=titleOf(m);
    img.onclick=()=>openReader(m);
    list.appendChild(img);
  });
}

function renderUpdates(items){
  const grid=document.getElementById('updates-list');
  grid.innerHTML='';
  items.forEach(ch=>{
    const manga = (ch.relationships||[]).find(r=>r.type==='manga');
    if(!manga) return;
    const card=document.createElement('div');
    card.className='card';
    const img=document.createElement('img');
    img.src=coverUrl(manga);
    img.alt=titleOf(manga);
    img.onclick=()=>openReader(manga);
    const meta=document.createElement('div');
    meta.className='meta';
    const title=document.createElement('div');
    title.className='title';
    title.textContent = `${titleOf(manga)} — Ch. ${ch.attributes?.chapter || ''}`;
    meta.appendChild(title);
    card.appendChild(img); card.appendChild(meta);
    grid.appendChild(card);
  });
}

async function fetchChapters(mangaId){
  const res = await fetch(`${MD_API}/chapter?manga=${mangaId}&translatedLanguage[]=en&order[chapter]=asc&limit=100`);
  const data = await res.json();
  return (data.data||[]).filter(c=>c.attributes?.pages>0);
}

async function fetchAtHome(chapterId){
  const res = await fetch(`${MD_API}/at-home/server/${chapterId}`);
  return await res.json();
}

async function openReader(manga){
  currentManga=manga;
  document.getElementById('reader-cover').src=coverUrl(manga);
  document.getElementById('reader-title').textContent=titleOf(manga);
  document.getElementById('reader-description').textContent=manga.attributes?.description?.en || '';

  const chapters=await fetchChapters(manga.id);
  const sel=document.getElementById('chapter'); sel.innerHTML='';
  chapters.forEach(ch=>{
    const opt=document.createElement('option');
    opt.value=ch.id; opt.textContent=`Ch. ${ch.attributes.chapter || ch.id.slice(0,6)}`;
    sel.appendChild(opt);
  });
  if(chapters.length){ sel.value=chapters[0].id; await loadChapter(chapters[0].id); }

  document.getElementById('reader-modal').style.display='flex';
}

async function loadChapter(chapterId){
  const atHome=await fetchAtHome(chapterId);
  const base=atHome.baseUrl; const chapter=atHome.chapter;
  currentChapter=chapterId; currentPages=chapter.data||[];
  const pageSel=document.getElementById('page'); pageSel.innerHTML='';
  currentPages.forEach((_,i)=>{ const o=document.createElement('option'); o.value=String(i); o.textContent=`Page ${i+1}`; pageSel.appendChild(o); });
  if(currentPages.length){
    pageSel.value='0';
    const url = `${base}/data/${chapter.hash}/${currentPages[0]}`;
    const img=document.getElementById('reader-image');
    img.src=url; img.setAttribute('data-base', `${base}/data/${chapter.hash}`);
  }
}

function changeChapter(){ const id=document.getElementById('chapter').value; loadChapter(id); }
function changePage(){ const i=parseInt(document.getElementById('page').value||'0',10); const base=document.getElementById('reader-image').getAttribute('data-base'); const f=currentPages[i]; if(f&&base){ document.getElementById('reader-image').src=`${base}/${f}`; } }
function prevPage(){ const sel=document.getElementById('page'); const i=Math.max(0,(parseInt(sel.value||'0',10)-1)); sel.value=String(i); changePage(); }
function nextPage(){ const sel=document.getElementById('page'); const i=Math.min(currentPages.length-1,(parseInt(sel.value||'0',10)+1)); sel.value=String(i); changePage(); }

function closeReader(){ document.getElementById('reader-modal').style.display='none'; document.getElementById('reader-image').src=''; }

async function searchManga(){
  const q=document.getElementById('search-input').value.trim();
  const box=document.getElementById('search-results'); if(!q){ box.innerHTML=''; return; }
  const res=await fetch(`${MD_API}/manga?title=${encodeURIComponent(q)}&includes[]=cover_art&limit=40`);
  const data=await res.json(); const items=data.data||[]; box.innerHTML='';
  items.forEach(m=>{ const img=document.createElement('img'); img.src=coverUrl(m); img.alt=titleOf(m); img.onclick=()=>{ closeSearchModal(); openReader(m); }; box.appendChild(img); });
}

function openSearchModal(){ const m=document.getElementById('search-modal'); m.style.display='flex'; setTimeout(()=>document.getElementById('search-input').focus(),0); }
function closeSearchModal(){ const m=document.getElementById('search-modal'); m.style.display='none'; document.getElementById('search-results').innerHTML=''; }

async function init(){
  const [trending, updates] = await Promise.all([fetchTrending(), fetchLatestUpdates()]);
  renderTrending(trending);
  renderUpdates(updates);
}

init();

