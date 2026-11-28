/**
 * TeeMedia Studio Public Portfolio - Chỉ trưng bày các album & hình ảnh đã được Setup sẵn bởi Studio.
 */
(function initPortfolioHome(global) {
    const params = new URLSearchParams(global.location.search);
    if (params.has('share') || params.has('folder')) return;

    const isPortfolioPage = Boolean(document.getElementById('portfolioHomeRoot'));
    if (!isPortfolioPage) return;

    const API = global.PhotoSelectAPI;
    if (!API) return;

    const BOOKMARKS_KEY = 'teemediaPortfolioBookmarks_v1';
    const PREVIEW_DRAFT_KEY = 'teemediaPortfolioPreviewDraft_v1';
    const isPreviewMode = params.get('preview') === '1';

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

    function initCarouselRotation() {
        const slides = [...document.querySelectorAll('.wedding-slide')];
        const dots = [...document.querySelectorAll('#weddingCarouselDots span')];
        if (!slides.length || slides.length !== dots.length) return;

        let activeSlide = 0;
        const updateCarousel = () => {
            const middle = Math.floor(slides.length / 2);
            slides.forEach((slide, index) => {
                let position = (index - activeSlide + slides.length) % slides.length;
                if (position > middle) position -= slides.length;
                slide.dataset.position = Math.abs(position) > 2 ? 'hidden' : String(position);
                dots[index].classList.toggle('active', index === activeSlide);
            });
        };

        const moveCarousel = direction => {
            activeSlide = (activeSlide + direction + slides.length) % slides.length;
            updateCarousel();
        };

        document.querySelector('.hero-carousel-prev')?.addEventListener('click', () => moveCarousel(-1));
        document.querySelector('.hero-carousel-next')?.addEventListener('click', () => moveCarousel(1));
        updateCarousel();
        if (!global.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            global.setInterval(() => moveCarousel(1), 4500);
        }
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
                    const visible = getFilteredPortfolioPhotos();
                    const foundIdx = visible.findIndex(p => String(p.id) === String(photo.id));
                    if (foundIdx >= 0) openPortfolioLightbox(foundIdx);
                    else {
                        state.activeAlbumFilter = 'all';
                        renderFilterTabs();
                        renderPhotoGallery();
                        const allIdx = getFilteredPortfolioPhotos().findIndex(p => String(p.id) === String(photo.id));
                        if (allIdx >= 0) openPortfolioLightbox(allIdx);
                    }
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
        if (photoStat) photoStat.textContent = String(state.photos.length);
        if (phoneEl && state.studio.phone) {
            phoneEl.textContent = state.studio.phone;
            phoneEl.href = `tel:${state.studio.phone.replace(/\s+/g, '')}`;
        }
        if (emailEl && state.studio.email) {
            emailEl.textContent = state.studio.email;
            emailEl.href = `mailto:${state.studio.email}`;
        }
    }

    function selectAlbumOnPortfolio(folderId, openFirstInLightbox = false) {
        state.activeAlbumFilter = String(folderId || 'all');
        renderFilterTabs();
        renderPhotoGallery();
        if (openFirstInLightbox) {
            const visible = getFilteredPortfolioPhotos();
            if (visible.length) {
                openPortfolioLightbox(0);
                return;
            }
        }
        document.getElementById('portfolioGallerySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function renderAlbumCards() {
        const grid = document.getElementById('portfolioAlbumsGrid');
        if (!grid) return;
        const query = state.albumSearchQuery.trim().toLowerCase();
        const filtered = state.albums.filter(a => !query || String(a.album_name || '').toLowerCase().includes(query));

        if (!filtered.length) {
            grid.innerHTML = `<div class="portfolio-empty">
                <p>${query ? 'Không tìm thấy album phù hợp với từ khóa.' : 'Hiện chưa có bộ sưu tập nào được setup hiển thị trên Portfolio.'}</p>
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
            const coverPhoto = samples.find(s => String(s.id) === String(album.cover_photo_id || '')) || samples[0] || null;

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
                placeholder.textContent = '📷';
                visual.appendChild(placeholder);
            }

            const miniThumbs = samples.filter(s => String(s.id) !== String(coverPhoto?.id || '')).slice(0, 3);
            if (miniThumbs.length) {
                const miniRow = document.createElement('div');
                miniRow.className = 'portfolio-album-mini-strip';
                miniThumbs.forEach(sample => {
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
            countBadge.textContent = `${samples.length} ảnh chọn lọc`;
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

            const viewGalleryBtn = document.createElement('button');
            viewGalleryBtn.type = 'button';
            viewGalleryBtn.className = 'portfolio-album-cta';
            viewGalleryBtn.style.border = '0';
            viewGalleryBtn.style.cursor = 'pointer';
            viewGalleryBtn.textContent = `Xem ${samples.length} ảnh chọn lọc →`;
            viewGalleryBtn.addEventListener('click', event => {
                event.stopPropagation();
                selectAlbumOnPortfolio(album.folder_id, false);
            });

            const lightboxBtn = document.createElement('button');
            lightboxBtn.type = 'button';
            lightboxBtn.className = 'portfolio-album-preview-btn';
            lightboxBtn.textContent = '🔍 Phóng to';
            lightboxBtn.addEventListener('click', event => {
                event.stopPropagation();
                selectAlbumOnPortfolio(album.folder_id, true);
            });

            actions.append(viewGalleryBtn, lightboxBtn);
            body.append(title, meta, actions);
            card.append(visual, body);
            card.addEventListener('click', () => selectAlbumOnPortfolio(album.folder_id, false));
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
        return state.activeAlbumFilter === 'all'
            ? state.photos
            : state.photos.filter(p => String(p.albumFolderId) === String(state.activeAlbumFilter));
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
            grid.innerHTML = `<div class="portfolio-empty">
                <p>Hiện chưa có ảnh nào được chọn hiển thị trên Portfolio.</p>
            </div>`;
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
            caption.innerHTML = '<strong></strong><small></small>';
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
        if (!modal || !img) return;
        API.bindDriveImage(img, photo, 'full');
        img.alt = photo.name || 'Ảnh Portfolio TeeMedia';
        if (title) title.textContent = `${photo.albumName || 'TeeMedia'} · ${photo.name || ''}`;
        syncPortfolioLightboxHeart();
        modal.classList.add('is-open');
    }

    function closePortfolioLightbox() {
        document.getElementById('portfolioLightbox')?.classList.remove('is-open');
        state.lightboxIndex = -1;
    }

    function openChatWidgetWithText(text) {
        const chatToggle = document.getElementById('adminChatToggle');
        const chatInput = document.getElementById('adminChatInput');
        const chatContainer = document.getElementById('adminChat');
        if (chatContainer && !chatContainer.classList.contains('open')) {
            chatToggle?.click();
        }
        if (chatInput) {
            if (text) chatInput.value = text;
            chatInput.focus();
        }
    }

    function sendConceptsToStudio() {
        const items = [...state.bookmarks.values()];
        if (!items.length) return;
        const summary = `Chào TeeMedia Studio, mình thích ${items.length} ảnh mẫu trên Portfolio:\n` +
            items.map((item, i) => `${i + 1}. ${item.name} (${item.albumName})`).join('\n');
        openChatWidgetWithText(summary);
    }

    function bindChatEvents() {
        const chatContainer = document.getElementById('adminChat');
        const toggleBtn = document.getElementById('adminChatToggle');
        const form = document.getElementById('adminChatForm');
        const input = document.getElementById('adminChatInput');
        const messagesEl = document.getElementById('adminChatMessages');
        const statusEl = document.getElementById('adminChatMessage');
        if (!chatContainer || !toggleBtn || !form) return;

        toggleBtn.addEventListener('click', () => {
            const isOpen = chatContainer.classList.toggle('open');
            toggleBtn.setAttribute('aria-expanded', String(isOpen));
        });

        form.addEventListener('submit', async event => {
            event.preventDefault();
            const message = String(input?.value || '').trim();
            if (!message) {
                if (statusEl) statusEl.textContent = 'Vui lòng nhập nội dung tin nhắn.';
                return;
            }
            if (statusEl) statusEl.textContent = 'Đang gửi cho TeeMedia Studio...';
            try {
                const { ok, result } = await API.callJson({
                    action: 'send_chat_message',
                    message,
                    report_type: 'portfolio_inquiry'
                });
                if (!ok || !result?.success) {
                    throw new Error(result?.message || 'Không thể gửi tin nhắn.');
                }
                if (messagesEl) {
                    const bubble = document.createElement('div');
                    bubble.className = 'admin-chat-item is-user';
                    bubble.textContent = message;
                    messagesEl.appendChild(bubble);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                }
                if (input) input.value = '';
                if (statusEl) statusEl.textContent = '✅ Đã gửi tới TeeMedia Studio!';
            } catch (err) {
                if (statusEl) statusEl.textContent = err.message || 'Không thể gửi tin nhắn.';
            }
        });
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
            if (!state.visibleLightboxPhotos.length) return;
            const next = (state.lightboxIndex - 1 + state.visibleLightboxPhotos.length) % state.visibleLightboxPhotos.length;
            openPortfolioLightbox(next);
        });
        document.getElementById('portfolioLightboxNext')?.addEventListener('click', () => {
            if (!state.visibleLightboxPhotos.length) return;
            const next = (state.lightboxIndex + 1) % state.visibleLightboxPhotos.length;
            openPortfolioLightbox(next);
        });
        document.getElementById('portfolioLightboxHeart')?.addEventListener('click', () => {
            const photo = state.visibleLightboxPhotos[state.lightboxIndex];
            if (photo) toggleBookmark(photo);
        });
        document.getElementById('portfolioLightboxFilterAlbum')?.addEventListener('click', () => {
            const photo = state.visibleLightboxPhotos[state.lightboxIndex];
            closePortfolioLightbox();
            if (photo?.albumFolderId) {
                selectAlbumOnPortfolio(photo.albumFolderId, false);
            }
        });
        document.getElementById('portfolioSendConceptsBtn')?.addEventListener('click', sendConceptsToStudio);
        document.getElementById('portfolioClearConceptsBtn')?.addEventListener('click', () => {
            state.bookmarks.clear();
            saveBookmarks();
            updateBookmarkDock();
            renderPhotoGallery();
        });
        document.getElementById('portfolioOpenChatBtn')?.addEventListener('click', () => {
            openChatWidgetWithText('');
        });
        document.addEventListener('keydown', e => {
            const modal = document.getElementById('portfolioLightbox');
            if (!modal?.classList.contains('is-open')) return;
            if (e.key === 'Escape') closePortfolioLightbox();
            else if (e.key === 'ArrowLeft') document.getElementById('portfolioLightboxPrev')?.click();
            else if (e.key === 'ArrowRight') document.getElementById('portfolioLightboxNext')?.click();
        });
    }

    function applyPortfolioPayload(rawAlbums, rawPhotos) {
        const photos = (Array.isArray(rawPhotos) ? rawPhotos : []).map(p => ({
            ...p,
            id: String(p.id),
            albumFolderId: String(p.folder_id || p.albumFolderId || ''),
            albumName: String(p.album_name || p.albumName || p.category || 'TeeMedia Studio')
        }));

        const photosByAlbum = new Map();
        photos.forEach(p => {
            const list = photosByAlbum.get(p.albumFolderId) || [];
            list.push(p);
            photosByAlbum.set(p.albumFolderId, list);
        });

        const albums = (Array.isArray(rawAlbums) ? rawAlbums : [])
            .map(a => {
                const fid = String(a.folder_id || '');
                const samples = photosByAlbum.get(fid) || [];
                return {
                    ...a,
                    folder_id: fid,
                    samples,
                    photoCount: samples.length
                };
            })
            .filter(a => a.samples.length > 0);

        const validAlbumIds = new Set(albums.map(a => a.folder_id));
        state.albums = albums;
        state.photos = photos.filter(p => validAlbumIds.has(p.albumFolderId));
    }

    async function bootPortfolio() {
        initCarouselRotation();
        bindChatEvents();
        bindPortfolioEvents();
        updateBookmarkDock();

        let loadedFromPreview = false;
        if (isPreviewMode) {
            try {
                const draftRaw = localStorage.getItem(PREVIEW_DRAFT_KEY);
                if (draftRaw) {
                    const draft = JSON.parse(draftRaw);
                    const banner = document.getElementById('portfolioPreviewBanner');
                    if (banner) banner.hidden = false;
                    if (draft?.studio) state.studio = draft.studio;
                    applyPortfolioPayload(draft?.albums || [], draft?.photos || []);
                    loadedFromPreview = true;
                }
            } catch {}
        }

        if (!loadedFromPreview) {
            try {
                const { ok, result } = await API.callJson({ action: 'load_public_portfolio' });
                if (ok && result?.success) {
                    if (result.studio) state.studio = result.studio;
                    applyPortfolioPayload(result.albums || [], result.photos || []);
                }
            } catch (err) {
                console.warn('Không thể tải Portfolio từ Firebase:', err);
            }
        }

        renderStatsAndStudioInfo();
        renderAlbumCards();
        renderFilterTabs();
        renderPhotoGallery();
        if (state.photos.length) {
            hydrateHeroCarousel(state.photos);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootPortfolio);
    } else {
        bootPortfolio();
    }
})(window);
