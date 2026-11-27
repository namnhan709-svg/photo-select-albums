/**
 * Trình xem ảnh inline, chọn/thả tim ảnh, bình luận và Lightbox toàn màn hình.
 */
(function initViewerModule(global) {
    const { state, formatDate, isAcceptedImageFile } = global.PhotoSelectApp;
    const API = global.PhotoSelectAPI;

    function getPhotoThumbUrl(file) {
        return file.thumbnailUrl || `https://drive.google.com/thumbnail?id=${encodeURIComponent(String(file.id))}&sz=w640`;
    }

    function getPhotoFullUrl(file) {
        return file.fullUrl || `https://drive.google.com/thumbnail?id=${encodeURIComponent(String(file.id))}&sz=w1280`;
    }

    async function loadAlbumImages(folderId, visitedFolders = new Set(), category = 'Album') {
        if (visitedFolders.has(folderId)) return [];
        visitedFolders.add(folderId);
        const entries = [];
        let pageToken = '';
        do {
            const { ok, result } = await API.driveList(folderId, pageToken);
            if (!ok || result.error) throw new Error(result.error?.message || 'Không thể tải ảnh album.');
            entries.push(...(Array.isArray(result.files) ? result.files : []));
            pageToken = result.nextPageToken || '';
        } while (pageToken);

        const images = entries
            .filter(file => isAcceptedImageFile(file))
            .map(file => ({ ...file, category: file.category || category }));
        const folders = entries.filter(file => file.mimeType === 'application/vnd.google-apps.folder');
        const nestedImages = await Promise.all(
            folders.map(folder => loadAlbumImages(folder.id, visitedFolders, folder.name || category))
        );
        return images.concat(...nestedImages);
    }

    function renderGuestSelectionsPanel(records = [], summary = {}) {
        const list = document.getElementById('viewerGuestSelectionsList');
        const title = document.getElementById('viewerGuestSelectionsTitle');
        const meta = document.getElementById('viewerGuestSelectionsMeta');
        const countBadge = document.getElementById('viewerGuestSelectionCount');
        const total = records.length || state.selectedViewerFiles.size;
        if (countBadge) countBadge.textContent = String(total);
        if (title) title.textContent = `Danh sách ảnh khách đã chọn trong thư mục (${total} ảnh)`;
        if (meta) {
            const guests = Array.isArray(summary.guests) && summary.guests.length ? `Khách: ${summary.guests.join(', ')}` : '';
            const lastAt = summary.last_selected_at ? `Cập nhật: ${formatDate(summary.last_selected_at)}` : '';
            meta.textContent = [guests, lastAt].filter(Boolean).join(' · ');
        }
        if (!list) return;
        list.replaceChildren();
        const displayRecords = records.length
            ? records
            : [...state.selectedViewerFiles].map(id => {
                const f = state.viewerFiles.find(item => String(item.id) === String(id));
                return { photo_id: id, photo_name: f?.name || id, category: f?.category || 'Album', guest_name: 'Đã chọn', selected_at: '' };
            });
        if (!displayRecords.length) {
            list.innerHTML = '<span style="color:var(--muted);font-size:.78rem;">Chưa có ảnh nào được khách chọn trong thư mục này.</span>';
            return;
        }
        displayRecords.forEach(rec => {
            const card = document.createElement('article');
            card.className = 'viewer-guest-selection-item';
            const left = document.createElement('div');
            left.style.minWidth = '0';
            const nameEl = document.createElement('strong');
            nameEl.textContent = rec.photo_name || rec.photo_id;
            const infoEl = document.createElement('small');
            infoEl.textContent = `${rec.category || 'Album'} · ${rec.guest_name || 'Khách'}${rec.selected_at ? ` · ${formatDate(rec.selected_at)}` : ''}`;
            left.append(nameEl, infoEl);
            const heart = document.createElement('span');
            heart.textContent = '❤️';
            card.append(left, heart);
            card.addEventListener('click', () => {
                const photo = state.viewerFiles.find(file => String(file.id) === String(rec.photo_id));
                if (photo) openViewerLightbox(photo);
            });
            list.appendChild(card);
        });
    }

    async function loadViewerSelections(folderId) {
        const albumViewerStatus = document.getElementById('albumViewerStatus');
        try {
            const { ok, result } = await API.callJson({
                action: 'load_album_selections',
                folder_id: folderId
            });
            if (ok && result.success) {
                state.selectedViewerFiles.clear();
                (result.selected_ids || []).forEach(id => state.selectedViewerFiles.add(String(id)));
                state.viewerSelectionRecords = Array.isArray(result.records) ? result.records : [];
                state.viewerSelectionSummary = result.summary || {};
                renderGuestSelectionsPanel(state.viewerSelectionRecords, state.viewerSelectionSummary);
                return;
            }
            const fallback = await API.callJson({
                action: 'load_state',
                keys: [`photoSelectionsByAlbum:${folderId}`]
            });
            const saved = fallback.result.data?.[`photoSelectionsByAlbum:${folderId}`];
            if (Array.isArray(saved)) saved.forEach(id => state.selectedViewerFiles.add(String(id)));
            renderGuestSelectionsPanel([], {});
        } catch {
            albumViewerStatus.textContent = 'Không thể tải danh sách ảnh đã chọn.';
        }
    }

    async function refreshViewerSelections() {
        if (!state.selectedAlbumId) return;
        const albumViewerStatus = document.getElementById('albumViewerStatus');
        await loadViewerSelections(state.selectedAlbumId);
        renderViewerPhotos();
        albumViewerStatus.textContent = `${state.viewerFiles.length} ảnh · ❤️ ${state.selectedViewerFiles.size} ảnh khách đã chọn`;
    }

    async function saveViewerSelections() {
        if (!state.selectedAlbumId) return;
        const albumViewerStatus = document.getElementById('albumViewerStatus');
        const selectedList = [...state.selectedViewerFiles];
        const photoMeta = state.viewerFiles
            .filter(file => state.selectedViewerFiles.has(String(file.id)))
            .map(file => ({ id: String(file.id), name: file.name || '', category: file.category || 'Album' }));
        try {
            await API.callJson({
                action: 'save_photo_selection',
                folder_id: state.selectedAlbumId,
                selected_photos: selectedList,
                photo_meta: photoMeta,
                guest_name: state.dashboardUser?.name || 'Studio'
            });
            await loadViewerSelections(state.selectedAlbumId);
        } catch {
            albumViewerStatus.textContent = 'Không thể lưu danh sách ảnh đã chọn.';
        }
    }

    function renderViewerCommentSummary() {
        const summary = document.getElementById('viewerCommentsSummary');
        const count = document.getElementById('viewerCommentsCount');
        count.textContent = String(state.viewerAlbumComments.length);
        if (!state.viewerAlbumComments.length) {
            summary.textContent = 'Chưa có bình luận nào trong album này.';
            return;
        }
        const grouped = new Map();
        state.viewerAlbumComments.forEach(comment => {
            const key = String(comment.photo_id);
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key).push(comment);
        });
        summary.replaceChildren();
        grouped.forEach((comments, photoId) => {
            const photo = state.viewerFiles.find(file => String(file.id) === photoId);
            const item = document.createElement('article');
            item.className = 'viewer-comment-summary';
            const title = document.createElement('strong');
            title.textContent = `${photo?.name || 'Ảnh ' + photoId} (${comments.length} bình luận)`;
            const text = document.createElement('small');
            text.textContent = comments.map(comment => `${comment.author || 'Khách'}: ${comment.comment_text || ''}`).join('\n');
            item.append(title, text);
            item.addEventListener('click', () => openViewerLightbox(photo));
            item.style.cursor = 'pointer';
            summary.appendChild(item);
        });
    }

    async function loadViewerAlbumComments() {
        const summary = document.getElementById('viewerCommentsSummary');
        try {
            const { ok, result } = await API.callJson({ action: 'load_all_comments' });
            if (!ok || !result.success) throw new Error(result.message || 'Không thể tải bình luận.');
            const photoIds = new Set(state.viewerFiles.map(file => String(file.id)));
            state.viewerAlbumComments = (Array.isArray(result.data) ? result.data : [])
                .filter(comment => photoIds.has(String(comment.photo_id)));
            renderViewerCommentSummary();
        } catch (error) {
            summary.textContent = error.message || 'Không thể tải danh sách bình luận.';
        }
    }

    function renderViewerPhotos() {
        const albumViewerGrid = document.getElementById('albumViewerGrid');
        const query = document.getElementById('viewerSearch').value.trim().toLowerCase();
        const filteredFiles = state.viewerFiles.filter(file => {
            const matchesSearch = !query || String(file.name || '').toLowerCase().includes(query);
            const isSelected = state.selectedViewerFiles.has(String(file.id));
            const matchesFilter = state.viewerFilter === 'all' || (state.viewerFilter === 'selected' ? isSelected : !isSelected);
            const matchesCategory = state.viewerCategory === 'all' || file.category === state.viewerCategory;
            return matchesSearch && matchesFilter && matchesCategory;
        });

        if (state.viewerSort === 'name-asc') {
            filteredFiles.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        }
        if (state.viewerSort === 'name-desc') {
            filteredFiles.sort((a, b) => String(b.name || '').localeCompare(String(a.name || '')));
        }

        document.getElementById('viewerSelectedCount').textContent = String(state.selectedViewerFiles.size);
        if (!filteredFiles.length) {
            albumViewerGrid.innerHTML = '<div class="viewer-empty">Không có ảnh phù hợp.</div>';
            return;
        }

        albumViewerGrid.innerHTML = filteredFiles.map(file => {
            const fileId = String(file.id);
            const selected = state.selectedViewerFiles.has(fileId);
            const altText = String(file.name || 'Ảnh album').replace(/"/g, '&quot;');
            return `<article class="viewer-photo ${selected ? 'is-selected' : ''}" data-file-id="${encodeURIComponent(fileId)}">
                <img src="${getPhotoThumbUrl(file)}" alt="${altText}" loading="lazy" decoding="async">
                <span class="viewer-photo-name">${String(file.name || 'Ảnh album')}</span>
                <button class="viewer-photo-heart" type="button" aria-label="${selected ? 'Bỏ chọn ảnh' : 'Chọn ảnh'}">${selected ? '❤️' : '🤍'}</button>
            </article>`;
        }).join('');

        albumViewerGrid.querySelectorAll('.viewer-photo').forEach(photo => {
            const fileId = decodeURIComponent(photo.dataset.fileId);
            const toggle = () => {
                if (state.selectedViewerFiles.has(fileId)) state.selectedViewerFiles.delete(fileId);
                else state.selectedViewerFiles.add(fileId);
                renderViewerPhotos();
                saveViewerSelections();
            };
            photo.querySelector('img').addEventListener('click', event => {
                event.stopPropagation();
                openViewerLightbox(state.viewerFiles.find(file => String(file.id) === fileId));
            });
            photo.addEventListener('click', toggle);
            photo.querySelector('.viewer-photo-heart').addEventListener('click', event => {
                event.stopPropagation();
                toggle();
            });
        });
    }

    async function openAlbumInline(album) {
        if (!album?.folder_id) return;
        const albumsGrid = document.getElementById('albumsGrid');
        const albumViewer = document.getElementById('albumViewer');
        const albumViewerTitle = document.getElementById('albumViewerTitle');
        const albumViewerStatus = document.getElementById('albumViewerStatus');
        const albumViewerGrid = document.getElementById('albumViewerGrid');

        state.selectedAlbumId = String(album.folder_id);
        albumsGrid.querySelectorAll('.album-card').forEach(card => {
            card.classList.toggle('is-selected', Number(card.dataset.albumIndex) === state.currentAlbums.indexOf(album));
        });

        albumViewer.classList.add('is-visible');
        albumViewerTitle.textContent = album.album_name || 'Album ảnh';
        albumViewerStatus.textContent = 'Đang tải ảnh...';
        state.viewerFiles = [];
        state.viewerAlbumComments = [];
        state.selectedViewerFiles.clear();
        state.viewerCategory = 'all';
        state.viewerSort = 'default';

        document.getElementById('viewerCategory').innerHTML = '<option value="all">Tất cả nhóm</option>';
        document.getElementById('viewerSort').value = 'default';
        await loadViewerSelections(state.selectedAlbumId);
        document.getElementById('viewerToolbar').classList.add('is-visible');
        document.getElementById('viewerSearch').value = '';
        albumViewerGrid.innerHTML = '<div class="viewer-empty">Đang tải ảnh từ Google Drive...</div>';
        albumViewer.scrollIntoView({ behavior: 'smooth', block: 'start' });

        try {
            const files = await loadAlbumImages(album.folder_id);
            state.viewerFiles = files;
            await loadViewerAlbumComments();
            const categories = [...new Set(files.map(file => file.category).filter(Boolean))];
            document.getElementById('viewerCategory').innerHTML = '<option value="all">Tất cả nhóm</option>' +
                categories.map(category => `<option value="${category.replace(/"/g, '&quot;')}">${category}</option>`).join('');

            const availableFileIds = new Set(files.map(file => String(file.id)));
            [...state.selectedViewerFiles].forEach(fileId => {
                if (!availableFileIds.has(fileId)) state.selectedViewerFiles.delete(fileId);
            });

            if (!files.length) {
                albumViewerGrid.innerHTML = '<div class="viewer-empty">Album chưa có ảnh để hiển thị.</div>';
                albumViewerStatus.textContent = 'Không có ảnh';
                return;
            }
            albumViewerStatus.textContent = `${files.length} ảnh · ❤️ ${state.selectedViewerFiles.size} ảnh khách đã chọn`;
            renderGuestSelectionsPanel(state.viewerSelectionRecords || [], state.viewerSelectionSummary || {});
            renderViewerPhotos();
        } catch (error) {
            albumViewerStatus.textContent = 'Không thể tải ảnh';
            albumViewerGrid.innerHTML = `<div class="viewer-empty">${error.message || 'Không thể tải ảnh album.'}</div>`;
        }
    }

    function syncViewerLightboxHeart() {
        const button = document.getElementById('viewerLightboxHeart');
        if (!button || !state.viewerLightboxFile) return;
        const isSelected = state.selectedViewerFiles.has(String(state.viewerLightboxFile.id));
        button.classList.toggle('is-active', isSelected);
        button.textContent = isSelected ? '❤️' : '🤍';
        button.setAttribute('aria-label', isSelected ? 'Bỏ thả tim ảnh' : 'Thả tim ảnh');
    }

    function preloadViewerLightboxNeighbors() {
        [-2, -1, 1, 2].forEach(offset => {
            const file = state.viewerFiles[state.viewerLightboxIndex + offset];
            if (!file || file.preloaded) return;
            const image = new Image();
            image.decoding = 'async';
            image.src = getPhotoFullUrl(file);
            file.preloaded = true;
        });
    }

    function updateViewerLightboxNavigation() {
        document.getElementById('viewerLightboxPrev').disabled = state.viewerLightboxIndex <= 0;
        document.getElementById('viewerLightboxNext').disabled =
            state.viewerLightboxIndex < 0 || state.viewerLightboxIndex >= state.viewerFiles.length - 1;
    }

    async function loadViewerComments(fileId) {
        const comments = document.getElementById('viewerComments');
        comments.textContent = 'Đang tải bình luận...';
        try {
            const { ok, result } = await API.callJson({ action: 'load_comments', photo_id: fileId });
            if (!ok || !result.success) throw new Error(result.message || 'Không thể tải bình luận.');
            const items = Array.isArray(result.data) ? result.data : [];
            comments.replaceChildren();
            if (!items.length) {
                comments.textContent = 'Chưa có bình luận nào.';
                return;
            }
            items.forEach(comment => {
                const item = document.createElement('article');
                item.className = 'viewer-comment';
                const author = document.createElement('strong');
                author.textContent = comment.author || (comment.user_id ? 'Người dùng' : 'Khách');
                const text = document.createElement('span');
                text.textContent = String(comment.comment_text || '');
                item.append(author, text);
                if (comment.created_at) {
                    const date = document.createElement('small');
                    date.textContent = formatDate(comment.created_at);
                    item.appendChild(date);
                }
                comments.appendChild(item);
            });
        } catch (error) {
            comments.textContent = error.message || 'Không thể tải bình luận.';
        }
    }

    function openViewerLightbox(file, transitionDirection = 0) {
        if (!file) return;
        state.viewerLightboxFile = file;
        state.viewerLightboxIndex = state.viewerFiles.findIndex(item => String(item.id) === String(file.id));
        const image = document.getElementById('viewerLightboxImage');
        image.classList.remove('is-switching-next', 'is-switching-prev');
        if (transitionDirection !== 0) {
            void image.offsetWidth;
            image.classList.add(transitionDirection > 0 ? 'is-switching-next' : 'is-switching-prev');
        }
        image.src = getPhotoFullUrl(file);
        image.alt = file.name || 'Ảnh album';
        document.getElementById('viewerLightboxNumber').textContent = `#${state.viewerLightboxIndex + 1}`;
        document.getElementById('viewerLightboxTitle').textContent = file.name || 'Ảnh album';
        document.getElementById('viewerLightbox').classList.add('is-open');
        syncViewerLightboxHeart();
        updateViewerLightboxNavigation();
        preloadViewerLightboxNeighbors();
        loadViewerComments(file.id);
    }

    function changeViewerLightboxPhoto(direction) {
        const nextIndex = state.viewerLightboxIndex + direction;
        const nextFile = state.viewerFiles[nextIndex];
        if (!nextFile) return;
        openViewerLightbox(nextFile, direction);
    }

    async function submitViewerComment(event) {
        event.preventDefault();
        if (!state.viewerLightboxFile) return;
        const input = document.getElementById('viewerCommentInput');
        const text = input.value.trim();
        if (!text) return;
        try {
            const { ok, result } = await API.callJson({
                action: 'save_comment',
                photo_id: state.viewerLightboxFile.id,
                comment_text: text
            });
            if (!ok || !result.success) throw new Error(result.message || 'Không thể gửi bình luận.');
            input.value = '';
            await loadViewerComments(state.viewerLightboxFile.id);
            await loadViewerAlbumComments();
        } catch (error) {
            document.getElementById('viewerComments').textContent = error.message || 'Không thể gửi bình luận.';
        }
    }

    global.PhotoSelectViewer = {
        openAlbumInline,
        renderViewerPhotos,
        saveViewerSelections,
        refreshViewerSelections,
        openViewerLightbox,
        syncViewerLightboxHeart,
        changeViewerLightboxPhoto,
        submitViewerComment
    };
})(window);
