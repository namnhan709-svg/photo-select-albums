/**
 * TeeMedia Atelier Public Portfolio — Trưng bày các bộ ảnh theo chủ đề được Studio Setup.
 * Giao diện tối giản ưu tiên ảnh: không hiển thị tên file, không nút tim, không bộ lọc tên khách.
 */
(function initPortfolioHome(global) {
    const params = new URLSearchParams(global.location.search);
    if (params.has('share') || params.has('folder')) return;

    if (!document.getElementById('portfolioHomeRoot')) return;

    const API = global.PhotoSelectAPI;
    if (!API) return;

    const PREVIEW_DRAFT_KEY = 'teemediaPortfolioPreviewDraft_v1';
    const isPreviewMode = params.get('preview') === '1';

    function toAlbumSlug(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[\u0111\u0110]/g, 'd')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    const state = {
        studio: { name: 'TeeMedia Atelier', phone: '0386 038 930', email: 'thongtrong10@gmail.com', zalo: '0386038930' },
        albums: [],
        photos: [],
        activeAlbumId: 'all',
        lightboxIndex: -1,
        visibleLightboxPhotos: []
    };

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
                img.alt = photo.albumName || 'TeeMedia Atelier';
                slide.style.cursor = 'pointer';
                slide.onclick = () => {
                    selectPortfolioAlbum(photo.portfolioAlbumId || 'all', false);
                    const visible = getFilteredPortfolioPhotos();
                    const foundIdx = visible.findIndex(p => String(p.id) === String(photo.id));
                    if (foundIdx >= 0) openPortfolioLightbox(foundIdx);
                };
            }
            if (caption) {
                caption.textContent = photo.albumName || 'TeeMedia Atelier';
            }
        });
    }

    function renderStatsAndStudioInfo() {
        const albumStat = document.getElementById('portfolioAlbumCountStat');
        const photoStat = document.getElementById('portfolioPhotoCountStat');
        const phoneEl = document.getElementById('portfolioContactPhone');
        const emailEl = document.getElementById('portfolioContactEmail');
        const zaloEl = document.getElementById('portfolioContactZalo');
        if (albumStat) albumStat.textContent = String(state.albums.length);
        if (photoStat) photoStat.textContent = String(state.photos.length);
        const cleanPhone = (!state.studio.phone || state.studio.phone === '0901 234 567') ? '0386 038 930' : state.studio.phone;
        const cleanEmail = (!state.studio.email || state.studio.email === 'studio@gmail.com') ? 'thongtrong10@gmail.com' : state.studio.email;
        const cleanZalo = String(state.studio.zalo || cleanPhone || '0386038930').replace(/\D+/g, '') || '0386038930';
        if (phoneEl) {
            phoneEl.textContent = cleanPhone;
            phoneEl.href = `tel:${cleanPhone.replace(/\s+/g, '')}`;
        }
        if (emailEl) {
            emailEl.textContent = cleanEmail;
            emailEl.href = `mailto:${cleanEmail}`;
        }
        if (zaloEl) {
            zaloEl.href = `https://zalo.me/${cleanZalo}`;
        }
        document.querySelectorAll('[data-studio-zalo-link]').forEach(link => {
            link.href = `https://zalo.me/${cleanZalo}`;
        });
    }

    function syncAlbumQueryUrl() {
        if (!global.history?.replaceState) return;
        try {
            const nextUrl = new URL(global.location.href);
            nextUrl.searchParams.delete('album');
            if (isPreviewMode) nextUrl.searchParams.set('preview', '1');
            if (state.activeAlbumId !== 'all') {
                const matched = state.albums.find(a => String(a.id) === String(state.activeAlbumId));
                const slug = toAlbumSlug(matched?.album_name || '') || String(state.activeAlbumId);
                if (slug) nextUrl.searchParams.set('album', slug);
            }
            const query = nextUrl.searchParams.toString();
            const cleanTarget = `${nextUrl.pathname}${query ? `?${query}` : ''}${nextUrl.hash || ''}`;
            global.history.replaceState(null, '', cleanTarget);
        } catch {}
    }

    function selectPortfolioAlbum(albumId, scrollToGallery = true, syncUrl = true) {
        state.activeAlbumId = String(albumId || 'all');
        if (syncUrl) syncAlbumQueryUrl();
        renderAlbumCards();
        renderFilterTabs();
        renderGalleryHeading();
        renderPhotoGallery();
        if (scrollToGallery) {
            document.getElementById('portfolioGallerySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    function renderGalleryHeading() {
        const eyebrowEl = document.getElementById('portfolioGalleryEyebrow');
        const titleEl = document.getElementById('portfolioGalleryTitle');
        const descEl = document.getElementById('portfolioGalleryDesc');
        if (state.activeAlbumId === 'all') {
            if (eyebrowEl) eyebrowEl.textContent = 'Triển lãm tác phẩm';
            if (titleEl) titleEl.textContent = 'Tất Cả Tác Phẩm Chọn Lọc';
            if (descEl) descEl.textContent = 'Duyệt toàn bộ khung hình hoặc lọc theo từng album chủ đề.';
            return;
        }
        const activeAlbum = state.albums.find(a => String(a.id) === String(state.activeAlbumId));
        if (!activeAlbum) return;
        if (eyebrowEl) eyebrowEl.textContent = `Bộ ảnh · ${activeAlbum.photoCount} khung hình`;
        if (titleEl) titleEl.textContent = activeAlbum.album_name || 'Bộ ảnh';
        if (descEl) {
            descEl.textContent = activeAlbum.description || 'Chạm vào từng bức ảnh để xem ở chế độ toàn màn hình.';
        }
    }

    function renderAlbumCards() {
        const grid = document.getElementById('portfolioAlbumsGrid');
        if (!grid) return;

        if (!state.albums.length) {
            grid.innerHTML = `<div class="portfolio-empty">
                <p>Hiện chưa có bộ ảnh nào được xuất bản lên Portfolio.</p>
            </div>`;
            return;
        }

        grid.replaceChildren();
        state.albums.forEach(album => {
            const isActive = String(state.activeAlbumId) === String(album.id);
            const card = document.createElement('article');
            card.className = `portfolio-album-card${isActive ? ' is-selected-album' : ''}`;

            const visual = document.createElement('div');
            visual.className = 'portfolio-album-visual portfolio-album-visual--clean';
            const coverPhoto = album.coverPhoto || album.samples[0] || null;

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

            const body = document.createElement('div');
            body.className = 'portfolio-album-body portfolio-album-body--clean';

            const countMeta = document.createElement('span');
            countMeta.className = 'portfolio-album-count-tag';
            countMeta.textContent = `${album.photoCount} ảnh`;

            const title = document.createElement('h3');
            title.textContent = album.album_name || 'Bộ sưu tập ảnh';

            body.append(countMeta, title);

            if (album.description) {
                const desc = document.createElement('p');
                desc.className = 'portfolio-album-desc';
                desc.textContent = album.description;
                body.appendChild(desc);
            }

            const actionRow = document.createElement('div');
            actionRow.className = 'portfolio-album-actions';

            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'portfolio-album-cta';
            openBtn.style.border = '0';
            openBtn.style.cursor = 'pointer';
            openBtn.textContent = isActive ? 'Đang xem bộ ảnh ↓' : 'Xem bộ ảnh →';
            openBtn.addEventListener('click', event => {
                event.stopPropagation();
                selectPortfolioAlbum(album.id, true);
            });

            actionRow.appendChild(openBtn);
            body.appendChild(actionRow);

            card.append(visual, body);
            card.addEventListener('click', () => selectPortfolioAlbum(album.id, true));
            grid.appendChild(card);
        });
    }

    function renderFilterTabs() {
        const container = document.getElementById('portfolioFilterTabs');
        if (!container) return;
        container.replaceChildren();
        const tabs = [
            { id: 'all', label: `Tất cả (${state.photos.length})` },
            ...state.albums.map(a => ({
                id: String(a.id),
                label: `${a.album_name} (${a.photoCount})`
            }))
        ];
        tabs.forEach(tab => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `portfolio-filter-tab${state.activeAlbumId === tab.id ? ' is-active' : ''}`;
            btn.textContent = tab.label;
            btn.addEventListener('click', () => selectPortfolioAlbum(tab.id, false));
            container.appendChild(btn);
        });
    }

    function getFilteredPortfolioPhotos() {
        return state.activeAlbumId === 'all'
            ? state.photos
            : state.photos.filter(p => String(p.portfolioAlbumId) === String(state.activeAlbumId));
    }

    function renderPhotoGallery() {
        const grid = document.getElementById('portfolioPhotoGrid');
        if (!grid) return;
        const photos = getFilteredPortfolioPhotos();
        state.visibleLightboxPhotos = photos;
        if (!photos.length) {
            grid.innerHTML = `<div class="portfolio-empty">
                <p>Hiện chưa có ảnh nào trong bộ sưu tập này.</p>
            </div>`;
            return;
        }
        grid.replaceChildren();
        photos.forEach((photo, idx) => {
            const card = document.createElement('article');
            card.className = 'portfolio-photo-card portfolio-photo-card--pure';

            const img = document.createElement('img');
            img.alt = photo.albumName || 'Tác phẩm TeeMedia Atelier';
            img.loading = idx < 8 ? 'eager' : 'lazy';
            img.decoding = 'async';
            API.bindDriveImage(img, photo, 'thumb');

            card.appendChild(img);
            card.addEventListener('click', () => openPortfolioLightbox(idx));
            grid.appendChild(card);
        });
    }

    function openPortfolioLightbox(index) {
        const photos = state.visibleLightboxPhotos;
        if (!photos.length || index < 0 || index >= photos.length) return;
        state.lightboxIndex = index;
        const photo = photos[index];
        const modal = document.getElementById('portfolioLightbox');
        const img = document.getElementById('portfolioLightboxImg');
        const title = document.getElementById('portfolioLightboxTitle');
        const counter = document.getElementById('portfolioLightboxCounter');
        if (!modal || !img) return;
        API.bindDriveImage(img, photo, 'full');
        img.alt = photo.albumName || 'Tác phẩm TeeMedia Atelier';
        if (title) title.textContent = photo.albumName || 'TeeMedia Atelier';
        if (counter) {
            counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(photos.length).padStart(2, '0')}`;
        }
        modal.classList.add('is-open');
    }

    function closePortfolioLightbox() {
        document.getElementById('portfolioLightbox')?.classList.remove('is-open');
        state.lightboxIndex = -1;
    }

    function openChatWidget() {
        const chatToggle = document.getElementById('adminChatToggle');
        const chatInput = document.getElementById('adminChatInput');
        const chatContainer = document.getElementById('adminChat');
        if (chatContainer && !chatContainer.classList.contains('open')) {
            chatToggle?.click();
        }
        chatInput?.focus();
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
            if (statusEl) statusEl.textContent = 'Đang gửi cho TeeMedia...';
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
                if (statusEl) statusEl.textContent = '✅ Đã gửi tới TeeMedia Atelier!';
            } catch (err) {
                if (statusEl) statusEl.textContent = err.message || 'Không thể gửi tin nhắn.';
            }
        });
    }

    function bindPortfolioEvents() {
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
        document.getElementById('portfolioOpenChatBtn')?.addEventListener('click', openChatWidget);
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
            portfolioAlbumId: String(p.portfolio_album_id || p.folder_id || ''),
            albumName: String(p.album_name || p.albumName || 'Bộ sưu tập')
        }));

        const photosByAlbum = new Map();
        photos.forEach(p => {
            const key = p.portfolioAlbumId;
            const list = photosByAlbum.get(key) || [];
            list.push(p);
            photosByAlbum.set(key, list);
        });

        const albums = (Array.isArray(rawAlbums) ? rawAlbums : [])
            .map(a => {
                const aid = String(a.id || a.folder_id || '');
                const samples = Array.isArray(a.photos) && a.photos.length
                    ? a.photos.map(p => ({ ...p, id: String(p.id), portfolioAlbumId: aid, albumName: a.album_name }))
                    : (photosByAlbum.get(aid) || photosByAlbum.get(String(a.folder_id || '')) || []);
                const coverPhoto = samples.find(s => String(s.id) === String(a.cover_photo_id || '')) || a.cover_photo || samples[0] || null;
                return {
                    ...a,
                    id: aid,
                    description: String(a.description || '').trim(),
                    order: Number(a.order || 999),
                    samples,
                    coverPhoto,
                    photoCount: samples.length
                };
            })
            .filter(a => a.visible !== false && a.samples.length > 0)
            .sort((a, b) => (a.order - b.order));

        const validIds = new Set(albums.map(a => a.id));
        const flattened = [];
        albums.forEach(a => {
            a.samples.forEach(p => {
                if (validIds.has(a.id)) flattened.push(p);
            });
        });

        state.albums = albums;
        state.photos = flattened;
    }

    async function bootPortfolio() {
        initCarouselRotation();
        bindChatEvents();
        bindPortfolioEvents();

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

        const requestedAlbum = toAlbumSlug(params.get('album') || '') || (params.get('album') || '').trim().toLowerCase();
        if (requestedAlbum && requestedAlbum !== 'all') {
            const matchedAlbum = state.albums.find(a =>
                String(a.id).toLowerCase() === requestedAlbum
                || toAlbumSlug(a.album_name || '') === requestedAlbum
            );
            if (matchedAlbum) {
                state.activeAlbumId = String(matchedAlbum.id);
            }
        }

        renderStatsAndStudioInfo();
        renderAlbumCards();
        renderFilterTabs();
        renderGalleryHeading();
        renderPhotoGallery();
        if (state.photos.length) {
            hydrateHeroCarousel(state.photos);
        }
        if (requestedAlbum && state.activeAlbumId !== 'all') {
            requestAnimationFrame(() => {
                document.getElementById('portfolioGallerySection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootPortfolio);
    } else {
        bootPortfolio();
    }
})(window);
