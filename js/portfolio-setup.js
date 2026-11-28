/**
 * TeeMedia Studio Home — Thiết lập & chọn lọc ảnh/album hiển thị lên trang Portfolio công khai.
 */
(function initPortfolioSetup(global) {
    const params = new URLSearchParams(global.location.search);
    if (params.has('share') || params.has('folder')) return;

    const API = global.PhotoSelectAPI;
    if (!API) return;

    const PREVIEW_DRAFT_KEY = 'teemediaPortfolioPreviewDraft_v1';

    const setupState = {
        initialized: false,
        albums: [],
        enabledAlbums: new Set(),
        selectedPhotosByAlbum: new Map(), // folder_id -> Map(photoId -> photoMeta)
        coverPhotoByAlbum: new Map(),     // folder_id -> photoId
        activeFolderId: '',
        loadedDrivePhotos: new Map(),     // folder_id -> Array<photo>
        filterMode: 'all',                // 'all' | 'selected' | 'unselected'
        searchQuery: '',
        publishedAt: null,
        dirty: false,
        loadingPhotos: false,
        saving: false
    };

    function isAcceptedImage(file) {
        const mime = String(file?.mimeType || '').toLowerCase();
        const name = String(file?.name || '').toLowerCase();
        if (mime.startsWith('image/')) return true;
        return /\.(jpg|jpeg|png|webp|avif|gif|heic|heif)$/i.test(name);
    }

    function escapeText(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    function showSetupToast(text) {
        if (typeof global.showToast === 'function') {
            global.showToast(text);
        }
        const statusEl = document.getElementById('setupStatusText');
        if (statusEl) statusEl.textContent = text;
    }

    function getAlbumSelectedMap(folderId) {
        const fid = String(folderId || '');
        let map = setupState.selectedPhotosByAlbum.get(fid);
        if (!map) {
            map = new Map();
            setupState.selectedPhotosByAlbum.set(fid, map);
        }
        return map;
    }

    function countTotalSelectedPhotos() {
        let total = 0;
        setupState.enabledAlbums.forEach(fid => {
            const map = setupState.selectedPhotosByAlbum.get(fid);
            if (map) total += map.size;
        });
        return total;
    }

    function countEnabledAlbumsWithPhotos() {
        let count = 0;
        setupState.enabledAlbums.forEach(fid => {
            const map = setupState.selectedPhotosByAlbum.get(fid);
            if (map && map.size > 0) count += 1;
        });
        return count;
    }

    function buildPortfolioPayload() {
        const albums = [];
        const photos = [];
        setupState.albums.forEach(album => {
            const fid = String(album.folder_id || '');
            if (!setupState.enabledAlbums.has(fid)) return;
            const selectedMap = getAlbumSelectedMap(fid);
            if (!selectedMap.size) return;

            const albumPhotos = [...selectedMap.values()];
            const coverId = setupState.coverPhotoByAlbum.get(fid);
            const resolvedCoverId = (coverId && selectedMap.has(String(coverId)))
                ? String(coverId)
                : String(albumPhotos[0]?.id || '');

            albums.push({
                folder_id: fid,
                album_name: album.album_name || 'Album ảnh',
                allow_save: Number(album.allow_save) === 1 ? 1 : 0,
                created_at: album.created_at || null,
                cover_photo_id: resolvedCoverId,
                photo_ids: albumPhotos.map(p => String(p.id))
            });

            albumPhotos.forEach(p => {
                photos.push({
                    id: String(p.id),
                    name: p.name || 'IMG.jpg',
                    folder_id: fid,
                    album_name: album.album_name || p.album_name || 'Album ảnh',
                    category: p.category || album.album_name || 'Album ảnh',
                    thumbnailLink: p.thumbnailLink || '',
                    thumbnailUrl: p.thumbnailUrl || '',
                    fullUrl: p.fullUrl || '',
                    mimeType: p.mimeType || 'image/jpeg',
                    size: Number(p.size || 0) || undefined,
                    createdTime: p.createdTime || null,
                    modifiedTime: p.modifiedTime || null
                });
            });
        });
        return {
            updated_at: new Date().toISOString(),
            albums,
            photos
        };
    }

    function updateSummaryAndStatus() {
        const albumsEl = document.getElementById('setupSelectedAlbumsCount');
        const photosEl = document.getElementById('setupSelectedPhotosCount');
        const publishedEl = document.getElementById('setupPublishedTimeText');
        const statusEl = document.getElementById('setupStatusText');
        const stickyBar = document.getElementById('setupStickyDock');
        const stickyCount = document.getElementById('setupStickyCount');
        const totalAlbums = countEnabledAlbumsWithPhotos();
        const totalPhotos = countTotalSelectedPhotos();

        if (albumsEl) albumsEl.textContent = String(totalAlbums);
        if (photosEl) photosEl.textContent = String(totalPhotos);
        if (stickyCount) stickyCount.textContent = `${totalAlbums} album · ${totalPhotos} ảnh ❤️`;
        if (stickyBar) stickyBar.hidden = totalPhotos < 1 && !setupState.dirty;

        if (publishedEl) {
            if (setupState.publishedAt) {
                const d = new Date(setupState.publishedAt);
                publishedEl.textContent = Number.isNaN(d.getTime())
                    ? 'Đã xuất bản'
                    : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
            } else {
                publishedEl.textContent = 'Chưa xuất bản';
            }
        }

        if (statusEl) {
            if (setupState.dirty) {
                statusEl.textContent = `🟡 Chưa lưu thay đổi (${totalAlbums} album · ${totalPhotos} ảnh)`;
                statusEl.className = 'setup-status-pill is-dirty';
            } else if (totalPhotos > 0) {
                statusEl.textContent = `✅ Đang xuất bản: ${totalAlbums} album · ${totalPhotos} ảnh`;
                statusEl.className = 'setup-status-pill is-saved';
            } else {
                statusEl.textContent = 'Chọn album & chạm ❤️ ảnh để đưa lên Portfolio';
                statusEl.className = 'setup-status-pill';
            }
        }
    }

    function renderSelectedTray() {
        const tray = document.getElementById('setupSelectedTray');
        const strip = document.getElementById('setupSelectedTrayStrip');
        if (!tray || !strip) return;
        const payload = buildPortfolioPayload();
        tray.hidden = payload.photos.length === 0;
        strip.replaceChildren();

        payload.photos.forEach(photo => {
            const fid = String(photo.folder_id || '');
            const isCover = String(setupState.coverPhotoByAlbum.get(fid) || '') === String(photo.id);
            const chip = document.createElement('div');
            chip.className = `setup-tray-item${isCover ? ' is-cover' : ''}`;

            const img = document.createElement('img');
            img.alt = photo.name || '';
            img.loading = 'lazy';
            API.bindDriveImage(img, photo, 'thumb');

            const meta = document.createElement('div');
            meta.className = 'setup-tray-meta';
            meta.innerHTML = `<strong>${escapeText(photo.album_name)}</strong><small>${escapeText(photo.name)}</small>`;

            const coverBtn = document.createElement('button');
            coverBtn.type = 'button';
            coverBtn.className = 'setup-tray-cover-btn';
            coverBtn.title = isCover ? 'Đang là ảnh bìa album' : 'Đặt làm ảnh bìa album';
            coverBtn.textContent = isCover ? '★ Bìa' : '☆ Bìa';
            coverBtn.addEventListener('click', () => {
                setupState.coverPhotoByAlbum.set(fid, String(photo.id));
                setupState.dirty = true;
                updateSummaryAndStatus();
                renderSelectedTray();
                renderPhotoCuratorGrid();
            });

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'setup-tray-remove-btn';
            removeBtn.title = 'Bỏ khỏi Portfolio';
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', () => {
                const map = getAlbumSelectedMap(fid);
                map.delete(String(photo.id));
                if (map.size === 0) {
                    setupState.coverPhotoByAlbum.delete(fid);
                }
                setupState.dirty = true;
                updateSummaryAndStatus();
                renderAlbumsList();
                renderSelectedTray();
                renderPhotoCuratorGrid();
            });

            chip.append(img, meta, coverBtn, removeBtn);
            strip.appendChild(chip);
        });
    }

    function renderAlbumsList() {
        const container = document.getElementById('setupAlbumsList');
        if (!container) return;
        container.replaceChildren();

        if (!setupState.albums.length) {
            container.innerHTML = `<div class="setup-empty-card">
                <p>Bạn chưa có album nào được tải lên.</p>
                <a class="setup-btn is-primary" href="albums.html">+ Thêm album từ Google Drive</a>
            </div>`;
            return;
        }

        setupState.albums.forEach(album => {
            const fid = String(album.folder_id || '');
            const isActive = fid === String(setupState.activeFolderId);
            const isEnabled = setupState.enabledAlbums.has(fid);
            const selectedMap = getAlbumSelectedMap(fid);
            const selectedCount = selectedMap.size;

            const card = document.createElement('article');
            card.className = `setup-album-card${isActive ? ' is-active' : ''}${isEnabled && selectedCount > 0 ? ' is-published' : ''}`;

            const topRow = document.createElement('div');
            topRow.className = 'setup-album-card-top';

            const label = document.createElement('label');
            label.className = 'setup-album-toggle';
            label.addEventListener('click', e => e.stopPropagation());

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = isEnabled;
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) setupState.enabledAlbums.add(fid);
                else setupState.enabledAlbums.delete(fid);
                setupState.dirty = true;
                updateSummaryAndStatus();
                renderAlbumsList();
                renderSelectedTray();
            });

            const toggleText = document.createElement('span');
            toggleText.textContent = isEnabled ? 'Hiện Portfolio' : 'Đang ẩn';
            label.append(checkbox, toggleText);

            const badge = document.createElement('span');
            badge.className = `setup-album-count-badge${selectedCount > 0 ? ' has-items' : ''}`;
            badge.textContent = `❤️ ${selectedCount} ảnh`;
            topRow.append(label, badge);

            const title = document.createElement('h3');
            title.textContent = album.album_name || 'Album ảnh';

            const sub = document.createElement('small');
            sub.className = 'setup-album-sub';
            sub.textContent = isActive ? 'Đang mở chọn ảnh bên dưới ↓' : 'Bấm để mở danh sách ảnh';

            card.append(topRow, title, sub);
            card.addEventListener('click', () => selectActiveAlbum(fid));
            container.appendChild(card);
        });
    }

    async function loadDriveFolderRecursive(folderId, albumName, collected = [], visited = new Set()) {
        if (!folderId || visited.has(folderId)) return collected;
        visited.add(folderId);
        let pageToken = '';
        let safetyPages = 0;
        const subfolders = [];

        do {
            const { ok, result } = await API.driveList(folderId, pageToken);
            if (!ok || result?.error) break;
            const entries = Array.isArray(result.files) ? result.files : [];
            entries.forEach(entry => {
                if (entry.mimeType === 'application/vnd.google-apps.folder') {
                    subfolders.push(entry);
                } else if (isAcceptedImage(entry)) {
                    collected.push({
                        ...entry,
                        id: String(entry.id),
                        folder_id: setupState.activeFolderId || folderId,
                        album_name: albumName,
                        category: entry.category || (folderId === setupState.activeFolderId ? albumName : '')
                    });
                }
            });
            pageToken = result.nextPageToken || '';
            safetyPages += 1;
        } while (pageToken && safetyPages < 8);

        for (const sub of subfolders) {
            if (collected.length >= 240) break;
            await loadDriveFolderRecursive(sub.id, albumName, collected, visited);
        }
        return collected;
    }

    async function selectActiveAlbum(folderId) {
        const fid = String(folderId || '');
        if (!fid) return;
        setupState.activeFolderId = fid;
        const album = setupState.albums.find(a => String(a.folder_id) === fid);
        const titleEl = document.getElementById('setupActiveAlbumTitle');
        if (titleEl) titleEl.textContent = album?.album_name || 'Album ảnh';

        renderAlbumsList();

        if (!setupState.loadedDrivePhotos.has(fid)) {
            setupState.loadingPhotos = true;
            renderPhotoCuratorGrid();
            try {
                const photos = await loadDriveFolderRecursive(fid, album?.album_name || 'Album ảnh', [], new Set());
                photos.forEach(p => {
                    p.folder_id = fid;
                    p.album_name = album?.album_name || 'Album ảnh';
                });
                setupState.loadedDrivePhotos.set(fid, photos);
            } catch (err) {
                console.warn('Không thể tải ảnh album Drive:', err);
                setupState.loadedDrivePhotos.set(fid, []);
            } finally {
                setupState.loadingPhotos = false;
            }
        }
        renderPhotoCuratorGrid();
    }

    function togglePhotoSelection(photo) {
        const fid = String(photo.folder_id || setupState.activeFolderId || '');
        if (!fid || !photo?.id) return;
        const pid = String(photo.id);
        const map = getAlbumSelectedMap(fid);

        if (map.has(pid)) {
            map.delete(pid);
            if (String(setupState.coverPhotoByAlbum.get(fid) || '') === pid) {
                const next = map.keys().next().value || '';
                if (next) setupState.coverPhotoByAlbum.set(fid, next);
                else setupState.coverPhotoByAlbum.delete(fid);
            }
        } else {
            map.set(pid, photo);
            setupState.enabledAlbums.add(fid);
            if (!setupState.coverPhotoByAlbum.has(fid)) {
                setupState.coverPhotoByAlbum.set(fid, pid);
            }
        }
        setupState.dirty = true;
        updateSummaryAndStatus();
        renderAlbumsList();
        renderSelectedTray();
        renderPhotoCuratorGrid();
    }

    function renderPhotoCuratorGrid() {
        const grid = document.getElementById('setupPhotosGrid');
        const countMeta = document.getElementById('setupActiveAlbumMeta');
        if (!grid) return;

        if (setupState.loadingPhotos) {
            grid.innerHTML = '<div class="setup-empty-card"><p>⏳ Đang tải danh sách ảnh chất lượng cao từ Google Drive...</p></div>';
            return;
        }

        const fid = String(setupState.activeFolderId || '');
        const photos = setupState.loadedDrivePhotos.get(fid) || [];
        const selectedMap = getAlbumSelectedMap(fid);

        const q = setupState.searchQuery.trim().toLowerCase();
        const filtered = photos.filter(p => {
            if (q && !String(p.name || '').toLowerCase().includes(q)) return false;
            const isSel = selectedMap.has(String(p.id));
            if (setupState.filterMode === 'selected' && !isSel) return false;
            if (setupState.filterMode === 'unselected' && isSel) return false;
            return true;
        });

        if (countMeta) {
            countMeta.textContent = `${photos.length} ảnh trong album · Đã chọn ${selectedMap.size} ảnh ❤️ vào Portfolio`;
        }

        if (!filtered.length) {
            grid.innerHTML = `<div class="setup-empty-card">
                <p>${photos.length ? 'Không có ảnh nào khớp bộ lọc hiện tại.' : 'Không tìm thấy ảnh trong thư mục Google Drive này.'}</p>
            </div>`;
            return;
        }

        grid.replaceChildren();
        const currentCoverId = String(setupState.coverPhotoByAlbum.get(fid) || '');

        filtered.forEach((photo, idx) => {
            const pid = String(photo.id);
            const isSelected = selectedMap.has(pid);
            const isCover = isSelected && currentCoverId === pid;

            const card = document.createElement('article');
            card.className = `setup-photo-card${isSelected ? ' is-selected' : ''}`;

            const img = document.createElement('img');
            img.alt = photo.name || 'Ảnh Google Drive';
            img.loading = idx < 12 ? 'eager' : 'lazy';
            img.decoding = 'async';
            API.bindDriveImage(img, photo, 'thumb');

            const heartBtn = document.createElement('button');
            heartBtn.type = 'button';
            heartBtn.className = `setup-photo-heart${isSelected ? ' is-active' : ''}`;
            heartBtn.textContent = isSelected ? '❤️' : '🤍';
            heartBtn.title = isSelected ? 'Bỏ khỏi Portfolio' : 'Chọn đưa lên Portfolio';
            heartBtn.addEventListener('click', e => {
                e.stopPropagation();
                togglePhotoSelection(photo);
            });

            const bottomBar = document.createElement('div');
            bottomBar.className = 'setup-photo-bar';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = photo.name || pid;
            bottomBar.appendChild(nameSpan);

            if (isSelected) {
                const coverBtn = document.createElement('button');
                coverBtn.type = 'button';
                coverBtn.className = `setup-cover-pill${isCover ? ' is-active' : ''}`;
                coverBtn.textContent = isCover ? '★ Bìa' : 'Đặt bìa';
                coverBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    setupState.coverPhotoByAlbum.set(fid, pid);
                    setupState.dirty = true;
                    updateSummaryAndStatus();
                    renderSelectedTray();
                    renderPhotoCuratorGrid();
                });
                bottomBar.appendChild(coverBtn);
            }

            card.append(img, heartBtn, bottomBar);
            card.addEventListener('click', () => togglePhotoSelection(photo));
            grid.appendChild(card);
        });
    }

    function openPortfolioPreview() {
        const payload = buildPortfolioPayload();
        if (!payload.photos.length) {
            showSetupToast('⚠️ Hãy chọn ít nhất 1 ảnh ❤️ trước khi Preview Portfolio.');
            return;
        }
        try {
            localStorage.setItem(PREVIEW_DRAFT_KEY, JSON.stringify({
                ...payload,
                studio: {
                    name: global.__APP_USER__?.name || 'TeeMedia Studio',
                    phone: global.__APP_USER__?.phone || '0901 234 567',
                    email: global.__APP_USER__?.email || 'studio@gmail.com'
                }
            }));
        } catch {}
        global.open('portfolio.html?preview=1', '_blank', 'noopener');
    }

    async function savePortfolioSetup() {
        if (setupState.saving) return;
        const payload = buildPortfolioPayload();
        setupState.saving = true;
        const saveBtns = [document.getElementById('setupSaveBtn'), document.getElementById('setupSaveTopBtn'), document.getElementById('setupStickySaveBtn')];
        saveBtns.forEach(btn => { if (btn) btn.disabled = true; });
        try {
            const { ok, result } = await API.callJson({
                action: 'save_portfolio_setup',
                portfolio: payload
            });
            if (!ok || !result?.success) {
                throw new Error(result?.message || 'Không thể lưu cấu hình Portfolio.');
            }
            setupState.publishedAt = result.portfolio?.updated_at || new Date().toISOString();
            setupState.dirty = false;
            try {
                localStorage.setItem(PREVIEW_DRAFT_KEY, JSON.stringify({
                    ...payload,
                    studio: {
                        name: global.__APP_USER__?.name || 'TeeMedia Studio',
                        phone: global.__APP_USER__?.phone || '0901 234 567',
                        email: global.__APP_USER__?.email || 'studio@gmail.com'
                    }
                }));
            } catch {}
            updateSummaryAndStatus();
            showSetupToast(`✅ Đã lưu Portfolio (${payload.albums.length} album · ${payload.photos.length} ảnh)!`);
        } catch (err) {
            showSetupToast(`❌ ${err.message || 'Lưu thất bại.'}`);
        } finally {
            setupState.saving = false;
            saveBtns.forEach(btn => { if (btn) btn.disabled = false; });
        }
    }

    function copyPublicPortfolioLink() {
        const url = new URL('portfolio.html', global.location.href).toString();
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                showSetupToast('✅ Đã sao chép link Portfolio công khai!');
            }).catch(() => {
                prompt('Link Portfolio công khai:', url);
            });
        } else {
            prompt('Link Portfolio công khai:', url);
        }
    }

    function bindSetupControls() {
        document.getElementById('setupSaveBtn')?.addEventListener('click', savePortfolioSetup);
        document.getElementById('setupSaveTopBtn')?.addEventListener('click', savePortfolioSetup);
        document.getElementById('setupStickySaveBtn')?.addEventListener('click', savePortfolioSetup);

        document.getElementById('setupPreviewBtn')?.addEventListener('click', openPortfolioPreview);
        document.getElementById('setupPreviewTopBtn')?.addEventListener('click', openPortfolioPreview);
        document.getElementById('setupStickyPreviewBtn')?.addEventListener('click', openPortfolioPreview);

        document.getElementById('setupCopyLinkBtn')?.addEventListener('click', copyPublicPortfolioLink);

        document.getElementById('setupPhotoSearch')?.addEventListener('input', e => {
            setupState.searchQuery = e.currentTarget.value || '';
            renderPhotoCuratorGrid();
        });

        document.querySelectorAll('.setup-filter-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.setup-filter-chip').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                setupState.filterMode = btn.dataset.setupFilter || 'all';
                renderPhotoCuratorGrid();
            });
        });

        document.getElementById('setupSelectTop6Btn')?.addEventListener('click', () => {
            const fid = String(setupState.activeFolderId || '');
            const album = setupState.albums.find(a => String(a.folder_id) === fid);
            const photos = (setupState.loadedDrivePhotos.get(fid) || []).slice(0, 6);
            if (!photos.length) return;
            const map = getAlbumSelectedMap(fid);
            photos.forEach(p => map.set(String(p.id), { ...p, folder_id: fid, album_name: album?.album_name || p.album_name || 'Album ảnh' }));
            setupState.enabledAlbums.add(fid);
            if (!setupState.coverPhotoByAlbum.has(fid) && photos[0]) {
                setupState.coverPhotoByAlbum.set(fid, String(photos[0].id));
            }
            setupState.dirty = true;
            updateSummaryAndStatus();
            renderAlbumsList();
            renderSelectedTray();
            renderPhotoCuratorGrid();
        });

        document.getElementById('setupSelectAllBtn')?.addEventListener('click', () => {
            const fid = String(setupState.activeFolderId || '');
            const album = setupState.albums.find(a => String(a.folder_id) === fid);
            const photos = setupState.loadedDrivePhotos.get(fid) || [];
            if (!photos.length) return;
            const map = getAlbumSelectedMap(fid);
            photos.forEach(p => map.set(String(p.id), { ...p, folder_id: fid, album_name: album?.album_name || p.album_name || 'Album ảnh' }));
            setupState.enabledAlbums.add(fid);
            if (!setupState.coverPhotoByAlbum.has(fid) && photos[0]) {
                setupState.coverPhotoByAlbum.set(fid, String(photos[0].id));
            }
            setupState.dirty = true;
            updateSummaryAndStatus();
            renderAlbumsList();
            renderSelectedTray();
            renderPhotoCuratorGrid();
        });

        document.getElementById('setupClearAlbumBtn')?.addEventListener('click', () => {
            const fid = String(setupState.activeFolderId || '');
            if (!fid) return;
            getAlbumSelectedMap(fid).clear();
            setupState.coverPhotoByAlbum.delete(fid);
            setupState.enabledAlbums.delete(fid);
            setupState.dirty = true;
            updateSummaryAndStatus();
            renderAlbumsList();
            renderSelectedTray();
            renderPhotoCuratorGrid();
        });
    }

    async function loadSetupWorkspace() {
        if (setupState.initialized) return;
        const root = document.getElementById('studioHomeSetupRoot');
        if (!root) return;
        setupState.initialized = true;
        bindSetupControls();

        try {
            const { ok, result } = await API.callJson({ action: 'load_portfolio_setup' });
            if (!ok || !result?.success) {
                throw new Error(result?.message || 'Không thể tải dữ liệu Setup Portfolio.');
            }
            setupState.albums = Array.isArray(result.albums) ? result.albums : [];
            const savedPortfolio = result.portfolio || {};
            setupState.publishedAt = savedPortfolio.updated_at || null;

            (savedPortfolio.albums || []).forEach(a => {
                const fid = String(a.folder_id || '');
                if (!fid) return;
                setupState.enabledAlbums.add(fid);
                if (a.cover_photo_id) setupState.coverPhotoByAlbum.set(fid, String(a.cover_photo_id));
            });

            (savedPortfolio.photos || []).forEach(p => {
                const fid = String(p.folder_id || '');
                if (!fid || !p.id) return;
                setupState.enabledAlbums.add(fid);
                getAlbumSelectedMap(fid).set(String(p.id), p);
            });

            renderAlbumsList();
            updateSummaryAndStatus();
            renderSelectedTray();

            const firstFolderId = setupState.albums[0]?.folder_id;
            if (firstFolderId) {
                await selectActiveAlbum(firstFolderId);
            } else {
                const grid = document.getElementById('setupPhotosGrid');
                if (grid) {
                    grid.innerHTML = '<div class="setup-empty-card"><p>Hãy thêm ít nhất 1 album Google Drive ở mục Album gần đây để chọn ảnh lên Portfolio.</p></div>';
                }
            }
        } catch (err) {
            console.error('Lỗi tải Trang chủ Setup Portfolio:', err);
            showSetupToast('❌ Không thể tải cấu hình Portfolio.');
        }
    }

    if (global.__TEEMEDIA_STUDIO_HOME_READY__) {
        loadSetupWorkspace();
    } else {
        global.addEventListener('teemedia:studio-home-ready', loadSetupWorkspace);
    }
})(window);
