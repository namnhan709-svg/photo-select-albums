/**
 * Trạng thái dùng chung và các hàm tiện ích toàn cục cho Dashboard Album.
 */
(function initAppState(global) {
    const IMAGE_FILE_EXTENSION_RE = /\.(3fr|arw|avif|bay|bmp|braw|cap|cin|cr2|cr3|crw|dcr|dib|dng|erf|exr|fff|gif|heic|heif|heifs|heix|hif|iiq|jpeg|jpg|jpe|jp2|j2k|k25|kdc|mef|mos|mrw|nef|nrw|orf|pbm|pcx|pef|png|psd|raf|raw|rle|rw2|rwl|sr2|srf|srw|svg|tga|tif|tiff|webp|x3f)$/i;

    const state = {
        currentAlbums: [],
        currentShareAlbum: null,
        selectedAlbumId: '',
        viewerFiles: [],
        selectedViewerFiles: new Set(),
        viewerFilter: 'all',
        quickFilterSourceHandle: null,
        quickFilterDestinationHandle: null,
        viewerCategory: 'all',
        viewerSort: 'default',
        viewerLightboxFile: null,
        viewerLightboxIndex: -1,
        viewerAlbumComments: [],
        viewerTouchStartX: 0,
        viewerTouchStartY: 0,
        viewerZipDownloadCancelled: false,
        viewerZipDownloadController: null,
        dashboardChatConversationId: localStorage.getItem('photoSelectChatId') || '',
        dashboardChatTypingTimer: null,
        dashboardNotifications: [],
        dashboardUser: null
    };

    function formatDate(value) {
        if (!value) return 'Chưa có thời gian';
        const normalized = String(value).includes('T')
            ? String(value)
            : `${String(value).replace(' ', 'T')}Z`;
        const date = new Date(normalized);
        if (Number.isNaN(date.getTime())) return value;
        return new Intl.DateTimeFormat('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    function showMessage(message, isError = false) {
        const statusElement = document.getElementById('status');
        if (!statusElement) return;
        statusElement.textContent = message;
        statusElement.className = `status${isError ? ' error' : ''}`;
    }

    function sanitizeFilename(value, fallback = 'album') {
        return String(value || fallback)
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
            .replace(/\s+/g, ' ')
            .trim() || fallback;
    }

    function isAcceptedImageFile(file) {
        const mimeType = String(file?.mimeType || '').toLowerCase();
        const fileName = String(file?.name || '').toLowerCase();
        if (mimeType.startsWith('image/')) return true;
        if (mimeType === 'application/octet-stream' || mimeType === 'image/x-raw' || mimeType === 'application/x-raw-image') return true;
        return IMAGE_FILE_EXTENSION_RE.test(fileName);
    }

    global.PhotoSelectApp = {
        state,
        IMAGE_FILE_EXTENSION_RE,
        formatDate,
        showMessage,
        sanitizeFilename,
        isAcceptedImageFile
    };
})(window);
