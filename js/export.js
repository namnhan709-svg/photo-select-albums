/**
 * Xuất danh sách .txt, tải ảnh chọn thành file .zip và lọc ảnh từ thư mục máy tính.
 */
(function initExportModule(global) {
    const { state, IMAGE_FILE_EXTENSION_RE, sanitizeFilename } = global.PhotoSelectApp;
    const API = global.PhotoSelectAPI;

    function getViewerExportFiles() {
        const query = document.getElementById('viewerSearch').value.trim().toLowerCase();
        const visibleFiles = state.viewerFiles.filter(file => {
            const matchesSearch = !query || String(file.name || '').toLowerCase().includes(query);
            const isSelected = state.selectedViewerFiles.has(String(file.id));
            const matchesFilter = state.viewerFilter === 'all' || (state.viewerFilter === 'selected' ? isSelected : !isSelected);
            const matchesCategory = state.viewerCategory === 'all' || file.category === state.viewerCategory;
            return matchesSearch && matchesFilter && matchesCategory;
        });
        const selected = visibleFiles.filter(file => state.selectedViewerFiles.has(String(file.id)));
        return selected.length ? selected : visibleFiles;
    }

    function getViewerExportDigitCounts() {
        return [...document.querySelectorAll('input[name="viewerExportDigits"]:checked')]
            .map(input => Number(input.value))
            .filter(count => [3, 4, 5, 6].includes(count))
            .sort((first, second) => first - second);
    }

    function getViewerExportSeparator() {
        const separator = document.getElementById('viewerExportSeparator').value;
        if (separator === 'custom') return document.getElementById('viewerExportCustomSeparator').value || ',';
        if (separator === '\\n') return '\n';
        if (separator === '\\t') return '\t';
        return separator;
    }

    function formatViewerExportFile(file, digitCounts) {
        const name = String(file.name || '');
        const digits = (name.match(/\d+/g) || []).join('');
        const codes = digits ? digitCounts.map(count => digits.slice(-count).padStart(count, '0')) : [];
        const codeText = codes.join('/');
        if (document.getElementById('viewerExportIncludeName').checked) {
            return codeText ? `${codeText}-${name}` : name;
        }
        return codeText;
    }

    function getViewerExportText() {
        const files = getViewerExportFiles();
        const digitCounts = getViewerExportDigitCounts();
        return files
            .map(file => formatViewerExportFile(file, digitCounts))
            .filter(Boolean)
            .join(getViewerExportSeparator());
    }

    function updateViewerExportPreview() {
        const preview = document.getElementById('viewerExportPreview');
        const files = getViewerExportFiles();
        const digitCounts = getViewerExportDigitCounts();
        if (!files.length) {
            preview.textContent = 'Không có ảnh nào để xuất.';
            return;
        }
        if (!digitCounts.length && !document.getElementById('viewerExportIncludeName').checked) {
            preview.textContent = 'Chọn ít nhất một độ dài mã số hoặc bật kèm tên file.';
            return;
        }
        const examples = files.slice(0, 3)
            .map(file => formatViewerExportFile(file, digitCounts))
            .filter(Boolean);
        const separator = getViewerExportSeparator();
        preview.textContent = examples.join(separator) || 'Ảnh đã chọn không có nội dung phù hợp.';
        if (files.length > examples.length) preview.textContent += `${separator}...`;
    }

    function openViewerExportDialog() {
        document.getElementById('viewerExportModal').classList.add('is-open');
        updateViewerExportPreview();
        document.getElementById('viewerExportCancel').focus();
    }

    function closeViewerExportDialog() {
        document.getElementById('viewerExportModal').classList.remove('is-open');
    }

    async function copyViewerExportText() {
        const albumViewerStatus = document.getElementById('albumViewerStatus');
        const text = getViewerExportText();
        if (!text) {
            albumViewerStatus.textContent = 'Hãy chọn ảnh và tùy chọn nội dung cần xuất.';
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
            albumViewerStatus.textContent = 'Đã copy danh sách ảnh.';
            closeViewerExportDialog();
        } catch {
            albumViewerStatus.textContent = 'Không thể copy danh sách ảnh.';
        }
    }

    function exportViewerText() {
        const albumViewerStatus = document.getElementById('albumViewerStatus');
        const albumViewerTitle = document.getElementById('albumViewerTitle');
        const text = getViewerExportText();
        if (!text) {
            albumViewerStatus.textContent = 'Hãy chọn ảnh và tùy chọn nội dung cần xuất.';
            return;
        }
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
        const safeAlbumName = sanitizeFilename(albumViewerTitle.textContent || state.selectedAlbumId, 'album');
        link.download = `${safeAlbumName}-danh-sach-anh.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        global.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        closeViewerExportDialog();
    }

    function updateViewerZipProgress(percent, status) {
        const modal = document.getElementById('viewerZipProgressModal');
        const fill = document.getElementById('viewerZipProgressFill');
        const label = document.getElementById('viewerZipProgressStatus');
        const percentText = document.getElementById('viewerZipProgressPercent');
        if (modal) modal.classList.add('is-open');
        if (fill) fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
        if (label) label.textContent = status || 'Đang xử lý...';
        if (percentText) percentText.textContent = `${Math.round(percent)}%`;
    }

    function closeViewerZipProgress() {
        state.viewerZipDownloadCancelled = true;
        if (state.viewerZipDownloadController) {
            state.viewerZipDownloadController.abort();
            state.viewerZipDownloadController = null;
        }
        const modal = document.getElementById('viewerZipProgressModal');
        if (modal) modal.classList.remove('is-open');
    }

    function getUploadTimestamp(file) {
        const value = file?.createdTime || file?.uploadedAt || file?.modifiedTime || file?.created_at || file?.uploaded_at || null;
        const time = value ? new Date(value).getTime() : 0;
        return Number.isFinite(time) ? time : 0;
    }

    function sortFilesByUploadTime(files) {
        return [...files].sort((a, b) => {
            const aTime = getUploadTimestamp(a);
            const bTime = getUploadTimestamp(b);
            if (bTime !== aTime) return bTime - aTime;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });
    }

    function getViewerFileDate(file) {
        const value = file?.createdTime || file?.modifiedTime || null;
        if (!value) return new Date();
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? new Date() : date;
    }

    async function downloadViewerSelection() {
        const albumViewerStatus = document.getElementById('albumViewerStatus');
        const albumViewerTitle = document.getElementById('albumViewerTitle');
        const filesToDownload = sortFilesByUploadTime(
            state.viewerFiles.filter(file => state.selectedViewerFiles.has(String(file.id)))
        );

        if (!filesToDownload.length) {
            albumViewerStatus.textContent = 'Chưa có ảnh yêu thích để tải.';
            return;
        }

        const button = document.getElementById('viewerDownloadBtn');
        button.disabled = true;
        state.viewerZipDownloadCancelled = false;
        state.viewerZipDownloadController = new AbortController();
        updateViewerZipProgress(0, 'Đang chuẩn bị dialog tải ảnh...');
        albumViewerStatus.textContent = 'Đang đóng gói file ZIP...';

        try {
            if (typeof global.JSZip !== 'function') {
                throw new Error('Thư viện ZIP chưa sẵn sàng. Vui lòng thử lại.');
            }

            const zip = new global.JSZip();
            for (const [index, file] of filesToDownload.entries()) {
                if (state.viewerZipDownloadCancelled) {
                    albumViewerStatus.textContent = 'Đã hủy quá trình tải xuống.';
                    updateViewerZipProgress(0, 'Đã hủy quá trình tải xuống.');
                    return;
                }
                const blob = await API.driveDownloadBlob(file.id, state.viewerZipDownloadController.signal);
                const blobType = String(blob.type || '').toLowerCase();
                const fileName = String(file.name || '').toLowerCase();
                const isAllowedRaw = IMAGE_FILE_EXTENSION_RE.test(fileName);
                if (!blobType.startsWith('image/') && !isAllowedRaw && blobType !== 'application/octet-stream') {
                    throw new Error(`Google Drive không trả về file ảnh cho ${file.name || 'ảnh'}.`);
                }
                const entryName = String(file.name || `anh-${index + 1}`).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
                zip.file(entryName, blob, { date: getViewerFileDate(file) });

                const progress = Math.round(((index + 1) / filesToDownload.length) * 80);
                updateViewerZipProgress(progress, `Đang đóng gói ${index + 1}/${filesToDownload.length} ảnh...`);
                albumViewerStatus.textContent = `Đang đóng gói ${index + 1}/${filesToDownload.length} ảnh...`;
            }

            updateViewerZipProgress(85, 'Đang tạo file ZIP...');
            const archive = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, metadata => {
                updateViewerZipProgress(85 + Math.round(metadata.percent * 0.15), 'Đang hoàn tất file ZIP...');
            });

            const url = URL.createObjectURL(archive);
            const link = document.createElement('a');
            link.href = url;
            link.download = `${sanitizeFilename(albumViewerTitle.textContent, 'album')}.zip`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            global.setTimeout(() => URL.revokeObjectURL(url), 1200);

            updateViewerZipProgress(100, `Đã tải xuống ZIP gồm ${filesToDownload.length} ảnh.`);
            albumViewerStatus.textContent = `Đã tải xuống ZIP gồm ${filesToDownload.length} ảnh.`;
            global.setTimeout(() => {
                const modal = document.getElementById('viewerZipProgressModal');
                if (modal) modal.classList.remove('is-open');
            }, 850);
        } catch (error) {
            if (error?.name === 'AbortError' && state.viewerZipDownloadCancelled) {
                albumViewerStatus.textContent = 'Đã hủy quá trình tải xuống.';
                return;
            }
            albumViewerStatus.textContent = error.message || 'Không thể tải ảnh.';
            updateViewerZipProgress(0, error.message || 'Không thể tải ảnh.');
            global.setTimeout(() => {
                const modal = document.getElementById('viewerZipProgressModal');
                if (modal) modal.classList.remove('is-open');
            }, 1200);
        } finally {
            state.viewerZipDownloadController = null;
            button.disabled = false;
        }
    }

    function openQuickFilter() {
        const albumViewerStatus = document.getElementById('albumViewerStatus');
        if (!state.selectedViewerFiles.size) {
            albumViewerStatus.textContent = 'Hãy chọn ảnh đã thả tim trước khi lọc từ máy tính.';
            return;
        }
        if (!global.showDirectoryPicker) {
            albumViewerStatus.textContent = 'Trình duyệt không hỗ trợ chọn thư mục. Hãy dùng Chrome hoặc Edge.';
            return;
        }
        document.getElementById('quickFilterStatus').textContent = '';
        document.getElementById('quickFilterModal').classList.add('is-open');
    }

    async function chooseQuickFilterFolder(type) {
        if (!global.showDirectoryPicker) return;
        try {
            const handle = await global.showDirectoryPicker({ mode: type === 'destination' ? 'readwrite' : 'read' });
            if (type === 'destination') state.quickFilterDestinationHandle = handle;
            else state.quickFilterSourceHandle = handle;
            document.getElementById(type === 'destination' ? 'quickFilterDestinationName' : 'quickFilterSourceName').textContent = handle.name;
        } catch {
            // Người dùng có thể đóng hộp thoại chọn thư mục.
        }
    }

    async function collectComputerImages(directoryHandle) {
        const files = [];
        for await (const entry of directoryHandle.values()) {
            if (entry.kind === 'file') files.push(entry);
            else if (entry.kind === 'directory') files.push(...await collectComputerImages(entry));
        }
        return files.filter(file => IMAGE_FILE_EXTENSION_RE.test(file.name));
    }

    async function startQuickFilter() {
        const status = document.getElementById('quickFilterStatus');
        if (!state.quickFilterSourceHandle || !state.quickFilterDestinationHandle) {
            status.textContent = 'Vui lòng chọn đủ thư mục nguồn và thư mục lưu.';
            return;
        }
        const selectedNames = new Set(
            state.viewerFiles
                .filter(file => state.selectedViewerFiles.has(String(file.id)))
                .map(file => String(file.name || '').trim().toLowerCase())
                .filter(Boolean)
        );
        const startButton = document.getElementById('quickFilterStart');
        startButton.disabled = true;
        try {
            status.textContent = `Đang quét thư mục nguồn (${selectedNames.size} ảnh yêu thích)...`;
            const sourceFiles = await collectComputerImages(state.quickFilterSourceHandle);
            const matchedNames = new Set();
            const matchedFiles = sourceFiles.filter(file => {
                const normalizedName = file.name.trim().toLowerCase();
                if (!selectedNames.has(normalizedName) || matchedNames.has(normalizedName)) return false;
                matchedNames.add(normalizedName);
                return true;
            });
            const missingCount = Math.max(0, selectedNames.size - matchedNames.size);
            let copied = 0;
            status.textContent = `Đã đối chiếu ${matchedNames.size}/${selectedNames.size} ảnh yêu thích. Đang chuẩn bị copy...`;
            for (const fileHandle of matchedFiles) {
                const file = await fileHandle.getFile();
                const output = await state.quickFilterDestinationHandle.getFileHandle(file.name, { create: true });
                const writable = await output.createWritable();
                await writable.write(file);
                await writable.close();
                copied += 1;
                status.textContent = `Đang copy ${copied}/${matchedFiles.length} ảnh tìm thấy...`;
            }
            status.textContent = `Hoàn tất: yêu thích ${selectedNames.size}, tìm thấy ${matchedNames.size}, đã copy ${copied}${missingCount ? `, thiếu ${missingCount}` : ''}.`;
        } catch (error) {
            status.textContent = error.message || 'Không thể lọc và copy ảnh.';
        } finally {
            startButton.disabled = false;
        }
    }

    global.PhotoSelectExport = {
        updateViewerExportPreview,
        openViewerExportDialog,
        closeViewerExportDialog,
        copyViewerExportText,
        exportViewerText,
        closeViewerZipProgress,
        downloadViewerSelection,
        openQuickFilter,
        chooseQuickFilterFolder,
        startQuickFilter
    };
})(window);
