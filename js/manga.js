const MD_API = 'https://api.mangadex.org';
const MD_COVER = 'https://uploads.mangadex.org/covers';

let currentManga = null;
let currentChapter = null;
let currentPages = [];

async function fetchTrendingManga() {
  const res = await fetch(`${MD_API}/manga?includes[]=cover_art&order[followedCount]=desc&limit=24`);
  const data = await res.json();
  return data.data || [];
}

function getTitle(manga) {
  const attrs = manga?.attributes;
  if (!attrs) return 'Untitled';
  const en = attrs.title?.en;
  const alt = attrs.altTitles?.find(t => t.en)?.en;
  return en || alt || Object.values(attrs.title || {})[0] || 'Untitled';
}

function getCoverFile(manga) {
  const rel = manga?.relationships?.find(r => r.type === 'cover_art');
  return rel?.attributes?.fileName || '';
}

function buildCoverUrl(manga) {
  const cover = getCoverFile(manga);
  if (!cover) return '';
  return `${MD_COVER}/${manga.id}/${cover}.256.jpg`;
}

function displayMangaList(items, containerId) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  items.forEach(manga => {
    const img = document.createElement('img');
    img.src = buildCoverUrl(manga);
    img.alt = getTitle(manga);
    img.onclick = () => openReader(manga);
    container.appendChild(img);
  });
}

async function fetchChapters(mangaId) {
  const res = await fetch(`${MD_API}/chapter?manga=${mangaId}&translatedLanguage[]=en&order[chapter]=asc&limit=100`);
  const data = await res.json();
  return (data.data || []).filter(c => c.attributes?.pages > 0);
}

async function fetchAtHomeServer(chapterId) {
  const res = await fetch(`${MD_API}/at-home/server/${chapterId}`);
  return await res.json();
}

async function openReader(manga) {
  currentManga = manga;
  document.getElementById('reader-cover').src = buildCoverUrl(manga);
  document.getElementById('reader-title').textContent = getTitle(manga);
  document.getElementById('reader-description').textContent = manga.attributes?.description?.en || '';

  const chapters = await fetchChapters(manga.id);
  const chapterSelect = document.getElementById('chapter');
  chapterSelect.innerHTML = '';
  chapters.forEach(ch => {
    const num = ch.attributes.chapter || ch.id.substring(0, 6);
    const opt = document.createElement('option');
    opt.value = ch.id;
    opt.textContent = `Ch. ${num}`;
    chapterSelect.appendChild(opt);
  });

  if (chapters.length > 0) {
    chapterSelect.value = chapters[0].id;
    await loadChapter(chapters[0].id);
  } else {
    document.getElementById('page').innerHTML = '';
    document.getElementById('reader-image').src = '';
  }

  document.getElementById('reader-modal').style.display = 'flex';
}

async function loadChapter(chapterId) {
  const atHome = await fetchAtHomeServer(chapterId);
  const baseUrl = atHome.baseUrl;
  const chapter = atHome.chapter;
  currentChapter = chapterId;
  currentPages = chapter.data || [];

  const pageSelect = document.getElementById('page');
  pageSelect.innerHTML = '';
  currentPages.forEach((_, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = `Page ${idx + 1}`;
    pageSelect.appendChild(opt);
  });

  if (currentPages.length > 0) {
    pageSelect.value = '0';
    const url = `${baseUrl}/data/${chapter.hash}/${currentPages[0]}`;
    document.getElementById('reader-image').src = url;
    document.getElementById('reader-image').setAttribute('data-base', `${baseUrl}/data/${chapter.hash}`);
  }
}

function changeChapter() {
  const chapterId = document.getElementById('chapter').value;
  loadChapter(chapterId);
}

function changePage() {
  const idx = parseInt(document.getElementById('page').value, 10) || 0;
  const base = document.getElementById('reader-image').getAttribute('data-base');
  const file = currentPages[idx];
  if (file && base) {
    document.getElementById('reader-image').src = `${base}/${file}`;
  }
}

function closeReader() {
  document.getElementById('reader-modal').style.display = 'none';
  document.getElementById('reader-image').src = '';
}

async function searchManga() {
  const q = document.getElementById('search-input').value.trim();
  const container = document.getElementById('search-results');
  if (!q) { container.innerHTML = ''; return; }
  const res = await fetch(`${MD_API}/manga?title=${encodeURIComponent(q)}&includes[]=cover_art&limit=30`);
  const data = await res.json();
  const items = data.data || [];
  container.innerHTML = '';
  items.forEach(manga => {
    const img = document.createElement('img');
    img.src = buildCoverUrl(manga);
    img.alt = getTitle(manga);
    img.onclick = () => { closeSearchModal(); openReader(manga); };
    container.appendChild(img);
  });
}

function openSearchModal() {
  document.getElementById('search-modal').style.display = 'flex';
  document.getElementById('search-input').focus();
}

function closeSearchModal() {
  document.getElementById('search-modal').style.display = 'none';
  document.getElementById('search-results').innerHTML = '';
}

async function init() {
  document.getElementById('banner').style.backgroundImage = 'linear-gradient(120deg, rgba(255,0,80,0.06), rgba(0,140,255,0.03))';
  const manga = await fetchTrendingManga();
  displayMangaList(manga, 'manga-list');
}

init();

