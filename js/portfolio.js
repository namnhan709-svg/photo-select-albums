/**
 * TeeMedia Studio Portfolio - Trưng bày album & hình ảnh thực tế cho khách hàng xem và chọn mẫu.
 */
(function initPortfolioHome(global) {
    const params = new URLSearchParams(global.location.search);
    if (params.has('share') || params.has('folder')) return;

    const API = global.PhotoSelectAPI;
    if (!API) return;

    const BOOKMARKS_KEY = 'teemediaPortfolioBookmarks_v1';
    const state = {
        studio: { name: 'TeeMedia Studio', phone: '0901 234 567', email: 'studio@gmail.com' },
        albums: [],
        photos: [],
        activeAlbumFilter: 'all',
        albumSearchQuery: '',
        bookmarks: new Map(),
        lightboxIndex: -1,
        visibleLightboxPhotos: []
    };

    try {
        const saved = JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '[]');
        if (Array.isArray(saved)) {
            saved.forEach(item => {
                if (item?.id) state.bookmarks.set(String(item.id), item);
            });
        }
    } catch {}

    function saveBookmarks() {
        try {
            localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...state.bookmarks.values()]));
        } catch {}
    }

    function formatDisplayDate(raw) {
        if (!raw) return 'Mới cập nhật';
        const d = new Date(String(raw).replace(' ', 'T'));
        if (Number.isNaN(d.getTime())) return String(raw);
        return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function isAcceptedImage(file) {
        const mime = String(file?.mimeType || '').toLowerCase();
        const name = String(file?.name || '').toLowerCase();
        if (mime.startsWith('image/')) return true;
        return /\.(jpg|jpeg|png|webp|avif|gif|heic|heif)$/i.test(name);
    }

    async function fetchAlbumSamplePhotos(folderId, albumName, visited = new Set()) {
        if (!folderId || visited.has(folderId)) return [];
        visited.add(folderId);
        const collected = [];
        let pageToken = '';
        let pages = 0;
        do {
            const { ok, result } = await API.driveList(folderId, pageToken);
            if (!ok || result?.error) break;
            const entries = Array.isArray(result.files) ? result.files : [];
            const imgs = entries.filter(isAcceptedImage).map(f => ({
                ...f,
                albumFolderId: folderId,
                albumName
            }));
            collected.push(...imgs);
            const folders = entries.filter(f => f.mimeType === 'application/vnd.google-apps.folder');
            if (collected.length < 18 && folders.length) {
                for (const sub of folders.slice(0, 3)) {
                    const nested = await fetchAlbumSamplePhotos(sub.id, albumName, visited);
                    collected.push(...nested);
                    if (collected.length >= 24) break;
                }
            }
            pageToken = result.nextPageToken || '';
            pages += 1;
        } while (pageToken && pages < 2 && collected.length < 48);
        return collected;
    }

    function hydrateHeroCarousel(photos) {
        const carousel = document.getElementById('weddingCarousel');
        if (!carousel || !photos.length) return;
        const slides = [...carousel.querySelectorAll('.wedding-slide')];
        if (!slides.length) return;
        const step = photos.length > slides.length ? photos.length / slides.length : 1;
        slides.forEach((slide, idx) => {
            const photo = photos[Math.min(photos.length - 1, Math.floor(idx * step))];
            if (!photo) return;
            const img = slide.querySelector('img');
            const caption = slide.querySelector('figcaption');
            if (img) {
                API.bindDriveImage(img, photo, 'thumb');
                img.alt = photo.name || photo.albumName || 'TeeMedia Portfolio';
                slide.style.cursor = 'pointer';
                slide.onclick = () => {
                    const foundIdx = getFilteredPortfolioPhotos().findIndex(p => String(p.id) === String(photo.id));
                    if (foundIdx >= 0) openPortfolioLightbox(foundIdx);
                    else if (photo.shareUrl) global.location.href = photo.shareUrl;
                };
            }
            if (caption) {
                caption.textContent = photo.albumName || 'TeeMedia Studio';
            }
        });
    }

    function renderStatsAndStudioInfo() {
        const albumStat = document.getElementById('portfolioAlbumCountStat');
        const photoStat = document.getElementById('portfolioPhotoCountStat');
        const phoneEl = document.getElementById('portfolioContactPhone');
        const emailEl = document.getElementById('portfolioContactEmail');
        if (albumStat) albumStat.textContent = String(state.albums.length);
        if (photoStat) {
            const total = state.albums.reduce((sum, a) => sum + (Number(a.photoCount) || 0), 0) || state.photos.length;
            photoStat.textContent = String(total);
        }
        if (phoneEl && state.studio.phone) {
            phoneEl.textContent = state.studio.phone;
            phoneEl.href = `tel:${state.studio.phone.replace(/\s+/g, '')}`;
        }
        if (emailEl && state.studio.email) {
            emailEl.textContent = state.studio.email;
            emailEl.href = `mailto:${state.studio.email}`;
        }
    }

    function renderAlbumCards() {
        const grid = document.getElementById('portfolioAlbumsGrid');
        if (!grid) return;
        const query = state.albumSearchQuery.trim().toLowerCase();
        const filtered = state.albums.filter(a => !query || String(a.album_name || '').toLowerCase().includes(query));

        if (!filtered.length) {
            grid.innerHTML = `<div class="portfolio-empty">
                <p>${query ? 'Không tìm thấy album phù hợp với từ khóa.' : 'Hiện chưa có album nào được đăng lên Portfolio.'}</p>
            </div>`;
            return;
        }

        grid.replaceChildren();
        filtered.forEach(album => {
            const card = document.createElement('article');
            card.className = 'portfolio-album-card';

            const visual = document.createElement('div');
            visual.className = 'portfolio-album-visual';
            const samples = Array.isArray(album.samples) ? album.samples : [];
            const coverPhoto = samples[0] || null;

            if (coverPhoto) {
                const coverImg = document.createElement('img');
                coverImg.className = 'portfolio-album-cover';
                coverImg.alt = album.album_name || 'Album ảnh';
                coverImg.loading = 'lazy';
                coverImg.decoding = 'async';
                API.bindDriveImage(coverImg, coverPhoto, 'full');
                visual.appendChild(coverImg);
            } else {
                const placeholder = document.createElement('div');
                placeholder.className = 'portfolio-album-placeholder';
                placeholder.textContent = album.loading ? 'Đang tải ảnh từ Drive...' : '📷';
                visual.appendChild(placeholder);
            }

            if (samples.length > 1) {
                const miniRow = document.createElement('div');
                miniRow.className = 'portfolio-album-mini-strip';
                samples.slice(1, 4).forEach(sample => {
                    const mini = document.createElement('img');
                    mini.alt = sample.name || album.album_name || '';
                    mini.loading = 'lazy';
                    mini.decoding = 'async';
                    API.bindDriveImage(mini, sample, 'thumb');
                    miniRow.appendChild(mini);
                });
                visual.appendChild(miniRow);
            }

            const countBadge = document.createElement('span');
            countBadge.className = 'portfolio-album-count';
            countBadge.textContent = album.photoCount ? `${album.photoCount} ảnh` : (album.loading ? 'Đang đồng bộ' : 'Album Drive');
            visual.appendChild(countBadge);

            const body = document.createElement('div');
            body.className = 'portfolio-album-body';
            const title = document.createElement('h3');
            title.textContent = album.album_name || 'Bộ sưu tập ảnh';
            const meta = document.createElement('p');
            meta.className = 'portfolio-album-meta';
            meta.textContent = `Thực hiện: ${formatDisplayDate(album.created_at)} · TeeMedia Studio`;

            const actions = document.createElement('div');
            actions.className = 'portfolio-album-actions';
            const viewLink = document.createElement('a');
            viewLink.className = 'portfolio-album-cta';
            viewLink.href = album.share_url;
            viewLink.textContent = 'Xem trọn bộ & Chọn ảnh →';

            const filterBtn = document.createElement('button');
            filterBtn.type = 'button';
            filterBtn.className = 'portfolio-album-preview-btn';
            filterBtn.textContent = 'Lọc ảnh bên dưới';
            filterBtn.addEventListener('click', event => {
                event.stopPropagation();
                state.activeAlbumFilter = String(album.folder_id);
                renderFilterTabs();
                renderPhotoGallery();
                document.getElementById('portfolioGallerySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });

            actions.append(viewLink, filterBtn);
            body.append(title, meta, actions);
            card.append(visual, body);
            card.addEventListener('click', () => {
                global.location.href = album.share_url;
            });
            grid.appendChild(card);
        });
    }

    function renderFilterTabs() {
        const container = document.getElementById('portfolioFilterTabs');
        if (!container) return;
        container.replaceChildren();
        const tabs = [
            { id: 'all', label: `Tất cả (${state.photos.length})` },
            ...state.albums
                .filter(a => (a.samples || []).length > 0)
                .map(a => ({ id: String(a.folder_id), label: `${a.album_name} (${a.samples.length})` }))
        ];
        tabs.forEach(tab => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `portfolio-filter-tab${state.activeAlbumFilter === tab.id ? ' is-active' : ''}`;
            btn.textContent = tab.label;
            btn.addEventListener('click', () => {
                state.activeAlbumFilter = tab.id;
                renderFilterTabs();
                renderPhotoGallery();
            });
            container.appendChild(btn);
        });
    }

    function getFilteredPortfolioPhotos() {
        const list = state.activeAlbumFilter === 'all'
            ? state.photos
            : state.photos.filter(p => String(p.albumFolderId) === String(state.activeAlbumFilter));
        return list.slice(0, 36);
    }

    function updateBookmarkDock() {
        const dock = document.getElementById('portfolioConceptDock');
        const countEl = document.getElementById('portfolioBookmarkCount');
        const listEl = document.getElementById('portfolioBookmarkPreview');
        const headerBadge = document.getElementById('portfolioSavedConceptBadge');
        const count = state.bookmarks.size;
        if (headerBadge) headerBadge.textContent = String(count);
        if (!dock) return;
        dock.hidden = count < 1;
        dock.classList.toggle('is-visible', count > 0);
        if (countEl) countEl.textContent = String(count);
        if (listEl) {
            const names = [...state.bookmarks.values()].slice(0, 3).map(p => p.name);
            listEl.textContent = names.join(', ') + (count > 3 ? ` và ${count - 3} ảnh khác` : '');
        }
    }

    function toggleBookmark(photo) {
        if (!photo?.id) return;
        const key = String(photo.id);
        if (state.bookmarks.has(key)) state.bookmarks.delete(key);
        else state.bookmarks.set(key, { id: key, name: photo.name || key, albumName: photo.albumName || 'Portfolio' });
        saveBookmarks();
        updateBookmarkDock();
        renderPhotoGallery();
        if (state.lightboxIndex >= 0) syncPortfolioLightboxHeart();
    }

    function renderPhotoGallery() {
        const grid = document.getElementById('portfolioPhotoGrid');
        if (!grid) return;
        const photos = getFilteredPortfolioPhotos();
        state.visibleLightboxPhotos = photos;
        if (!photos.length) {
            grid.innerHTML = '<div class="portfolio-empty"><p>Đang tải các tác phẩm nổi bật từ Google Drive...</p></div>';
            return;
        }
        grid.replaceChildren();
        photos.forEach((photo, idx) => {
            const isBookmarked = state.bookmarks.has(String(photo.id));
            const card = document.createElement('article');
            card.className = `portfolio-photo-card${isBookmarked ? ' is-selected' : ''}`;

            const img = document.createElement('img');
            img.alt = photo.name || photo.albumName || 'Ảnh TeeMedia Studio';
            img.loading = idx < 8 ? 'eager' : 'lazy';
            img.decoding = 'async';
            API.bindDriveImage(img, photo, 'thumb');

            const heartBtn = document.createElement('button');
            heartBtn.type = 'button';
            heartBtn.className = 'portfolio-photo-heart';
            heartBtn.title = isBookmarked ? 'Bỏ chọn ảnh mẫu' : 'Chọn làm ảnh mẫu';
            heartBtn.setAttribute('aria-label', heartBtn.title);
            heartBtn.textContent = isBookmarked ? '❤️' : '🤍';
            heartBtn.addEventListener('click', event => {
                event.stopPropagation();
                toggleBookmark(photo);
            });

            const caption = document.createElement('div');
            caption.className = 'portfolio-photo-caption';
            caption.innerHTML = `<strong></strong><small></small>`;
            caption.querySelector('strong').textContent = photo.albumName || 'TeeMedia Studio';
            caption.querySelector('small').textContent = photo.name || '';

            card.append(img, heartBtn, caption);
            card.addEventListener('click', () => openPortfolioLightbox(idx));
            grid.appendChild(card);
        });
    }

    function syncPortfolioLightboxHeart() {
        const btn = document.getElementById('portfolioLightboxHeart');
        const photo = state.visibleLightboxPhotos[state.lightboxIndex];
        if (!btn || !photo) return;
        const active = state.bookmarks.has(String(photo.id));
        btn.textContent = active ? '❤️ Đã chọn mẫu' : '🤍 Chọn mẫu';
        btn.classList.toggle('is-active', active);
    }

    function openPortfolioLightbox(index) {
        const photos = state.visibleLightboxPhotos;
        if (!photos.length || index < 0 || index >= photos.length) return;
        state.lightboxIndex = index;
        const photo = photos[index];
        const modal = document.getElementById('portfolioLightbox');
        const img = document.getElementById('portfolioLightboxImg');
        const title = document.getElementById('portfolioLightboxTitle');
        const albumLink = document.getElementById('portfolioLightboxAlbumLink');
        if (!modal || !img) return;
        API.bindDriveImage(img, photo, 'full');
        img.alt = photo.name || 'Ảnh Portfolio TeeMedia';
        if (title) title.textContent = `${photo.albumName || 'TeeMedia'} · ${photo.name || ''}`;
        if (albumLink) {
            albumLink.href = photo.shareUrl || '#portfolioAlbumsSection';
            albumLink.hidden = !photo.shareUrl;
        }
        syncPortfolioLightboxHeart();
        modal.classList.add('is-open');
    }

    function closePortfolioLightbox() {
        document.getElementById('portfolioLightbox')?.classList.remove('is-open');
        state.lightboxIndex = -1;
    }

    function sendConceptsToStudio() {
        const items = [...state.bookmarks.values()];
        if (!items.length) return;
        const summary = `Chào TeeMedia Studio, mình thích ${items.length} ảnh mẫu trên Portfolio:\n` +
            items.map((item, i) => `${i + 1}. ${item.name} (${item.albumName})`).join('\n');
        const chatToggle = document.getElementById('adminChatToggle');
        const chatInput = document.getElementById('adminChatInput');
        const chatContainer = document.getElementById('adminChat');
        if (chatContainer && !chatContainer.classList.contains('open')) {
            chatToggle?.click();
        }
        if (chatInput) {
            chatInput.value = summary;
            chatInput.focus();
        }
    }

    function bindPortfolioEvents() {
        document.getElementById('portfolioAlbumSearch')?.addEventListener('input', e => {
            state.albumSearchQuery = e.currentTarget.value || '';
            renderAlbumCards();
        });
        document.getElementById('portfolioLightboxClose')?.addEventListener('click', closePortfolioLightbox);
        document.getElementById('portfolioLightbox')?.addEventListener('click', e => {
            if (e.target.id === 'portfolioLightbox') closePortfolioLightbox();
        });
        document.getElementById('portfolioLightboxPrev')?.addEventListener('click', () => {
            const next = (state.lightboxIndex - 1 + state.visibleLightboxPhotos.length) % state.visibleLightboxPhotos.length;
            openPortfolioLightbox(next);
        });
        document.getElementById('portfolioLightboxNext')?.addEventListener('click', () => {
            const next = (state.lightboxIndex + 1) % state.visibleLightboxPhotos.length;
            openPortfolioLightbox(next);
        });
        document.getElementById('portfolioLightboxHeart')?.addEventListener('click', () => {
            const photo = state.visibleLightboxPhotos[state.lightboxIndex];
            if (photo) toggleBookmark(photo);
        });
        document.getElementById('portfolioSendConceptsBtn')?.addEventListener('click', sendConceptsToStudio);
        document.getElementById('portfolioClearConceptsBtn')?.addEventListener('click', () => {
            state.bookmarks.clear();
            saveBookmarks();
            updateBookmarkDock();
            renderPhotoGallery();
        });
        document.getElementById('portfolioOpenChatBtn')?.addEventListener('click', () => {
            const chat = document.getElementById('adminChat');
            if (chat && !chat.classList.contains('open')) {
                document.getElementById('adminChatToggle')?.click();
            }
            document.getElementById('adminChatInput')?.focus();
        });
        document.addEventListener('keydown', e => {
            const modal = document.getElementById('portfolioLightbox');
            if (!modal?.classList.contains('is-open')) return;
            if (e.key === 'Escape') closePortfolioLightbox();
            else if (e.key === 'ArrowLeft') document.getElementById('portfolioLightboxPrev')?.click();
            else if (e.key === 'ArrowRight') document.getElementById('portfolioLightboxNext')?.click();
        });
    }

    async function bootPortfolio() {
        bindPortfolioEvents();
        updateBookmarkDock();
        try {
            const { ok, result } = await API.callJson({ action: 'load_public_portfolio' });
            if (!ok || !result?.success) return;
            if (result.studio) state.studio = result.studio;
            state.albums = (result.albums || []).map(a => ({ ...a, loading: true, samples: [], photoCount: 0 }));
            renderStatsAndStudioInfo();
            renderAlbumCards();

            const allPhotos = [];
            await Promise.all(state.albums.map(async album => {
                const imgs = await fetchAlbumSamplePhotos(album.folder_id, album.album_name);
                album.loading = false;
                album.photoCount = imgs.length;
                album.samples = imgs.map(p => ({ ...p, shareUrl: album.share_url }));
                allPhotos.push(...album.samples);
            }));

            state.photos = allPhotos;
            renderStatsAndStudioInfo();
            renderAlbumCards();
            renderFilterTabs();
            renderPhotoGallery();
            if (allPhotos.length) hydrateHeroCarousel(allPhotos);
        } catch (err) {
            console.warn('Không thể tải Portfolio từ Firebase/Drive:', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootPortfolio);
    } else {
        bootPortfolio();
    }
})(window);
