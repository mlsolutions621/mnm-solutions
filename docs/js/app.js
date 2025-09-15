// ... (keep all code up to the UI rendering section) ...

/* ---- UI rendering ---- */

function renderTrending(items){
  const list = document.getElementById('manga-list');
  if (!list) { console.warn('Missing container #manga-list'); return; }
  list.innerHTML = '';
  items.forEach(m=>{
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || '';
    img.alt = m.title || '';
    img.title = m.title || '';
    img.style.cursor = 'pointer';
    // --- MODIFIED: Open Details Modal ---
    img.onclick = ()=> openDetailsModal(m.id, m);
    list.appendChild(img);
  });
}

function renderUpdates(items){
  const grid = document.getElementById('updates-list');
  if (!grid) { console.warn('Missing container #updates-list'); return; }
  grid.innerHTML = '';
  items.forEach(m=>{
    const card = document.createElement('div'); card.className = 'card';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = m.image || '';
    img.alt = m.title || '';
    // --- MODIFIED: Open Details Modal ---
    img.onclick = ()=> openDetailsModal(m.id, m);
    const meta = document.createElement('div'); meta.className='meta';
    const title = document.createElement('div'); title.className='title'; title.textContent = m.title || '';
    const chap = document.createElement('div'); chap.className='muted'; chap.style.fontSize='13px'; chap.textContent = m.latestChapter || '';
    meta.appendChild(title);
    meta.appendChild(chap);
    card.appendChild(img); card.appendChild(meta); grid.appendChild(card);
  });
}

// --- MODIFIED: Load all chapter pages and render them as a long strip in the popup ---
// (This function remains, it's used by the popup reader when a chapter is selected)
async function loadChapterPages(mangaId, chapterId){
  console.log(`[app.js] Loading pages for chapter ${chapterId} of manga ${mangaId} (Popup)`);
  const arr = await getChapterPages(mangaId, chapterId);
  currentPages = (Array.isArray(arr) ? arr : []);

  console.log(`[app.js] Loaded ${currentPages.length} pages for popup.`);
  updateReaderImage(); // This will now render the strip
}

// --- MODIFIED: Update the reader image area in the popup to show a long strip ---
// (This function remains, it's used by the popup reader)
function updateReaderImage(){
  // Target the scrollable area inside the reader modal
  const stage = document.querySelector('#reader-modal .reader-stage');
  if (!stage) {
    console.error('[app.js] Reader stage element not found in popup');
    // Fallback to old method if stage not found (shouldn't happen with correct HTML)
    const img = document.getElementById('reader-image');
    if (img) {
      img.src = currentPages[currentPageIndex] || '';
      img.alt = `${currentManga?.title || 'Manga'} - Chapter Preview`;
    }
    return;
  }

  // Clear previous content
  stage.innerHTML = '';

  if (currentPages.length === 0) {
      stage.innerHTML = '<p style="color: red;">No pages available for this chapter.</p>';
      return;
  }

  // Create a wrapper div for all images
  const stripWrapper = document.createElement('div');
  stripWrapper.id = 'manga-strip-popup';
  stripWrapper.style.display = 'flex';
  stripWrapper.style.flexDirection = 'column';
  stripWrapper.style.alignItems = 'center';
  stripWrapper.style.gap = '10px'; // Space between images

  currentPages.forEach((url, index) => {
    const img = document.createElement('img');
    img.src = url;
    img.alt = `Page ${index + 1}`;
    img.style.width = '100%';
    img.style.maxWidth = '800px'; // Adjust as needed for popup width
    img.style.height = 'auto';
    img.style.borderRadius = '4px';
    img.style.display = 'block';
    img.loading = 'lazy';
    stripWrapper.appendChild(img);
  });

  stage.appendChild(stripWrapper);
  console.log('[app.js] Rendered chapter pages as a long strip in the popup modal.');
}

// (This function remains, it's used by the popup reader)
function changeChapter(){
  const raw = document.getElementById('chapter')?.value;
  if (!raw) return;
  const c = JSON.parse(raw);
  loadChapterPages(c.mangaId, c.chapterId);
}

// --- REMOVED: prevChapter and nextChapter functions for popup ---
// They are no longer needed as the buttons were removed from index.html
// If you need internal logic to change chapters, use changeChapter() directly.

function openDedicatedReader() {
  // This is for the "Read Full Chapter" button inside the OLD reader modal
  const chapterSel = document.getElementById('chapter');
  const chapterRaw = chapterSel?.value;
  if (!chapterRaw) return showStatus('No chapter selected', true);

  const { mangaId, chapterId } = JSON.parse(chapterRaw);

  const basePath = window.location.pathname.includes('/docs/')
    ? window.location.origin + '/mnm-solutions/docs/'
    : window.location.origin + '/mnm-solutions/';

  const url = new URL('read.html', basePath);
  url.searchParams.set('mangaId', mangaId);
  url.searchParams.set('chapterId', chapterId);
  url.searchParams.set('page', 0);

  window.location.href = url.toString();
}

function closeReader(){
  // For closing the OLD reader modal
  const modal = document.getElementById('reader-modal');
  if (modal) modal.style.display='none';
  document.body.style.overflow = '';
}

// --- NEW: Details Modal Functions ---
// (These functions remain and should now work as the HTML element exists)
async function openDetailsModal(mangaId, fallbackData) {
  console.log(`[app.js] Opening details modal for manga: ${mangaId}`);
  const mangaData = await getInfo(mangaId) || fallbackData || null;

  if (!mangaData) {
    showStatus('Could not load manga details', true);
    return;
  }

  currentDetailsMangaId = mangaData.id;

  // --- Determine the first chapter ID ---
  firstChapterIdForDetails = null;
  if (mangaData.chapters && Array.isArray(mangaData.chapters) && mangaData.chapters.length > 0) {
      const sortedChapters = [...mangaData.chapters].sort((a, b) => {
          const numA = parseFloat(a.chapterId);
          const numB = parseFloat(b.chapterId);
          if (!isNaN(numA) && !isNaN(numB)) {
              return numA - numB;
          }
          return String(a.chapterId).localeCompare(String(b.chapterId));
      });
      firstChapterIdForDetails = sortedChapters[0]?.chapterId || null;
      console.log(`[app.js] First chapter ID determined: ${firstChapterIdForDetails}`);
  } else {
      console.warn(`[app.js] No chapters found for manga ${mangaId}`);
  }

  // --- This line should now work ---
  document.getElementById('details-cover').src = mangaData.image || fallbackData?.image || '';
  document.getElementById('details-title').textContent = mangaData.title || 'Unknown Title';
  document.getElementById('details-description').textContent = mangaData.genres && mangaData.genres.length
    ? mangaData.genres.join(' • ')
    : mangaData.description || mangaData.status || 'No description available.';

  const modal = document.getElementById('details-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
}

function closeDetailsModal() {
  const modal = document.getElementById('details-modal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
  currentDetailsMangaId = null;
  firstChapterIdForDetails = null;
}

function openDedicatedReaderFromDetails() {
  if (!currentDetailsMangaId) {
    showStatus('No manga selected for reading', true);
    return;
  }
  if (!firstChapterIdForDetails) {
      showStatus('No chapters found for this manga', true);
      return;
  }

  console.log(`[app.js] Opening dedicated reader for ${currentDetailsMangaId}, chapter ${firstChapterIdForDetails}`);

  const basePath = window.location.pathname.includes('/docs/')
    ? window.location.origin + '/mnm-solutions/docs/'
    : window.location.origin + '/mnm-solutions/';

  const url = new URL('read.html', basePath);
  url.searchParams.set('mangaId', currentDetailsMangaId);
  url.searchParams.set('chapterId', firstChapterIdForDetails);
  url.searchParams.set('page', 0);

  window.location.href = url.toString();
}
// --- END NEW: Details Modal Functions ---

// ... (keep Search UI & helpers, observers, Genre Filters, init) ...

/* expose functions used by inline HTML */
window.searchManga = searchManga;
window.searchMangaDebounced = searchMangaDebounced;
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
// window.openReaderInfo = openReaderInfo; // Removed from global exposure
// window.closeReader = closeReader;       // Removed from global exposure
window.changeChapter = changeChapter;
// --- REMOVED EXPOSURE: ---
// window.prevChapter = prevChapter; // Removed exposure
// window.nextChapter = nextChapter; // Removed exposure
// --- END REMOVED EXPOSURE ---
window.loadMoreTrending = loadMoreTrending;
window.loadMoreUpdates = loadMoreUpdates;
window.loadMoreSearch = loadMoreSearch;
window.openDedicatedReader = openDedicatedReader;
window.toggleGenreFilters = toggleGenreFilters;
window.clearGenreFilters = clearGenreFilters;
// --- NEW EXPOSED FUNCTIONS ---
window.openDetailsModal = openDetailsModal;
window.closeDetailsModal = closeDetailsModal;
window.openDedicatedReaderFromDetails = openDedicatedReaderFromDetails;
