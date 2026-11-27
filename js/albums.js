/**
 * Quản lý danh sách album, thêm album từ Google Drive, phân quyền tải và chia sẻ link.
 */
(function initAlbumsModule(global) {
    const { state, formatDate, showMessage } = global.PhotoSelectApp;
    const API = global.PhotoSelectAPI;

    function extractDriveFolderId(value) {
        const input = String(value || '').trim();
        const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/) || input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        return match ? match[1] : (/^[a-zA-Z0-9_-]+$/.test(input) ? input : '');
    }

    function renderAlbums(albums) {
        const albumsGrid = document.getElementById('albumsGrid');
        const addAlbumCard = `<article class="album-card add-album-card">
            <div>
                <div class="album-icon" aria-hidden="true">＋</div>
                <h2 class="album-name">Thêm album mới</h2>
                <span class="album-date">Dán link thư mục Google Drive để bắt đầu.</span>
                <form class="add-album-form" id="addAlbumForm">
                    <input class="add-album-input" id="addAlbumInput" type="url" placeholder="https://drive.google.com/drive/folders/..." autocomplete="off" required>
                    <p class="add-album-message" id="addAlbumMessage" role="status"></p>
                    <button class="button button-primary add-album-submit" type="submit">Tải album</button>
                </form>
            </div>
        </article>`;

        const albumCards = albums.map((album, index) => {
            const isAllowed = Number(album.allow_save) === 1;
            const permission = isAllowed ? 'Khách được lưu ảnh' : 'Khách không được lưu';
            const selectedCount = Number(album.selected_count || 0);
            const guests = Array.isArray(album.selected_guests) ? album.selected_guests.filter(Boolean) : [];
            const selectionMeta = selectedCount > 0
                ? `${guests.length ? `${guests.join(', ')} · ` : ''}${album.last_selected_at ? formatDate(album.last_selected_at) : 'Đã lưu trong DB'}`
                : 'Chưa có ảnh khách chọn';
            return `<article class="album-card" data-album-index="${index}">
                <div class="album-settings">
                    <button class="button album-settings-button" type="button" aria-label="Cài đặt album" aria-expanded="false">⚙</button>
                    <div class="album-settings-menu" role="menu">
                        <button class="button album-action share-album-button" type="button" data-album-index="${index}" role="menuitem">🔗 Chia sẻ</button>
                        <button class="button album-action permission-toggle ${isAllowed ? 'is-allowed' : ''}" type="button" data-album-index="${index}" aria-pressed="${isAllowed}" role="menuitem">${isAllowed ? '✅ Cho khách tải' : '🔒 Không cho tải'}</button>
                    </div>
                </div>
                <div>
                    <div class="album-icon" aria-hidden="true">📁</div>
                    <h2 class="album-name"></h2>
                    <span class="album-date">Lưu lúc ${formatDate(album.created_at)}</span>
                    <span class="album-selection-meta">${selectionMeta}</span>
                </div>
                <div>
                    <div class="album-footer">
                        <span class="permission">${permission}</span>
                        <span class="album-selection-badge ${selectedCount > 0 ? 'has-items' : ''}">❤️ ${selectedCount} ảnh đã chọn</span>
                    </div>
                </div>
            </article>`;
        }).join('');

        albumsGrid.innerHTML = addAlbumCard + (albumCards || '<div class="empty">Chưa có album nào được lưu gần đây.</div>');
        document.getElementById('addAlbumForm').addEventListener('submit', addAlbumFromLink);

        albums.forEach((album, index) => {
            const title = albumsGrid.querySelector(`.album-card[data-album-index="${index}"] .album-name`);
            if (title) title.textContent = album.album_name || 'Album ảnh';
        });

        albumsGrid.querySelectorAll('.album-card[data-album-index]').forEach(card => {
            const album = albums[Number(card.dataset.albumIndex)];
            card.classList.toggle('is-selected', String(album?.folder_id || '') === state.selectedAlbumId);
            card.addEventListener('click', () => global.PhotoSelectViewer.openAlbumInline(state.currentAlbums[Number(card.dataset.albumIndex)]));
        });

        albumsGrid.querySelectorAll('.share-album-button').forEach(button => {
            button.addEventListener('click', () => shareAlbum(state.currentAlbums[Number(button.dataset.albumIndex)]));
        });

        albumsGrid.querySelectorAll('.permission-toggle').forEach(button => {
            button.addEventListener('click', () => toggleAlbumPermission(button));
        });

        albumsGrid.querySelectorAll('.album-settings-button').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const settings = button.closest('.album-settings');
                const isOpen = settings.classList.toggle('is-open');
                button.setAttribute('aria-expanded', String(isOpen));
                albumsGrid.querySelectorAll('.album-settings.is-open').forEach(other => {
                    if (other !== settings) {
                        other.classList.remove('is-open');
                        other.querySelector('.album-settings-button')?.setAttribute('aria-expanded', 'false');
                    }
                });
            });
        });

        albumsGrid.querySelectorAll('.album-settings, .share-album-button, .permission-toggle').forEach(element => {
            element.addEventListener('click', event => event.stopPropagation());
        });
    }

    async function addAlbumFromLink(event) {
        event.preventDefault();
        const input = document.getElementById('addAlbumInput');
        const message = document.getElementById('addAlbumMessage');
        const button = event.currentTarget.querySelector('button[type="submit"]');
        const folderId = extractDriveFolderId(input.value);
        message.className = 'add-album-message';

        if (!folderId) {
            message.classList.add('error');
            message.textContent = 'Link Google Drive không đúng định dạng.';
            return;
        }

        if (state.currentAlbums.some(album => String(album.folder_id || '') === folderId)) {
            message.classList.add('error');
            message.textContent = 'Album này đã có trong danh sách, không ghi đè album hiện tại.';
            return;
        }

        button.disabled = true;
        message.textContent = 'Đang kiểm tra và lưu album...';
        try {
            const { ok: metaOk, result: metaResult } = await API.driveMeta(folderId);
            if (!metaOk || !metaResult.name) {
                throw new Error('Không thể truy cập thư mục Google Drive. Hãy kiểm tra quyền chia sẻ.');
            }

            const { ok: saveOk, result: saveResult } = await API.callJson({
                action: 'save_album',
                album_name: metaResult.name,
                folder_id: folderId,
                allow_save: false
            });
            if (!saveOk || !saveResult.success) {
                throw new Error(saveResult.message || 'Không thể lưu album.');
            }

            input.value = '';
            message.textContent = 'Đã thêm album. Đang cập nhật danh sách...';
            await loadAlbums();
        } catch (error) {
            message.className = 'add-album-message error';
            message.textContent = error.message || 'Không thể thêm album.';
        } finally {
            button.disabled = false;
        }
    }

    function shareAlbum(album) {
        if (!album?.folder_id) return;
        state.currentShareAlbum = album;
        document.getElementById('shareCodeForm').classList.remove('is-visible');
        document.getElementById('shareResult').classList.remove('is-visible');
        document.getElementById('shareAccessCode').value = '';
        document.getElementById('shareMessage').textContent = '';
        document.getElementById('shareModal').classList.add('is-open');
        document.getElementById('shareWithoutCodeBtn').focus();
    }

    async function createShareLink(accessCode = '') {
        if (!state.currentShareAlbum?.folder_id) return;
        const message = document.getElementById('shareMessage');
        const buttons = document.querySelectorAll('#shareWithoutCodeBtn, #shareWithCodeBtn, #createProtectedShareBtn');
        if (accessCode !== '' && (accessCode.length < 4 || accessCode.length > 64)) {
            message.textContent = 'Mã bảo mật phải dài từ 4 đến 64 ký tự.';
            return;
        }
        buttons.forEach(button => button.disabled = true);
        message.textContent = 'Đang tạo link...';
        try {
            const { ok, result } = await API.callJson({
                action: 'create_share_link',
                folder_id: state.currentShareAlbum.folder_id,
                access_code: accessCode
            });
            if (!ok || !result.success) throw new Error(result.message || 'Không thể tạo link chia sẻ.');
            const shareUrl = API.isMockMode()
                ? result.url
                : new URL(result.url, global.location.origin).toString();
            document.getElementById('shareUrlInput').value = shareUrl;
            document.getElementById('shareResult').classList.add('is-visible');
            message.textContent = result.requires_code ? 'Link đã được bảo vệ bằng mã.' : 'Link không yêu cầu mã bảo mật.';
        } catch (error) {
            message.textContent = error.message || 'Không thể tạo link chia sẻ.';
        } finally {
            buttons.forEach(button => button.disabled = false);
        }
    }

    async function copyShareUrl() {
        const input = document.getElementById('shareUrlInput');
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(input.value);
            } else {
                input.select();
                document.execCommand('copy');
            }
            document.getElementById('shareMessage').textContent = 'Đã sao chép link chia sẻ album.';
        } catch {
            document.getElementById('shareMessage').textContent = 'Không thể copy link. Hãy copy trực tiếp trong ô link.';
        }
    }

    async function toggleAlbumPermission(button) {
        const album = state.currentAlbums[Number(button.dataset.albumIndex)];
        if (!album?.id) return;
        const previousState = Number(album.allow_save) === 1;
        const nextState = !previousState;
        button.disabled = true;
        button.textContent = 'Đang cập nhật...';
        try {
            const { ok, result } = await API.callJson({
                action: 'update_album_permission',
                album_id: album.id,
                allow_save: nextState
            });
            if (!ok || !result.success) throw new Error(result.message || 'Không thể cập nhật quyền album.');
            album.allow_save = result.allow_save ? 1 : 0;
            renderAlbums(state.currentAlbums);
            document.getElementById('allowedAlbums').textContent = String(state.currentAlbums.filter(item => Number(item.allow_save) === 1).length);
            showMessage(album.allow_save ? 'Đã cho phép khách tải ảnh.' : 'Đã khóa quyền tải ảnh của khách.');
        } catch (error) {
            button.disabled = false;
            button.classList.toggle('is-allowed', previousState);
            button.setAttribute('aria-pressed', String(previousState));
            button.textContent = previousState ? '✅ Cho khách tải' : '🔒 Không cho tải';
            showMessage(error.message || 'Không thể cập nhật quyền album.', true);
        }
    }

    async function loadAlbums() {
        const albumsGrid = document.getElementById('albumsGrid');
        albumsGrid.replaceChildren();
        showMessage('Đang tải danh sách album...');
        try {
            const { result: session } = await API.callJson({ action: 'session_state' });
            if (!session.user) {
                document.getElementById('accountStatus').textContent = 'Chưa đăng nhập';
                document.getElementById('totalAlbums').textContent = '0';
                document.getElementById('allowedAlbums').textContent = '0';
                showMessage('Vui lòng đăng nhập để xem danh sách album và ảnh khách đã chọn.', true);
                albumsGrid.innerHTML = `<section class="inline-login-card">
                    <h3>Đăng nhập tài khoản Studio</h3>
                    <p>Đăng nhập để mở thư mục album và xem lại toàn bộ ảnh khách hàng đã thả tim trong database. (Mẫu: <strong>studio@gmail.com</strong> / <strong>123456</strong>)</p>
                    <form class="inline-login-form" id="inlineLoginForm">
                        <input name="login_id" type="text" required placeholder="Email hoặc ID (studio@gmail.com)" autocomplete="username">
                        <input name="password" type="password" required placeholder="Mật khẩu" autocomplete="current-password">
                        <p class="add-album-message" id="inlineLoginStatus" role="status"></p>
                        <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                            <button class="button button-primary" type="submit" style="flex:1;">Đăng nhập</button>
                            <a class="button" href="login.html?redirect=albums.html">Đăng ký / Mở trang Login</a>
                        </div>
                        <a class="button" href="photowedding/app.php?google=login">Đăng nhập nhanh bằng Google</a>
                    </form>
                </section>`;
                document.getElementById('inlineLoginForm').addEventListener('submit', async event => {
                    event.preventDefault();
                    const statusEl = document.getElementById('inlineLoginStatus');
                    const payload = Object.fromEntries(new FormData(event.currentTarget));
                    payload.action = 'login';
                    payload.remember_me = '1';
                    statusEl.className = 'add-album-message';
                    statusEl.textContent = 'Đang đăng nhập...';
                    try {
                        const { ok, result } = await API.callJson(payload);
                        if (!ok || !result.success) throw new Error(result.message || 'Đăng nhập thất bại.');
                        await loadAlbums();
                    } catch (err) {
                        statusEl.classList.add('error');
                        statusEl.textContent = err.message || 'Không thể đăng nhập.';
                    }
                });
                return;
            }
            state.dashboardUser = session.user;
            global.PhotoSelectDialog.updateDashboardUser(session.user);
            await global.PhotoSelectNotifications.loadDashboardNotifications();

            const { ok, result } = await API.callJson({ action: 'load_albums' });
            if (!ok || !result.success) throw new Error(result.message || 'Không thể tải album.');
            const albums = result.data || [];
            state.currentAlbums = albums;
            renderAlbums(albums);
            document.getElementById('totalAlbums').textContent = String(albums.length);
            document.getElementById('allowedAlbums').textContent = String(albums.filter(album => Number(album.allow_save) === 1).length);
            const cloudActive = Boolean(API.getActiveCloudUrl && API.getActiveCloudUrl());
            document.getElementById('accountStatus').textContent = API.isMockMode()
                ? (cloudActive ? 'Cloud Firebase' : 'Demo cục bộ')
                : 'Đang hoạt động';

            const loginSucceeded = new URLSearchParams(global.location.search).get('login') === 'success';
            const modeSuffix = API.isMockMode()
                ? (cloudActive ? ' (Đã bật đồng bộ Cloud & Drive API)' : ' (Chế độ Demo VS Code)')
                : '';
            showMessage(loginSucceeded
                ? `✅ Đăng nhập thành công · ${albums.length} album gần đây${modeSuffix}`
                : `${albums.length} album gần đây${modeSuffix}`);
            if (loginSucceeded) global.history.replaceState({}, document.title, global.location.pathname);
        } catch (error) {
            showMessage(error.message || 'Không thể kết nối máy chủ.', true);
            albumsGrid.innerHTML = '<div class="empty">Không thể tải danh sách album. Vui lòng thử lại.</div>';
        }
    }

    global.PhotoSelectAlbums = {
        renderAlbums,
        loadAlbums,
        shareAlbum,
        createShareLink,
        copyShareUrl
    };
})(window);
