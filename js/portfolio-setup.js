/**
 * TeeMedia Studio Home — Quản trị Album Portfolio theo chủ đề (Tạo / Sửa / Xóa / Thứ tự / Ẩn-Hiện / Ảnh bìa / Mô tả) & Chọn ảnh từ Google Drive.
 */
(function initPortfolioSetup(global) {
    const params = new URLSearchParams(global.location.search);
    if (params.has('share') || params.has('folder')) return;

    const API = global.PhotoSelectAPI;
    if (!API) return;

    const PREVIEW_DRAFT_KEY = 'teemediaPortfolioPreviewDraft_v1';

    const setupState = {
        initialized: false,
        driveAlbums: [],            // Available uploaded Google Drive folders from server/Firebase
        portfolioAlbums: [],        // Array of { id, album_name, description, order, visible, cover_photo_id, folder_id, photos: [] }
        activePortfolioId: '',      // Currently editing portfolio album id
        activeDriveFolderId: '',    // Currently browsing source Google Drive folder id
        isCreatingNew: false,
        loadedDrivePhotos: new Map(), // folder_id -> Array<photo>
        filterMode: 'all',          // 'all' | 'selected' | 'unselected'
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

    function getActivePortfolioAlbum() {
        return setupState.portfolioAlbums.find(a => String(a.id) === String(setupState.activePortfolioId)) || null;
    }

    function sortPortfolioAlbums() {
        setupState.portfolioAlbums.sort((a, b) => (Number(a.order) || 999) - (Number(b.order) || 999));
    }

    function buildPortfolioPayload() {
        sortPortfolioAlbums();
        const albums = [];
        const photos = [];

        setupState.portfolioAlbums.forEach((album, idx) => {
            const albumPhotos = Array.isArray(album.photos) ? album.photos : [];
            const coverId = album.cover_photo_id && albumPhotos.some(p => String(p.id) === String(album.cover_photo_id))
                ? String(album.cover_photo_id)
                : String(albumPhotos[0]?.id || '');

            const normalizedPhotos = albumPhotos.map(p => ({
                id: String(p.id),
                name: String(p.name || ''),
                folder_id: String(p.folder_id || album.folder_id || ''),
                portfolio_album_id: String(album.id),
                album_name: String(album.album_name || 'Bộ sưu tập'),
                thumbnailLink: String(p.thumbnailLink || ''),
                thumbnailUrl: String(p.thumbnailUrl || ''),
                fullUrl: String(p.fullUrl || ''),
                mimeType: String(p.mimeType || 'image/jpeg'),
                size: Number(p.size || 0) || undefined
            }));

            albums.push({
                id: String(album.id),
                folder_id: String(album.folder_id || normalizedPhotos[0]?.folder_id || ''),
                album_name: String(album.album_name || 'Bộ sưu tập'),
                description: String(album.description || '').trim(),
                order: Number.isFinite(Number(album.order)) && Number(album.order) > 0 ? Number(album.order) : idx + 1,
                visible: album.visible !== false,
                created_at: album.created_at || new Date().toISOString(),
                cover_photo_id: coverId,
                photo_ids: normalizedPhotos.map(p => p.id),
                photos: normalizedPhotos
            });

            if (album.visible !== false) {
                normalizedPhotos.forEach(p => photos.push(p));
            }
        });

        return {
            updated_at: new Date().toISOString(),
            albums,
            photos
        };
    }

    function buildPublicPreviewPayload() {
        const full = buildPortfolioPayload();
        const visibleAlbums = full.albums
            .filter(a => a.visible !== false && a.photos.length > 0)
            .sort((a, b) => (a.order - b.order));
        const visibleIds = new Set(visibleAlbums.map(a => String(a.id)));
        const visiblePhotos = full.photos.filter(p => visibleIds.has(String(p.portfolio_album_id)));
        return {
            updated_at: full.updated_at,
            studio: {
                name: global.__APP_USER__?.name || 'TeeMedia Atelier',
                phone: (!global.__APP_USER__?.phone || global.__APP_USER__?.phone === '0901 234 567') ? '0386 038 930' : global.__APP_USER__.phone,
                email: (!global.__APP_USER__?.email || global.__APP_USER__?.email === 'studio@gmail.com') ? 'thongtrong10@gmail.com' : global.__APP_USER__.email,
                zalo: '0386038930'
            },
            albums: visibleAlbums.map(a => ({
                ...a,
                cover_photo: a.photos.find(p => String(p.id) === String(a.cover_photo_id)) || a.photos[0] || null,
                photo_count: a.photos.length
            })),
            photos: visiblePhotos
        };
    }

    function updateSummaryAndStatus() {
        const albumsEl = document.getElementById('setupSelectedAlbumsCount');
        const photosEl = document.getElementById('setupSelectedPhotosCount');
        const publishedEl = document.getElementById('setupPublishedTimeText');
        const statusEl = document.getElementById('setupStatusText');
        const stickyBar = document.getElementById('setupStickyDock');
        const stickyCount = document.getElementById('setupStickyCount');

        const visibleWithPhotos = setupState.portfolioAlbums.filter(a => a.visible !== false && (a.photos || []).length > 0);
        const totalAlbums = visibleWithPhotos.length;
        const totalPhotos = visibleWithPhotos.reduce((sum, a) => sum + (a.photos || []).length, 0);

        if (albumsEl) albumsEl.textContent = String(totalAlbums);
        if (photosEl) photosEl.textContent = String(totalPhotos);
        if (stickyCount) stickyCount.textContent = `${totalAlbums} album hiển thị · ${totalPhotos} ảnh`;
        if (stickyBar) stickyBar.hidden = setupState.portfolioAlbums.length < 1 && !setupState.dirty;

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
                statusEl.textContent = `🟡 Có thay đổi chưa lưu (${totalAlbums} album · ${totalPhotos} ảnh)`;
                statusEl.className = 'setup-status-pill is-dirty';
            } else if (totalAlbums > 0) {
                statusEl.textContent = `✅ Đang xuất bản: ${totalAlbums} album · ${totalPhotos} ảnh`;
                statusEl.className = 'setup-status-pill is-saved';
            } else {
                statusEl.textContent = 'Tạo album & thêm ảnh để xuất bản Portfolio';
                statusEl.className = 'setup-status-pill';
            }
        }
    }

    function renderAlbumEditor() {
        const form = document.getElementById('setupAlbumEditor');
        if (!form) return;
        const heading = document.getElementById('setupEditorHeading');
        const nameInput = document.getElementById('setupEditAlbumName');
        const orderInput = document.getElementById('setupEditAlbumOrder');
        const descInput = document.getElementById('setupEditAlbumDesc');
        const visibleInput = document.getElementById('setupEditAlbumVisible');
        const applyBtn = document.getElementById('setupApplyAlbumMetaBtn');
        const cancelBtn = document.getElementById('setupCancelCreateBtn');
        const deleteBtn = document.getElementById('setupDeleteAlbumBtn');

        if (setupState.isCreatingNew) {
            form.hidden = false;
            if (heading) heading.textContent = 'Tạo Album Portfolio Mới';
            if (nameInput) nameInput.value = '';
            if (orderInput) orderInput.value = String(setupState.portfolioAlbums.length + 1);
            if (descInput) descInput.value = '';
            if (visibleInput) visibleInput.checked = true;
            if (applyBtn) applyBtn.textContent = '＋ Tạo album này';
            if (cancelBtn) cancelBtn.hidden = false;
            if (deleteBtn) deleteBtn.hidden = true;
            nameInput?.focus();
            return;
        }

        const active = getActivePortfolioAlbum();
        if (!active) {
            form.hidden = true;
            return;
        }

        form.hidden = false;
        if (heading) heading.textContent = `Chỉnh sửa: ${active.album_name || 'Album'}`;
        if (nameInput) nameInput.value = active.album_name || '';
        if (orderInput) orderInput.value = String(active.order || 1);
        if (descInput) descInput.value = active.description || '';
        if (visibleInput) visibleInput.checked = active.visible !== false;
        if (applyBtn) applyBtn.textContent = '✓ Cập nhật thông tin album';
        if (cancelBtn) cancelBtn.hidden = true;
        if (deleteBtn) deleteBtn.hidden = false;
    }

    function moveAlbumOrder(albumId, delta) {
        sortPortfolioAlbums();
        const idx = setupState.portfolioAlbums.findIndex(a => String(a.id) === String(albumId));
        if (idx < 0) return;
        const nextIdx = idx + delta;
        if (nextIdx < 0 || nextIdx >= setupState.portfolioAlbums.length) return;
        const [moved] = setupState.portfolioAlbums.splice(idx, 1);
        setupState.portfolioAlbums.splice(nextIdx, 0, moved);
        setupState.portfolioAlbums.forEach((a, i) => { a.order = i + 1; });
        setupState.dirty = true;
        updateSummaryAndStatus();
        renderAlbumsList();
        renderAlbumEditor();
    }

    function deletePortfolioAlbum(albumId) {
        const idx = setupState.portfolioAlbums.findIndex(a => String(a.id) === String(albumId));
        if (idx < 0) return;
        const target = setupState.portfolioAlbums[idx];
        if (!global.confirm(`Xóa album "${target.album_name}" khỏi danh sách Portfolio? (Kho ảnh gốc Google Drive vẫn được giữ nguyên)`)) {
            return;
        }
        setupState.portfolioAlbums.splice(idx, 1);
        setupState.portfolioAlbums.forEach((a, i) => { a.order = i + 1; });
        if (String(setupState.activePortfolioId) === String(albumId)) {
            setupState.activePortfolioId = setupState.portfolioAlbums[0]?.id || '';
        }
        setupState.isCreatingNew = false;
        setupState.dirty = true;
        updateSummaryAndStatus();
        renderAlbumsList();
        renderAlbumEditor();
        renderSelectedTray();
        renderPhotoCuratorGrid();
    }

    function renderAlbumsList() {
        const container = document.getElementById('setupAlbumsList');
        if (!container) return;
        container.replaceChildren();
        sortPortfolioAlbums();

        if (!setupState.portfolioAlbums.length) {
            container.innerHTML = `<div class="setup-empty-card">
                <p>Chưa có album Portfolio nào. Bấm <strong>＋ Tạo album mới</strong> (VD: Phóng sự cưới, Truyền thống, Kỷ yếu, Concept) để bắt đầu.</p>
            </div>`;
            return;
        }

        setupState.portfolioAlbums.forEach((album, idx) => {
            const aid = String(album.id);
            const isActive = !setupState.isCreatingNew && aid === String(setupState.activePortfolioId);
            const isVisible = album.visible !== false;
            const photos = Array.isArray(album.photos) ? album.photos : [];
            const coverPhoto = photos.find(p => String(p.id) === String(album.cover_photo_id)) || photos[0] || null;

            const card = document.createElement('article');
            card.className = `setup-album-card${isActive ? ' is-active' : ''}${isVisible && photos.length ? ' is-published' : ''}${!isVisible ? ' is-hidden-album' : ''}`;

            const topRow = document.createElement('div');
            topRow.className = 'setup-album-card-top';

            const orderBadge = document.createElement('span');
            orderBadge.className = 'setup-album-order-pill';
            orderBadge.textContent = `#${album.order || idx + 1}`;

            const visLabel = document.createElement('label');
            visLabel.className = 'setup-album-toggle';
            visLabel.addEventListener('click', e => e.stopPropagation());
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = isVisible;
            checkbox.addEventListener('change', () => {
                album.visible = checkbox.checked;
                setupState.dirty = true;
                updateSummaryAndStatus();
                renderAlbumsList();
                renderAlbumEditor();
            });
            const visSpan = document.createElement('span');
            visSpan.textContent = isVisible ? 'Hiển thị' : 'Đang ẩn';
            visLabel.append(checkbox, visSpan);

            topRow.append(orderBadge, visLabel);

            const bodyRow = document.createElement('div');
            bodyRow.className = 'setup-album-card-body';

            const thumbWrap = document.createElement('div');
            thumbWrap.className = 'setup-album-card-thumb';
            if (coverPhoto) {
                const img = document.createElement('img');
                img.alt = album.album_name || '';
                API.bindDriveImage(img, coverPhoto, 'thumb');
                thumbWrap.appendChild(img);
            } else {
                thumbWrap.textContent = '🖼️';
            }

            const copyWrap = document.createElement('div');
            copyWrap.className = 'setup-album-card-copy';
            const title = document.createElement('h3');
            title.textContent = album.album_name || 'Album chưa đặt tên';
            const desc = document.createElement('p');
            desc.className = 'setup-album-card-desc';
            desc.textContent = album.description || 'Chưa có mô tả ngắn';
            const meta = document.createElement('small');
            meta.className = 'setup-album-sub';
            meta.textContent = `${photos.length} ảnh trong album${isActive ? ' · Đang mở chọn ảnh' : ''}`;
            copyWrap.append(title, desc, meta);

            bodyRow.append(thumbWrap, copyWrap);

            const actionsRow = document.createElement('div');
            actionsRow.className = 'setup-album-card-actions';
            actionsRow.addEventListener('click', e => e.stopPropagation());

            const upBtn = document.createElement('button');
            upBtn.type = 'button';
            upBtn.className = 'setup-mini-btn';
            upBtn.title = 'Đưa lên trước';
            upBtn.textContent = '↑';
            upBtn.disabled = idx === 0;
            upBtn.addEventListener('click', () => moveAlbumOrder(aid, -1));

            const downBtn = document.createElement('button');
            downBtn.type = 'button';
            downBtn.className = 'setup-mini-btn';
            downBtn.title = 'Đưa xuống sau';
            downBtn.textContent = '↓';
            downBtn.disabled = idx === setupState.portfolioAlbums.length - 1;
            downBtn.addEventListener('click', () => moveAlbumOrder(aid, 1));

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'setup-mini-btn';
            editBtn.textContent = 'Sửa & Chọn ảnh';
            editBtn.addEventListener('click', () => selectPortfolioAlbum(aid));

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'setup-mini-btn is-danger';
            delBtn.title = 'Xóa album';
            delBtn.textContent = '✕';
            delBtn.addEventListener('click', () => deletePortfolioAlbum(aid));

            actionsRow.append(upBtn, downBtn, editBtn, delBtn);

            card.append(topRow, bodyRow, actionsRow);
            card.addEventListener('click', () => selectPortfolioAlbum(aid));
            container.appendChild(card);
        });
    }

    function renderSelectedTray() {
        const tray = document.getElementById('setupSelectedTray');
        const titleEl = document.getElementById('setupSelectedTrayTitle');
        const strip = document.getElementById('setupSelectedTrayStrip');
        const active = getActivePortfolioAlbum();
        if (!tray || !strip) return;

        if (!active || !(active.photos || []).length) {
            tray.hidden = true;
            strip.replaceChildren();
            return;
        }

        tray.hidden = false;
        if (titleEl) {
            titleEl.textContent = `Ảnh trong "${active.album_name}" (${active.photos.length} ảnh)`;
        }
        strip.replaceChildren();

        const coverId = String(active.cover_photo_id || active.photos[0]?.id || '');
        active.photos.forEach(photo => {
            const pid = String(photo.id);
            const isCover = pid === coverId;
            const chip = document.createElement('div');
            chip.className = `setup-tray-item${isCover ? ' is-cover' : ''}`;

            const img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            API.bindDriveImage(img, photo, 'thumb');

            const coverBtn = document.createElement('button');
            coverBtn.type = 'button';
            coverBtn.className = 'setup-tray-cover-btn';
            coverBtn.title = isCover ? 'Đang là ảnh bìa album' : 'Đặt làm ảnh bìa album';
            coverBtn.textContent = isCover ? '★ Ảnh bìa' : '☆ Đặt bìa';
            coverBtn.addEventListener('click', () => {
                active.cover_photo_id = pid;
                setupState.dirty = true;
                updateSummaryAndStatus();
                renderAlbumsList();
                renderSelectedTray();
                renderPhotoCuratorGrid();
            });

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'setup-tray-remove-btn';
            removeBtn.title = 'Bỏ ảnh khỏi album';
            removeBtn.textContent = '✕ Bỏ ảnh';
            removeBtn.addEventListener('click', () => {
                active.photos = active.photos.filter(p => String(p.id) !== pid);
                if (String(active.cover_photo_id) === pid) {
                    active.cover_photo_id = String(active.photos[0]?.id || '');
                }
                setupState.dirty = true;
                updateSummaryAndStatus();
                renderAlbumsList();
                renderSelectedTray();
                renderPhotoCuratorGrid();
            });

            chip.append(img, coverBtn, removeBtn);
            strip.appendChild(chip);
        });
    }

    function selectPortfolioAlbum(albumId) {
        setupState.isCreatingNew = false;
        setupState.activePortfolioId = String(albumId || '');
        const active = getActivePortfolioAlbum();
        if (active) {
            const titleEl = document.getElementById('setupActiveAlbumTitle');
            if (titleEl) titleEl.textContent = `Bước 2: Chọn ảnh vào "${active.album_name}"`;
            if (active.folder_id && setupState.driveAlbums.some(d => String(d.folder_id) === String(active.folder_id))) {
                const select = document.getElementById('setupSourceFolderSelect');
                if (select) select.value = String(active.folder_id);
                selectDriveSourceFolder(String(active.folder_id));
            }
        }
        renderAlbumsList();
        renderAlbumEditor();
        renderSelectedTray();
        renderPhotoCuratorGrid();
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
                        folder_id: setupState.activeDriveFolderId || folderId,
                        album_name: albumName
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

    async function selectDriveSourceFolder(folderId) {
        const fid = String(folderId || '');
        if (!fid) return;
        setupState.activeDriveFolderId = fid;
        const driveAlbum = setupState.driveAlbums.find(a => String(a.folder_id) === fid);

        if (!setupState.loadedDrivePhotos.has(fid)) {
            setupState.loadingPhotos = true;
            renderPhotoCuratorGrid();
            try {
                const photos = await loadDriveFolderRecursive(fid, driveAlbum?.album_name || 'Google Drive', [], new Set());
                photos.forEach(p => { p.folder_id = fid; });
                setupState.loadedDrivePhotos.set(fid, photos);
            } catch (err) {
                console.warn('Không thể tải ảnh kho Drive:', err);
                setupState.loadedDrivePhotos.set(fid, []);
            } finally {
                setupState.loadingPhotos = false;
            }
        }
        renderPhotoCuratorGrid();
    }

    function togglePhotoInActiveAlbum(photo) {
        const active = getActivePortfolioAlbum();
        if (!active) {
            showSetupToast('⚠️ Hãy chọn hoặc tạo một album ở Bước 1 trước.');
            return;
        }
        const pid = String(photo.id);
        const list = Array.isArray(active.photos) ? active.photos : (active.photos = []);
        const idx = list.findIndex(p => String(p.id) === pid);
        if (idx >= 0) {
            list.splice(idx, 1);
            if (String(active.cover_photo_id) === pid) {
                active.cover_photo_id = String(list[0]?.id || '');
            }
        } else {
            list.push({
                ...photo,
                folder_id: String(photo.folder_id || setupState.activeDriveFolderId || ''),
                portfolio_album_id: String(active.id),
                album_name: String(active.album_name || 'Bộ sưu tập')
            });
            if (!active.cover_photo_id) {
                active.cover_photo_id = pid;
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
        const metaEl = document.getElementById('setupActiveAlbumMeta');
        const titleEl = document.getElementById('setupActiveAlbumTitle');
        if (!grid) return;

        const active = getActivePortfolioAlbum();
        if (titleEl) {
            titleEl.textContent = active
                ? `Bước 2: Chọn ảnh đưa vào "${active.album_name}"`
                : 'Bước 2: Chọn ảnh đưa vào album';
        }

        if (setupState.loadingPhotos) {
            grid.innerHTML = '<div class="setup-empty-card"><p>⏳ Đang tải danh sách ảnh từ Google Drive...</p></div>';
            return;
        }

        const fid = String(setupState.activeDriveFolderId || '');
        const photos = setupState.loadedDrivePhotos.get(fid) || [];
        const selectedIds = new Set((active?.photos || []).map(p => String(p.id)));

        const q = setupState.searchQuery.trim().toLowerCase();
        const filtered = photos.filter(p => {
            if (q && !String(p.name || '').toLowerCase().includes(q)) return false;
            const isSel = selectedIds.has(String(p.id));
            if (setupState.filterMode === 'selected' && !isSel) return false;
            if (setupState.filterMode === 'unselected' && isSel) return false;
            return true;
        });

        if (metaEl) {
            metaEl.textContent = active
                ? `Kho nguồn: ${photos.length} ảnh · Album "${active.album_name}" đang có ${(active.photos || []).length} ảnh`
                : 'Chưa có album Portfolio nào được chọn ở Bước 1.';
        }

        if (!filtered.length) {
            grid.innerHTML = `<div class="setup-empty-card">
                <p>${photos.length ? 'Không có ảnh nào khớp bộ lọc hiện tại.' : 'Hãy thêm album Google Drive ở mục Album gần đây để chọn ảnh.'}</p>
            </div>`;
            return;
        }

        grid.replaceChildren();
        const currentCoverId = String(active?.cover_photo_id || '');

        filtered.forEach((photo, idx) => {
            const pid = String(photo.id);
            const isSelected = selectedIds.has(pid);
            const isCover = isSelected && currentCoverId === pid;

            const card = document.createElement('article');
            card.className = `setup-photo-card${isSelected ? ' is-selected' : ''}`;

            const img = document.createElement('img');
            img.alt = photo.name || 'Ảnh kho Google Drive';
            img.loading = idx < 12 ? 'eager' : 'lazy';
            img.decoding = 'async';
            API.bindDriveImage(img, photo, 'thumb');

            const pickBtn = document.createElement('button');
            pickBtn.type = 'button';
            pickBtn.className = `setup-photo-heart${isSelected ? ' is-active' : ''}`;
            pickBtn.textContent = isSelected ? '✓' : '＋';
            pickBtn.title = isSelected ? 'Bỏ khỏi album' : 'Đưa vào album';
            pickBtn.addEventListener('click', e => {
                e.stopPropagation();
                togglePhotoInActiveAlbum(photo);
            });

            const bottomBar = document.createElement('div');
            bottomBar.className = 'setup-photo-bar';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = photo.name || pid;
            bottomBar.appendChild(nameSpan);

            if (isSelected && active) {
                const coverBtn = document.createElement('button');
                coverBtn.type = 'button';
                coverBtn.className = `setup-cover-pill${isCover ? ' is-active' : ''}`;
                coverBtn.textContent = isCover ? '★ Bìa' : 'Đặt bìa';
                coverBtn.addEventListener('click', e => {
                    e.stopPropagation();
                    active.cover_photo_id = pid;
                    setupState.dirty = true;
                    updateSummaryAndStatus();
                    renderAlbumsList();
                    renderSelectedTray();
                    renderPhotoCuratorGrid();
                });
                bottomBar.appendChild(coverBtn);
            }

            card.append(img, pickBtn, bottomBar);
            card.addEventListener('click', () => togglePhotoInActiveAlbum(photo));
            grid.appendChild(card);
        });
    }

    function syncEditorToActiveAlbum() {
        if (setupState.isCreatingNew) return;
        const active = getActivePortfolioAlbum();
        const form = document.getElementById('setupAlbumEditor');
        if (!active || !form || form.hidden) return;
        const nameVal = String(document.getElementById('setupEditAlbumName')?.value || '').trim();
        const orderVal = Number(document.getElementById('setupEditAlbumOrder')?.value || active.order || 1);
        const descVal = String(document.getElementById('setupEditAlbumDesc')?.value || '').trim();
        const visVal = Boolean(document.getElementById('setupEditAlbumVisible')?.checked);
        if (nameVal) {
            active.album_name = nameVal;
            (active.photos || []).forEach(p => { p.album_name = nameVal; });
        }
        active.order = Number.isFinite(orderVal) && orderVal > 0 ? orderVal : active.order || 1;
        active.description = descVal;
        active.visible = visVal;
    }

    function openPortfolioPreview() {
        syncEditorToActiveAlbum();
        const preview = buildPublicPreviewPayload();
        if (!preview.albums.length) {
            showSetupToast('⚠️ Hãy tạo ít nhất 1 album đang bật "Hiển thị" và có tối thiểu 1 ảnh trước khi Preview.');
            return;
        }
        try {
            localStorage.setItem(PREVIEW_DRAFT_KEY, JSON.stringify(preview));
        } catch {}
        const portfolioPath = global.location.protocol === 'file:' ? 'portfolio.html' : 'portfolio';
        global.open(`${portfolioPath}?preview=1`, '_blank', 'noopener');
    }

    async function savePortfolioSetup() {
        if (setupState.saving) return;
        syncEditorToActiveAlbum();
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
                localStorage.setItem(PREVIEW_DRAFT_KEY, JSON.stringify(buildPublicPreviewPayload()));
            } catch {}
            updateSummaryAndStatus();
            const visAlbums = payload.albums.filter(a => a.visible !== false && a.photos.length > 0);
            const visPhotos = visAlbums.reduce((s, a) => s + a.photos.length, 0);
            showSetupToast(`✅ Đã lưu Portfolio (${visAlbums.length} album · ${visPhotos} ảnh)!`);
        } catch (err) {
            showSetupToast(`❌ ${err.message || 'Lưu thất bại.'}`);
        } finally {
            setupState.saving = false;
            saveBtns.forEach(btn => { if (btn) btn.disabled = false; });
        }
    }

    function copyPublicPortfolioLink() {
        const portfolioPath = global.location.protocol === 'file:' ? 'portfolio.html' : 'portfolio';
        const url = new URL(portfolioPath, global.location.href).toString();
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

        document.getElementById('setupCreateAlbumBtn')?.addEventListener('click', () => {
            setupState.isCreatingNew = true;
            renderAlbumsList();
            renderAlbumEditor();
        });

        document.getElementById('setupCancelCreateBtn')?.addEventListener('click', () => {
            setupState.isCreatingNew = false;
            renderAlbumsList();
            renderAlbumEditor();
        });

        document.getElementById('setupDeleteAlbumBtn')?.addEventListener('click', () => {
            if (setupState.activePortfolioId) {
                deletePortfolioAlbum(setupState.activePortfolioId);
            }
        });

        document.getElementById('setupAlbumEditor')?.addEventListener('submit', e => {
            e.preventDefault();
            const nameVal = String(document.getElementById('setupEditAlbumName')?.value || '').trim();
            if (!nameVal) {
                showSetupToast('⚠️ Vui lòng nhập tên album / chủ đề.');
                return;
            }
            const orderVal = Math.max(1, Number(document.getElementById('setupEditAlbumOrder')?.value || 1));
            const descVal = String(document.getElementById('setupEditAlbumDesc')?.value || '').trim();
            const visVal = Boolean(document.getElementById('setupEditAlbumVisible')?.checked);

            if (setupState.isCreatingNew) {
                const newId = `pf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
                setupState.portfolioAlbums.push({
                    id: newId,
                    folder_id: setupState.activeDriveFolderId || '',
                    album_name: nameVal,
                    description: descVal,
                    order: orderVal,
                    visible: visVal,
                    created_at: new Date().toISOString(),
                    cover_photo_id: '',
                    photos: []
                });
                setupState.isCreatingNew = false;
                setupState.activePortfolioId = newId;
                showSetupToast(`✨ Đã tạo album "${nameVal}". Chọn ảnh ở Bước 2 rồi bấm Lưu & Xuất bản.`);
            } else {
                const active = getActivePortfolioAlbum();
                if (active) {
                    active.album_name = nameVal;
                    active.order = orderVal;
                    active.description = descVal;
                    active.visible = visVal;
                    (active.photos || []).forEach(p => { p.album_name = nameVal; });
                    showSetupToast(`✓ Đã cập nhật "${nameVal}". Bấm Lưu & Xuất bản để phát hành.`);
                }
            }
            setupState.dirty = true;
            updateSummaryAndStatus();
            renderAlbumsList();
            renderAlbumEditor();
            renderSelectedTray();
            renderPhotoCuratorGrid();
        });

        document.getElementById('setupSourceFolderSelect')?.addEventListener('change', e => {
            const fid = String(e.currentTarget.value || '');
            if (fid) selectDriveSourceFolder(fid);
        });

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
            const active = getActivePortfolioAlbum();
            if (!active) return;
            const photos = (setupState.loadedDrivePhotos.get(setupState.activeDriveFolderId) || []).slice(0, 6);
            const existing = new Set((active.photos || []).map(p => String(p.id)));
            photos.forEach(p => {
                if (!existing.has(String(p.id))) {
                    active.photos.push({ ...p, portfolio_album_id: active.id, album_name: active.album_name });
                }
            });
            if (!active.cover_photo_id && active.photos[0]) {
                active.cover_photo_id = String(active.photos[0].id);
            }
            setupState.dirty = true;
            updateSummaryAndStatus();
            renderAlbumsList();
            renderSelectedTray();
            renderPhotoCuratorGrid();
        });

        document.getElementById('setupSelectAllBtn')?.addEventListener('click', () => {
            const active = getActivePortfolioAlbum();
            if (!active) return;
            const photos = setupState.loadedDrivePhotos.get(setupState.activeDriveFolderId) || [];
            const existing = new Set((active.photos || []).map(p => String(p.id)));
            photos.forEach(p => {
                if (!existing.has(String(p.id))) {
                    active.photos.push({ ...p, portfolio_album_id: active.id, album_name: active.album_name });
                }
            });
            if (!active.cover_photo_id && active.photos[0]) {
                active.cover_photo_id = String(active.photos[0].id);
            }
            setupState.dirty = true;
            updateSummaryAndStatus();
            renderAlbumsList();
            renderSelectedTray();
            renderPhotoCuratorGrid();
        });

        document.getElementById('setupClearAlbumBtn')?.addEventListener('click', () => {
            const active = getActivePortfolioAlbum();
            if (!active) return;
            active.photos = [];
            active.cover_photo_id = '';
            setupState.dirty = true;
            updateSummaryAndStatus();
            renderAlbumsList();
            renderSelectedTray();
            renderPhotoCuratorGrid();
        });
    }

    function populateSourceFolderDropdown() {
        const select = document.getElementById('setupSourceFolderSelect');
        if (!select) return;
        select.replaceChildren();
        if (!setupState.driveAlbums.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Chưa có album Drive nào';
            select.appendChild(opt);
            return;
        }
        setupState.driveAlbums.forEach(a => {
            const opt = document.createElement('option');
            opt.value = String(a.folder_id);
            opt.textContent = `Kho Drive: ${a.album_name || a.folder_id}`;
            select.appendChild(opt);
        });
        if (setupState.activeDriveFolderId) {
            select.value = String(setupState.activeDriveFolderId);
        }
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
            setupState.driveAlbums = Array.isArray(result.albums) ? result.albums : [];
            const savedPortfolio = result.portfolio || {};
            setupState.publishedAt = savedPortfolio.updated_at || null;
            setupState.portfolioAlbums = Array.isArray(savedPortfolio.albums) ? savedPortfolio.albums.map(a => ({ ...a, photos: Array.isArray(a.photos) ? [...a.photos] : [] })) : [];
            sortPortfolioAlbums();

            setupState.activePortfolioId = setupState.portfolioAlbums[0]?.id || '';
            const preferredDriveId = getActivePortfolioAlbum()?.folder_id || setupState.driveAlbums[0]?.folder_id || '';
            setupState.activeDriveFolderId = String(preferredDriveId);

            populateSourceFolderDropdown();
            renderAlbumsList();
            renderAlbumEditor();
            updateSummaryAndStatus();
            renderSelectedTray();

            if (setupState.activeDriveFolderId) {
                await selectDriveSourceFolder(setupState.activeDriveFolderId);
            } else {
                const grid = document.getElementById('setupPhotosGrid');
                if (grid) {
                    grid.innerHTML = '<div class="setup-empty-card"><p>Hãy thêm ít nhất 1 album Google Drive ở mục Album gần đây để chọn ảnh đưa vào Portfolio.</p></div>';
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
