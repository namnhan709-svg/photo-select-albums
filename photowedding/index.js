
        // CONFIG & STATE
        const ALBUM_NAMES_KEY = 'albumNames';
        const THEME_STORAGE_KEY = 'photoSelectTheme';
        const SETTINGS_STORAGE_KEY = 'photoSelectInterfaceSettings';
        const PHOTO_CACHE_PREFIX = 'photoList:v14:';
        const PHOTO_CACHE_TTL = 30 * 60 * 1000;
        const DRIVE_COVER_CACHE_PREFIX = 'driveCover:v2:';
        const DRIVE_COVER_CACHE_TTL = 24 * 60 * 60 * 1000;
        const ALBUM_META_BATCH_SIZE = 1;
        const ALBUM_META_YIELD_MS = 0;
        const DELETED_ALBUM_TTL = 7 * 24 * 60 * 60 * 1000;
        const CONFIG = {
            COPY_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzCFPLM9KB95wXEnGlSoCtHv3JVHnBdUciKD7-kx6fmRkxPfG8S7WiJL4AptLUkwSl0/exec',
            DRIVE_FOLDER_ID: window.__SHARED_FOLDER_ID__ || '',
            ALBUM_NAME: 'Album Wedding 2026',
            CURRENT_USER_ID: '',
            IS_SHARED_ALBUM: Boolean(window.__SHARED_FOLDER_ID__),
            SHARED_OWNER_USER_ID: Number(window.__SHARED_OWNER_USER_ID__ || 0),
            SHARED_ALBUM_ALLOW_SAVE: typeof window.__SHARED_ALBUM_ALLOW_SAVE__ === 'boolean' ? window.__SHARED_ALBUM_ALLOW_SAVE__ : true
        };

        function showDriveConfigError(message, error) {
            console.error('[Google Drive]', error || message);
            showToast(`❌ ${message}`);
        }

        const state = {
            photos: [],
            displayPhotos: [],
            selectedPhotos: new Set(),
            currentFilter: 'all',
            currentCategory: 'all',
            currentSort: 'default',
            searchQuery: '',
            currentLightboxIndex: 0,
            savedAlbums: [],
            deletedAlbums: [],
            savedAlbumPage: 1,
            savedAlbumPageSize: 6,
            commentCounts: {}
        };
        let albumMetadataRefreshToken = 0;
        let albumMetadataRefreshInFlight = false;
        let albumMetadataRefreshQueued = false;
        let albumCoverObserver = null;
        let albumCoverHydrating = new Set();
        let lightboxTouchStartX = 0;
        let lightboxTouchStartDistance = 0;
        let lightboxScale = 1;
        let lightboxTranslateX = 0;
        let lightboxTranslateY = 0;
        let lightboxPanStartX = 0;
        let lightboxPanStartY = 0;
        let lightboxMousePanning = false;
        let photoRenderVersion = 0;
        let quickFilterSourceHandle = null;
        let quickFilterDestinationHandle = null;
        let quickFilterRunId = 0;
        let sharedSelectionsReady = Promise.resolve();
        let adminChatConversationId = localStorage.getItem('photoSelectChatId') || '';
        let adminChatPollTimer = null;
        let lastAdminChatMessageId = 0;
        let hasLoadedAdminChat = false;
        let adminChatTypingTimer = null;
        let allPhotoComments = null;
        let albumLoadVersion = 0;
        let sharedPermissionPollTimer = null;

        document.addEventListener('DOMContentLoaded', init);

        async function resolveStaticShareToken() {
            const shareParam = new URLSearchParams(window.location.search).get('share') || '';
            if (CONFIG.DRIVE_FOLDER_ID || !shareParam.startsWith('v1.') || !window.PhotoSelectAPI) return;
            const payload = window.PhotoSelectAPI.decodeBase64Url(shareParam);
            if (!payload || !payload.f) return;

            if (payload.ch) {
                const unlockKey = `photoSelectShareUnlocked:${shareParam.slice(0, 32)}`;
                if (sessionStorage.getItem(unlockKey) !== payload.ch) {
                    const gate = document.createElement('div');
                    gate.style.cssText = 'position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:1rem;background:rgba(15,15,15,.94);backdrop-filter:blur(8px);';
                    gate.innerHTML = `<form style="width:min(100%,390px);padding:1.6rem;border-radius:18px;background:#1e1b17;border:1px solid rgba(212,175,55,.35);color:#f7f3ea;box-shadow:0 24px 48px rgba(0,0,0,.45);">
                        <h2 style="margin:0 0 .45rem;font-size:1.25rem;">Album được bảo vệ</h2>
                        <p style="margin:0 0 1rem;color:#c8c1b4;font-size:.84rem;line-height:1.5;">Vui lòng nhập mã bảo mật để xem album <strong>${String(payload.n || '').replace(/</g, '&lt;')}</strong>.</p>
                        <input id="staticShareCodeInput" type="password" placeholder="Nhập mã bảo mật..." required autofocus style="width:100%;box-sizing:border-box;padding:.75rem;border-radius:10px;border:1px solid rgba(212,175,55,.35);background:#12110f;color:#fff;font:inherit;margin-bottom:.75rem;">
                        <button type="submit" style="width:100%;padding:.8rem;border:0;border-radius:10px;background:linear-gradient(135deg,#d4af37,#f0cb5f);color:#171510;font:inherit;font-weight:800;cursor:pointer;">Mở album</button>
                        <p id="staticShareGateErr" style="min-height:1.1rem;margin:.6rem 0 0;color:#ff8f86;font-size:.82rem;"></p>
                    </form>`;
                    document.body.appendChild(gate);
                    await new Promise(resolve => {
                        gate.querySelector('form').addEventListener('submit', async event => {
                            event.preventDefault();
                            const input = gate.querySelector('#staticShareCodeInput').value.trim();
                            const hash = await window.PhotoSelectAPI.sha256Hex(input);
                            if (hash === payload.ch) {
                                sessionStorage.setItem(unlockKey, payload.ch);
                                gate.remove();
                                resolve();
                            } else {
                                gate.querySelector('#staticShareGateErr').textContent = 'Mã bảo mật không chính xác.';
                            }
                        });
                    });
                }
            }

            CONFIG.DRIVE_FOLDER_ID = String(payload.f);
            CONFIG.ALBUM_NAME = String(payload.n || 'Album ảnh');
            CONFIG.IS_SHARED_ALBUM = true;
            CONFIG.SHARED_OWNER_USER_ID = 1;
            CONFIG.SHARED_ALBUM_ALLOW_SAVE = Boolean(payload.a);
            window.__SHARED_FOLDER_ID__ = CONFIG.DRIVE_FOLDER_ID;
            window.__SHARED_OWNER_USER_ID__ = 1;
            window.__SHARED_ALBUM_ALLOW_SAVE__ = CONFIG.SHARED_ALBUM_ALLOW_SAVE;
            setActiveAlbumName(CONFIG.ALBUM_NAME);
        }

        async function init() {
    await resolveStaticShareToken();
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const settings = getInterfaceSettings();
    const initialTheme = settings.theme || (storedTheme === 'dark' ? 'dark' : 'sage');
    applyTheme(initialTheme === 'dark' ? 'dark' : 'sage');
    applyInterfaceSettings();

    document.body.classList.toggle(
        'customer-view',
        CONFIG.IS_SHARED_ALBUM
    );

    setupAuthEventListeners();
    setupEventListeners();

    await restoreUserSession();

    const isExplicitHomeRequest = new URLSearchParams(window.location.search).get('home') === '1';
    if (!CONFIG.IS_SHARED_ALBUM && !isExplicitHomeRequest && (window.__APP_USER__ || {}).id) {
        window.location.replace('albums.html');
        return;
    }

    document.body.classList.toggle(
        'guest-shared-view',
        isGuestSharedView()
    );

    updateGuestPermissionStatus();
    const guestIdentityBar = document.getElementById('guestSelectionIdentityBar');
    const guestNameInput = document.getElementById('guestNameInput');
    if (guestIdentityBar && guestNameInput && CONFIG.IS_SHARED_ALBUM) {
        guestIdentityBar.style.display = 'flex';
        guestNameInput.value = localStorage.getItem('photoSelectGuestName') || '';
        guestNameInput.addEventListener('input', () => {
            localStorage.setItem('photoSelectGuestName', guestNameInput.value.trim());
        });
    }

    setScreenshotProtection(
        !getCurrentAlbumPermission()
    );
    updateLightboxDownloadAvailability();

    startSharedPermissionPolling();

    // =====================================================
    // KIỂM TRA LẠI QUYỀN KHI TRANG ĐƯỢC MỞ LẠI / BACK / FORWARD
    // =====================================================
    window.addEventListener('pageshow', function(event) {
        if (event.persisted) {
            refreshSharedPermission();
        }
    });

    // =====================================================
    // KIỂM TRA LẠI QUYỀN KHI QUAY LẠI TAB
    // =====================================================
    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
            refreshSharedPermission();
        }
    });

    initializeUserProfile();
    window.setInterval(loadUserNotifications, 30000);

    updateAlbumVisibility();

    renderSavedAlbums();

    const requestedFolderId = new URLSearchParams(window.location.search).get('folder') || '';
    if (requestedFolderId && (window.__APP_USER__ || {}).id && /^[a-zA-Z0-9_-]+$/.test(requestedFolderId)) {
        CONFIG.DRIVE_FOLDER_ID = requestedFolderId;
        document.getElementById('folderId').value = requestedFolderId;
        loadPhotos();
    }

    if ((window.__APP_USER__ || {}).id) {
        loadUserAlbums();
    }

    const googleLoginParams = new URLSearchParams(window.location.search);
    if (googleLoginParams.get('google_login') === 'success') {
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (googleLoginParams.get('google_login') === 'error') {
        showToast(`❌ ${googleLoginParams.get('message') || 'Đăng nhập Google không thành công.'}`);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (
        CONFIG.IS_SHARED_ALBUM &&
        CONFIG.DRIVE_FOLDER_ID
    ) {
        document.getElementById('folderId').value =
            CONFIG.DRIVE_FOLDER_ID;

        loadPhotos();
    }
}

        async function restoreUserSession() {
            if ((window.__APP_USER__ || {}).id) return;
            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'session_state' })
                });
                const result = await response.json();
                if (result.success && result.user) {
                    window.__APP_USER__ = result.user;
                    updateUserProfile(result.user);
                }
            } catch (error) {
                console.warn('Không thể khôi phục phiên đăng nhập.', error);
            }
        }

        function setupAuthEventListeners() {
            document.getElementById('loginBtnHeader').addEventListener('click', () => {
                openAuthModal('login');
            });
            document.getElementById('authClose').addEventListener('click', closeAuthModal);
            document.getElementById('authModal').addEventListener('click', (event) => {
                if (event.target.id === 'authModal') closeAuthModal();
            });
            document.querySelectorAll('[data-auth-tab]').forEach(tab => tab.addEventListener('click', () => switchAuthTab(tab.dataset.authTab)));
            document.querySelectorAll('[data-auth-form]').forEach(form => form.addEventListener('submit', submitAuthForm));
            document.getElementById('authModal').addEventListener('keydown', (event) => {
                handleModalTabNavigation(event, document.getElementById('authModal'));
            });
        }

        function setupEventListeners() {
            window.addEventListener('storage', (event) => {
                if (event.key !== SETTINGS_STORAGE_KEY) return;
                const settings = getInterfaceSettings();
                applyTheme(settings.theme === 'dark' ? 'dark' : 'sage');
                const status = document.getElementById('settingsThemeStatus');
                if (status && document.getElementById('settingsModal').classList.contains('active')) {
                    status.textContent = `Đã đồng bộ giao diện ${settings.theme === 'dark' ? 'tối' : 'sáng'}.`;
                }
            });
            document.getElementById('userPanel').addEventListener('click', toggleAccountMenu);
            document.getElementById('profileInfoBtn').addEventListener('click', (event) => {
                event.stopPropagation();
                if (!(window.__APP_USER__ || {}).id) {
                    openAuthModal('login');
                    return;
                }
                openProfileModal();
            });
            document.getElementById('changePasswordBtn').addEventListener('click', openPasswordModal);
            document.getElementById('settingsBtn').addEventListener('click', (event) => {
                event.stopPropagation();
                openSettingsModal();
            });
            document.getElementById('securityBtn').addEventListener('click', (event) => {
                event.stopPropagation();
                document.getElementById('userPanel').classList.remove('open');
            });
            document.getElementById('activityHistoryBtn').addEventListener('click', (event) => {
                event.stopPropagation();
                document.getElementById('userPanel').classList.remove('open');
            });
            document.getElementById('logoutBtn').addEventListener('click', logoutUser);
            document.getElementById('profileClose').addEventListener('click', closeProfileModal);
            document.getElementById('profileCancelBtn').addEventListener('click', closeProfileModal);
            document.getElementById('profileSaveBtn').addEventListener('click', saveProfilePhone);
            document.getElementById('notificationBtn').addEventListener('click', openNotificationModal);
            document.getElementById('notificationClose').addEventListener('click', closeNotificationModal);
            document.getElementById('passwordClose').addEventListener('click', closePasswordModal);
            document.getElementById('passwordForm').addEventListener('submit', submitPasswordForm);
            document.getElementById('settingsClose').addEventListener('click', closeSettingsModal);
            document.getElementById('settingsModal').addEventListener('click', (event) => {
                const themeButton = event.target.closest('[data-settings-theme]');
                if (themeButton) selectInterfaceTheme(themeButton.dataset.settingsTheme);
            });
            document.getElementById('settingsModal').addEventListener('click', (event) => {
                if (event.target.id === 'settingsModal') closeSettingsModal();
            });
            document.getElementById('passwordModal').addEventListener('keydown', (event) => {
                handleModalTabNavigation(event, document.getElementById('passwordModal'));
            });
            document.getElementById('shareLinkBtn').addEventListener('click', shareAlbum);
            document.getElementById('shareClose').addEventListener('click', closeShareModal);
            document.getElementById('copyShareUrlBtn').addEventListener('click', copyShareUrl);
            document.getElementById('shareWithoutCodeBtn').addEventListener('click', () => createShareLink(''));
            document.getElementById('shareWithCodeBtn').addEventListener('click', showProtectedShareForm);
            document.getElementById('createProtectedShareBtn').addEventListener('click', () => {
                createShareLink(document.getElementById('shareAccessCode').value.trim());
            });
            document.addEventListener('keydown', (event) => {
                const isGuestBlocked = isGuestSharedView() && !getCurrentAlbumPermission();
                const isScreenshotShortcut = event.key === 'PrintScreen'
                    || event.code === 'PrintScreen'
                    || (event.ctrlKey && event.key.toLowerCase() === 'p')
                    || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's')
                    || (event.metaKey && event.shiftKey && ['3', '4', '5'].includes(event.key));
                if (isGuestBlocked && isScreenshotShortcut) {
                    event.preventDefault();
                    event.stopPropagation();
                    setScreenshotProtection(true);
                    showToast('⚠️ Chủ album đang tắt quyền lưu ảnh và chụp màn hình.');
                }
            });
            window.addEventListener('blur', () => {
                if (isGuestSharedView() && !getCurrentAlbumPermission()) setScreenshotProtection(true);
            });
            window.addEventListener('focus', () => {
                if (getCurrentAlbumPermission()) setScreenshotProtection(false);
            });
            document.addEventListener('visibilitychange', () => {
                if (document.hidden && isGuestSharedView() && !getCurrentAlbumPermission()) {
                    setScreenshotProtection(true);
                } else if (!document.hidden && getCurrentAlbumPermission()) {
                    setScreenshotProtection(false);
                }
            });
            document.addEventListener('contextmenu', (event) => {
                if (isGuestSharedView() && !getCurrentAlbumPermission() && event.target instanceof Element && event.target.closest('img')) {
                    event.preventDefault();
                }
            });
            document.addEventListener('dragstart', (event) => {
                if (isGuestSharedView() && !getCurrentAlbumPermission() && event.target instanceof Element && event.target.closest('img')) {
                    event.preventDefault();
                }
            });
            document.getElementById('searchInput').addEventListener('input', handleSearch);
            document.getElementById('confirmGuestSelectionBtn')?.addEventListener('click', confirmGuestSelectionSubmission);
            document.getElementById('categorySelect').addEventListener('change', event => {
                setCategoryFilter(event.target.value);
            });
            document.getElementById('sortSelect').addEventListener('change', handleSort);
            document.getElementById('toolbarExportBtn').addEventListener('click', () => {
                if (!ensureAlbumAllowsSave('xuất file')) return;
                document.getElementById('exportModal').classList.add('active');
                updateExportPreview();
            });
            document.getElementById('mobileDownloadNoticeClose').addEventListener('click', () => {
                document.getElementById('mobileDownloadNoticeModal').classList.remove('active');
            });
            document.getElementById('exportCancel').addEventListener('click', () => document.getElementById('exportModal').classList.remove('active'));
            document.getElementById('exportCopyBtn').addEventListener('click', copyExport);
            document.getElementById('exportDownloadBtn').addEventListener('click', downloadExport);
            document.getElementById('exportModal').addEventListener('input', updateExportPreview);
            document.getElementById('exportModal').addEventListener('change', event => {
                if (event.target.id === 'exportSeparator') {
                    const customSeparator = document.getElementById('exportCustomSeparator');
                    customSeparator.hidden = event.target.value !== 'custom';
                    if (!customSeparator.hidden) customSeparator.focus();
                }
                updateExportPreview();
            });
            document.getElementById('toolbarZipBtn').addEventListener('click', openZipSetup);
            document.getElementById('drivePermissionGuideBtn').addEventListener('click', () => document.getElementById('drivePermissionGuideModal').classList.add('active'));
            document.getElementById('drivePermissionGuideClose').addEventListener('click', closeDrivePermissionGuide);
            document.getElementById('drivePermissionGuideDone').addEventListener('click', closeDrivePermissionGuide);
            document.getElementById('toolbarCopyBtn').addEventListener('click', openQuickFilter);
            document.getElementById('quickFilterSourceBtn').addEventListener('click', chooseQuickFilterSource);
            document.getElementById('quickFilterDestinationBtn').addEventListener('click', chooseQuickFilterDestination);
            document.getElementById('quickFilterCancel').addEventListener('click', closeQuickFilter);
            document.getElementById('quickFilterStart').addEventListener('click', startQuickFilter);
            document.getElementById('zipSetupCancel').addEventListener('click', closeZipSetup);
            document.getElementById('zipSetupStart').addEventListener('click', startZipDownload);
            document.getElementById('albumFolderDownloadCancel').addEventListener('click', closeAlbumFolderDownloadChooser);
            document.getElementById('albumFolderDownloadStart').addEventListener('click', startAlbumFolderDownload);
            document.getElementById('albumFolderSelectAll').addEventListener('change', event => {
                document.querySelectorAll('#albumFolderList input[type="checkbox"]').forEach(input => {
                    input.checked = event.currentTarget.checked;
                });
                event.currentTarget.indeterminate = false;
            });
            document.getElementById('albumFolderList').addEventListener('change', syncAlbumFolderSelectAll);
            
            document.getElementById('pageTopBtn').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
            document.getElementById('pageMiddleBtn').addEventListener('click', () => window.scrollTo({ top: Math.max(0, (document.documentElement.scrollHeight - window.innerHeight) / 2), behavior: 'smooth' }));
            document.getElementById('pageBottomBtn').addEventListener('click', () => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' }));
            const commentStatBtn = document.getElementById('commentStatBtn');
            commentStatBtn.addEventListener('click', toggleCommentSummary);
            commentStatBtn.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleCommentSummary();
                }
            });
            document.getElementById('adminChatToggle').addEventListener('click', toggleAdminChat);
            document.getElementById('adminChatForm').addEventListener('submit', submitAdminFeedback);
            document.getElementById('adminChatReportToggle').addEventListener('click', toggleAdminChatReportMode);
            document.getElementById('adminChatInput').addEventListener('input', handleAdminChatTyping);
            document.getElementById('adminChatInput').addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form.requestSubmit();
                }
            });
            loadAdminChat();
            adminChatPollTimer = window.setInterval(loadAdminChat, 1000);

            document.querySelectorAll('.filter-btn, .stat-item').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    if (e.currentTarget.id === 'commentStatBtn') return;
                    const filter = e.currentTarget.dataset.filter;
                    state.currentFilter = filter;
                    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
                    document.querySelectorAll('.stat-item').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
                    applyFilters();
                });
            });

            document.getElementById('lightboxClose').addEventListener('click', () => document.getElementById('lightbox').classList.remove('active'));
            document.getElementById('lightboxPrev').addEventListener('click', () => changeLightboxPhoto(-1));
            document.getElementById('lightboxNext').addEventListener('click', () => changeLightboxPhoto(1));
            document.getElementById('lightboxDownloadToggle').addEventListener('click', event => {
                event.stopPropagation();
                if (!ensureAlbumAllowsSave('tải ảnh')) return;
                const isOpen = document.getElementById('lightboxDownloadMenu').classList.toggle('is-open');
                event.currentTarget.setAttribute('aria-expanded', String(isOpen));
            });
            document.getElementById('downloadCurrentLightboxPhoto').addEventListener('click', downloadCurrentLightboxPhoto);
            document.getElementById('downloadCurrentPhotoDirectDrive')?.addEventListener('click', downloadCurrentPhotoDirectDrive);
            document.getElementById('downloadSharedAlbum').addEventListener('click', downloadSharedAlbum);
            document.getElementById('guestDownloadSelectedBtn')?.addEventListener('click', downloadGuestSelectedPhotos);
            document.getElementById('guestDownloadAllBtn')?.addEventListener('click', downloadSharedAlbum);
            document.addEventListener('click', event => {
                const downloadWrap = document.getElementById('lightboxDownloadWrap');
                if (!downloadWrap.contains(event.target)) closeLightboxDownloadMenu();
            });
            document.addEventListener('keydown', (event) => {
                const lightbox = document.getElementById('lightbox');
                const target = event.target;
                const isTyping = target instanceof HTMLInputElement
                    || target instanceof HTMLTextAreaElement
                    || target instanceof HTMLSelectElement
                    || target.isContentEditable;
                if (!lightbox.classList.contains('active') || isTyping) return;
                if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    changeLightboxPhoto(-1);
                } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    changeLightboxPhoto(1);
                }
            });
            document.getElementById('lightboxCommentForm').addEventListener('submit', submitPhotoComment);
            document.getElementById('lightbox').addEventListener('touchstart', (event) => {
                lightboxTouchStartX = event.changedTouches[0].clientX;
            }, { passive: true });
            document.getElementById('lightbox').addEventListener('touchend', (event) => {
                if (lightboxScale > 1 || event.changedTouches.length > 1) return;
                const distance = event.changedTouches[0].clientX - lightboxTouchStartX;
                if (Math.abs(distance) < 55) return;
                changeLightboxPhoto(distance < 0 ? 1 : -1);
            }, { passive: true });
            const lightboxImage = document.getElementById('lightboxImage');
            lightboxImage.addEventListener('wheel', (event) => {
                event.preventDefault();
                zoomLightboxImage(event.deltaY < 0 ? 0.2 : -0.2);
            }, { passive: false });
            lightboxImage.addEventListener('dblclick', () => {
                lightboxScale = lightboxScale > 1 ? 1 : 2;
                if (lightboxScale === 1) {
                    lightboxTranslateX = 0;
                    lightboxTranslateY = 0;
                }
                updateLightboxZoom();
            });
            lightboxImage.addEventListener('mousedown', (event) => {
                if (lightboxScale <= 1) return;
                lightboxMousePanning = true;
                lightboxPanStartX = event.clientX - lightboxTranslateX;
                lightboxPanStartY = event.clientY - lightboxTranslateY;
                lightboxImage.style.cursor = 'grabbing';
                event.preventDefault();
            });
            window.addEventListener('mousemove', (event) => {
                if (!lightboxMousePanning) return;
                lightboxTranslateX = event.clientX - lightboxPanStartX;
                lightboxTranslateY = event.clientY - lightboxPanStartY;
                updateLightboxZoom();
            });
            window.addEventListener('mouseup', () => {
                lightboxMousePanning = false;
                lightboxImage.style.cursor = 'pointer';
            });
            lightboxImage.addEventListener('touchstart', (event) => {
                if (event.touches.length === 2) {
                    lightboxTouchStartDistance = getTouchDistance(event.touches);
                    const midpoint = getTouchMidpoint(event.touches);
                    const bounds = lightboxImage.getBoundingClientRect();
                    lightboxImage.style.transformOrigin = `${((midpoint.x - bounds.left) / bounds.width) * 100}% ${((midpoint.y - bounds.top) / bounds.height) * 100}%`;
                } else if (event.touches.length === 1 && lightboxScale > 1) {
                    lightboxPanStartX = event.touches[0].clientX - lightboxTranslateX;
                    lightboxPanStartY = event.touches[0].clientY - lightboxTranslateY;
                }
            }, { passive: true });
            lightboxImage.addEventListener('touchmove', (event) => {
                if (event.touches.length === 1 && lightboxScale > 1) {
                    lightboxTranslateX = event.touches[0].clientX - lightboxPanStartX;
                    lightboxTranslateY = event.touches[0].clientY - lightboxPanStartY;
                    updateLightboxZoom();
                    event.preventDefault();
                    return;
                }
                if (event.touches.length !== 2) return;
                const distance = getTouchDistance(event.touches);
                if (lightboxTouchStartDistance > 0) {
                    lightboxScale = Math.min(4, Math.max(1, lightboxScale * distance / lightboxTouchStartDistance));
                    lightboxTouchStartDistance = distance;
                    if (lightboxScale === 1) {
                        lightboxTranslateX = 0;
                        lightboxTranslateY = 0;
                    }
                    updateLightboxZoom();
                }
                event.preventDefault();
            }, { passive: false });
            document.getElementById('lightboxHeart').addEventListener('click', () => {
                const photo = state.displayPhotos[state.currentLightboxIndex];
                if (photo) toggleFavorite(photo.id);
            });

            document.getElementById('deleteRecentAlbumBtn').addEventListener('click', () => {
                document.querySelector('.saved-albums').classList.add('delete-mode');
            });
            document.getElementById('showDeletedAlbumsBtn').addEventListener('click', () => {
                document.getElementById('deletedAlbumsHistory').classList.toggle('visible');
                renderDeletedAlbumsHistory();
            });
            document.getElementById('cancelDeleteAlbumsBtn').addEventListener('click', () => {
                document.querySelector('.saved-albums').classList.remove('delete-mode');
            });
            document.getElementById('confirmDeleteAlbumsBtn').addEventListener('click', deleteSelectedAlbums);
            renderDeletedAlbumsHistory();
        }

        function initializeUserProfile() {
            const user = window.__APP_USER__ || {};
            if (!user.id) return;
            updateUserProfile(user);
            document.getElementById('loginBtnHeader').style.display = 'none';
        }

        function updateUserProfile(user) {
            const isLoggedIn = Boolean(user && user.id);
            const name = isLoggedIn ? (user.name || 'Người dùng') : 'Khách';
            const email = isLoggedIn ? (user.email || '') : 'Chưa đăng nhập';
            const avatarUrl = (user && user.avatar) || localStorage.getItem('photoSelectCurrentUserAvatar') || '';
            document.getElementById('userNameText').textContent = name;
            document.getElementById('userEmailText').textContent = email;
            document.getElementById('loginBtnHeader').style.display = isLoggedIn ? 'none' : '';
            renderAvatarElement(document.getElementById('userAvatar'), avatarUrl, name);
            document.getElementById('greetingName').textContent = name;
            document.getElementById('greetingEmail').textContent = email;
            renderAvatarElement(document.getElementById('accountAvatar'), avatarUrl, name);
            syncProfileModalFromUser();
            loadUserNotifications();
            updatePhoneAlert();
        }

        function updateAlbumVisibility() {
            const isLoggedIn = Boolean((window.__APP_USER__ || {}).id);
            const savedAlbums = document.querySelector('.saved-albums');
            const manageAlbumsButton = document.getElementById('manageAlbumsBtn');
            if (savedAlbums) savedAlbums.style.display = isLoggedIn ? '' : 'none';
            if (manageAlbumsButton) manageAlbumsButton.style.display = isLoggedIn ? 'inline-flex' : 'none';
        }

        async function toggleCommentSummary() {
            const panel = document.getElementById('commentSummaryPanel');
            const button = document.getElementById('commentStatBtn');
            const content = document.getElementById('commentSummaryContent');
            const isOpen = panel.classList.toggle('open');
            button.setAttribute('aria-expanded', String(isOpen));
            if (!isOpen) return;

            if (allPhotoComments) {
                renderCommentSummary(allPhotoComments);
                return;
            }

            content.className = 'comment-summary-loading';
            content.textContent = 'Đang tải bình luận...';
            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'load_all_comments' })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error('comment loading failed');
                allPhotoComments = result.data || [];
                renderCommentSummary(allPhotoComments);
            } catch (error) {
                content.className = 'comment-summary-empty';
                content.textContent = 'Không thể tải danh sách bình luận.';
            }
        }

        function renderCommentSummary(comments) {
            const content = document.getElementById('commentSummaryContent');
            content.replaceChildren();

            // Lọc danh sách ảnh theo đúng thư mục con đang được chọn (hoặc tất cả nếu chọn 'all')
            const targetPhotos = state.currentCategory === 'all'
                ? state.photos
                : state.photos.filter(p => p.category === state.currentCategory);

            const photoIdsInFilter = new Set(targetPhotos.map(p => String(p.id)));
            const albumFilteredComments = (comments || []).filter(c => photoIdsInFilter.has(String(c.photo_id)));

            if (!albumFilteredComments.length) {
                content.className = 'comment-summary-empty';
                content.textContent = 'Chưa có bình luận nào trong thư mục này.';
                return;
            }
            content.className = '';
            const groupedComments = new Map();
            albumFilteredComments.forEach(comment => {
                const photoId = String(comment.photo_id);
                if (!groupedComments.has(photoId)) groupedComments.set(photoId, []);
                groupedComments.get(photoId).push(comment);
            });
            groupedComments.forEach((photoComments, photoId) => {
                const item = document.createElement('div');
                item.className = 'comment-summary-item';
                const photo = state.photos.find(photoItem => String(photoItem.id) === photoId);
                const photoName = document.createElement('strong');
                photoName.textContent = `${photo?.name || `Ảnh ${photoId}`} (${photoComments.length} bình luận)`;
                const text = document.createElement('small');
                text.textContent = photoComments.map(comment => `${comment.author || 'Khách'}: ${comment.comment_text}`).join('\n');
                item.append(photoName, text);
                content.appendChild(item);
            });
        }

        function toggleAccountMenu(event) {
            event.stopPropagation();
            if (!(window.__APP_USER__ || {}).id) {
                openAuthModal('login');
                return;
            }
            const panel = document.getElementById('userPanel');
            const isOpen = panel.classList.toggle('open');
            panel.setAttribute('aria-expanded', String(isOpen));
        }

        document.addEventListener('click', (event) => {
            const panel = document.getElementById('userPanel');
            if (!panel) return;
            if (!panel.contains(event.target)) {
                panel.classList.remove('open');
                panel.setAttribute('aria-expanded', 'false');
            }
        });

        function renderAvatarElement(element, avatarUrl, initials) {
            if (!element) return;
            const safeInitials = (initials || 'U').charAt(0).toUpperCase();
            if (avatarUrl) {
                element.textContent = '';
                element.style.backgroundImage = `url('${avatarUrl}')`;
                element.style.backgroundColor = '#f3f4f6';
                element.setAttribute('data-has-image', 'true');
                return;
            }
            element.style.backgroundImage = 'none';
            element.style.backgroundColor = 'linear-gradient(135deg, #f59e0b, #ef4444)';
            element.style.background = 'linear-gradient(135deg, #f59e0b, #ef4444)';
            element.textContent = safeInitials;
            element.removeAttribute('data-has-image');
        }

        function syncProfileModalFromUser() {
            const user = window.__APP_USER__ || {};
            const name = user.name || 'Khách';
            const email = user.email || 'Chưa đăng nhập';
            const nameInput = document.getElementById('profileNameInput');
            const emailInput = document.getElementById('profileEmailInput');
            const phoneInput = document.getElementById('profilePhoneInput');
            if (nameInput) nameInput.value = name;
            if (emailInput) emailInput.value = email;
            if (phoneInput) phoneInput.value = user.phone || '';
        }

        function openProfileModal() {
            syncProfileModalFromUser();
            document.getElementById('userPanel').classList.remove('open');
            document.getElementById('profileModal').classList.add('active');
        }

        function updatePhoneAlert() {
            const button = document.getElementById('notificationBtn');
            if (!button) return;
            const missingPhone = Boolean((window.__APP_USER__ || {}).id) && !String((window.__APP_USER__ || {}).phone || '').trim();
            button.classList.toggle('has-alert', missingPhone);
            button.title = missingPhone ? 'Vui lòng cập nhật số điện thoại' : 'Thông báo';
            button.setAttribute('aria-label', button.title);
        }

        async function saveProfilePhone() {
            const message = document.getElementById('profileMessage');
            const phone = document.getElementById('profilePhoneInput').value.trim();
            message.textContent = 'Đang lưu...';
            try {
                const response = await fetch('photowedding/app.php', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'update_phone', phone }) });
                const result = await response.json();
                message.textContent = result.message || (result.success ? 'Đã cập nhật số điện thoại.' : 'Không thể cập nhật.');
                if (result.success) { window.__APP_USER__ = result.user; updateUserProfile(result.user); showToast('✅ Đã cập nhật số điện thoại'); }
            } catch (error) { message.textContent = 'Không thể kết nối máy chủ.'; }
        }

        let userNotifications = [];
        async function loadUserNotifications() {
            if (!(window.__APP_USER__ || {}).id) return;
            try {
                const response = await fetch('photowedding/app.php', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'get_notifications' }) });
                const result = await response.json();
                if (!result.success) return;
                userNotifications = result.notifications || [];
                const unread = userNotifications.filter(item => Number(item.is_read) === 0).length;
                const badge = document.getElementById('notificationBadge');
                badge.hidden = unread === 0;
                badge.textContent = unread > 9 ? '9+' : String(unread);
                document.getElementById('notificationBtn').classList.toggle('has-alert', unread > 0 || !String((window.__APP_USER__ || {}).phone || '').trim());
            } catch (error) { /* Thông báo không làm gián đoạn ứng dụng chính. */ }
        }

        function openNotificationModal() {
            if (!(window.__APP_USER__ || {}).id) { openAuthModal('login'); return; }
            const list = document.getElementById('notificationList');
            const notificationButton = document.getElementById('notificationBtn');
            const notificationContent = document.querySelector('#notificationModal .modal-content');
            if (notificationButton && notificationContent) {
                const buttonRect = notificationButton.getBoundingClientRect();
                const contentWidth = Math.min(390, window.innerWidth - 32);
                const left = Math.max(8, Math.min(buttonRect.right - contentWidth, window.innerWidth - contentWidth - 8));
                notificationContent.style.top = `${buttonRect.bottom + 8}px`;
                notificationContent.style.left = `${left}px`;
                notificationContent.style.right = 'auto';
            }
            list.replaceChildren();
            if (!String((window.__APP_USER__ || {}).phone || '').trim()) {
                const phoneNotice = document.createElement('article');
                phoneNotice.className = 'notification-item unread';
                phoneNotice.innerHTML = '<strong>Cần cập nhật số điện thoại</strong><small>Bảo mật tài khoản</small><p>Vui lòng cập nhật số điện thoại để Quản trị viên hỗ trợ xác thực tài khoản khi cần thiết.</p><button type="button" class="btn btn-primary">Cập nhật ngay</button>';
                phoneNotice.querySelector('button').addEventListener('click', () => { closeNotificationModal(); openProfileModal(); });
                list.appendChild(phoneNotice);
            }
            if (!userNotifications.length && !list.children.length) { list.innerHTML = '<p class="hint">Chưa có thông báo mới.</p>'; }
            userNotifications.forEach(item => {
                const article = document.createElement('article');
                article.className = `notification-item ${Number(item.is_read) === 0 ? 'unread' : ''}`;
                article.innerHTML = `<strong></strong><small></small><p></p>`;
                article.querySelector('strong').textContent = item.title;
                article.querySelector('small').textContent = item.created_at || '';
                article.querySelector('p').textContent = item.message;
                list.appendChild(article);
                if (Number(item.is_read) === 0) fetch('photowedding/app.php', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'mark_notification_read', notification_id:item.id }) });
            });
            document.getElementById('notificationBadge').hidden = true;
            updatePhoneAlert();
            document.getElementById('notificationModal').classList.add('active');
        }

        function closeNotificationModal() { document.getElementById('notificationModal').classList.remove('active'); }

        function closeProfileModal() {
            document.getElementById('profileModal').classList.remove('active');
        }

        function openPasswordModal(event) {
            event.stopPropagation();
            document.getElementById('userPanel').classList.remove('open');
            document.getElementById('passwordMessage').textContent = '';
            document.getElementById('passwordForm').reset();
            document.getElementById('passwordModal').classList.add('active');
            requestAnimationFrame(() => document.querySelector('#passwordForm input[name="old_password"]')?.focus());
        }

        function closePasswordModal() {
            document.getElementById('passwordModal').classList.remove('active');
        }

        function getInterfaceSettings() {
            try {
                const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || '{}');
                const dashboardTheme = localStorage.getItem('photoSelectDashboardTheme');
                const savedTheme = saved.theme === 'dark' || saved.theme === 'sage'
                    ? saved.theme
                    : (dashboardTheme === 'dark' || (dashboardTheme !== 'light' && localStorage.getItem(THEME_STORAGE_KEY) === 'dark') ? 'dark' : 'sage');
                return {
                    showWelcome: saved.showWelcome !== false,
                    showGuide: saved.showGuide !== false,
                    showJump: saved.showJump !== false,
                    showSavedAlbums: saved.showSavedAlbums !== false,
                    compactMode: Boolean(saved.compactMode),
                    highContrast: Boolean(saved.highContrast),
                    strongBorder: Boolean(saved.strongBorder),
                    accentColor: saved.accentColor || 'gold',
                    fontScale: saved.fontScale || 'normal',
                    theme: savedTheme
                };
            } catch (error) {
                return {
                    showWelcome: true,
                    showGuide: true,
                    showJump: true,
                    showSavedAlbums: true,
                    compactMode: false,
                    highContrast: false,
                    strongBorder: false,
                    accentColor: 'gold',
                    fontScale: 'normal',
                    theme: 'sage'
                };
            }
        }

        function applyAccentSettings(accentColor) {
            const palette = {
                gold: {
                    accent: '#d4af37',
                    accentHover: '#f0cb5f',
                    accentGradient: 'linear-gradient(135deg, #d4af37 0%, #f0cb5f 100%)'
                },
                blue: {
                    accent: '#3b82f6',
                    accentHover: '#60a5fa',
                    accentGradient: 'linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)'
                },
                green: {
                    accent: '#22c55e',
                    accentHover: '#4ade80',
                    accentGradient: 'linear-gradient(135deg, #16a34a 0%, #4ade80 100%)'
                }
            };

            const selected = palette[accentColor] || palette.gold;
            document.body.style.setProperty('--accent', selected.accent);
            document.body.style.setProperty('--accent-hover', selected.accentHover);
            document.body.style.setProperty('--accent-gradient', selected.accentGradient);
            const button = document.getElementById('themeToggleBtn');
            if (button && !document.body.getAttribute('data-theme')) {
                button.style.setProperty('background', selected.accentGradient);
            }
        }

        function applyInterfaceSettings(settings = getInterfaceSettings()) {
            document.body.classList.toggle('hide-welcome-section', !settings.showWelcome);
            document.body.classList.toggle('hide-usage-guide', !settings.showGuide);
            document.body.classList.toggle('hide-page-jump', !settings.showJump);
            document.body.classList.toggle('hide-saved-albums', !settings.showSavedAlbums);
            document.body.classList.toggle('compact-interface', settings.compactMode);
            document.body.classList.toggle('high-contrast-interface', settings.highContrast);
            document.body.classList.toggle('strong-border-interface', settings.strongBorder);

            const fontMap = {
                normal: '1rem',
                large: '1.06rem',
                xlarge: '1.14rem'
            };
            document.body.style.fontSize = fontMap[settings.fontScale] || '1rem';

            const theme = settings.theme === 'dark' ? 'dark' : 'sage';
            applyTheme(theme);
            applyAccentSettings(settings.accentColor || 'gold');

            const welcome = document.querySelector('.main-welcome');
            const usageGuide = document.querySelector('.usage-guide');
            const jumpControls = document.querySelector('.page-jump-controls');
            const savedAlbums = document.querySelector('.saved-albums');

            if (welcome) welcome.style.display = settings.showWelcome ? '' : 'none';
            if (usageGuide) usageGuide.style.display = settings.showGuide ? '' : 'none';
            if (jumpControls) jumpControls.style.display = settings.showJump ? '' : 'none';
            if (savedAlbums) savedAlbums.style.display = settings.showSavedAlbums ? '' : 'none';

            if (settings.compactMode) {
                document.body.style.setProperty('--panel-padding', '0.8rem');
            } else {
                document.body.style.removeProperty('--panel-padding');
            }

            if (settings.highContrast) {
                document.body.style.setProperty('--border', 'rgba(255, 255, 255, 0.7)');
                document.body.style.setProperty('--text', '#f8fafc');
                document.body.style.setProperty('--primary', '#f8fafc');
                document.body.style.setProperty('--secondary', '#e2e8f0');
                document.body.style.setProperty('--card-bg', 'rgba(15, 23, 42, 0.98)');
            } else {
                document.body.style.removeProperty('--border');
                document.body.style.removeProperty('--text');
                document.body.style.removeProperty('--primary');
                document.body.style.removeProperty('--secondary');
                document.body.style.removeProperty('--card-bg');
            }

            if (settings.strongBorder) {
                document.body.style.setProperty('--border', 'rgba(255, 255, 255, 0.75)');
            } else {
                document.body.style.removeProperty('--border');
            }
        }

        function openSettingsModal() {
            syncSettingsThemeButtons();
            document.getElementById('settingsThemeStatus').textContent = '';
            const userPanel = document.getElementById('userPanel');
            userPanel.classList.remove('open');
            userPanel.setAttribute('aria-expanded', 'false');
            document.getElementById('settingsModal').classList.add('active');
        }

        function closeSettingsModal() {
            document.getElementById('settingsModal').classList.remove('active');
        }

        function syncSettingsThemeButtons() {
            const activeTheme = document.body.dataset.theme === 'dark' ? 'dark' : 'sage';
            document.querySelectorAll('[data-settings-theme]').forEach(button => {
                button.setAttribute('aria-pressed', String(button.dataset.settingsTheme === activeTheme));
            });
        }

        function selectInterfaceTheme(theme) {
            if (theme !== 'sage' && theme !== 'dark') return;
            const settings = getInterfaceSettings();
            settings.theme = theme;
            try {
                localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
                applyInterfaceSettings(settings);
                document.getElementById('settingsThemeStatus').textContent = `Đã áp dụng giao diện ${theme === 'dark' ? 'tối' : 'sáng'} cho các trang.`;
            } catch (error) {
                document.getElementById('settingsThemeStatus').textContent = 'Không thể lưu lựa chọn giao diện trên trình duyệt này.';
                console.error('Không thể lưu giao diện.', error);
            }
        }

        async function submitPasswordForm(event) {
            event.preventDefault();
            const message = document.getElementById('passwordMessage');
            const payload = Object.fromEntries(new FormData(event.currentTarget));
            payload.action = 'change_password';
            message.textContent = 'Đang cập nhật...';
            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams(payload)
                });
                const result = await response.text();
                if (!response.ok || result !== 'success') throw new Error(result);
                closePasswordModal();
                showToast('✅ Đổi mật khẩu thành công');
            } catch (error) {
                message.textContent = error.message || 'Không thể đổi mật khẩu.';
            }
        }

        function logoutUser(event) {
            event.stopPropagation();
            if (window.PhotoSelectAPI?.isMockMode?.()) {
                localStorage.setItem('photoSelectStaticUserId', '0');
                window.location.href = './?home=1';
                return;
            }
            window.location.href = './?logout=1';
        }

        function getFocusableElements(container = document) {
            return Array.from(container.querySelectorAll('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'))
                .filter(element => {
                    if (element.closest('[hidden]')) return false;
                    if (element.offsetParent === null && element !== document.activeElement) return false;
                    return true;
                });
        }

        function handleModalTabNavigation(event, modalElement) {
            if (!modalElement || !modalElement.classList.contains('active')) return;
            if (event.key !== 'Tab') return;
            const focusables = getFocusableElements(modalElement);
            if (!focusables.length) return;
            const currentIndex = focusables.indexOf(document.activeElement);
            const nextIndex = event.shiftKey
                ? (currentIndex <= 0 ? focusables.length - 1 : currentIndex - 1)
                : (currentIndex === -1 || currentIndex === focusables.length - 1 ? 0 : currentIndex + 1);
            event.preventDefault();
            focusables[nextIndex].focus();
        }

        function focusFirstAuthField() {
            const activeForm = document.querySelector('.auth-form.active');
            if (!activeForm) return;
            const firstField = activeForm.querySelector('input, select, textarea, button');
            if (firstField) {
                requestAnimationFrame(() => firstField.focus());
            }
        }

        function openAuthModal(tab = 'login') {
            closeSettingsModal();
            switchAuthTab(tab);
            document.getElementById('authModal').classList.add('active');
            focusFirstAuthField();
        }

        function closeAuthModal() {
            document.getElementById('authModal').classList.remove('active');
            document.getElementById('authMessage').textContent = '';
        }

        function switchAuthTab(target) {
            document.querySelectorAll('[data-auth-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.authTab === target));
            document.querySelectorAll('[data-auth-form]').forEach(form => form.classList.toggle('active', form.dataset.authForm === target));
            document.getElementById('authMessage').textContent = '';
            focusFirstAuthField();
        }

        function validateGmailEmail(email, { showMessage = true, messageElement = null } = {}) {
            const normalized = String(email || '').trim().toLowerCase();
            if (!normalized) {
                if (showMessage && messageElement) messageElement.textContent = 'Vui lòng nhập email.';
                return { valid: false, message: 'Vui lòng nhập email.' };
            }
            if (!normalized.includes('@')) {
                if (showMessage && messageElement) messageElement.textContent = 'Thiếu @ trong email. Vui lòng thêm @ và nhập đúng định dạng.';
                return { valid: false, message: 'Thiếu @ trong email. Vui lòng thêm @ và nhập đúng định dạng.' };
            }
            if (!/^[^\s@]+@gmail\.com$/i.test(normalized)) {
                if (showMessage && messageElement) messageElement.textContent = 'Chỉ chấp nhận email @gmail.com. Vui lòng dùng địa chỉ Gmail.';
                return { valid: false, message: 'Chỉ chấp nhận email @gmail.com. Vui lòng dùng địa chỉ Gmail.' };
            }
            return { valid: true, message: '' };
        }

        async function submitAuthForm(event) {
            event.preventDefault();
            const form = event.currentTarget;
            const message = document.getElementById('authMessage');
            const payload = Object.fromEntries(new FormData(form));
            payload.action = form.dataset.authForm;

            if (payload.action === 'register' || payload.action === 'forgot') {
                const email = String(payload.email || '').trim();
                const validation = validateGmailEmail(email, { showMessage: true, messageElement: message });
                if (!validation.valid) {
                    return;
                }
            }

            if (payload.action === 'login') {
                const loginIdentifier = String(payload.login_id || payload.email || '').trim();
                if (!/^\d+$/.test(loginIdentifier) && !loginIdentifier.includes('@')) {
                    const validation = validateGmailEmail(loginIdentifier, { showMessage: true, messageElement: message });
                    if (!validation.valid) {
                        return;
                    }
                }
                if (!/^\d+$/.test(loginIdentifier) && loginIdentifier.includes('@')) {
                    const validation = validateGmailEmail(loginIdentifier, { showMessage: true, messageElement: message });
                    if (!validation.valid) {
                        return;
                    }
                }
            }

            message.textContent = 'Đang xử lý...';

            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await response.json();
                message.textContent = result.message || (result.success ? 'Thành công.' : 'Không thể xử lý yêu cầu.');
                if (result.success && payload.action === 'login') {
                    const user = result.user;
                    if (!user || !user.id) {
                        message.textContent = 'Đăng nhập thành công nhưng chưa nhận được thông tin tài khoản. Vui lòng tải lại trang.';
                        console.error('Login response did not include a valid user.', result);
                        return;
                    }
                    window.__APP_USER__ = user;
                    updateUserProfile(user);
                    document.body.classList.toggle('guest-shared-view', isGuestSharedView());
                    updateAlbumVisibility();
                    loadUserAlbums();
                    document.getElementById('loginBtnHeader').style.display = 'none';
                    closeAuthModal();
                    if (!CONFIG.IS_SHARED_ALBUM) {
                        window.location.replace('albums.html?login=success');
                        return;
                    }
                    showToast('✅ Đăng nhập thành công');
                }
            } catch (error) {
                message.textContent = 'Không thể kết nối máy chủ. Vui lòng thử lại.';
            }
        }


        function toggleTheme() {
            const nextTheme = document.body.getAttribute('data-theme') === 'sage' ? 'dark' : 'sage';
            const settings = getInterfaceSettings();
            settings.theme = nextTheme;
            localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
            applyTheme(nextTheme);
        }

        function applyTheme(theme) {
            const isSage = theme === 'sage';
            document.body.setAttribute('data-theme', isSage ? 'sage' : 'dark');
            localStorage.setItem(THEME_STORAGE_KEY, isSage ? 'sage' : 'dark');
            syncSettingsThemeButtons();
        }

        function toggleAdminChat() {
            const chat = document.getElementById('adminChat');
            const isOpen = chat.classList.toggle('open');
            document.getElementById('adminChatToggle').setAttribute('aria-expanded', String(isOpen));
            if (isOpen) document.getElementById('adminChatInput').focus();
        }

        function toggleAdminChatReportMode() {
            const form = document.getElementById('adminChatForm');
            const input = document.getElementById('adminChatInput');
            const button = document.getElementById('adminChatReportToggle');
            const enabled = form.dataset.reportMode !== 'true';
            form.dataset.reportMode = String(enabled);
            input.maxLength = enabled ? 300 : 2000;
            input.placeholder = enabled ? 'Mô tả lỗi bạn gặp phải...' : 'Ví dụ: Tôi muốn góp ý về cách hiển thị ảnh...';
            button.classList.toggle('is-active', enabled);
            button.setAttribute('aria-pressed', String(enabled));
            document.getElementById('adminChatSubmit').textContent = enabled ? 'Gửi báo lỗi' : 'Gửi góp ý';
            input.focus();
        }

        function renderAdminChatMessages(messages) {
            const container = document.getElementById('adminChatMessages');
            container.replaceChildren();
            if (!messages.length) {
                const empty = document.createElement('div');
                empty.className = 'admin-chat-empty';
                empty.textContent = 'Chưa có tin nhắn nào.';
                container.appendChild(empty);
                return;
            }
            messages.forEach(item => {
                const bubble = document.createElement('div');
                bubble.className = `admin-chat-bubble ${item.sender_type === 'guest' ? 'guest' : 'admin'}`;
                const sender = document.createElement('small');
                sender.textContent = item.sender_type === 'guest' ? 'Bạn' : 'Admin';
                const text = document.createElement('span');
                text.textContent = item.message;
                bubble.append(sender, text);
                container.appendChild(bubble);
            });
            container.scrollTop = container.scrollHeight;
        }

        async function loadAdminChat() {
            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'load_chat', conversation_id: adminChatConversationId })
                });
                const result = await response.json();
                if (!response.ok || !result.success) return;
                if (result.conversation_id && result.conversation_id !== adminChatConversationId) {
                    adminChatConversationId = result.conversation_id;
                    localStorage.setItem('photoSelectChatId', adminChatConversationId);
                }
                const messages = result.data || [];
                const latestAdminMessage = [...messages].reverse().find(item => item.sender_type === 'admin');
                const latestAdminMessageId = Number(latestAdminMessage?.id || 0);
                if (hasLoadedAdminChat && latestAdminMessageId > lastAdminChatMessageId && !document.getElementById('adminChat').classList.contains('open')) {
                    showToast('💬 Admin vừa phản hồi');
                }
                if (latestAdminMessageId > lastAdminChatMessageId) {
                    lastAdminChatMessageId = latestAdminMessageId;
                }
                hasLoadedAdminChat = true;
                renderAdminChatMessages(messages);
                document.getElementById('adminChatTyping').textContent = result.typing?.type === 'admin'
                    ? `${result.typing.name || 'Admin'} đang nhập`
                    : '';
            } catch (error) {
                console.warn('Không thể tải lịch sử chat.', error);
            }
        }

        function sendAdminChatTyping(typing) {
            fetch('photowedding/app.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'set_chat_typing', conversation_id: adminChatConversationId, typing })
            }).then(response => response.json()).then(result => {
                if (result.conversation_id && result.conversation_id !== adminChatConversationId) {
                    adminChatConversationId = result.conversation_id;
                    localStorage.setItem('photoSelectChatId', adminChatConversationId);
                }
            }).catch(() => {});
        }

        function handleAdminChatTyping(event) {
            const hasText = event.currentTarget.value.trim() !== '';
            sendAdminChatTyping(hasText);
            window.clearTimeout(adminChatTypingTimer);
            if (hasText) {
                adminChatTypingTimer = window.setTimeout(() => sendAdminChatTyping(false), 1600);
            }
        }

        async function submitAdminFeedback(event) {
            event.preventDefault();
            const input = document.getElementById('adminChatInput');
            const submit = document.getElementById('adminChatSubmit');
            const message = document.getElementById('adminChatMessage');
            const text = input.value.trim();
            if (!text) return;
            const isBugReport = document.getElementById('adminChatForm').dataset.reportMode === 'true';
            const messageText = isBugReport
                ? `[BÁO LỖI]\nTrang: ${window.location.pathname}\nThời gian: ${new Date().toLocaleString('vi-VN')}\nMô tả: ${text}`
                : text;

            window.clearTimeout(adminChatTypingTimer);
            sendAdminChatTyping(false);
            submit.disabled = true;
            message.textContent = 'Đang gửi...';
            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'contact_admin', message: messageText })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.message || 'Không thể gửi góp ý.');
                adminChatConversationId = result.conversation_id || adminChatConversationId;
                if (adminChatConversationId) localStorage.setItem('photoSelectChatId', adminChatConversationId);
                renderAdminChatMessages(result.data || []);
                input.value = '';
                if (isBugReport) toggleAdminChatReportMode();
                message.textContent = result.message;
            } catch (error) {
                message.textContent = error.message || 'Không thể kết nối máy chủ.';
            } finally {
                submit.disabled = false;
            }
        }

        function extractFolderIdFromUrl(url) {
            const match = url.match(/folders\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
            return match ? match[1] : url.trim();
        }

        function extractFolderId() {
            if (!(window.__APP_USER__ || {}).id) {
                openAuthModal('login');
                return;
            }

            const link = document.getElementById('folderLink').value.trim();
            const id = extractFolderIdFromUrl(link);
            if (id) {
                document.getElementById('folderId').value = id;
                showToast('✅ Trích xuất ID thành công: ' + id);
            } else {
                showToast('❌ Link không đúng định dạng');
            }
        }

        function showProtectedShareForm() {
            document.getElementById('shareSecurityQuestion').hidden = true;
            document.getElementById('shareCodeForm').hidden = false;
            document.getElementById('shareAccessCode').focus();
        }

        function resetShareModal() {
            document.getElementById('shareSecurityQuestion').hidden = false;
            document.getElementById('shareCodeForm').hidden = true;
            document.getElementById('shareAccessCode').value = '';
            document.getElementById('shareUrlInput').value = '';
            document.getElementById('shareSecurityMessage').textContent = '';
            document.getElementById('shareQrImage').src = '';
            document.getElementById('shareQrImage').hidden = true;
            document.getElementById('shareQrPlaceholder').hidden = false;
        }

        async function shareAlbum() {
            const folderId = document.getElementById('folderId').value.trim() || CONFIG.DRIVE_FOLDER_ID;
            if (!folderId) {
                showToast('❌ Hãy nhập hoặc tải album trước khi chia sẻ');
                return;
            }
            resetShareModal();
            document.getElementById('shareModal').classList.add('active');
        }

        async function createShareLink(accessCode) {
            const folderId = document.getElementById('folderId').value.trim() || CONFIG.DRIVE_FOLDER_ID;
            if (accessCode !== '' && (accessCode.length < 4 || accessCode.length > 64)) {
                document.getElementById('shareSecurityMessage').textContent = 'Mã bảo mật phải dài từ 4 đến 64 ký tự.';
                return;
            }

            const message = document.getElementById('shareSecurityMessage');
            message.textContent = 'Đang tạo link...';
            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'create_share_link', folder_id: folderId, access_code: accessCode })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.message || 'Không thể tạo link.');
                const shareUrl = new URL(result.url, window.location.href);
                const url = shareUrl.toString();
                document.getElementById('shareUrlInput').value = url;
                document.getElementById('shareQrImage').src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
                document.getElementById('shareQrImage').hidden = false;
                document.getElementById('shareQrPlaceholder').hidden = true;
                message.textContent = result.requires_code ? 'Link đã được bảo vệ bằng mã bảo mật.' : 'Link không yêu cầu mã bảo mật.';
            } catch (error) {
                message.textContent = error.message || 'Không thể tạo link chia sẻ.';
                return;
            }
        }

        function closeShareModal() {
            document.getElementById('shareModal').classList.remove('active');
            resetShareModal();
        }

        async function copyShareUrl() {
            const input = document.getElementById('shareUrlInput');
            if (!input.value.trim()) {
                showShareDialogToast('⚠️ Vui lòng chọn đặt mã bảo vệ hoặc không đặt mã trước khi copy link.');
                return;
            }
            try {
                await navigator.clipboard.writeText(input.value);
                showShareDialogToast('✅ Đã sao chép link album');
            } catch (error) {
                input.select();
                document.execCommand('copy');
                showShareDialogToast('✅ Đã sao chép link album');
            }
        }

        function showShareDialogToast(message) {
            document.querySelector('.share-dialog-toast')?.remove();
            const toast = document.createElement('div');
            toast.className = 'share-dialog-toast';
            toast.textContent = message;
            document.querySelector('.share-modal-content').appendChild(toast);
            setTimeout(() => toast.remove(), 2800);
        }

        async function saveConfig() {
    if (!(window.__APP_USER__ || {}).id) {
        openAuthModal('login');
        return;
    }

    try {
        extractFolderId();
        const folderId = document.getElementById('folderId').value.trim();
        if (!folderId) return;
        
        CONFIG.DRIVE_FOLDER_ID = folderId;
        localStorage.setItem('driveFolderId', folderId);
        
        // XÓA CACHE CŨ CỦA FOLDER NÀY
        sessionStorage.removeItem(PHOTO_CACHE_PREFIX + folderId);
        
        const albumName = await getDriveFolderName(folderId, true); // true để lấy tên mới nhất từ Drive
        await saveAlbumToDatabase(folderId, albumName);
        setActiveAlbumName(albumName);
        document.getElementById('folderLink').value = '';
        
        // NẠP LẠI MỚI HOÀN TOÀN
        await loadPhotos();
    } catch (error) {
        showDriveConfigError('Không thể kết nối Google Drive. Kiểm tra GOOGLE_API_KEY, quyền thư mục và ID folder.', error);
    }
}

        function readCachedAlbumMeta(albumId) {
            const result = { name: '', cover: '' };
            try {
                const albumNames = JSON.parse(localStorage.getItem(ALBUM_NAMES_KEY) || '{}');
                const cachedName = albumNames[albumId];
                if (typeof cachedName === 'string' && cachedName.trim()) {
                    result.name = normalizeAlbumName(cachedName);
                }
            } catch (error) {
                // Ignore invalid cached names.
            }

            try {
                const cachedValue = JSON.parse(localStorage.getItem(DRIVE_COVER_CACHE_PREFIX + albumId) || 'null');
                if (cachedValue && cachedValue.savedAt > Date.now() - DRIVE_COVER_CACHE_TTL && cachedValue.url) {
                    result.cover = cachedValue.url;
                }
            } catch (error) {
                // Ignore invalid cached covers.
            }

            return result;
        }

        function attachAlbumCoverObserver() {
            if (albumCoverObserver) {
                albumCoverObserver.disconnect();
            }

            albumCoverObserver = new IntersectionObserver((entries) => {
                const visibleIds = entries
                    .filter(entry => entry.isIntersecting)
                    .map(entry => entry.target.dataset.albumId)
                    .filter(Boolean);

                visibleIds.forEach(albumId => {
                    if (albumCoverHydrating.has(String(albumId))) return;
                    albumCoverHydrating.add(String(albumId));
                    queueMicrotask(() => loadAlbumCoverIfNeeded(albumId));
                });
            }, {
                root: null,
                rootMargin: '200px',
                threshold: 0.01
            });

            document.querySelectorAll('.saved-album-thumb[data-album-id]').forEach(element => {
                albumCoverObserver.observe(element);
            });
        }

        async function loadAlbumCoverIfNeeded(albumId) {
            if (!albumId) return;
            const album = state.savedAlbums.find(item => String(item.id) === String(albumId));
            if (!album) {
                albumCoverHydrating.delete(String(albumId));
                return;
            }

            try {
                if (album.cover) {
                    albumCoverHydrating.delete(String(albumId));
                    return;
                }

                const cover = await getRandomDriveCover(String(album.id));
                if (cover) {
                    album.cover = cover;
                    renderSavedAlbums();
                }
            } catch (error) {
                // Keep the list snappy: no blocking fallback.
            } finally {
                albumCoverHydrating.delete(String(albumId));
            }
        }

        async function loadUserAlbums() {
            try {
                const [albumsResponse, deletedResponse] = await Promise.all([
                    fetch('photowedding/app.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'load_albums' })
                    }),
                    fetch('photowedding/app.php', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'load_deleted_albums' })
                    })
                ]);
                const albumsResult = await albumsResponse.json();
                const deletedResult = await deletedResponse.json();
                if (!albumsResponse.ok || !albumsResult.success) throw new Error('load albums failed');
                if (!deletedResponse.ok || !deletedResult.success) throw new Error('load deleted albums failed');

                state.savedAlbums = albumsResult.data.map(mapDatabaseAlbum);
                state.deletedAlbums = deletedResult.data.map(mapDatabaseAlbum);

                state.savedAlbums.forEach(album => {
                    if (!album.id) return;
                    const cachedMeta = readCachedAlbumMeta(String(album.id));
                    if (cachedMeta.name) album.name = cachedMeta.name;
                    if (cachedMeta.cover) album.cover = cachedMeta.cover;
                });

                renderSavedAlbums();
                renderDeletedAlbumsHistory();
                attachAlbumCoverObserver();
                queueVisibleAlbumMetadataRefresh();
            } catch (error) {
                console.warn('Không thể tải danh sách album từ database.', error);
            }
        }

        function queueVisibleAlbumMetadataRefresh() {
            if (albumMetadataRefreshInFlight) {
                albumMetadataRefreshQueued = true;
                return;
            }

            albumMetadataRefreshQueued = false;
            albumMetadataRefreshInFlight = true;
            requestAnimationFrame(() => {
                const token = ++albumMetadataRefreshToken;
                refreshVisibleAlbumMetadata(token)
                    .finally(() => {
                        albumMetadataRefreshInFlight = false;
                        if (albumMetadataRefreshQueued) {
                            albumMetadataRefreshQueued = false;
                            queueVisibleAlbumMetadataRefresh();
                        }
                    });
            });
        }

        async function refreshVisibleAlbumMetadata(token = albumMetadataRefreshToken) {
            const start = (state.savedAlbumPage - 1) * state.savedAlbumPageSize;
            const visibleAlbums = state.savedAlbums.slice(start, start + state.savedAlbumPageSize);
            if (!visibleAlbums.length || token !== albumMetadataRefreshToken) return;

            const priorityAlbums = visibleAlbums.slice(0, ALBUM_META_BATCH_SIZE);

            for (const album of priorityAlbums) {
                if (token !== albumMetadataRefreshToken || !album || !album.id) continue;
                const cachedMeta = readCachedAlbumMeta(String(album.id));
                if (!album.cover && cachedMeta.cover) album.cover = cachedMeta.cover;
                if (!album.name || /[?]/.test(album.name || '')) {
                    const cachedName = cachedMeta.name || album.name;
                    if (cachedName) album.name = cachedName;
                }

                if (album.cover && !/[?]/.test(album.name || '')) continue;

                try {
                    if (!album.name || /[?]/.test(album.name || '')) {
                        album.name = await getDriveFolderName(String(album.id), true);
                    }
                    if (!album.cover) {
                        album.cover = await getRandomDriveCover(String(album.id));
                    }
                } catch (error) {
                    // Keep the list responsive: no background flood.
                }
            }

            if (token !== albumMetadataRefreshToken) return;
            renderSavedAlbums();
            attachAlbumCoverObserver();
        }

        function mapDatabaseAlbum(album) {
            return {
                databaseId: Number(album.id),
                id: album.folder_id,
                name: normalizeAlbumName(album.album_name),
                cover: '',
                createdAt: album.created_at,
                deletedAt: album.deleted_at,
                allowSave: Boolean(album.allow_save)
            };
        }

        function normalizeAlbumName(value) {
            const name = String(value || '').trim();
            if (!name || !/[ÃÂÄÅÆâ€]/.test(name)) return name;
            try {
                const repaired = decodeURIComponent(escape(name));
                return repaired.includes('\ufffd') ? name : repaired;
            } catch (error) {
                return name;
            }
        }

        async function getRandomDriveCover(folderId) {
            const cacheKey = DRIVE_COVER_CACHE_PREFIX + folderId;
            try {
                const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
                if (cached && cached.savedAt > Date.now() - DRIVE_COVER_CACHE_TTL) {
                    return cached.url || '';
                }
            } catch (error) {
                localStorage.removeItem(cacheKey);
            }

            const response = await fetch(`photowedding/app.php?drive_proxy=list&folder_id=${encodeURIComponent(folderId)}&images_only=1&page_size=1`);
            if (!response.ok) throw new Error(`Google Drive cover error (${response.status})`);
            const result = await response.json();
            const files = Array.isArray(result.files) ? result.files : [];
            const url = files.length
                ? (files[0].thumbnailUrl || `https://lh3.googleusercontent.com/d/${encodeURIComponent(files[0].id)}=w320`)
                : '';
            try {
                localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), url }));
            } catch (error) {
                // Ignore storage quota errors; the cover remains functional.
            }
            return url;
        }

        async function saveAlbumToDatabase(folderId, albumName, allowSave = false) {
            if (state.savedAlbums.some(album => album.id === folderId)) return;
            const response = await fetch('photowedding/app.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save_album', album_name: albumName, folder_id: folderId, allow_save: allowSave })
            });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.message || 'Không thể lưu album');
            await loadUserAlbums();
        }

        function getCurrentAlbumPermission() {
            const currentFolderId = (document.getElementById('folderId')?.value || '').trim();
            if (!currentFolderId || !isGuestSharedView()) return true;
            if (typeof window.__SHARED_ALBUM_ALLOW_SAVE__ === 'boolean') {
                return Boolean(window.__SHARED_ALBUM_ALLOW_SAVE__);
            }
            const album = state.savedAlbums.find(item => item.id === currentFolderId);
            return album ? Boolean(album.allowSave) : true;
        }

        function getSharedDownloadQuery() {
            const shareToken = new URLSearchParams(window.location.search).get('share') || '';
            return shareToken ? `&share_token=${encodeURIComponent(shareToken)}` : '';
        }

        function updateGuestPermissionStatus() {
            const status = document.getElementById('guestPermissionStatus');
            if (!status || !CONFIG.IS_SHARED_ALBUM) return;
            const allowed = Boolean(window.__SHARED_ALBUM_ALLOW_SAVE__);
            status.textContent = allowed ? '✅ Khách được lưu ảnh' : '🔒 Khách không được lưu ảnh';
            status.style.color = allowed ? 'var(--control-green)' : '#b42318';
        }

        function isGuestSharedView() {
            if (!CONFIG.IS_SHARED_ALBUM) return false;
            const currentUserId = Number((window.__APP_USER__ || {}).id || 0);
            return currentUserId !== CONFIG.SHARED_OWNER_USER_ID;
        }

        function ensureAlbumAllowsSave(actionName = 'lưu ảnh') {
            if (getCurrentAlbumPermission()) return true;
            showToast(`⚠️ Khách xem đang bị khóa ${actionName}. Khi nút ở OFF, khách không được lưu ảnh và không được chụp màn hình.`);
            return false;
        }

        function setScreenshotProtection(enabled) {
            document.body.classList.toggle('guest-screenshot-blocked', Boolean(enabled && isGuestSharedView() && !getCurrentAlbumPermission()));
        }

        function startSharedPermissionPolling() {
            if (!isGuestSharedView() || sharedPermissionPollTimer) return;
            refreshSharedPermission();
            sharedPermissionPollTimer = window.setInterval(refreshSharedPermission, 1500);
        }

       async function refreshSharedPermission() {
    if (!isGuestSharedView()) return;

    const shareToken =
        new URLSearchParams(window.location.search).get('share') || '';

    if (!shareToken) return;

    try {
        const response = await fetch('photowedding/app.php', {
            method: 'POST',
            cache: 'no-store',
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache'
            },
            body: JSON.stringify({
                action: 'get_share_permission',
                share_token: shareToken
            })
        });

        const result = await response.json();

        if (!response.ok || !result.success) return;

     const previousPermission = Boolean(window.__SHARED_ALBUM_ALLOW_SAVE__);
window.__SHARED_ALBUM_ALLOW_SAVE__ = Boolean(result.allow_save);
updateGuestPermissionStatus();
setScreenshotProtection(!window.__SHARED_ALBUM_ALLOW_SAVE__);
updateLightboxDownloadAvailability();

// Chỉ thông báo khi chuyển từ OFF → ON
if (!previousPermission && window.__SHARED_ALBUM_ALLOW_SAVE__) {
    showToast('Chức năng này hoạt động tốt trên Safari Điện thoại.');
}

    } catch (error) {
        console.warn(
            'Không thể đồng bộ quyền lưu ảnh của link chia sẻ.',
            error
        );
    }
}

        async function updateAlbumSavePermission(albumId, allowSave) {
            const response = await fetch('photowedding/app.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'update_album_permission', album_id: albumId, allow_save: allowSave })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.message || 'Không thể cập nhật quyền lưu ảnh');
            }
            const album = state.savedAlbums.find(item => Number(item.databaseId) === Number(albumId));
            if (album) album.allowSave = Boolean(result.allow_save);
            if (isGuestSharedView() && (document.getElementById('folderId')?.value || '').trim() === (album?.id || '')) {
                const toolbarButtons = document.querySelectorAll('#toolbarZipBtn, #toolbarCopyBtn, #toolbarExportBtn');
                toolbarButtons.forEach(button => {
                    button.disabled = !allowSave;
                    button.style.opacity = allowSave ? '1' : '0.5';
                    button.title = allowSave ? '' : 'Album đang bị khóa lưu ảnh';
                });
            }
            return result;
        }

        function setActiveAlbumName(name) {
            const customerAlbumTitle = document.getElementById('customerAlbumTitle');
            if (customerAlbumTitle) customerAlbumTitle.textContent = name;
        }

        async function getDriveFolderName(folderId, forceRefresh = false) {
            const fallback = 'Album ' + folderId.substring(0, 8);
            let albumNames = {};
            try {
                albumNames = JSON.parse(localStorage.getItem(ALBUM_NAMES_KEY) || '{}');
                if (!forceRefresh && albumNames[folderId]) {
                    const cachedName = normalizeAlbumName(albumNames[folderId]);
                    albumNames[folderId] = cachedName;
                    localStorage.setItem(ALBUM_NAMES_KEY, JSON.stringify(albumNames));
                    return cachedName;
                }
            } catch (error) {
                console.warn('Không thể đọc tên album đã lưu.', error);
            }

            try {
                const response = await fetch(`photowedding/app.php?drive_proxy=meta&folder_id=${encodeURIComponent(folderId)}`);
                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`Google Drive API error (${response.status}): ${text.slice(0, 200)}`);
                }
                const result = await response.json();
                const name = typeof result.name === 'string' && result.name.trim() !== ''
                    ? normalizeAlbumName(result.name)
                    : fallback;
                albumNames[folderId] = name;
                localStorage.setItem(ALBUM_NAMES_KEY, JSON.stringify(albumNames));
                return name;
            } catch (error) {
                console.warn('Không thể lấy tên thư mục Google Drive.', error);
                throw new Error('Google Drive không thể truy cập. Kiểm tra GOOGLE_API_KEY, quyền chia sẻ folder và định dạng folder ID.');
            }
        }

        function getSavedAlbumPageCount() {
            return Math.max(1, Math.ceil(state.savedAlbums.length / state.savedAlbumPageSize));
        }

        function renderSavedAlbumPagination(totalPages) {
            const pager = document.getElementById('savedAlbumsPagination');
            if (!pager) return;
            if (totalPages <= 1) {
                pager.innerHTML = '';
                return;
            }

            const prevDisabled = state.savedAlbumPage <= 1 ? 'disabled' : '';
            const nextDisabled = state.savedAlbumPage >= totalPages ? 'disabled' : '';
            const pageButtons = Array.from({ length: totalPages }, (_, index) => {
                const pageNumber = index + 1;
                const activeClass = pageNumber === state.savedAlbumPage ? 'active' : '';
                return `<button type="button" class="saved-album-page-btn ${activeClass}" data-page="${pageNumber}" ${pageNumber === state.savedAlbumPage ? 'aria-current="page"' : ''}>${pageNumber}</button>`;
            }).join('');

            pager.innerHTML = `
                <button type="button" class="saved-album-page-btn" data-page="prev" ${prevDisabled} aria-label="Trang trước">‹</button>
                ${pageButtons}
                <button type="button" class="saved-album-page-btn" data-page="next" ${nextDisabled} aria-label="Trang sau">›</button>
            `;

            pager.querySelectorAll('.saved-album-page-btn').forEach(button => {
                button.addEventListener('click', () => {
                    const target = button.dataset.page;
                    if (!target || button.disabled) return;
                    if (target === 'prev') {
                        state.savedAlbumPage = Math.max(1, state.savedAlbumPage - 1);
                    } else if (target === 'next') {
                        state.savedAlbumPage = Math.min(totalPages, state.savedAlbumPage + 1);
                    } else {
                        state.savedAlbumPage = Number(target) || state.savedAlbumPage;
                    }
                    renderSavedAlbums();
                    refreshVisibleAlbumMetadata();
                });
            });
        }

        function renderSavedAlbums() {
            const list = document.getElementById('savedAlbumsList');
            const currentAlbumId = (document.getElementById('folderId')?.value || '').trim();
            const totalPages = getSavedAlbumPageCount();

            state.savedAlbumPage = Math.min(Math.max(1, state.savedAlbumPage), totalPages);

            const start = (state.savedAlbumPage - 1) * state.savedAlbumPageSize;
            const pageAlbums = state.savedAlbums.slice(start, start + state.savedAlbumPageSize);

            list.innerHTML = `
                ${pageAlbums.map(album => `
                <div class="saved-album-item ${currentAlbumId === album.id ? 'active' : ''}" aria-current="${currentAlbumId === album.id ? 'true' : 'false'}" onclick="selectSavedAlbum('${album.id}')">
                    <div class="saved-album-visual">
                        <div class="saved-album-thumb" data-album-id="${String(album.id)}">
                            ${album.cover ? `<img src="${album.cover}" referrerpolicy="no-referrer" loading="lazy" decoding="async" alt="${String(album.name || 'Album').replace(/"/g, '&quot;')}">` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;">📁</div>'}
                        </div>
                        <span class="saved-album-badge">Bìa</span>
                        <span class="saved-album-time">${formatSavedAlbumDate(album.createdAt)}</span>
                    </div>
                    <div class="saved-album-meta">
                        <strong>${album.name}</strong>
                        <div class="saved-album-permission-row">
                            <span class="saved-album-permission-status">${album.allowSave ? '✅ Khách được lưu' : '🔒 Khách không được lưu'}</span>
                            <button class="saved-album-share-btn" type="button" data-album-id="${album.id}" data-album-name="${String(album.name).replace(/"/g, '&quot;')}" data-tooltip="Chia sẻ album">🔗</button>
                            <div class="saved-album-permission">
                                <button
                                    type="button"
                                    class="album-toggle saved-album-toggle"
                                    data-album-id="${album.id}"
                                    data-album-database-id="${album.databaseId}"
                                    aria-label="Khách được lưu ảnh trong album ${String(album.name).replace(/"/g, '&quot;')}"
                                    aria-checked="${album.allowSave ? 'true' : 'false'}"
                                    data-tooltip="${album.allowSave ? 'Bật quyền lưu ảnh' : 'Tắt quyền lưu ảnh'}"
                                >
                                    <span class="slider"></span>
                                    <span class="toggle-label">${album.allowSave ? 'ON' : 'OFF'}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <input type="checkbox" class="saved-album-select" data-database-id="${album.databaseId}" onclick="event.stopPropagation()">
                </div>
            `).join('')}`;

            renderSavedAlbumPagination(totalPages);

            list.querySelectorAll('.saved-album-share-btn').forEach(button => {
                button.addEventListener('click', (event) => {
                    event.stopPropagation();
                    shareSavedAlbum(button.dataset.albumId, button.dataset.albumName || 'Album');
                });
            });

            list.querySelectorAll('.saved-album-toggle').forEach(toggle => {
                toggle.addEventListener('click', async (event) => {
                    event.stopPropagation();
                    const databaseId = Number(toggle.dataset.albumDatabaseId || 0);
                    const nextState = toggle.getAttribute('aria-checked') !== 'true';
                    toggle.setAttribute('aria-checked', String(nextState));
                    const label = toggle.querySelector('.toggle-label');
                    if (label) label.textContent = nextState ? 'ON' : 'OFF';
                    toggle.setAttribute('data-tooltip', nextState ? 'Bật quyền lưu ảnh' : 'Tắt quyền lưu ảnh');
                    const permissionToast = nextState
                        ? '✅ Đã mở quyền lưu ảnh cho khách'
                        : '🔒 Đã khóa quyền lưu ảnh cho khách';
                    showToast(permissionToast);
                    if (nextState) {
                        setTimeout(() => showToast('Chức năng này hoạt động tốt trên Safari Điện thoại.'), 350);
                    }
                    try {
                        await updateAlbumSavePermission(databaseId, nextState);
                        const match = state.savedAlbums.find(item => Number(item.databaseId) === Number(databaseId));
                        if (match) match.allowSave = nextState;
                        const permissionStatus = toggle.closest('.saved-album-item')?.querySelector('.saved-album-permission-status');
                        if (permissionStatus) permissionStatus.textContent = nextState ? '✅ Khách được lưu' : '🔒 Khách không được lưu';
                        if (isGuestSharedView() && (document.getElementById('folderId')?.value || '').trim() === (match?.id || '')) {
                            const toolbarButtons = document.querySelectorAll('#toolbarZipBtn, #toolbarCopyBtn, #toolbarExportBtn');
                            toolbarButtons.forEach(button => {
                                button.disabled = !nextState;
                                button.style.opacity = nextState ? '1' : '0.5';
                                button.title = nextState ? '' : 'Album đang bị khóa lưu ảnh';
                            });
                        }
                    } catch (error) {
                        const previousState = !nextState;
                        toggle.setAttribute('aria-checked', String(previousState));
                        toggle.setAttribute('data-tooltip', previousState ? 'Bật quyền lưu ảnh' : 'Tắt quyền lưu ảnh');
                        if (label) label.textContent = previousState ? 'ON' : 'OFF';
                        showToast(error.message || 'Không thể cập nhật quyền lưu ảnh');
                    }
                });
            });
        }

        async function addAlbumFromCard(event) {
            event.preventDefault();
            event.stopPropagation();

            const input = document.getElementById('savedAlbumAddInput');
            const submitButton = event.currentTarget.querySelector('button[type="submit"]');
            const link = input?.value.trim() || '';
            if (!link) return;

            document.getElementById('folderLink').value = link;
            submitButton.disabled = true;
            try {
                await saveConfig();
                if (input) input.value = '';
            } finally {
                submitButton.disabled = false;
            }
        }

        function parseDatabaseTimestamp(value) {
            const timestamp = String(value || '').trim();
            if (!timestamp) return null;
            const isoTimestamp = timestamp.includes('T') ? timestamp : timestamp.replace(' ', 'T');
            const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(isoTimestamp);
            const date = new Date(hasTimezone ? isoTimestamp : `${isoTimestamp}Z`);
            return Number.isNaN(date.getTime()) ? null : date;
        }

        function formatVietnamDateTime(value, includeSeconds = false) {
            const date = parseDatabaseTimestamp(value);
            if (!date) return String(value || '');
            const parts = new Intl.DateTimeFormat('vi-VN', {
                timeZone: 'Asia/Ho_Chi_Minh',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                ...(includeSeconds ? { second: '2-digit' } : {})
            }).formatToParts(date).reduce((result, part) => {
                result[part.type] = part.value;
                return result;
            }, {});
            const seconds = includeSeconds ? `:${parts.second}` : '';
            return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}${seconds}`;
        }

        function formatSavedAlbumDate(value) {
            return value ? formatVietnamDateTime(value) : 'Chưa có thời gian';
        }

        function shareSavedAlbum(id, albumName) {
            document.getElementById('folderId').value = id;
            CONFIG.DRIVE_FOLDER_ID = id;
            localStorage.setItem('driveFolderId', id);
            if (albumName) setActiveAlbumName(albumName);
            renderSavedAlbums();
            shareAlbum();
        }

async function selectSavedAlbum(id) {
    document.getElementById('folderId').value = id;
    CONFIG.DRIVE_FOLDER_ID = id;
    localStorage.setItem('driveFolderId', id);
    
    const album = state.savedAlbums.find(item => item.id === id);
    if (album) setActiveAlbumName(album.name);
    
    renderSavedAlbums();
    
    // XÓA CACHE TẠM CỦA ALBUM NÀY ĐỂ BẮT BUỘC TẢI MỚI HOÀN TOÀN TỪ DRIVE
    sessionStorage.removeItem(PHOTO_CACHE_PREFIX + id);
    
    // GỌI TẢI LẠI TOÀN BỘ ẢNH VÀ DỮ LIỆU MỚI NHẤT
    await loadPhotos();
}
        async function deleteSelectedAlbums() {
            const checked = [...document.querySelectorAll('.saved-album-select:checked')].map(c => Number(c.dataset.databaseId));
            if (!checked.length) return;
            await Promise.all(checked.map(albumId => fetch('photowedding/app.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'delete_album', album_id: albumId })
            })));
            document.querySelector('.saved-albums').classList.remove('delete-mode');
            document.getElementById('deletedAlbumsHistory').classList.add('visible');
            await loadUserAlbums();
            showToast('✅ Đã xóa các album đã chọn');
        }

        function renderDeletedAlbumsHistory() {
            const history = document.getElementById('deletedAlbumsHistory');
            if (!state.deletedAlbums.length) {
                history.innerHTML = '<p style="color:var(--secondary);font-size:0.78rem;">Chưa có album nào đã xóa.</p>';
                return;
            }
            history.innerHTML = state.deletedAlbums.map(album => `
                <div class="deleted-album-item">
                    <div class="deleted-album-meta">
                        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${album.name}</span>
                        <small class="deleted-album-expiry">Xóa vĩnh viễn ngày ${formatDeletedAlbumDate(album.deletedAt)}</small>
                    </div>
                    <button class="album-management-btn" type="button" data-restore-album="${album.databaseId}">Khôi phục</button>
                </div>
            `).join('');
            history.querySelectorAll('[data-restore-album]').forEach(button => {
                button.addEventListener('click', () => restoreDeletedAlbum(button.dataset.restoreAlbum));
            });
        }

        function formatDeletedAlbumDate(deletedAt) {
            const date = parseDatabaseTimestamp(deletedAt);
            if (!date) return String(deletedAt || '');
            return formatVietnamDateTime(new Date(date.getTime() + DELETED_ALBUM_TTL));
        }

        async function restoreDeletedAlbum(id) {
            const response = await fetch('photowedding/app.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'restore_album', album_id: Number(id) })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                showToast('❌ Không thể khôi phục album');
                return;
            }
            await loadUserAlbums();
            showToast('✅ Đã khôi phục album');
        }

        async function loadPhotos() {
            const folderId = CONFIG.DRIVE_FOLDER_ID;
            const cacheKey = PHOTO_CACHE_PREFIX + folderId;
            const loadVersion = ++albumLoadVersion;
            updateLightboxDownloadAvailability();
            state.photos = [];
            state.displayPhotos = [];
            state.selectedPhotos = new Set();
            state.commentCounts = {};
            allPhotoComments = null;
            state.currentFilter = 'all';
            state.currentCategory = 'all';
            state.currentSort = 'default';
            state.searchQuery = '';
            document.getElementById('searchInput').value = '';
            document.getElementById('categorySelect').value = 'all';
            document.getElementById('albumCategoryNav').classList.remove('visible');
            document.getElementById('sortSelect').value = 'default';
            document.querySelectorAll('.filter-btn, .stat-item').forEach(element => {
                element.classList.toggle('active', element.dataset.filter === 'all');
            });
            document.getElementById('toolbar').style.display = 'none';
            document.getElementById('statistics').style.display = 'none';
            document.getElementById('emptyState').style.display = 'none';
            updateStats();
            document.getElementById('loadingText').style.display = 'block';
            document.getElementById('photoGrid').style.display = 'none';

            try {
                const albumName = await getDriveFolderName(folderId);
                if (loadVersion !== albumLoadVersion) return;
                setActiveAlbumName(albumName);
                const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
                if (cached && cached.savedAt > Date.now() - PHOTO_CACHE_TTL) {
                    state.photos = (cached.photos || []).map(photo => ({
                        ...photo,
                        id: String(photo.id),
                        category: photo.category || albumName,
                        folderPath: Array.isArray(photo.folderPath) ? photo.folderPath : []
                    }));
                } else {
                    const deviceWidth = window.innerWidth;
                    const thumbnailSize = deviceWidth <= 600 ? 180 : (deviceWidth <= 1024 ? 320 : 640);
                    const files = await loadDriveImagesRecursively(folderId, new Set(), albumName);
                    if (loadVersion !== albumLoadVersion) return;

                    state.photos = files.map(f => ({
                        id: f.id,
                        name: f.name,
                        category: f.category || albumName,
                        folderPath: f.folderPath || [],
                        modifiedTime: f.modifiedTime,
                        size: Number(f.size || 0),
                        webContentLink: f.webContentLink || '',
                        thumbnailLink: f.thumbnailLink || '',
                        thumbnailUrl: f.thumbnailUrl || '',
                        fullUrl: f.fullUrl || '',
                        thumbnail: f.thumbnailUrl || `https://lh3.googleusercontent.com/d/${encodeURIComponent(f.id)}=w${thumbnailSize}`,
                        url: f.fullUrl || `https://lh3.googleusercontent.com/d/${encodeURIComponent(f.id)}=w2048`
                    }));
                    try {
                        sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), photos: state.photos }));
                    } catch (cacheError) {
                        console.warn('Không thể lưu cache danh sách ảnh.', cacheError);
                    }
                }

                if (loadVersion !== albumLoadVersion) return;
                populateCategorySelect();
                applyFilters();
                updateStats();
                document.getElementById('toolbar').style.display = 'flex';
                document.getElementById('statistics').style.display = 'grid';
                updateLightboxDownloadAvailability();
                showToast(`✅ Đã tải ${state.photos.length} ảnh`);
                
                // Đồng bộ và đếm chính xác bình luận cho đúng album hiện tại
                loadAllAlbumComments(loadVersion);

                sharedSelectionsReady = loadSharedSelections(folderId, loadVersion).then(() => {
                    if (loadVersion !== albumLoadVersion) return;
                    applyFilters();
                    updateStats();
                });
            } catch (err) {
                console.error(err);
                showDriveConfigError('Không thể kết nối Google Drive. Kiểm tra GOOGLE_API_KEY, chia sẻ thư mục và folder ID.', err);
            } finally {
                if (loadVersion === albumLoadVersion) {
                    document.getElementById('loadingText').style.display = 'none';
                }
            }
        }

        async function loadAllAlbumComments(loadVersion = albumLoadVersion) {
            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'load_all_comments' })
                });
                const result = await response.json();
                if (!response.ok || !result.success) return;
                if (loadVersion !== albumLoadVersion) return;
                
                allPhotoComments = result.data || [];
                // Tập hợp tất cả ID ảnh trong album đang mở
                const photoIdsInCurrentAlbum = new Set(state.photos.map(p => String(p.id)));

                // Tính toán số lượng bình luận CHỈ cho các ảnh thuộc album này
                const counts = {};
                let totalAlbumComments = 0;

                allPhotoComments.forEach(item => {
                    const pid = String(item.photo_id);
                    if (photoIdsInCurrentAlbum.has(pid)) {
                        counts[pid] = (counts[pid] || 0) + 1;
                        totalAlbumComments += 1;
                    }
                });

                state.commentCounts = counts;

                // Cập nhật lên thanh thống kê cho đúng album hiện tại
                const statCommentsEl = document.getElementById('statComments');
                if (statCommentsEl) {
                    statCommentsEl.textContent = totalAlbumComments;
                }

                // Cập nhật số đếm lên từng ảnh đang hiển thị
                state.photos.forEach(photo => {
                    updatePhotoCommentBadge(photo.id, counts[photo.id] || 0);
                });
            } catch (error) {
                console.warn('Không thể tải toàn bộ bình luận album.', error);
            }
        }

        function isAcceptedDriveImageFile(file) {
            const mimeType = String(file?.mimeType || '').toLowerCase();
            const fileName = String(file?.name || '').toLowerCase();
            if (mimeType.startsWith('image/')) return true;
            if (mimeType === 'application/octet-stream' || mimeType === 'image/x-raw' || mimeType === 'application/x-raw-image') return true;
            return /\.(3fr|arw|avif|bay|bmp|braw|cap|cin|cr2|cr3|crw|dcr|dib|dng|erf|exr|fff|gif|heic|heif|heifs|heix|hif|iiq|jpeg|jpg|jpe|jp2|j2k|k25|kdc|mef|mos|mrw|nef|nrw|orf|pbm|pcx|pef|png|psd|raf|raw|rle|rw2|rwl|sr2|srf|srw|svg|tga|tif|tiff|webp|x3f)$/i.test(fileName);
        }

        async function loadDriveImagesRecursively(folderId, visitedFolders = new Set(), albumName = '', folderPath = []) {
            if (visitedFolders.has(folderId)) return [];
            visitedFolders.add(folderId);

            const entries = [];
            let pageToken = '';
            do {
                const token = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '';
                const response = await fetch(`photowedding/app.php?drive_proxy=list&folder_id=${encodeURIComponent(folderId)}${token}`);
                if (!response.ok) {
                    const text = await response.text();
                    throw new Error(`Drive list error (${response.status}): ${text.slice(0, 200)}`);
                }
                const result = await response.json();
                if (result.error) throw new Error(result.error.message);
                entries.push(...(result.files || []));
                pageToken = result.nextPageToken || '';
            } while (pageToken);

            const images = entries
                .filter(entry => isAcceptedDriveImageFile(entry))
                .map(image => ({
                    ...image,
                    category: folderPath.length ? folderPath.join(' / ') : albumName,
                    folderPath: [...folderPath]
                }));
            const folders = entries.filter(entry => entry.mimeType === 'application/vnd.google-apps.folder');
            const nestedImages = await Promise.all(folders.map(folder => (
                    loadDriveImagesRecursively(folder.id, visitedFolders, albumName, [...folderPath, folder.name])
            )));
            return images.concat(...nestedImages);
        }

        function populateCategorySelect() {
            const select = document.getElementById('categorySelect');
            const categories = [...new Set(state.photos.map(photo => photo.category).filter(Boolean))];
            select.replaceChildren(new Option('Tất cả nhóm', 'all'));
            categories.forEach(category => select.add(new Option(category, category)));
            select.value = 'all';
            state.currentCategory = 'all';
            populateCategoryNav(categories);
        }










        function populateCategoryNav(categories) {
            const nav = document.getElementById('albumCategoryNav');
            nav.replaceChildren();
            if (categories.length < 2) {
                nav.classList.remove('visible');
                return;
            }

            const allCategories = ['all', ...categories];
            allCategories.forEach(category => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'album-category-btn' + (category === state.currentCategory ? ' active' : '');
                button.dataset.category = category;

                const count = category === 'all' 
                    ? state.photos.length 
                    : state.photos.filter(p => p.category === category).length;

                // Lấy phần tên thư mục cuối cùng sau dấu '/'
                const cleanName = category === 'all' ? 'Tất cả' : category.split('/').pop().trim();
                button.textContent = `${cleanName} (${count})`;
                button.title = `${cleanName} (${count})`;

                button.addEventListener('click', () => setCategoryFilter(category));
                nav.appendChild(button);
            });
            nav.classList.add('visible');
        }
        function setCategoryFilter(category) {
            state.currentCategory = category;
            document.getElementById('categorySelect').value = category;
            document.querySelectorAll('.album-category-btn').forEach(button => {
                button.classList.toggle('active', button.dataset.category === category);
            });
            applyFilters();
            updateStats();

            // Nếu bảng danh sách bình luận đang mở thì cập nhật lại theo đúng thư mục vừa chọn
            const panel = document.getElementById('commentSummaryPanel');
            if (panel && panel.classList.contains('open') && allPhotoComments) {
                renderCommentSummary(allPhotoComments);
            }
        }

        function renderPhotoGrid() {
            const grid = document.getElementById('photoGrid');
            const renderVersion = ++photoRenderVersion;
            if (!state.displayPhotos.length) {
                grid.style.display = 'none';
                document.getElementById('emptyState').style.display = 'block';
                return;
            }

            document.getElementById('emptyState').style.display = 'none';
            grid.style.display = 'grid';
            grid.replaceChildren();
            const batchSize = window.innerWidth <= 600 ? 12 : 24;

            const appendPhotoBatch = (startIndex) => {
                if (renderVersion !== photoRenderVersion) return;
                const batch = document.createDocumentFragment();
                const endIndex = Math.min(startIndex + batchSize, state.displayPhotos.length);
                for (let index = startIndex; index < endIndex; index += 1) {
                    const photo = state.displayPhotos[index];
                    if (index === 0 || state.displayPhotos[index - 1]?.category !== photo.category) {
                        const categoryHeading = document.createElement('div');
                        categoryHeading.className = 'photo-category-heading';
                        categoryHeading.textContent = photo.category || 'Album ảnh';
                        batch.appendChild(categoryHeading);
                    }
                    const item = document.createElement('div');
                    item.className = 'photo-item' + (state.selectedPhotos.has(photo.id) ? ' selected' : '');
                    item.setAttribute('data-photo-id', photo.id);
                    item.addEventListener('click', () => openLightbox(index));

                    const image = document.createElement('img');
                    image.referrerPolicy = 'no-referrer';
                    image.alt = photo.name;
                    image.loading = index < 6 ? 'eager' : 'lazy';
                    image.decoding = 'async';
                    if (index < 2) image.fetchPriority = 'high';
                    if (window.PhotoSelectAPI?.bindDriveImage) {
                        window.PhotoSelectAPI.bindDriveImage(image, photo, 'thumb');
                    } else {
                        image.src = photo.thumbnail;
                    }

                    const badge = document.createElement('div');
                    badge.className = 'photo-favorite-badge';
                    badge.textContent = '♥';
                    const name = document.createElement('div');
                    name.className = 'photo-name';
                    name.textContent = photo.name;
                    const commentCount = Number(state.commentCounts[photo.id] || 0);
                    const commentBadge = document.createElement('div');
                    commentBadge.className = 'photo-comment-count';
                    commentBadge.dataset.commentCountFor = photo.id;
                    commentBadge.hidden = commentCount < 1;
                    commentBadge.textContent = `💬 ${commentCount}`;
                    const heart = document.createElement('button');
                    heart.type = 'button';
                    heart.className = 'photo-heart';
                    heart.dataset.photoId = photo.id;
                    heart.setAttribute('aria-label', state.selectedPhotos.has(photo.id) ? 'Bỏ chọn ảnh' : 'Chọn ảnh');
                    heart.setAttribute('aria-pressed', String(state.selectedPhotos.has(photo.id)));
                    heart.textContent = state.selectedPhotos.has(photo.id) ? '❤️' : '🤍';
                    heart.addEventListener('click', (event) => {
                        event.stopPropagation();
                        toggleFavorite(photo.id);
                    });
                    const overlay = document.createElement('div');
                    overlay.className = 'photo-overlay';
                    const top = document.createElement('div');
                    top.className = 'photo-top';
                    const number = document.createElement('span');
                    number.className = 'photo-number';
                    number.textContent = '#' + (index + 1);
                    top.appendChild(number);
                    overlay.appendChild(top);
                    if (CONFIG.IS_SHARED_ALBUM) {
                        const downloadBtn = document.createElement('button');
                        downloadBtn.type = 'button';
                        downloadBtn.className = 'photo-download-btn';
                        downloadBtn.title = 'Tải ảnh gốc chất lượng cao nhất';
                        downloadBtn.setAttribute('aria-label', `Tải ảnh gốc ${photo.name || ''}`);
                        downloadBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m-5-5 5 5 5-5M4 15v4h16v-4"/></svg>';
                        downloadBtn.addEventListener('click', (event) => {
                            event.stopPropagation();
                            downloadOriginalPhotoFile(photo, { triggerButton: downloadBtn });
                        });
                        item.append(image, badge, name, commentBadge, downloadBtn, heart, overlay);
                    } else {
                        item.append(image, badge, name, commentBadge, heart, overlay);
                    }
                    batch.appendChild(item);
                }
                grid.appendChild(batch);
                if (endIndex < state.displayPhotos.length) {
                    requestAnimationFrame(() => appendPhotoBatch(endIndex));
                }
            };

            appendPhotoBatch(0);
        }

        function toggleFavorite(id) {
    id = String(id);
    quickFilterRunId += 1;
    if (state.selectedPhotos.has(id)) {
        state.selectedPhotos.delete(id);
    } else {
        state.selectedPhotos.add(id);
    }
    
    // Lưu ngay trạng thái chọn vào bộ nhớ/database
    saveSharedSelections(CONFIG.DRIVE_FOLDER_ID);
    updateStats();

    const nextSelected = state.selectedPhotos.has(id);

    document.querySelectorAll('.photo-heart').forEach(heart => {
        if (String(heart.dataset.photoId) !== String(id)) return;
        heart.textContent = nextSelected ? '❤️' : '🤍';
        heart.setAttribute('aria-label', nextSelected ? 'Bỏ chọn ảnh' : 'Chọn ảnh');
        heart.setAttribute('aria-pressed', String(nextSelected));
        heart.classList.add('animate');
        setTimeout(() => heart.classList.remove('animate'), 380);
    });

    document.querySelectorAll('.photo-item').forEach(photoItem => {
        if (String(photoItem.dataset.photoId) === String(id)) {
            photoItem.classList.toggle('selected', nextSelected);
        }
    });

    const currentLightboxPhoto = state.displayPhotos[state.currentLightboxIndex];
    const lightboxHeart = document.getElementById('lightboxHeart');
    if (lightboxHeart && currentLightboxPhoto && String(currentLightboxPhoto.id) === String(id)) {
        lightboxHeart.textContent = nextSelected ? '❤️' : '🤍';
        lightboxHeart.classList.add('animate');
        setTimeout(() => lightboxHeart.classList.remove('animate'), 380);
    }
}


        async function loadSharedSelections(folderId, loadVersion = albumLoadVersion) {
            if (!folderId) return;
            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'load_state',
                        keys: [`photoSelectionsByAlbum:${folderId}`]
                    })
                });
                const result = await response.json();
                if (loadVersion !== albumLoadVersion || folderId !== CONFIG.DRIVE_FOLDER_ID) return;
                const selected = result.data?.[`photoSelectionsByAlbum:${folderId}`];
                const albumPhotoIds = new Set(state.photos.map(photo => String(photo.id)));
                state.selectedPhotos = new Set(
                    (Array.isArray(selected) ? selected : [])
                        .map(id => String(id))
                        .filter(id => albumPhotoIds.has(id))
                );
            } catch (error) {
                console.warn('Không thể tải lựa chọn ảnh đã lưu.', error);
            }
        }

        function getSelectedPhotosMetaPayload() {
            return state.photos
                .filter(photo => state.selectedPhotos.has(String(photo.id)))
                .map(photo => ({
                    id: String(photo.id),
                    name: photo.name || '',
                    category: photo.category || 'Album'
                }));
        }

        function getCurrentGuestName() {
            const inputVal = document.getElementById('guestNameInput')?.value.trim();
            if (inputVal) return inputVal;
            if ((window.__APP_USER__ || {}).name) return window.__APP_USER__.name;
            return localStorage.getItem('photoSelectGuestName') || 'Khách xem album';
        }

        async function saveSharedSelections(folderId) {
            if (!folderId) return;
            const shareToken = new URLSearchParams(window.location.search).get('share') || '';
            try {
                await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'save_photo_selection',
                        folder_id: folderId,
                        share_token: shareToken,
                        guest_name: getCurrentGuestName(),
                        selected_photos: [...state.selectedPhotos],
                        photo_meta: getSelectedPhotosMetaPayload()
                    })
                });
            } catch (error) {
                console.warn('Không thể lưu lựa chọn ảnh.', error);
            }
        }

        async function confirmGuestSelectionSubmission() {
            const folderId = CONFIG.DRIVE_FOLDER_ID || document.getElementById('folderId')?.value.trim();
            if (!folderId) return;
            const shareToken = new URLSearchParams(window.location.search).get('share') || '';
            const btn = document.getElementById('confirmGuestSelectionBtn');
            if (btn) btn.disabled = true;
            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'confirm_guest_selection',
                        folder_id: folderId,
                        share_token: shareToken,
                        guest_name: getCurrentGuestName(),
                        selected_photos: [...state.selectedPhotos],
                        photo_meta: getSelectedPhotosMetaPayload()
                    })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error(result.message || 'Không thể gửi danh sách.');
                showToast(`✅ ${result.message || 'Đã gửi danh sách ảnh đã chọn cho Studio!'}`);
            } catch (error) {
                showToast(`❌ ${error.message || 'Không thể gửi danh sách ảnh.'}`);
            } finally {
                if (btn) btn.disabled = false;
            }
        }

function updateStats() {
    const visibleAlbumPhotos = state.currentCategory === 'all'
        ? state.photos
        : state.photos.filter(photo => photo.category === state.currentCategory);
    
    const total = visibleAlbumPhotos.length;
    const selected = visibleAlbumPhotos.reduce(
        (count, photo) => count + (state.selectedPhotos.has(String(photo.id)) ? 1 : 0),
        0
    );

    // Cập nhật các con số lên giao diện
    document.getElementById('statTotal').textContent = total;
    document.getElementById('statSelected').textContent = selected;
    document.getElementById('statUnselected').textContent = total - selected;
    
    // ĐỒNG BỘ HIỂN THỊ SỐ LƯỢNG VÀO NÚT LỌC ẢNH NHANH VÀ BỘ LỌC
    document.getElementById('selectedFilterCount').textContent = selected;
    document.getElementById('copiedCount').textContent = selected; // Thay thế số 0 mặc định thành số thực tế

    // Cập nhật số lượng bình luận theo đúng thư mục con đang xem
    const visiblePhotoIds = new Set(visibleAlbumPhotos.map(p => String(p.id)));
    let visibleCommentsCount = 0;
    if (allPhotoComments) {
        visibleCommentsCount = allPhotoComments.filter(c => visiblePhotoIds.has(String(c.photo_id))).length;
    } else {
        visibleAlbumPhotos.forEach(p => {
            visibleCommentsCount += Number(state.commentCounts[p.id] || 0);
        });
    }
    const statCommentsEl = document.getElementById('statComments');
    if (statCommentsEl) statCommentsEl.textContent = visibleCommentsCount;

    const bottomBar = document.getElementById('bottomBar');
    document.getElementById('bottomBarCount').textContent = selected;
    bottomBar.classList.toggle('show', selected > 0);
}


        function applyFilters() {
            let list = [...state.photos];
            if (state.searchQuery) {
                list = list.filter(p => p.name.toLowerCase().includes(state.searchQuery));
            }
            if (state.currentCategory !== 'all') {
                list = list.filter(p => p.category === state.currentCategory);
            }
            if (state.currentFilter === 'selected') {
                list = list.filter(p => state.selectedPhotos.has(p.id));
            } else if (state.currentFilter === 'unselected') {
                list = list.filter(p => !state.selectedPhotos.has(p.id));
            }
            state.displayPhotos = list;
            renderPhotoGrid();
        }

        function handleSearch(e) {
            state.searchQuery = e.target.value.toLowerCase().trim();
            applyFilters();
        }

        function handleSort(e) {
            const val = e.target.value;
            if (val === 'name-asc') state.displayPhotos.sort((a, b) => a.name.localeCompare(b.name));
            if (val === 'name-desc') state.displayPhotos.sort((a, b) => b.name.localeCompare(a.name));
            renderPhotoGrid();
        }

        function openLightbox(index, transitionDirection = 0) {
            state.currentLightboxIndex = index;
            const photo = state.displayPhotos[index];
            if (!photo) return;
            const lightboxImage = document.getElementById('lightboxImage');
            if (transitionDirection !== 0) {
                lightboxImage.classList.remove('is-switching-next', 'is-switching-prev');
                void lightboxImage.offsetWidth;
                lightboxImage.classList.add(transitionDirection > 0 ? 'is-switching-next' : 'is-switching-prev');
                window.setTimeout(() => lightboxImage.classList.remove('is-switching-next', 'is-switching-prev'), 320);
            }
            lightboxScale = 1;
            lightboxTranslateX = 0;
            lightboxTranslateY = 0;
            lightboxImage.style.transformOrigin = 'center center';
            updateLightboxZoom();
            closeLightboxDownloadMenu();
            document.getElementById('lightboxDownloadStatus').textContent = '';
            updateLightboxDownloadAvailability();
            const photoId = String(photo.id);
            lightboxImage.dataset.photoId = photoId;
            lightboxImage.referrerPolicy = 'no-referrer';
            lightboxImage.alt = photo.name || 'Ảnh album';
            if (window.PhotoSelectAPI?.bindDriveImage) {
                window.PhotoSelectAPI.bindDriveImage(lightboxImage, photo, 'full', () => {
                    showToast('Không thể tải ảnh xem trước');
                });
            } else {
                lightboxImage.onerror = () => {
                    lightboxImage.onerror = null;
                    showToast('Không thể tải ảnh xem trước');
                };
                lightboxImage.src = photo.thumbnail;

                const fullResolutionImage = new Image();
                fullResolutionImage.decoding = 'async';
                fullResolutionImage.fetchPriority = 'high';
                fullResolutionImage.referrerPolicy = 'no-referrer';
                fullResolutionImage.src = photo.url;
                fullResolutionImage.decode().then(() => {
                    if (lightboxImage.dataset.photoId === photoId) {
                        lightboxImage.src = photo.url;
                    }
                }).catch(() => {});
            }

            document.getElementById('lightboxPhotoNumber').textContent = `#${index + 1}`;
            document.getElementById('lightboxCaption').textContent = photo.name || 'Ảnh album';
            const dlCurrentBtn = document.getElementById('downloadCurrentLightboxPhoto');
            if (dlCurrentBtn) {
                const sizeText = formatPhotoBytes(photo.size);
                dlCurrentBtn.textContent = sizeText
                    ? `⬇️ Tải ảnh gốc (${sizeText})`
                    : '⬇️ Tải ảnh gốc (Chất lượng cao nhất)';
            }
            document.getElementById('lightboxCommentInput').value = '';
            document.getElementById('lightboxHeart').textContent = state.selectedPhotos.has(photo.id) ? '❤️' : '🤍';
            document.getElementById('lightbox').classList.add('active');
            preloadLightboxNeighbors(index, transitionDirection);
            loadPhotoComments(photo.id);
        }

        function closeLightboxDownloadMenu() {
            const menu = document.getElementById('lightboxDownloadMenu');
            const toggle = document.getElementById('lightboxDownloadToggle');
            menu?.classList.remove('is-open');
            toggle?.setAttribute('aria-expanded', 'false');
        }

        function updateLightboxDownloadAvailability() {
            const isAllowed = getCurrentAlbumPermission();
            const shouldHideDownloads = isGuestSharedView() && !isAllowed;
            document.body.classList.toggle('guest-save-disabled', shouldHideDownloads);
            [
                document.getElementById('toolbarZipBtn'),
                document.getElementById('lightboxDownloadWrap')
            ].forEach(control => {
                if (!control) return;
                control.hidden = shouldHideDownloads;
                control.style.display = shouldHideDownloads ? 'none' : '';
            });
            const guestDownloadActions = document.getElementById('guestDownloadActions');
            if (guestDownloadActions) {
                const showGuestDownloads = CONFIG.IS_SHARED_ALBUM && isAllowed;
                guestDownloadActions.hidden = !showGuestDownloads;
                guestDownloadActions.style.display = showGuestDownloads ? 'flex' : 'none';
            }
            const controls = [
                document.getElementById('lightboxDownloadToggle'),
                document.getElementById('downloadCurrentLightboxPhoto'),
                document.getElementById('downloadCurrentPhotoDirectDrive'),
                document.getElementById('downloadSharedAlbum'),
                document.getElementById('guestDownloadSelectedBtn'),
                document.getElementById('guestDownloadAllBtn')
            ];
            controls.forEach(control => {
                if (!control) return;
                control.disabled = !isAllowed;
                control.title = isAllowed ? '' : 'Chủ album chưa bật quyền lưu ảnh';
            });
            if (!isAllowed) closeLightboxDownloadMenu();
        }

        function isMobileDownloadBlocked() {
            return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
                || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        }

        function showMobileDownloadNotice() {
            document.getElementById('mobileDownloadNoticeModal').classList.add('active');
        }

        function formatPhotoBytes(bytes) {
            const num = Number(bytes || 0);
            if (!Number.isFinite(num) || num <= 0) return '';
            if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
            if (num >= 1024) return `${Math.round(num / 1024)} KB`;
            return `${num} B`;
        }

        function buildSanitizedPhotoFilename(photo, fallbackIndex = 1) {
            return String(photo?.name || `anh-${fallbackIndex}`)
                .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
        }

        function getDirectGoogleDriveDownloadUrl(photo) {
            if (!photo) return '';
            if (window.PhotoSelectAPI?.getDriveOriginalDownloadUrl) {
                return window.PhotoSelectAPI.getDriveOriginalDownloadUrl(photo);
            }
            if (photo.webContentLink) return String(photo.webContentLink);
            return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(String(photo.id || ''))}`;
        }

        function triggerBrowserBlobDownload(blob, filename) {
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = filename;
            link.rel = 'noopener';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            window.setTimeout(() => {
                link.remove();
                URL.revokeObjectURL(objectUrl);
            }, 60000);
        }

        async function fetchOriginalDrivePhotoBlob(photo) {
            if (typeof photo?.fullUrl === 'string' && photo.fullUrl.startsWith('data:')) {
                const res = await fetch(photo.fullUrl);
                return res.blob();
            }
            if (window.PhotoSelectAPI?.isMockMode && window.PhotoSelectAPI.isMockMode()) {
                return window.PhotoSelectAPI.driveDownloadBlob(photo.id);
            }
            const filename = buildSanitizedPhotoFilename(photo);
            const url = `photowedding/app.php?drive_proxy=download&file_id=${encodeURIComponent(photo.id)}&filename=${encodeURIComponent(filename)}${getSharedDownloadQuery()}`;
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const blob = await response.blob();
            if (!blob || (blob.type && /text\/html/i.test(blob.type))) {
                throw new Error('Drive returned HTML instead of image');
            }
            return blob;
        }

        async function downloadOriginalPhotoFile(photo, { statusEl = null, triggerButton = null } = {}) {
            if (!ensureAlbumAllowsSave('tải ảnh')) return;
            if (!photo) return;
            const filename = buildSanitizedPhotoFilename(photo, state.currentLightboxIndex + 1);
            const sizeLabel = formatPhotoBytes(photo.size);
            const prevHtml = triggerButton ? triggerButton.innerHTML : '';
            if (triggerButton) {
                triggerButton.disabled = true;
                if (triggerButton.classList.contains('photo-download-btn')) {
                    triggerButton.textContent = '⏳';
                }
            }
            if (statusEl) {
                statusEl.textContent = sizeLabel
                    ? `Đang tải ảnh gốc (${sizeLabel})...`
                    : 'Đang tải ảnh gốc chất lượng cao nhất...';
            }

            try {
                const blob = await fetchOriginalDrivePhotoBlob(photo);
                const actualSize = formatPhotoBytes(blob.size) || sizeLabel;
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '')
                    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

                if (isIOS && navigator.canShare && typeof File === 'function') {
                    try {
                        const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({ files: [file], title: filename });
                            if (statusEl) statusEl.textContent = `✅ Đã lưu ảnh gốc (${actualSize || 'Full'}).`;
                            return;
                        }
                    } catch (shareErr) {
                        if (shareErr?.name === 'AbortError') {
                            if (statusEl) statusEl.textContent = 'Đã hủy lưu ảnh.';
                            return;
                        }
                    }
                }

                triggerBrowserBlobDownload(blob, filename);
                if (statusEl) statusEl.textContent = `✅ Đã tải ảnh gốc (${actualSize || 'Full'}).`;
            } catch (error) {
                console.warn('Tải qua API gặp lỗi, chuyển sang link tải trực tiếp từ Google Drive:', error);
                const directUrl = getDirectGoogleDriveDownloadUrl(photo);
                if (directUrl && !String(photo.id || '').startsWith('img-')) {
                    window.open(directUrl, '_blank', 'noopener,noreferrer');
                    if (statusEl) statusEl.textContent = '↗️ Đã mở link tải file gốc trực tiếp từ Google Drive.';
                } else {
                    if (statusEl) statusEl.textContent = '❌ Không thể tải ảnh gốc. Vui lòng thử lại.';
                }
            } finally {
                if (triggerButton) {
                    triggerButton.disabled = false;
                    triggerButton.innerHTML = prevHtml;
                }
            }
        }

        function downloadCurrentLightboxPhoto() {
            if (!ensureAlbumAllowsSave('tải ảnh')) return;
            const photo = state.displayPhotos[state.currentLightboxIndex];
            if (!photo) return;
            const status = document.getElementById('lightboxDownloadStatus');
            const button = document.getElementById('downloadCurrentLightboxPhoto');
            downloadOriginalPhotoFile(photo, { statusEl: status, triggerButton: button });
        }

        function downloadCurrentPhotoDirectDrive() {
            if (!ensureAlbumAllowsSave('tải ảnh')) return;
            const photo = state.displayPhotos[state.currentLightboxIndex];
            if (!photo) return;
            const status = document.getElementById('lightboxDownloadStatus');
            const directUrl = getDirectGoogleDriveDownloadUrl(photo);
            if (!directUrl || String(photo.id || '').startsWith('img-')) {
                downloadCurrentLightboxPhoto();
                return;
            }
            window.open(directUrl, '_blank', 'noopener,noreferrer');
            if (status) status.textContent = '↗️ Đã mở trang tải gốc trực tiếp từ Google Drive.';
        }

        async function downloadGuestSelectedPhotos() {
            if (!ensureAlbumAllowsSave('tải ảnh')) return;
            const selected = state.photos.filter(photo => state.selectedPhotos.has(String(photo.id)));
            if (!selected.length) {
                window.alert('Bạn chưa chọn (thả tim ❤️) ảnh nào. Hãy thả tim các ảnh muốn tải hoặc bấm "Tải toàn bộ album".');
                return;
            }
            if (selected.length === 1) {
                const btn = document.getElementById('guestDownloadSelectedBtn');
                await downloadOriginalPhotoFile(selected[0], { triggerButton: btn });
                return;
            }
            if (isMobileDownloadBlocked()) {
                if (selected.length <= 5) {
                    const btn = document.getElementById('guestDownloadSelectedBtn');
                    for (let i = 0; i < selected.length; i += 1) {
                        await downloadOriginalPhotoFile(selected[i], { triggerButton: btn });
                        if (i < selected.length - 1) {
                            await new Promise(resolve => window.setTimeout(resolve, 400));
                        }
                    }
                    return;
                }
                showMobileDownloadNotice();
                return;
            }
            await downloadSelectedPhotosAsZip(selected);
        }

        function sanitizeZipEntrySegment(value, fallback = 'anh') {
            const normalized = String(value || '')
                .normalize('NFKD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
                .replace(/\s+/g, '_')
                .replace(/_+/g, '_')
                .replace(/^_+|_+$/g, '')
                .replace(/[. ]+$/g, '');
            return normalized || fallback;
        }

        function getAlbumSubfolderPaths(photos) {
            const paths = new Map();
            photos.forEach(photo => {
                const folderPath = Array.isArray(photo.folderPath) ? photo.folderPath : [];
                folderPath.forEach((folderName, index) => {
                    const path = folderPath.slice(0, index + 1);
                    paths.set(JSON.stringify(path), path);
                });
            });
            return [...paths.values()].sort((first, second) => first.join(' / ').localeCompare(second.join(' / '), 'vi'));
        }

        function showAlbumFolderDownloadChooser(folderPaths) {
            const list = document.getElementById('albumFolderList');
            list.replaceChildren();
            folderPaths.forEach(folderPath => {
                const label = document.createElement('label');
                label.className = 'album-folder-option';
                label.style.paddingInlineStart = `${(folderPath.length - 1) * 18}px`;

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = true;
                checkbox.value = JSON.stringify(folderPath);

                const name = document.createElement('span');
                name.textContent = folderPath.join(' / ');
                label.append(checkbox, name);
                list.appendChild(label);
            });

            const selectAll = document.getElementById('albumFolderSelectAll');
            selectAll.checked = true;
            selectAll.indeterminate = false;
            document.getElementById('albumFolderSelectionStatus').textContent =
                'Ảnh ở thư mục album sẽ được lưu trực tiếp cùng các thư mục con đã chọn.';
            document.getElementById('albumFolderDownloadModal').classList.add('active');
        }

        function syncAlbumFolderSelectAll() {
            const checkboxes = [...document.querySelectorAll('#albumFolderList input[type="checkbox"]')];
            const checkedCount = checkboxes.filter(checkbox => checkbox.checked).length;
            const selectAll = document.getElementById('albumFolderSelectAll');
            selectAll.checked = checkedCount === checkboxes.length;
            selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
        }

        function closeAlbumFolderDownloadChooser() {
            document.getElementById('albumFolderDownloadModal').classList.remove('active');
        }

        async function startAlbumFolderDownload() {
            if (!ensureAlbumAllowsSave('tải ảnh')) return;
            if (isMobileDownloadBlocked()) {
                closeAlbumFolderDownloadChooser();
                showMobileDownloadNotice();
                return;
            }
            const selectedPaths = [...document.querySelectorAll('#albumFolderList input[type="checkbox"]:checked')]
                .map(checkbox => JSON.parse(checkbox.value));
            const photos = state.photos.filter(photo => {
                const folderPath = Array.isArray(photo.folderPath) ? photo.folderPath : [];
                return folderPath.length === 0 || selectedPaths.some(selectedPath => (
                    selectedPath.length <= folderPath.length
                    && selectedPath.every((segment, index) => segment === folderPath[index])
                ));
            });

            if (!photos.length) {
                document.getElementById('albumFolderSelectionStatus').textContent = 'Chưa chọn thư mục nào có ảnh để tải.';
                return;
            }

            closeAlbumFolderDownloadChooser();
            document.getElementById('zipProgressModal').classList.add('active');
            await downloadSelectedPhotosAsZip(photos);
        }

        async function downloadSharedAlbum() {
            if (!ensureAlbumAllowsSave('tải ảnh')) return;
            if (isMobileDownloadBlocked()) {
                closeLightboxDownloadMenu();
                showMobileDownloadNotice();
                return;
            }
            if (!state.photos.length) return;
            closeLightboxDownloadMenu();
            const folderPaths = getAlbumSubfolderPaths(state.photos);
            if (folderPaths.length) {
                showAlbumFolderDownloadChooser(folderPaths);
                return;
            }
            document.getElementById('zipProgressModal').classList.add('active');
            await downloadSelectedPhotosAsZip(state.photos);
        }

        function preloadLightboxNeighbors(index, direction = 1) {
            const offsets = direction < 0 ? [-1, -2] : [1, 2];
            offsets.forEach(offset => {
                const photo = state.displayPhotos[index + offset];
                if (!photo || photo.preloaded) return;
                const image = new Image();
                image.decoding = 'async';
                image.fetchPriority = 'low';
                image.src = photo.url;
                photo.preloaded = true;
            });
        }

        function getTouchDistance(touches) {
            const x = touches[0].clientX - touches[1].clientX;
            const y = touches[0].clientY - touches[1].clientY;
            return Math.sqrt(x * x + y * y);
        }

        function getTouchMidpoint(touches) {
            return {
                x: (touches[0].clientX + touches[1].clientX) / 2,
                y: (touches[0].clientY + touches[1].clientY) / 2
            };
        }

        function zoomLightboxImage(amount) {
            lightboxScale = Math.min(4, Math.max(1, lightboxScale + amount));
            updateLightboxZoom();
        }

        function updateLightboxZoom() {
            const image = document.getElementById('lightboxImage');
            image.style.transform = `translate3d(${lightboxTranslateX}px, ${lightboxTranslateY}px, 0) scale(${lightboxScale})`;
        }

        function changeLightboxPhoto(direction) {
            const nextIdx = state.currentLightboxIndex + direction;
            if (nextIdx >= 0 && nextIdx < state.displayPhotos.length) {
                openLightbox(nextIdx, direction);
            }
        }

        async function loadPhotoComments(photoId) {
            const comments = document.getElementById('lightboxComments');
            comments.textContent = 'Đang tải bình luận...';
            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'load_comments', photo_id: photoId })
                });
                const result = await response.json();
                state.commentCounts[photoId] = Array.isArray(result.data) ? result.data.length : 0;
                updatePhotoCommentBadge(photoId, state.commentCounts[photoId]);
                comments.replaceChildren();
                if (!result.data?.length) {
                    comments.textContent = 'Chưa có bình luận nào.';
                    return;
                }
                result.data.forEach(comment => {
                    const item = document.createElement('div');
                    item.className = 'lightbox-comment';
                    const author = document.createElement('strong');
                    author.textContent = comment.author || (comment.user_id ? 'Người dùng' : 'Khách');
                    const text = document.createElement('span');
                    text.textContent = ': ' + comment.comment_text;
                    item.append(author, text);
                    comments.appendChild(item);
                });
            } catch (error) {
                comments.textContent = 'Không thể tải bình luận.';
            }
        }

        function updatePhotoCommentBadge(photoId, count) {
            document.querySelectorAll('.photo-comment-count').forEach(badge => {
                if (badge.dataset.commentCountFor === String(photoId)) {
                    badge.textContent = `💬 ${count}`;
                    badge.hidden = count < 1;
                }
            });
        }

        async function submitPhotoComment(event) {
            event.preventDefault();
            const photo = state.displayPhotos[state.currentLightboxIndex];
            const input = document.getElementById('lightboxCommentInput');
            const text = input.value.trim();
            if (!photo || !text) return;

            // --- BẮT ĐẦU CẬP NHẬT TỨC THÌ TRỰC TIẾP (OPTIMISTIC UPDATE) ---
            const currentCount = Number(state.commentCounts[photo.id] || 0) + 1;
            state.commentCounts[photo.id] = currentCount;
            updatePhotoCommentBadge(photo.id, currentCount);

            const statCommentsEl = document.getElementById('statComments');
            if (statCommentsEl) {
                const totalCurrent = parseInt(statCommentsEl.textContent, 10) || 0;
                statCommentsEl.textContent = totalCurrent + 1;
            }

            const currentUser = (window.__APP_USER__ || {});
            const authorName = currentUser.name || (currentUser.id ? 'Người dùng' : 'Khách');

            const commentsContainer = document.getElementById('lightboxComments');
            if (commentsContainer) {
                if (commentsContainer.textContent.includes('Chưa có bình luận') || commentsContainer.textContent.includes('Đang tải')) {
                    commentsContainer.replaceChildren();
                }
                const newCommentItem = document.createElement('div');
                newCommentItem.className = 'lightbox-comment';
                const authorEl = document.createElement('strong');
                authorEl.textContent = authorName;
                const textEl = document.createElement('span');
                textEl.textContent = ': ' + text;
                newCommentItem.append(authorEl, textEl);
                commentsContainer.appendChild(newCommentItem);
                commentsContainer.scrollTop = commentsContainer.scrollHeight;
            }

            if (allPhotoComments) {
                allPhotoComments.push({
                    photo_id: photo.id,
                    author: authorName,
                    comment_text: text
                });
                renderCommentSummary(allPhotoComments);
            }

            input.value = '';
            // --- KẾT THÚC CẬP NHẬT TỨC THÌ ---

            try {
                const response = await fetch('photowedding/app.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'save_comment', photo_id: photo.id, comment_text: text })
                });
                const result = await response.json();
                if (!response.ok || !result.success) throw new Error('comment failed');
                loadPhotoComments(photo.id);
            } catch (error) {
                showToast('❌ Không thể gửi bình luận');
            }
        }

        function getExportText() {
            const selected = state.photos.filter(photo => state.selectedPhotos.has(String(photo.id)));
            if (!selected.length) return '';
            const digitCounts = getExportDigitCounts();
            if (!digitCounts.length) return '';
            return selected
                .map(photo => formatExportPhoto(photo, digitCounts))
                .filter(Boolean)
                .join(getExportSeparator());
        }

        function getExportDigitCounts() {
            return [...document.querySelectorAll('input[name="exportDigitCount"]:checked')]
                .map(input => Number(input.value))
                .filter(count => [3, 4, 5, 6].includes(count))
                .sort((first, second) => first - second);
        }

        function getExportSeparator() {
            const separatorValue = document.getElementById('exportSeparator').value;
            if (separatorValue === 'custom') {
                return document.getElementById('exportCustomSeparator').value || ', ';
            }
            if (separatorValue === '\\n') return '\n';
            if (separatorValue === '\\t') return '\t';
            return separatorValue;
        }

        function formatExportPhoto(photo, digitCounts) {
            const fileName = String(photo.name || '');
            const digits = (fileName.match(/\d+/g) || []).join('');
            const codes = digits
                ? digitCounts.map(count => digits.slice(-count).padStart(count, '0'))
                : [];
            const includeName = document.getElementById('exportIncludeName').checked;
            const codeText = codes.join(' / ');
            if (includeName) return codeText ? `${codeText} - ${fileName}` : fileName;
            return codeText;
        }

        function updateExportPreview() {
            const preview = document.getElementById('exportPreview');
            if (!preview) return;
            const selected = state.photos
                .filter(photo => state.selectedPhotos.has(String(photo.id)))
                .slice(0, 3);
            const digitCounts = getExportDigitCounts();
            if (!digitCounts.length) {
                preview.textContent = 'Hãy chọn ít nhất một độ dài mã số.';
                return;
            }
            if (!selected.length) {
                preview.textContent = 'Chọn ảnh yêu thích để xem trước.';
                return;
            }
            const examples = selected
                .map(photo => formatExportPhoto(photo, digitCounts))
                .filter(Boolean);
            const separator = getExportSeparator();
            preview.textContent = examples.join(separator) || 'Ảnh đã chọn không có mã số để xuất.';
            if (state.photos.filter(photo => state.selectedPhotos.has(String(photo.id))).length > selected.length) {
                preview.textContent += `${separator}...`;
            }
        }

        function getExportEmptyMessage() {
            if (!getExportDigitCounts().length) return '⚠️ Hãy chọn ít nhất một độ dài mã số';
            const hasSelectedPhotos = state.photos.some(photo => state.selectedPhotos.has(String(photo.id)));
            if (!hasSelectedPhotos) return '⚠️ Chưa có ảnh nào được chọn';
            if (!document.getElementById('exportIncludeName').checked) {
                return '⚠️ Ảnh đã chọn không có mã số; hãy bật tùy chọn kèm tên file';
            }
            return '⚠️ Không có nội dung phù hợp để xuất';
        }

        async function copyExport() {
            if (!ensureAlbumAllowsSave('copy dữ liệu')) return;
            const text = getExportText();
            if (!text) {
                showToast(getExportEmptyMessage());
                return;
            }
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    textarea.remove();
                }
                document.getElementById('exportModal').classList.remove('active');
                showToast('✅ Đã copy danh sách ảnh');
            } catch (error) {
                showToast('❌ Không thể copy danh sách');
            }
        }

        async function copySelectedNumbers() {
            if (!ensureAlbumAllowsSave('copy dữ liệu')) return;
            const text = getExportText();
            if (!text) {
                showToast('⚠️ Chưa có ảnh nào được chọn');
                return;
            }
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    textarea.remove();
                }
                showCopyDialog(`✅ Đã copy ${state.selectedPhotos.size} số ảnh`);
            } catch (error) {
                showToast('❌ Không thể copy danh sách');
            }
        }

        function getFavoriteFileNames() {
            return state.photos
                .filter(photo => state.selectedPhotos.has(String(photo.id)))
                .map(photo => String(photo.name || '').trim())
                .filter(Boolean);
        }

        function normalizeQuickFilterName(fileName) {
            const name = String(fileName || '').trim().normalize('NFC').toLocaleLowerCase();
            const extensionIndex = name.lastIndexOf('.');
            const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
            return stem.replace(/[\s._-]+/g, '');
        }

        function normalizeQuickFilterFullName(fileName) {
            const name = String(fileName || '').trim().normalize('NFC').toLocaleLowerCase();
            const extensionIndex = name.lastIndexOf('.');
            const stem = extensionIndex > 0 ? name.slice(0, extensionIndex) : name;
            return stem.replace(/[\s._-]+/g, '');
        }

        async function openQuickFilter() {
    if (!ensureAlbumAllowsSave('lọc và lưu ảnh')) return;
    quickFilterRunId += 1;
    resetActionCounter();
    
    // Đảm bảo đồng bộ dữ liệu chọn mới nhất trước khi hiển thị số liệu lên bảng lọc
    await sharedSelectionsReady;

    const favoriteFileNames = getFavoriteFileNames();
    const selectedCount = favoriteFileNames.length;
    
    const summary = document.getElementById('quickFilterSummary');
    const status = document.getElementById('quickFilterStatus');
    
    summary.textContent = selectedCount
        ? `${selectedCount} tên file ảnh yêu thích hiện tại sẽ được so sánh chính xác với ảnh trong thư mục nguồn.`
        : 'Chưa có ảnh yêu thích nào được chọn để so sánh tên file.';
        
    status.textContent = window.showDirectoryPicker
        ? ''
        : 'Trình duyệt hiện tại không hỗ trợ chọn thư mục. Hãy dùng Chrome hoặc Edge.';
    status.classList.remove('error');
    
    document.getElementById('quickFilterStart').disabled = false;
    status.classList.toggle('error', !window.showDirectoryPicker);
    document.getElementById('quickFilterModal').classList.add('active');
}

        function closeQuickFilter() {
            document.getElementById('quickFilterModal').classList.remove('active');
        }

        async function chooseQuickFilterSource() {
            if (!window.showDirectoryPicker) return;
            try {
                quickFilterSourceHandle = await window.showDirectoryPicker({ mode: 'read' });
                const sourceName = document.getElementById('quickFilterSourceName');
                sourceName.textContent = `Đã chọn thư mục: ${quickFilterSourceHandle.name}`;
                sourceName.title = quickFilterSourceHandle.name;
            } catch (error) {
                quickFilterSourceHandle = null;
            }
        }

        async function chooseQuickFilterDestination() {
            if (!window.showDirectoryPicker) return;
            try {
                // Chỉ xin quyền đọc khi chọn; quyền ghi sẽ được xin đúng lúc bắt đầu copy.
                quickFilterDestinationHandle = await window.showDirectoryPicker({ mode: 'read' });
                const destinationName = document.getElementById('quickFilterDestinationName');
                destinationName.textContent = `Đã chọn thư mục: ${quickFilterDestinationHandle.name}`;
                destinationName.title = quickFilterDestinationHandle.name;
            } catch (error) {
                quickFilterDestinationHandle = null;
            }
        }

        async function ensureQuickFilterPermission(directoryHandle, mode) {
            if (!directoryHandle || typeof directoryHandle.queryPermission !== 'function') return true;
            const options = { mode };
            let permission = await directoryHandle.queryPermission(options);
            if (permission === 'granted') return true;
            if (typeof directoryHandle.requestPermission !== 'function') return false;
            permission = await directoryHandle.requestPermission(options);
            return permission === 'granted';
        }

        function showQuickFilterStatus(message, isError = false) {
            const status = document.getElementById('quickFilterStatus');
            status.textContent = message;
            status.classList.toggle('error', isError);
        }

        function resetActionCounter() {
            document.getElementById('copiedCount').textContent = '0';
        }

        function isImageFile(fileName) {
            return /\.(3fr|arw|avif|bay|bmp|braw|cap|cin|cr2|cr3|crw|dcr|dib|dng|erf|exr|fff|gif|heic|heif|heifs|heix|hif|iiq|jpeg|jpg|jpe|jp2|j2k|k25|kdc|mef|mos|mrw|nef|nrw|orf|pbm|pcx|pef|png|psd|raf|raw|rle|rw2|rwl|sr2|srf|srw|svg|tga|tif|tiff|webp|x3f)$/i.test(fileName);
        }

        async function collectQuickFilterFiles(directoryHandle) {
            const files = [];
            for await (const entry of directoryHandle.values()) {
                if (entry.kind === 'file') {
                    files.push(entry);
                } else if (entry.kind === 'directory') {
                    files.push(...await collectQuickFilterFiles(entry));
                }
            }
            return files;
        }

        async function copyQuickFilterFile(fileHandle, destinationHandle) {
            const file = await fileHandle.getFile();
            const targetHandle = await destinationHandle.getFileHandle(file.name, { create: true });
            const writable = await targetHandle.createWritable();
            try {
                await writable.write(file);
            } finally {
                await writable.close();
            }
        }

        function downloadQuickFilterErrorReport(missingNames = [], copyErrors = [], generalErrors = []) {
            const lines = [
                'BÁO CÁO LỖI LỌC ẢNH NHANH',
                `Thời gian: ${new Date().toLocaleString('vi-VN')}`,
                ''
            ];
            if (missingNames.length) {
                lines.push(`KHÔNG TÌM THẤY (${missingNames.length}):`);
                missingNames.forEach(name => lines.push(`- ${name}`));
                lines.push('');
            }
            if (copyErrors.length) {
                lines.push(`COPY LỖI (${copyErrors.length}):`);
                copyErrors.forEach(error => lines.push(`- ${error}`));
                lines.push('');
            }
            if (generalErrors.length) {
                lines.push('LỖI HỆ THỐNG:');
                generalErrors.forEach(error => lines.push(`- ${error}`));
            }

            const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `bao-cao-loi-loc-anh-${Date.now()}.txt`;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => {
                URL.revokeObjectURL(link.href);
                link.remove();
            }, 1200);
        }

async function startQuickFilter() {
    if (!ensureAlbumAllowsSave('lọc và lưu ảnh')) return;
    resetActionCounter();
    await sharedSelectionsReady;
    
    const favoriteFileNames = getFavoriteFileNames();
    if (!favoriteFileNames.length) {
        showQuickFilterStatus('Chưa có tên file từ ảnh yêu thích để lọc.', true);
        return;
    }
    if (!quickFilterSourceHandle || !quickFilterDestinationHandle) {
        showQuickFilterStatus('Vui lòng chọn cả thư mục nguồn và thư mục lưu.', true);
        return;
    }

    const startButton = document.getElementById('quickFilterStart');
    const runId = ++quickFilterRunId;
    let missingNames = [];
    const copyErrors = [];
    startButton.disabled = true;
    
    try {
        const canReadSource = await ensureQuickFilterPermission(quickFilterSourceHandle, 'read');
        const canWriteDestination = await ensureQuickFilterPermission(quickFilterDestinationHandle, 'readwrite');
        if (!canReadSource || !canWriteDestination) {
            throw new Error('Chưa được cấp quyền truy cập thư mục.');
        }

        showQuickFilterStatus('Đang quét danh sách ảnh trong thư mục nguồn...');
        const sourceFiles = await collectQuickFilterFiles(quickFilterSourceHandle);
        if (runId !== quickFilterRunId) return;
        
        const sourceFilesByFullName = new Map();
        const sourceFilesByName = new Map();
        sourceFiles.forEach(fileHandle => {
            const fullName = normalizeQuickFilterFullName(fileHandle.name);
            const exactFiles = sourceFilesByFullName.get(fullName) || [];
            exactFiles.push(fileHandle);
            sourceFilesByFullName.set(fullName, exactFiles);
            const normalizedName = normalizeQuickFilterName(fileHandle.name);
            const matchingFiles = sourceFilesByName.get(normalizedName) || [];
            matchingFiles.push(fileHandle);
            sourceFilesByName.set(normalizedName, matchingFiles);
        });
        
        const usedSourceFiles = new Set();
        const successfulCopiedNames = []; // Mảng lưu tên các file đã copy thành công
        
        const matchedFiles = favoriteFileNames
            .map(favoriteName => {
                const exactFiles = sourceFilesByFullName.get(normalizeQuickFilterFullName(favoriteName)) || [];
                const stemFiles = sourceFilesByName.get(normalizeQuickFilterName(favoriteName)) || [];
                const fileHandle = [...exactFiles, ...stemFiles]
                    .find(candidate => !usedSourceFiles.has(candidate)) || null;
                if (fileHandle) usedSourceFiles.add(fileHandle);
                return { favoriteName, fileHandle };
            });
            
        missingNames = matchedFiles
            .filter(item => !item.fileHandle)
            .map(item => item.favoriteName);
        const filesToCopy = matchedFiles
            .map(item => item.fileHandle)
            .filter(Boolean);
            
        const totalToProcess = favoriteFileNames.length;

        if (!filesToCopy.length) {
            downloadQuickFilterErrorReport(missingNames);
            document.getElementById('copiedCount').textContent = '0 / ' + totalToProcess;
            showQuickFilterStatus('Đã lọc và tìm thấy 0 / ' + totalToProcess + ' ảnh trong thư mục nguồn. Đã tải báo cáo lỗi .txt.', true);
            return;
        }
        
        let copiedCount = 0;
        for (let index = 0; index < filesToCopy.length; index += 1) {
            if (runId !== quickFilterRunId) return;
            
            showQuickFilterStatus('Đang copy (' + (copiedCount + 1) + ' / ' + totalToProcess + '): ' + filesToCopy[index].name);
            
            try {
                await copyQuickFilterFile(filesToCopy[index], quickFilterDestinationHandle);
                copiedCount += 1;
                successfulCopiedNames.push(filesToCopy[index].name);
                
                document.getElementById('copiedCount').textContent = copiedCount + ' / ' + totalToProcess;
            } catch (error) {
                copyErrors.push(filesToCopy[index].name + ': ' + (error.message || 'Không thể copy file'));
            }
        }
        
        if (runId !== quickFilterRunId) return;
        
        // TỰ ĐỘNG TẠO FILE .TXT LẤY TÊN THEO TÊN HIỂN THỊ ALBUM VÀO THƯ MỤC LƯU
        if (successfulCopiedNames.length > 0 && typeof quickFilterDestinationHandle.getFileHandle === 'function') {
            try {
                showQuickFilterStatus('Đang tạo file kết quả .txt trong thư mục lưu...');
                
                // Lấy tên album hiện tại và làm sạch ký tự đặc biệt để làm tên file an toàn
                const rawAlbumName = (document.getElementById('albumName')?.textContent || '').trim() || 'danh-sach-anh';
                const sanitizedAlbumName = rawAlbumName
                    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
                    .replace(/\s+/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_+|_+$/g, '') || 'danh-sach-anh';
                
                const resultFileName = sanitizedAlbumName + '.txt';
                const resultFileHandle = await quickFilterDestinationHandle.getFileHandle(resultFileName, { create: true });
                const writable = await resultFileHandle.createWritable();
                
                const reportContent = [
                    'DANH SÁCH ẢNH ĐÃ LỌC - ' + rawAlbumName,
                    'Thời gian: ' + new Date().toLocaleString('vi-VN'),
                    'Tổng số ảnh đã copy: ' + copiedCount + ' / ' + totalToProcess,
                    '----------------------------------------',
                    ...successfulCopiedNames
                ].join('\n');
                
                await writable.write(reportContent);
                await writable.close();
            } catch (txtError) {
                console.warn('Không thể tự động tạo file .txt vào thư mục đích.', txtError);
            }
        }

        if (missingNames.length || copyErrors.length) {
            downloadQuickFilterErrorReport(missingNames, copyErrors);
        }
        
        showQuickFilterStatus('Hoàn tất! Đã lọc, copy thành công ' + copiedCount + ' / ' + totalToProcess + ' ảnh và tạo file .txt kết quả.');
        showToast('✅ Đã lọc thành công ' + copiedCount + ' / ' + totalToProcess + ' ảnh');
    } catch (error) {
        console.warn('Không thể lọc và copy ảnh.', error);
        downloadQuickFilterErrorReport(missingNames, copyErrors, [error.message || 'Không thể lọc ảnh']);
        showQuickFilterStatus('Lọc ảnh gặp lỗi. Đã tải báo cáo lỗi .txt.', true);
    } finally {
        if (runId === quickFilterRunId) {
            startButton.disabled = false;
        }
    }
}

        function downloadExport() {
            const text = getExportText();
            if (!text) {
                showToast(getExportEmptyMessage());
                return;
            }
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'danh-sach-anh.txt';
            a.click();
            document.getElementById('exportModal').classList.remove('active');
            showToast('✅ Đã tải danh sách .txt');
        }

        function openZipSetup() {
            if (!ensureAlbumAllowsSave('tải ảnh')) return;
            if (isMobileDownloadBlocked()) {
                showMobileDownloadNotice();
                return;
            }
            resetActionCounter();
            const selected = state.photos.filter(photo => state.selectedPhotos.has(String(photo.id)));
            if (!selected.length) {
                showToast('⚠️ Chưa có ảnh nào được chọn để tải');
                return;
            }
            startZipDownload();
        }

        function closeZipSetup() {
            document.getElementById('zipSetupModal').classList.remove('active');
        }

        async function startZipDownload() {
            if (!ensureAlbumAllowsSave('tải ảnh')) return;
            if (isMobileDownloadBlocked()) {
                document.getElementById('zipSetupModal').classList.remove('active');
                showMobileDownloadNotice();
                return;
            }
            resetActionCounter();
            const selected = state.photos.filter(photo => state.selectedPhotos.has(String(photo.id)));
            if (!selected.length) {
                showToast('⚠️ Chưa có ảnh nào được chọn');
                return;
            }

            document.getElementById('zipSetupModal').classList.remove('active');
            document.getElementById('zipProgressModal').classList.add('active');
            await downloadSelectedPhotosAsZip(selected);
        }

        async function downloadSelectedPhotosAsZip(selected) {
            if (!selected.length) return;

            const button = document.getElementById('toolbarZipBtn');
            const progressModal = document.getElementById('zipProgressModal');
            const albumName = (document.getElementById('customerAlbumTitle')?.textContent || CONFIG.ALBUM_NAME || '').trim() || 'album';
            const archiveName = `${sanitizeZipEntrySegment(albumName, 'album')}.zip`;
            document.getElementById('zipProgressTitle').textContent = 'Đang đóng gói ảnh';
            document.getElementById('zipProgressWarning').textContent = 'Ảnh gốc và cấu trúc thư mục con sẽ được giữ trong một file ZIP.';
            if (button) button.disabled = true;
            if (progressModal) progressModal.classList.add('active');
            updateZipProgress(0, 'Đang chuẩn bị đóng gói ảnh...');

            try {
                if (typeof JSZip !== 'function') throw new Error('Thư viện đóng gói ZIP chưa được tải.');

                const results = new Array(selected.length);
                let downloaded = 0;
                let nextIndex = 0;
                const concurrency = Math.min(6, selected.length);
                const fetchZipPhoto = async photo => {
                    const downloadUrl = `photowedding/app.php?drive_proxy=download&file_id=${encodeURIComponent(photo.id)}${getSharedDownloadQuery()}`;
                    for (let attempt = 0; attempt < 3; attempt += 1) {
                        let response;
                        try {
                            response = await fetch(downloadUrl, { cache: 'no-store' });
                        } catch (error) {
                            if (attempt === 2) throw new Error(`Lỗi mạng khi tải ${photo.name || 'ảnh'}: ${error.message || 'không kết nối được'}`);
                            await new Promise(resolve => window.setTimeout(resolve, 400 * (2 ** attempt)));
                            continue;
                        }

                        if (response.ok) {
                            const contentType = response.headers.get('content-type') || '';
                            if (/text\/html/i.test(contentType)) {
                                throw new Error(`Google Drive trả về trang xác nhận thay vì ảnh: ${photo.name || 'ảnh'}`);
                            }
                            return response.blob();
                        }

                        const errorText = await response.text().catch(() => '');
                        const downloadError = new Error(errorText || `Không thể tải ${photo.name || 'ảnh'} (HTTP ${response.status})`);
                        const canRetry = response.status === 408 || response.status === 429 || response.status >= 500;
                        if (!canRetry || attempt === 2) throw downloadError;
                        await new Promise(resolve => window.setTimeout(resolve, 400 * (2 ** attempt)));
                    }
                    throw new Error(`Không thể tải ${photo.name || 'ảnh'}`);
                };
                const workers = Array.from({ length: concurrency }, async () => {
                    while (true) {
                        const currentIndex = nextIndex++;
                        if (currentIndex >= selected.length) return;
                        const photo = selected[currentIndex];
                        results[currentIndex] = {
                            filename: sanitizeZipEntrySegment(photo.name || `anh-${currentIndex + 1}`),
                            folderPath: Array.isArray(photo.folderPath) ? photo.folderPath : [],
                            blob: await fetchZipPhoto(photo)
                        };
                        downloaded += 1;
                        updateZipProgress(Math.round(downloaded / selected.length * 70), `Đã tải ${downloaded}/${selected.length} ảnh gốc`);
                    }
                });
                await Promise.all(workers);

                const zip = new JSZip();
                const usedEntryNames = new Set();
                results.forEach(item => {
                    const folderSegments = item.folderPath.map(folder => sanitizeZipEntrySegment(folder, 'thu_muc'));
                    const extensionIndex = item.filename.lastIndexOf('.');
                    const stem = extensionIndex > 0 ? item.filename.slice(0, extensionIndex) : item.filename;
                    const extension = extensionIndex > 0 ? item.filename.slice(extensionIndex) : '';
                    let filename = item.filename;
                    let entryName = [...folderSegments, filename].join('/');
                    let suffix = 1;
                    while (usedEntryNames.has(entryName.toLocaleLowerCase())) {
                        filename = `${stem}_${suffix}${extension}`;
                        entryName = [...folderSegments, filename].join('/');
                        suffix += 1;
                    }
                    usedEntryNames.add(entryName.toLocaleLowerCase());
                    zip.file(entryName, item.blob);
                });

                updateZipProgress(75, 'Đang tạo file ZIP...');
                const archive = await zip.generateAsync(
                    { type: 'blob', mimeType: 'application/zip', compression: 'STORE' },
                    metadata => updateZipProgress(75 + Math.round(metadata.percent * 0.25), 'Đang hoàn tất file ZIP...')
                );
                const url = URL.createObjectURL(archive);
                const link = document.createElement('a');
                link.href = url;
                link.download = archiveName;
                link.rel = 'noopener';
                link.style.display = 'none';
                document.body.appendChild(link);
                link.click();
                updateZipProgress(100, `Đã tạo xong ${archiveName}`);
                window.setTimeout(() => {
                    link.remove();
                    URL.revokeObjectURL(url);
                }, 60000);
            } catch (error) {
                console.error(error);
                document.getElementById('zipProgressStatus').textContent = `Không thể tạo file ZIP: ${error.message || 'lỗi không xác định'}`;
            } finally {
                if (button) button.disabled = false;
                resetActionCounter();
                if (progressModal) window.setTimeout(() => progressModal.classList.remove('active'), 1200);
            }
        }

        async function uploadFavoritePhotosToDrive() {
            if (!ensureAlbumAllowsSave('sao chép / lưu ảnh')) return;
            const selected = state.photos.filter(photo => state.selectedPhotos.has(String(photo.id)));
            const folderLinkInput = document.getElementById('driveUploadFolderLink');
            const rawFolderValue = (folderLinkInput?.value || '').trim();
            const folderId = extractFolderIdFromUrl(rawFolderValue) || (CONFIG.DRIVE_FOLDER_ID || '').trim();

            if (!selected.length) {
                showDriveUploadStatus('Chưa có ảnh nào được chọn để upload.', true);
                return;
            }

            if (!folderId) {
                showDriveUploadStatus('Vui lòng nhập link thư mục đích hợp lệ.', true);
                return;
            }

            const button = document.getElementById('driveUploadStart');
            button.disabled = true;
            showDriveUploadStatus(`Đang chuẩn bị sao chép ${selected.length} ảnh...`);

            try {
                let copiedCount = 0;
                for (const [index, photo] of selected.entries()) {
                    showDriveUploadStatus(`Đang sao chép ảnh ${index + 1}/${selected.length}: ${photo.name}`);
                    const response = await fetch(CONFIG.COPY_SCRIPT_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                        body: JSON.stringify({
                            folderId,
                            photoIds: [photo.id],
                            photoNames: [photo.name]
                        })
                    });
                    const responseText = await response.text();
                    let result = null;
                    try {
                        result = responseText.trim() !== '' ? JSON.parse(responseText) : null;
                    } catch (parseError) {
                        throw new Error(`Ảnh ${photo.name}: phản hồi không hợp lệ từ Apps Script.`);
                    }
                    if (!result) {
                        throw new Error(response.ok
                            ? `Ảnh ${photo.name}: Apps Script không trả về kết quả.`
                            : `Ảnh ${photo.name}: Apps Script lỗi HTTP ${response.status}.`);
                    }
                    if (!response.ok || !result.success || Number(result.copied || 0) !== 1) {
                        throw new Error(result.message || `Không thể sao chép ảnh ${photo.name}.`);
                    }
                    copiedCount += 1;
                }

                showDriveUploadStatus(`Đã sao chép ${copiedCount}/${selected.length} ảnh vào thư mục ẢNH YÊU THÍCH.`);
                showToast(`✅ Đã sao chép ${copiedCount}/${selected.length} ảnh`);
                setTimeout(() => closeDriveUploadModal(), 600);
            } catch (error) {
                showDriveUploadStatus(error.message || 'Không thể upload ảnh.', true);
            } finally {
                button.disabled = false;
            }
        }

        function openDriveUploadModal() {
            if (!ensureAlbumAllowsSave('sao chép / lưu ảnh')) return;
            const input = document.getElementById('driveUploadFolderLink');
            const folderId = (CONFIG.DRIVE_FOLDER_ID || '').trim();
            input.value = folderId ? `https://drive.google.com/drive/folders/${folderId}` : '';
            showDriveUploadStatus('');
            document.getElementById('driveUploadModal').classList.add('active');
            input.focus();
        }

        function closeDriveUploadModal() {
            document.getElementById('driveUploadModal').classList.remove('active');
        }

        function closeDrivePermissionGuide() {
            document.getElementById('drivePermissionGuideModal').classList.remove('active');
        }

        function showDriveUploadStatus(message, isError = false) {
            const status = document.getElementById('driveUploadStatus');
            status.textContent = message;
            status.classList.toggle('error', isError);
            status.classList.toggle('success', !isError && message.trim() !== '');
        }

        function triggerDirectDownload(blob, filename) {
            if (!ensureAlbumAllowsSave('lưu ảnh')) return;
            const url = URL.createObjectURL(blob);
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

            if (isIOS) {
                const popup = window.open(url, '_blank', 'noopener,noreferrer');
                if (!popup) {
                    window.location.href = url;
                }
                setTimeout(() => URL.revokeObjectURL(url), 1500);
                return;
            }

            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.rel = 'noopener';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => {
                link.remove();
                URL.revokeObjectURL(url);
            }, 1500);
        }

        function updateZipProgress(percent, status) {
            const progress = Math.max(0, Math.min(100, Math.round(percent)));
            document.getElementById('zipProgressFill').style.width = `${progress}%`;
            document.getElementById('zipProgressPercent').textContent = `${progress}%`;
            document.getElementById('zipProgressStatus').textContent = status;
            document.getElementById('zipProgressTrack').setAttribute('aria-valuenow', progress);
        }

        function showToast(msg) {
            if (CONFIG.IS_SHARED_ALBUM && isGuestSharedView()) return;
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        }

        function showCopyDialog(message) {
            document.querySelector('.copy-dialog')?.remove();
            const dialog = document.createElement('div');
            dialog.className = 'copy-dialog';
            dialog.textContent = message;
            document.body.appendChild(dialog);
            setTimeout(() => dialog.remove(), 1000);
        }
    