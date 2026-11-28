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

    function getQuickFilterEntries() {
        const LocalFilter = global.PhotoSelectLocalFilter;
        const textarea = document.getElementById('quickFilterTxtArea');
        if (textarea && LocalFilter) {
            return LocalFilter.parseTargetList(textarea.value);
        }
        return state.viewerFiles
            .filter(file => state.selectedViewerFiles.has(String(file.id)))
            .map(file => String(file.name || '').trim())
            .filter(Boolean);
    }

    function syncQuickFilterListCount() {
        const countEl = document.getElementById('quickFilterEntryCount');
        if (!countEl) return;
        const entries = getQuickFilterEntries();
        countEl.textContent = `${entries.length} ảnh`;
    }

    function toggleQuickFilterSubfolderMode() {
        const autoChecked = Boolean(document.getElementById('quickFilterAutoSubfolder')?.checked);
        const subRow = document.getElementById('quickFilterSubfolderRow');
        const customRow = document.getElementById('quickFilterCustomDestRow');
        if (subRow) subRow.hidden = !autoChecked;
        if (customRow) customRow.hidden = autoChecked;
    }

    function fillQuickFilterFromViewer() {
        const textarea = document.getElementById('quickFilterTxtArea');
        const txtNameEl = document.getElementById('quickFilterTxtName');
        const names = state.viewerFiles
            .filter(file => state.selectedViewerFiles.has(String(file.id)))
            .map(file => String(file.name || '').trim())
            .filter(Boolean);
        if (textarea) textarea.value = names.join('\n');
        if (txtNameEl) {
            txtNameEl.textContent = names.length ? `Đang dùng ${names.length} ảnh đã chọn trong album` : 'Chưa chọn file .txt';
        }
        syncQuickFilterListCount();
    }

    async function loadQuickFilterTxtFile(file) {
        if (!file) return;
        const text = await file.text();
        const textarea = document.getElementById('quickFilterTxtArea');
        const txtNameEl = document.getElementById('quickFilterTxtName');
        const subfolderInput = document.getElementById('quickFilterSubfolderName');
        if (textarea) textarea.value = text;
        if (txtNameEl) txtNameEl.textContent = file.name;
        if (subfolderInput && (!subfolderInput.value.trim() || subfolderInput.value.trim() === 'Anh_Da_Chon')) {
            const stem = String(file.name || '').replace(/\.[^.]+$/, '').replace(/-danh-sach-anh$/i, '');
            const suggested = global.PhotoSelectLocalFilter?.sanitizeFolderName(`${stem}_Da_Chon`, 'Anh_Da_Chon') || 'Anh_Da_Chon';
            subfolderInput.value = suggested;
        }
        syncQuickFilterListCount();
    }

    function openQuickFilter(options = {}) {
        const statusEl = document.getElementById('quickFilterStatus');
        const missingBox = document.getElementById('quickFilterMissingBox');
        const useSelectedBtn = document.getElementById('quickFilterUseSelectedBtn');
        const subfolderInput = document.getElementById('quickFilterSubfolderName');
        const selectedCount = state.selectedViewerFiles.size;

        if (useSelectedBtn) {
            useSelectedBtn.hidden = selectedCount === 0;
            useSelectedBtn.textContent = `❤️ Lấy từ ${selectedCount} ảnh đã chọn`;
        }
        if (options.preferViewerSelections && selectedCount > 0) {
            fillQuickFilterFromViewer();
            const viewerTitle = document.getElementById('albumViewerTitle')?.textContent?.trim();
            if (subfolderInput && viewerTitle && (!subfolderInput.value.trim() || subfolderInput.value.trim() === 'Anh_Da_Chon')) {
                subfolderInput.value = global.PhotoSelectLocalFilter?.sanitizeFolderName(`${viewerTitle}_Da_Chon`, 'Anh_Da_Chon') || 'Anh_Da_Chon';
            }
        } else {
            syncQuickFilterListCount();
        }

        if (missingBox) {
            missingBox.hidden = true;
            missingBox.innerHTML = '';
        }
        toggleQuickFilterSubfolderMode();
        if (statusEl) {
            statusEl.textContent = global.showDirectoryPicker
                ? ''
                : 'Trình duyệt hiện tại không hỗ trợ chọn thư mục. Hãy dùng Chrome hoặc Edge trên máy tính.';
            statusEl.classList.toggle('is-error', !global.showDirectoryPicker);
        }
        document.getElementById('quickFilterModal').classList.add('is-open');
    }

    async function chooseQuickFilterFolder(type) {
        if (!global.showDirectoryPicker) return;
        try {
            const autoSub = Boolean(document.getElementById('quickFilterAutoSubfolder')?.checked);
            const mode = type === 'destination' || autoSub ? 'readwrite' : 'read';
            const handle = await global.showDirectoryPicker({ mode });
            if (type === 'destination') state.quickFilterDestinationHandle = handle;
            else state.quickFilterSourceHandle = handle;
            document.getElementById(type === 'destination' ? 'quickFilterDestinationName' : 'quickFilterSourceName').textContent = handle.name;
        } catch {
            // Người dùng có thể đóng hộp thoại chọn thư mục.
        }
    }

    async function startQuickFilter() {
        const LocalFilter = global.PhotoSelectLocalFilter;
        const status = document.getElementById('quickFilterStatus');
        const missingBox = document.getElementById('quickFilterMissingBox');
        const startButton = document.getElementById('quickFilterStart');
        const entries = getQuickFilterEntries();

        if (!LocalFilter) {
            status.textContent = 'Không tìm thấy module lọc ảnh cục bộ.';
            status.classList.add('is-error');
            return;
        }
        if (!entries.length) {
            status.textContent = 'Vui lòng chọn file .txt hoặc dán danh sách tên ảnh cần lọc.';
            status.classList.add('is-error');
            return;
        }
        if (!state.quickFilterSourceHandle) {
            status.textContent = 'Vui lòng chọn thư mục chứa ảnh & RAW trong máy.';
            status.classList.add('is-error');
            return;
        }

        const createSubfolderInsideSource = Boolean(document.getElementById('quickFilterAutoSubfolder')?.checked);
        const subfolderName = document.getElementById('quickFilterSubfolderName')?.value || 'Anh_Da_Chon';
        const includeRaw = Boolean(document.getElementById('quickFilterIncludeRaw')?.checked);

        if (!createSubfolderInsideSource && !state.quickFilterDestinationHandle) {
            status.textContent = 'Vui lòng chọn thư mục lưu riêng hoặc bật tự động tạo thư mục con.';
            status.classList.add('is-error');
            return;
        }

        if (missingBox) {
            missingBox.hidden = true;
            missingBox.innerHTML = '';
        }
        status.classList.remove('is-error');
        startButton.disabled = true;

        try {
            const summary = await LocalFilter.runFilterAndCopy({
                entries,
                sourceHandle: state.quickFilterSourceHandle,
                destinationHandle: state.quickFilterDestinationHandle,
                createSubfolderInsideSource,
                subfolderName,
                includeRaw,
                onProgress: message => {
                    status.textContent = message;
                }
            });

            if (summary.cancelled) return;
            const rawInfo = includeRaw ? `, kèm ${summary.rawCount} file RAW` : '';
            const missingInfo = summary.missingEntries.length ? `, thiếu ${summary.missingEntries.length} mục` : '';
            status.textContent = `Hoàn tất! Khớp ${summary.matchedEntryCount}/${summary.totalEntries} mục → đã copy ${summary.copiedCount} file (${summary.primaryCount} ảnh${rawInfo}) vào "${summary.outputFolderLabel}"${missingInfo}.`;

            if ((summary.missingEntries.length || summary.copyErrors.length) && missingBox) {
                const lines = [
                    ...summary.missingEntries.map(item => `Không tìm thấy: ${item}`),
                    ...summary.copyErrors.map(item => `Lỗi copy: ${item}`)
                ];
                missingBox.innerHTML = '';
                const title = document.createElement('strong');
                title.textContent = `Chi tiết chưa khớp / lỗi (${lines.length}):`;
                const pre = document.createElement('pre');
                pre.textContent = lines.join('\n');
                missingBox.appendChild(title);
                missingBox.appendChild(pre);
                missingBox.hidden = false;
            }
        } catch (error) {
            status.textContent = error.message || 'Không thể lọc và copy ảnh.';
            status.classList.add('is-error');
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
        loadQuickFilterTxtFile,
        syncQuickFilterListCount,
        toggleQuickFilterSubfolderMode,
        fillQuickFilterFromViewer,
        startQuickFilter
    };
})(window);
