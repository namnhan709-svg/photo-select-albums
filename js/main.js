/**
 * Khởi tạo sự kiện DOM và chạy ứng dụng Dashboard Album.
 */
(function bootstrapApp(global) {
    const { state, showMessage } = global.PhotoSelectApp;
    const Theme = global.PhotoSelectTheme;
    const Notifications = global.PhotoSelectNotifications;
    const Dialog = global.PhotoSelectDialog;
    const Albums = global.PhotoSelectAlbums;
    const Viewer = global.PhotoSelectViewer;
    const Export = global.PhotoSelectExport;
    const Chat = global.PhotoSelectChat;

    document.getElementById('refreshBtn').addEventListener('click', Albums.loadAlbums);

    document.querySelectorAll('[data-dashboard-dialog]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            Dialog.openDashboardDialog(button.dataset.dashboardDialog);
        });
    });

    document.getElementById('dashboardDialogBody').addEventListener('click', event => {
        const sectionButton = event.target.closest('[data-dashboard-setting-section]');
        if (sectionButton) {
            Dialog.renderDashboardSettingsSection(sectionButton.dataset.dashboardSettingSection);
            return;
        }
        const themeButton = event.target.closest('[data-dashboard-theme-option]');
        if (themeButton) Theme.setDashboardTheme(themeButton.dataset.dashboardThemeOption);
    });

    document.getElementById('dashboardDialogBody').addEventListener('submit', Dialog.handlePasswordSubmit);

    document.getElementById('userPanel').addEventListener('click', event => {
        if (event.target.closest('[data-dashboard-dialog], .account-action')) return;
        const isOpen = event.currentTarget.classList.toggle('open');
        event.currentTarget.setAttribute('aria-expanded', String(isOpen));
        document.getElementById('dashboardNotificationMenu').classList.remove('is-open');
        document.getElementById('dashboardNotificationButton').setAttribute('aria-expanded', 'false');
    });

    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.addEventListener('click', event => {
            if (link.hasAttribute('data-dashboard-dialog')) {
                document.querySelectorAll('.sidebar-link').forEach(item => item.removeAttribute('aria-current'));
                link.setAttribute('aria-current', 'page');
                return;
            }
            const href = link.getAttribute('href');
            if (!href || href.startsWith('#')) {
                event.preventDefault();
            }
        });
    });

    document.getElementById('dashboardDialogClose').addEventListener('click', () => {
        document.getElementById('dashboardDialog').classList.remove('is-open');
    });
    document.getElementById('dashboardDialog').addEventListener('click', event => {
        if (event.target.id === 'dashboardDialog') event.currentTarget.classList.remove('is-open');
    });

    document.getElementById('dashboardNotificationButton').addEventListener('click', event => {
        event.stopPropagation();
        const menu = document.getElementById('dashboardNotificationMenu');
        const isOpen = menu.classList.toggle('is-open');
        event.currentTarget.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) Notifications.renderDashboardNotifications();
        document.getElementById('userPanel').classList.remove('open');
        document.getElementById('userPanel').setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('click', event => {
        const albumsGrid = document.getElementById('albumsGrid');
        if (!event.target.closest('.album-settings')) {
            albumsGrid.querySelectorAll('.album-settings.is-open').forEach(settings => {
                settings.classList.remove('is-open');
                settings.querySelector('.album-settings-button')?.setAttribute('aria-expanded', 'false');
            });
        }

        const userPanel = document.getElementById('userPanel');
        if (!userPanel?.contains(event.target)) {
            userPanel?.classList.remove('open');
            userPanel?.setAttribute('aria-expanded', 'false');
        }

        const notificationMenu = document.getElementById('dashboardNotificationMenu');
        const notificationButton = document.getElementById('dashboardNotificationButton');
        if (!notificationMenu?.contains(event.target) && event.target !== notificationButton) {
            notificationMenu?.classList.remove('is-open');
            notificationButton?.setAttribute('aria-expanded', 'false');
        }
    });

    // Viewer & Filters
    document.getElementById('closeViewerBtn').addEventListener('click', () => {
        document.getElementById('albumViewer').classList.remove('is-visible');
    });
    document.getElementById('viewerSearch').addEventListener('input', Viewer.renderViewerPhotos);
    document.getElementById('viewerCategory').addEventListener('change', event => {
        state.viewerCategory = event.target.value;
        Viewer.renderViewerPhotos();
    });
    document.getElementById('viewerSort').addEventListener('change', event => {
        state.viewerSort = event.target.value;
        Viewer.renderViewerPhotos();
    });
    document.querySelectorAll('[data-viewer-filter]').forEach(button => {
        button.addEventListener('click', () => {
            state.viewerFilter = button.dataset.viewerFilter;
            document.querySelectorAll('[data-viewer-filter]').forEach(item => item.classList.toggle('is-active', item === button));
            Viewer.renderViewerPhotos();
        });
    });

    // Download & Export
    document.getElementById('viewerDownloadBtn').addEventListener('click', async () => {
        const button = document.getElementById('viewerDownloadBtn');
        button.classList.add('is-active');
        try {
            await Export.downloadViewerSelection();
        } finally {
            global.setTimeout(() => button.classList.remove('is-active'), 350);
        }
    });
    document.getElementById('viewerZipProgressClose').addEventListener('click', () => {
        Export.closeViewerZipProgress();
        document.getElementById('albumViewerStatus').textContent = 'Đã hủy quá trình tải xuống.';
    });
    document.getElementById('viewerExportBtn').addEventListener('click', Export.openViewerExportDialog);
    document.getElementById('viewerExportCancel').addEventListener('click', Export.closeViewerExportDialog);
    document.getElementById('viewerExportCopy').addEventListener('click', Export.copyViewerExportText);
    document.getElementById('viewerExportDownload').addEventListener('click', Export.exportViewerText);
    document.getElementById('viewerExportModal').addEventListener('click', event => {
        if (event.target.id === 'viewerExportModal') Export.closeViewerExportDialog();
    });
    document.getElementById('viewerExportModal').addEventListener('input', Export.updateViewerExportPreview);
    document.getElementById('viewerExportModal').addEventListener('change', event => {
        if (event.target.id === 'viewerExportSeparator') {
            const customSeparator = document.getElementById('viewerExportCustomSeparator');
            customSeparator.hidden = event.target.value !== 'custom';
            if (!customSeparator.hidden) customSeparator.focus();
        }
        Export.updateViewerExportPreview();
    });

    // Comments & Guest Selections & Lightbox
    document.getElementById('viewerGuestSelectionsToggle').addEventListener('click', event => {
        const panel = document.getElementById('viewerGuestSelectionsPanel');
        const open = panel.classList.toggle('is-visible');
        event.currentTarget.classList.toggle('is-active', open);
    });
    document.getElementById('viewerRefreshSelectionsBtn').addEventListener('click', Viewer.refreshViewerSelections);
    document.getElementById('viewerCommentsToggle').addEventListener('click', event => {
        const panel = document.getElementById('viewerCommentsPanel');
        const open = panel.classList.toggle('is-visible');
        event.currentTarget.classList.toggle('is-active', open);
    });
    document.getElementById('viewerLightboxClose').addEventListener('click', () => {
        document.getElementById('viewerLightbox').classList.remove('is-open');
    });
    document.getElementById('viewerLightboxHeart').addEventListener('click', () => {
        if (!state.viewerLightboxFile) return;
        const fileId = String(state.viewerLightboxFile.id);
        if (state.selectedViewerFiles.has(fileId)) state.selectedViewerFiles.delete(fileId);
        else state.selectedViewerFiles.add(fileId);
        Viewer.saveViewerSelections();
        Viewer.syncViewerLightboxHeart();
        Viewer.renderViewerPhotos();
    });
    document.getElementById('viewerLightboxPrev').addEventListener('click', () => Viewer.changeViewerLightboxPhoto(-1));
    document.getElementById('viewerLightboxNext').addEventListener('click', () => Viewer.changeViewerLightboxPhoto(1));
    document.getElementById('viewerLightbox').addEventListener('click', event => {
        if (event.target.id === 'viewerLightbox') event.currentTarget.classList.remove('is-open');
    });
    document.getElementById('viewerLightboxImage').addEventListener('touchstart', event => {
        const touch = event.changedTouches[0];
        state.viewerTouchStartX = touch.clientX;
        state.viewerTouchStartY = touch.clientY;
    }, { passive: true });
    document.getElementById('viewerLightboxImage').addEventListener('touchend', event => {
        const touch = event.changedTouches[0];
        const distanceX = touch.clientX - state.viewerTouchStartX;
        const distanceY = touch.clientY - state.viewerTouchStartY;
        if (Math.abs(distanceX) < 55 || Math.abs(distanceX) < Math.abs(distanceY) * 1.2) return;
        event.preventDefault();
        Viewer.changeViewerLightboxPhoto(distanceX < 0 ? 1 : -1);
    }, { passive: false });
    document.getElementById('viewerLightbox').addEventListener('wheel', event => {
        if (event.ctrlKey) event.preventDefault();
    }, { passive: false });
    document.getElementById('viewerLightbox').addEventListener('gesturestart', event => event.preventDefault());
    document.getElementById('viewerLightbox').addEventListener('gesturechange', event => event.preventDefault());
    document.getElementById('viewerLightbox').addEventListener('gestureend', event => event.preventDefault());

    document.addEventListener('keydown', event => {
        const lightbox = document.getElementById('viewerLightbox');
        if (!lightbox.classList.contains('is-open')) return;
        if (event.ctrlKey && ['+', '-', '=', '0'].includes(event.key)) {
            event.preventDefault();
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault();
            Viewer.changeViewerLightboxPhoto(-1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            Viewer.changeViewerLightboxPhoto(1);
        } else if (event.key === 'Escape') {
            lightbox.classList.remove('is-open');
        }
    });
    document.getElementById('viewerCommentForm').addEventListener('submit', Viewer.submitViewerComment);

    // Quick Filter
    document.getElementById('openTxtLocalFilterBtn')?.addEventListener('click', () => {
        Export.openQuickFilter({ preferViewerSelections: false });
    });
    document.getElementById('viewerComputerFilterBtn')?.addEventListener('click', () => {
        Export.openQuickFilter({ preferViewerSelections: true });
    });
    document.getElementById('quickFilterTxtBtn')?.addEventListener('click', () => {
        document.getElementById('quickFilterTxtInput')?.click();
    });
    document.getElementById('quickFilterTxtInput')?.addEventListener('change', async event => {
        const file = event.target.files?.[0];
        if (file) await Export.loadQuickFilterTxtFile(file);
        event.target.value = '';
    });
    document.getElementById('quickFilterUseSelectedBtn')?.addEventListener('click', Export.fillQuickFilterFromViewer);
    document.getElementById('quickFilterTxtArea')?.addEventListener('input', Export.syncQuickFilterListCount);
    document.getElementById('quickFilterAutoSubfolder')?.addEventListener('change', Export.toggleQuickFilterSubfolderMode);
    document.getElementById('quickFilterSourceBtn').addEventListener('click', () => Export.chooseQuickFilterFolder('source'));
    document.getElementById('quickFilterDestinationBtn').addEventListener('click', () => Export.chooseQuickFilterFolder('destination'));
    document.getElementById('quickFilterStart').addEventListener('click', Export.startQuickFilter);
    document.getElementById('quickFilterClose').addEventListener('click', () => {
        document.getElementById('quickFilterModal').classList.remove('is-open');
    });
    document.getElementById('quickFilterModal')?.addEventListener('click', event => {
        if (event.target.id === 'quickFilterModal') event.currentTarget.classList.remove('is-open');
    });

    // Share Modal
    document.getElementById('shareWithoutCodeBtn').addEventListener('click', () => Albums.createShareLink(''));
    document.getElementById('shareWithCodeBtn').addEventListener('click', () => {
        document.getElementById('shareCodeForm').classList.add('is-visible');
        document.getElementById('shareAccessCode').focus();
    });
    document.getElementById('createProtectedShareBtn').addEventListener('click', () => {
        Albums.createShareLink(document.getElementById('shareAccessCode').value.trim());
    });
    document.getElementById('copyShareUrlBtn').addEventListener('click', Albums.copyShareUrl);
    document.getElementById('shareClose').addEventListener('click', () => {
        document.getElementById('shareModal').classList.remove('is-open');
    });
    document.getElementById('shareModal').addEventListener('click', event => {
        if (event.target.id === 'shareModal') event.currentTarget.classList.remove('is-open');
    });

    // Admin Chat
    document.getElementById('adminChatToggle').addEventListener('click', Chat.toggleDashboardAdminChat);
    document.getElementById('adminChatForm').addEventListener('submit', Chat.submitDashboardChat);
    document.getElementById('adminChatReportToggle').addEventListener('click', () => {
        const enabled = document.getElementById('adminChatForm').dataset.reportMode !== 'true';
        Chat.setDashboardReportMode(enabled);
        document.getElementById('adminChatInput').focus();
    });
    document.getElementById('adminChatInput').addEventListener('input', event => {
        const hasText = event.currentTarget.value.trim() !== '';
        Chat.sendDashboardChatTyping(hasText);
        global.clearTimeout(state.dashboardChatTypingTimer);
        if (hasText) {
            state.dashboardChatTypingTimer = global.setTimeout(() => Chat.sendDashboardChatTyping(false), 1600);
        }
    });
    document.getElementById('adminChatInput').addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            event.currentTarget.form.requestSubmit();
        }
    });

    // Initial Boot
    Chat.loadDashboardChat();
    global.setInterval(Chat.loadDashboardChat, 1000);
    Albums.loadAlbums();
})(window);
