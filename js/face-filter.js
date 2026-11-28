/**
 * TeeMedia Privacy-First On-Device Face Filter & Grouping
 * - Chạy hoàn toàn trên trình duyệt của người dùng trong phạm vi 1 album.
 * - Không tải ảnh hoặc vector khuôn mặt lên máy chủ ngoài.
 * - Hỗ trợ chọn 1 hoặc nhiều người (ảnh chụp chung), đổi tên, gộp nhóm, tách/chuyển ảnh gán nhầm và xóa dữ liệu.
 */
(function initFaceFilterModule(global) {
    const STORAGE_PREFIX = 'teemediaFaceIndex_v1:';
    const FACE_API_SCRIPT_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.js';
    const FACE_API_MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';
    const MATCH_DISTANCE_THRESHOLD = 0.54;

    const moduleState = {
        albumKey: '',
        photos: [],
        photoMap: new Map(),
        clusters: [],
        scannedIds: new Set(),
        selectedClusterIds: [],
        optedOut: false,
        scanning: false,
        scanToken: 0,
        scannedCount: 0,
        totalToScan: 0,
        lastError: '',
        onFilterChange: null
    };

    let faceApiLoadPromise = null;

    function getStorageKey(albumKey) {
        return `${STORAGE_PREFIX}${String(albumKey || 'default')}`;
    }

    function readPersistedAlbumIndex(albumKey) {
        if (!albumKey) return null;
        try {
            const raw = localStorage.getItem(getStorageKey(albumKey));
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            return parsed;
        } catch {
            return null;
        }
    }

    function persistAlbumIndex() {
        if (!moduleState.albumKey) return;
        try {
            const payload = {
                version: 1,
                albumKey: moduleState.albumKey,
                optedOut: Boolean(moduleState.optedOut),
                updatedAt: new Date().toISOString(),
                scannedIds: [...moduleState.scannedIds],
                clusters: moduleState.clusters.map(c => ({
                    id: c.id,
                    label: c.label,
                    avatarDataUrl: c.avatarDataUrl || '',
                    descriptor: Array.isArray(c.descriptor) ? c.descriptor.map(n => Number(n.toFixed(5))) : [],
                    sampleCount: Number(c.sampleCount || 1),
                    photoIds: [...new Set((c.photoIds || []).map(String))]
                }))
            };
            localStorage.setItem(getStorageKey(moduleState.albumKey), JSON.stringify(payload));
        } catch (err) {
            console.warn('Không thể lưu chỉ mục khuôn mặt cục bộ:', err);
        }
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[data-faceapi-src="${src}"]`);
            if (existing) {
                if (global.faceapi) {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error('Không thể tải thư viện nhận diện khuôn mặt.')), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.crossOrigin = 'anonymous';
            script.dataset.faceapiSrc = src;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Không thể tải thư viện nhận diện khuôn mặt.'));
            document.head.appendChild(script);
        });
    }

    async function ensureFaceApiReady() {
        if (faceApiLoadPromise) return faceApiLoadPromise;
        faceApiLoadPromise = (async () => {
            if (!global.faceapi) {
                await loadScript(FACE_API_SCRIPT_URL);
            }
            const faceapi = global.faceapi;
            if (!faceapi) {
                throw new Error('Thư viện nhận diện khuôn mặt chưa sẵn sàng.');
            }
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL),
                faceapi.nets.faceLandmark68TinyNet.loadFromUri(FACE_API_MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(FACE_API_MODEL_URL)
            ]);
            return faceapi;
        })().catch(err => {
            faceApiLoadPromise = null;
            throw err;
        });
        return faceApiLoadPromise;
    }

    function getCorsCandidateUrls(photo) {
        const urls = [];
        const id = String(photo?.id || '');
        if (typeof photo?.thumbnail === 'string' && photo.thumbnail.startsWith('data:')) {
            urls.push(photo.thumbnail);
        }
        if (typeof photo?.thumbnailUrl === 'string' && photo.thumbnailUrl.startsWith('data:')) {
            urls.push(photo.thumbnailUrl);
        }
        if (id && !id.startsWith('img-')) {
            urls.push(`https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w480`);
        }
        if (photo?.thumbnail && !String(photo.thumbnail).startsWith('data:')) {
            urls.push(photo.thumbnail);
        }
        return [...new Set(urls.filter(Boolean))];
    }

    function loadHtmlImageCors(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            if (!url.startsWith('data:') && !url.startsWith('blob:')) {
                img.crossOrigin = 'anonymous';
                img.referrerPolicy = 'no-referrer';
            }
            let settled = false;
            const timer = global.setTimeout(() => {
                if (settled) return;
                settled = true;
                reject(new Error('Timeout tải ảnh để nhận diện khuôn mặt'));
            }, 12000);
            img.onload = () => {
                if (settled) return;
                settled = true;
                global.clearTimeout(timer);
                resolve(img);
            };
            img.onerror = () => {
                if (settled) return;
                settled = true;
                global.clearTimeout(timer);
                reject(new Error('Không thể tải ảnh CORS'));
            };
            img.src = url;
        });
    }

    async function loadPhotoCanvas(photo) {
        const candidates = getCorsCandidateUrls(photo);
        let loadedImg = null;
        let objectUrlToRevoke = '';

        for (const candidate of candidates) {
            try {
                loadedImg = await loadHtmlImageCors(candidate);
                break;
            } catch {}
        }

        if (!loadedImg && global.PhotoSelectAPI?.driveDownloadBlob && photo?.id) {
            try {
                const blob = await global.PhotoSelectAPI.driveDownloadBlob(photo.id);
                if (blob && blob.size) {
                    objectUrlToRevoke = URL.createObjectURL(blob);
                    loadedImg = await loadHtmlImageCors(objectUrlToRevoke);
                }
            } catch {}
        }

        if (!loadedImg) return null;

        try {
            const w = loadedImg.naturalWidth || loadedImg.width || 0;
            const h = loadedImg.naturalHeight || loadedImg.height || 0;
            if (!w || !h) return null;
            const maxDim = 480;
            const scale = Math.min(1, maxDim / Math.max(w, h));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(w * scale));
            canvas.height = Math.max(1, Math.round(h * scale));
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(loadedImg, 0, 0, canvas.width, canvas.height);
            // Verify canvas is not tainted before running model
            ctx.getImageData(0, 0, 1, 1);
            return canvas;
        } catch {
            return null;
        } finally {
            if (objectUrlToRevoke) {
                URL.revokeObjectURL(objectUrlToRevoke);
            }
        }
    }

    function cropFaceAvatarDataUrl(sourceCanvas, box) {
        try {
            const padX = box.width * 0.28;
            const padY = box.height * 0.32;
            const sx = Math.max(0, Math.floor(box.x - padX));
            const sy = Math.max(0, Math.floor(box.y - padY));
            const sw = Math.min(sourceCanvas.width - sx, Math.ceil(box.width + padX * 2));
            const sh = Math.min(sourceCanvas.height - sy, Math.ceil(box.height + padY * 2));
            if (sw <= 8 || sh <= 8) return '';
            const out = document.createElement('canvas');
            out.width = 96;
            out.height = 96;
            const ctx = out.getContext('2d');
            const side = Math.min(sw, sh);
            const cx = sx + (sw - side) / 2;
            const cy = sy + (sh - side) / 2;
            ctx.drawImage(sourceCanvas, cx, cy, side, side, 0, 0, 96, 96);
            return out.toDataURL('image/jpeg', 0.82);
        } catch {
            return '';
        }
    }

    function euclideanDistance(a, b) {
        if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
        let sum = 0;
        for (let i = 0; i < a.length; i += 1) {
            const d = a[i] - b[i];
            sum += d * d;
        }
        return Math.sqrt(sum);
    }

    function assignFaceToCluster(photoId, descriptorArr, avatarDataUrl) {
        const pid = String(photoId);
        let bestCluster = null;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (const cluster of moduleState.clusters) {
            // Two distinct faces in the exact same photo are unlikely to be the same person
            if (cluster.photoIds.includes(pid)) continue;
            if (!Array.isArray(cluster.descriptor) || !cluster.descriptor.length) continue;
            const dist = euclideanDistance(descriptorArr, cluster.descriptor);
            if (dist < bestDistance) {
                bestDistance = dist;
                bestCluster = cluster;
            }
        }

        if (bestCluster && bestDistance <= MATCH_DISTANCE_THRESHOLD) {
            const prevWeight = Math.max(1, Number(bestCluster.sampleCount || 1));
            bestCluster.descriptor = bestCluster.descriptor.map(
                (val, idx) => ((val * prevWeight) + descriptorArr[idx]) / (prevWeight + 1)
            );
            bestCluster.sampleCount = prevWeight + 1;
            if (!bestCluster.photoIds.includes(pid)) {
                bestCluster.photoIds.push(pid);
            }
            if (!bestCluster.avatarDataUrl && avatarDataUrl) {
                bestCluster.avatarDataUrl = avatarDataUrl;
            }
            return bestCluster;
        }

        const nextIdx = moduleState.clusters.length + 1;
        const newCluster = {
            id: `person-${Date.now().toString(36)}-${nextIdx}`,
            label: `Người ${nextIdx}`,
            avatarDataUrl: avatarDataUrl || '',
            descriptor: descriptorArr,
            sampleCount: 1,
            photoIds: [pid]
        };
        moduleState.clusters.push(newCluster);
        return newCluster;
    }

    function pruneStaleClusters() {
        const validIds = new Set(moduleState.photos.map(p => String(p.id)));
        moduleState.clusters = moduleState.clusters
            .map(c => ({
                ...c,
                photoIds: [...new Set((c.photoIds || []).map(String).filter(id => validIds.has(id)))]
            }))
            .filter(c => c.photoIds.length > 0);
        const clusterIdSet = new Set(moduleState.clusters.map(c => c.id));
        moduleState.selectedClusterIds = moduleState.selectedClusterIds.filter(id => clusterIdSet.has(id));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function updateFaceFilterUI() {
        const section = document.getElementById('faceFilterSection');
        if (!section) return;

        if (!moduleState.albumKey || !moduleState.photos.length) {
            section.hidden = true;
            return;
        }
        section.hidden = false;

        const strip = document.getElementById('faceAvatarStrip');
        const statusEl = document.getElementById('faceFilterStatusBar');
        const scanBtn = document.getElementById('faceScanBtn');
        const manageBtn = document.getElementById('faceManageBtn');
        const clearBtn = document.getElementById('faceClearSelectionBtn');
        const deleteBtn = document.getElementById('faceDeleteDataBtn');

        const selectedSet = new Set(moduleState.selectedClusterIds);
        const hasClusters = moduleState.clusters.length > 0;
        const hasSelection = moduleState.selectedClusterIds.length > 0;

        if (scanBtn) {
            scanBtn.disabled = moduleState.scanning;
            if (moduleState.scanning) {
                scanBtn.textContent = `⏳ Đang quét ${moduleState.scannedCount}/${moduleState.totalToScan}...`;
            } else if (moduleState.optedOut) {
                scanBtn.textContent = '🔒 Bật quét khuôn mặt';
            } else {
                scanBtn.textContent = hasClusters ? '🔄 Quét lại khuôn mặt' : '🔍 Quét khuôn mặt';
            }
        }
        if (manageBtn) manageBtn.hidden = !hasClusters;
        if (clearBtn) clearBtn.hidden = !hasSelection;
        if (deleteBtn) {
            deleteBtn.hidden = moduleState.optedOut && !hasClusters && moduleState.scannedIds.size === 0;
        }

        if (statusEl) {
            if (moduleState.scanning) {
                statusEl.innerHTML = `<span>⏳ Đang tự động phân tích khuôn mặt trên thiết bị (<strong>${moduleState.scannedCount}/${moduleState.totalToScan}</strong> ảnh trong album)... Dữ liệu chỉ lưu cục bộ trên trình duyệt này.</span>`;
            } else if (moduleState.lastError) {
                statusEl.innerHTML = `<span class="is-warn">⚠️ ${escapeHtml(moduleState.lastError)}</span>`;
            } else if (hasSelection) {
                const names = moduleState.selectedClusterIds
                    .map(id => moduleState.clusters.find(c => c.id === id)?.label)
                    .filter(Boolean);
                const modeLabel = names.length > 1
                    ? `Đang lọc <strong>ảnh chụp chung</strong> của <strong>${names.length} người</strong> (${names.map(escapeHtml).join(' + ')})`
                    : `Đang lọc ảnh có <strong>${escapeHtml(names[0] || '')}</strong> · Chạm thêm khuôn mặt khác để tìm ảnh chụp chung`;
                statusEl.innerHTML = `<span>${modeLabel}</span>`;
            } else if (moduleState.optedOut) {
                statusEl.innerHTML = `<span>🔒 Đã xóa dữ liệu khuôn mặt cho album này. Bạn có thể bấm <strong>“Bật quét khuôn mặt”</strong> khi muốn sử dụng lại.</span>`;
            } else if (hasClusters) {
                statusEl.innerHTML = `<span>Phát hiện <strong>${moduleState.clusters.length}</strong> khuôn mặt. Chạm để lọc 1 người hoặc chọn nhiều người để xem ảnh chụp chung. Xử lý hoàn toàn cục bộ trong album.</span>`;
            } else if (moduleState.scannedIds.size >= moduleState.photos.length) {
                statusEl.innerHTML = `<span>Không phát hiện khuôn mặt rõ nét nào trong album này. Toàn bộ xử lý chỉ diễn ra trên thiết bị của bạn.</span>`;
            } else {
                statusEl.innerHTML = `<span>🔒 Nhận diện khuôn mặt chạy trực tiếp trên thiết bị trong phạm vi album này, không gửi dữ liệu sinh trắc học ra ngoài.</span>`;
            }
        }

        if (!strip) return;
        strip.replaceChildren();
        if (!hasClusters) {
            strip.hidden = true;
            return;
        }
        strip.hidden = false;

        const resetChip = document.createElement('button');
        resetChip.type = 'button';
        resetChip.className = `face-chip face-chip-all${!hasSelection ? ' is-active' : ''}`;
        resetChip.innerHTML = `
            <span class="face-chip-all-icon" aria-hidden="true">🎞️</span>
            <span class="face-chip-meta">
                <strong>Tất cả ảnh</strong>
                <small>${moduleState.photos.length} ảnh</small>
            </span>
        `;
        resetChip.addEventListener('click', () => clearSelection());
        strip.appendChild(resetChip);

        const sorted = [...moduleState.clusters].sort((a, b) => b.photoIds.length - a.photoIds.length);
        sorted.forEach(cluster => {
            const isSelected = selectedSet.has(cluster.id);
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `face-chip${isSelected ? ' is-active' : ''}`;
            chip.setAttribute('aria-pressed', String(isSelected));
            chip.title = `${cluster.label} (${cluster.photoIds.length} ảnh) — Chạm để lọc hoặc chọn nhiều người`;

            const avatarWrap = document.createElement('span');
            avatarWrap.className = 'face-chip-avatar';
            if (cluster.avatarDataUrl) {
                const img = document.createElement('img');
                img.src = cluster.avatarDataUrl;
                img.alt = cluster.label;
                avatarWrap.appendChild(img);
            } else {
                avatarWrap.textContent = '👤';
            }

            const meta = document.createElement('span');
            meta.className = 'face-chip-meta';
            const title = document.createElement('strong');
            title.textContent = cluster.label;
            const sub = document.createElement('small');
            sub.textContent = `${cluster.photoIds.length} ảnh`;
            meta.append(title, sub);

            chip.append(avatarWrap, meta);
            chip.addEventListener('click', () => toggleClusterSelection(cluster.id));
            strip.appendChild(chip);
        });
    }

    function toggleClusterSelection(clusterId) {
        const idx = moduleState.selectedClusterIds.indexOf(clusterId);
        if (idx >= 0) {
            moduleState.selectedClusterIds.splice(idx, 1);
        } else {
            moduleState.selectedClusterIds.push(clusterId);
        }
        updateFaceFilterUI();
        moduleState.onFilterChange?.();
    }

    function clearSelection() {
        if (!moduleState.selectedClusterIds.length) return;
        moduleState.selectedClusterIds = [];
        updateFaceFilterUI();
        moduleState.onFilterChange?.();
    }

    function matchesPhoto(photoId) {
        if (!moduleState.selectedClusterIds.length) return true;
        const pid = String(photoId);
        return moduleState.selectedClusterIds.every(cid => {
            const cluster = moduleState.clusters.find(c => c.id === cid);
            return Boolean(cluster && cluster.photoIds.includes(pid));
        });
    }

    function getActiveFilterSummary() {
        if (!moduleState.selectedClusterIds.length) return null;
        const labels = moduleState.selectedClusterIds
            .map(cid => moduleState.clusters.find(c => c.id === cid)?.label)
            .filter(Boolean);
        return {
            count: labels.length,
            labels
        };
    }

    async function runScan({ rescanAll = false } = {}) {
        if (!moduleState.albumKey || !moduleState.photos.length) return;
        const token = ++moduleState.scanToken;
        moduleState.optedOut = false;
        moduleState.lastError = '';
        moduleState.scanning = true;

        if (rescanAll) {
            moduleState.clusters = [];
            moduleState.scannedIds = new Set();
            moduleState.selectedClusterIds = [];
            moduleState.onFilterChange?.();
        }

        const pendingPhotos = moduleState.photos.filter(p => rescanAll || !moduleState.scannedIds.has(String(p.id)));
        moduleState.scannedCount = 0;
        moduleState.totalToScan = pendingPhotos.length;
        updateFaceFilterUI();

        if (!pendingPhotos.length) {
            moduleState.scanning = false;
            updateFaceFilterUI();
            return;
        }

        try {
            const faceapi = await ensureFaceApiReady();
            if (token !== moduleState.scanToken) return;

            const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.48 });

            for (let i = 0; i < pendingPhotos.length; i += 1) {
                if (token !== moduleState.scanToken) return;
                const photo = pendingPhotos[i];
                const canvas = await loadPhotoCanvas(photo);
                if (token !== moduleState.scanToken) return;

                if (canvas) {
                    try {
                        const detections = await faceapi
                            .detectAllFaces(canvas, options)
                            .withFaceLandmarks(true)
                            .withFaceDescriptors();

                        if (token !== moduleState.scanToken) return;

                        if (Array.isArray(detections) && detections.length) {
                            detections.forEach(det => {
                                const desc = Array.from(det.descriptor || []);
                                if (!desc.length) return;
                                const avatar = cropFaceAvatarDataUrl(canvas, det.detection.box);
                                assignFaceToCluster(photo.id, desc, avatar);
                            });
                        }
                        moduleState.scannedIds.add(String(photo.id));
                    } catch (detErr) {
                        console.warn('Bỏ qua ảnh lỗi nhận diện khuôn mặt:', detErr);
                    }
                }

                moduleState.scannedCount = i + 1;
                if (i % 2 === 1 || i === pendingPhotos.length - 1) {
                    persistAlbumIndex();
                    updateFaceFilterUI();
                }

                // Yield to main thread so mobile scrolling and heart taps stay smooth
                await new Promise(resolve => global.setTimeout(resolve, 16));
            }
        } catch (err) {
            if (token === moduleState.scanToken) {
                moduleState.lastError = err?.message || 'Không thể chạy nhận diện khuôn mặt trên trình duyệt này.';
            }
        } finally {
            if (token === moduleState.scanToken) {
                moduleState.scanning = false;
                persistAlbumIndex();
                updateFaceFilterUI();
            }
        }
    }

    function deleteFaceDataForAlbum() {
        moduleState.scanToken += 1;
        moduleState.scanning = false;
        moduleState.clusters = [];
        moduleState.scannedIds = new Set();
        moduleState.selectedClusterIds = [];
        moduleState.optedOut = true;
        moduleState.lastError = '';
        if (moduleState.albumKey) {
            try {
                localStorage.setItem(getStorageKey(moduleState.albumKey), JSON.stringify({
                    version: 1,
                    albumKey: moduleState.albumKey,
                    optedOut: true,
                    updatedAt: new Date().toISOString(),
                    scannedIds: [],
                    clusters: []
                }));
            } catch {}
        }
        updateFaceFilterUI();
        moduleState.onFilterChange?.();
    }

    function renameCluster(clusterId, newName) {
        const cluster = moduleState.clusters.find(c => c.id === clusterId);
        if (!cluster) return;
        const clean = String(newName || '').trim();
        if (clean) cluster.label = clean.slice(0, 40);
        persistAlbumIndex();
        updateFaceFilterUI();
        if (moduleState.selectedClusterIds.includes(clusterId)) {
            moduleState.onFilterChange?.();
        }
    }

    function mergeClusters(sourceClusterId, targetClusterId) {
        if (!sourceClusterId || !targetClusterId || sourceClusterId === targetClusterId) return;
        const source = moduleState.clusters.find(c => c.id === sourceClusterId);
        const target = moduleState.clusters.find(c => c.id === targetClusterId);
        if (!source || !target) return;

        target.photoIds = [...new Set([...target.photoIds, ...source.photoIds])];
        const w1 = Math.max(1, Number(target.sampleCount || 1));
        const w2 = Math.max(1, Number(source.sampleCount || 1));
        if (Array.isArray(target.descriptor) && Array.isArray(source.descriptor) && target.descriptor.length === source.descriptor.length) {
            target.descriptor = target.descriptor.map((v, i) => ((v * w1) + (source.descriptor[i] * w2)) / (w1 + w2));
            target.sampleCount = w1 + w2;
        }
        if (!target.avatarDataUrl && source.avatarDataUrl) {
            target.avatarDataUrl = source.avatarDataUrl;
        }

        moduleState.clusters = moduleState.clusters.filter(c => c.id !== sourceClusterId);
        if (moduleState.selectedClusterIds.includes(sourceClusterId)) {
            moduleState.selectedClusterIds = [...new Set(
                moduleState.selectedClusterIds.map(id => (id === sourceClusterId ? targetClusterId : id))
            )];
        }
        persistAlbumIndex();
        updateFaceFilterUI();
        renderGroupManagerModal();
        moduleState.onFilterChange?.();
    }

    function movePhotoFromCluster(photoId, fromClusterId, toClusterId) {
        const pid = String(photoId);
        const from = moduleState.clusters.find(c => c.id === fromClusterId);
        if (!from) return;

        from.photoIds = from.photoIds.filter(id => id !== pid);

        if (toClusterId === '__new__') {
            const nextIdx = moduleState.clusters.length + 1;
            const photo = moduleState.photoMap.get(pid);
            const newId = `person-${Date.now().toString(36)}-${nextIdx}`;
            moduleState.clusters.push({
                id: newId,
                label: `Người ${nextIdx}`,
                avatarDataUrl: from.avatarDataUrl || photo?.thumbnail || '',
                descriptor: [],
                sampleCount: 1,
                photoIds: [pid]
            });
        } else if (toClusterId && toClusterId !== '__remove__') {
            const target = moduleState.clusters.find(c => c.id === toClusterId);
            if (target && !target.photoIds.includes(pid)) {
                target.photoIds.push(pid);
            }
        }

        pruneStaleClusters();
        persistAlbumIndex();
        updateFaceFilterUI();
        renderGroupManagerModal(fromClusterId);
        moduleState.onFilterChange?.();
    }

    let activeManageClusterId = '';

    function renderGroupManagerModal(preferredClusterId = '') {
        const listEl = document.getElementById('faceManagerGroupsList');
        const photosEl = document.getElementById('faceManagerPhotosPane');
        if (!listEl || !photosEl) return;

        if (!moduleState.clusters.length) {
            listEl.innerHTML = '<p class="face-manager-empty">Chưa có nhóm khuôn mặt nào trong album này.</p>';
            photosEl.innerHTML = '';
            return;
        }

        if (!activeManageClusterId || !moduleState.clusters.some(c => c.id === activeManageClusterId)) {
            activeManageClusterId = (preferredClusterId && moduleState.clusters.some(c => c.id === preferredClusterId))
                ? preferredClusterId
                : moduleState.clusters[0].id;
        }

        listEl.replaceChildren();
        moduleState.clusters.forEach(cluster => {
            const row = document.createElement('div');
            row.className = `face-manager-group-row${cluster.id === activeManageClusterId ? ' is-active' : ''}`;

            const avatar = document.createElement('img');
            avatar.className = 'face-manager-avatar';
            avatar.src = cluster.avatarDataUrl || '';
            avatar.alt = cluster.label;

            const fields = document.createElement('div');
            fields.className = 'face-manager-fields';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.maxLength = 40;
            nameInput.value = cluster.label;
            nameInput.placeholder = 'Đặt tên (VD: Cô dâu)';
            nameInput.addEventListener('change', () => renameCluster(cluster.id, nameInput.value));

            const actionLine = document.createElement('div');
            actionLine.className = 'face-manager-row-actions';

            const inspectBtn = document.createElement('button');
            inspectBtn.type = 'button';
            inspectBtn.className = 'face-mgr-btn';
            inspectBtn.textContent = `Ảnh (${cluster.photoIds.length})`;
            inspectBtn.addEventListener('click', () => {
                activeManageClusterId = cluster.id;
                renderGroupManagerModal(cluster.id);
            });

            actionLine.appendChild(inspectBtn);

            if (moduleState.clusters.length > 1) {
                const mergeSelect = document.createElement('select');
                mergeSelect.className = 'face-mgr-select';
                mergeSelect.setAttribute('aria-label', `Gộp ${cluster.label} vào nhóm khác`);
                const defaultOpt = document.createElement('option');
                defaultOpt.value = '';
                defaultOpt.textContent = 'Gộp vào...';
                mergeSelect.appendChild(defaultOpt);
                moduleState.clusters.forEach(other => {
                    if (other.id === cluster.id) return;
                    const opt = document.createElement('option');
                    opt.value = other.id;
                    opt.textContent = `→ ${other.label} (${other.photoIds.length})`;
                    mergeSelect.appendChild(opt);
                });
                mergeSelect.addEventListener('change', () => {
                    if (mergeSelect.value) {
                        mergeClusters(cluster.id, mergeSelect.value);
                    }
                });
                actionLine.appendChild(mergeSelect);
            }

            fields.append(nameInput, actionLine);
            row.append(avatar, fields);
            listEl.appendChild(row);
        });

        const current = moduleState.clusters.find(c => c.id === activeManageClusterId) || moduleState.clusters[0];
        photosEl.replaceChildren();
        const heading = document.createElement('div');
        heading.className = 'face-manager-photos-head';
        heading.innerHTML = `<strong>Ảnh trong nhóm “${escapeHtml(current.label)}” (${current.photoIds.length})</strong><small>Nếu có ảnh nhận diện nhầm người, bạn có thể chuyển sang nhóm khác, tách thành người mới hoặc bỏ khỏi nhóm.</small>`;
        photosEl.appendChild(heading);

        const grid = document.createElement('div');
        grid.className = 'face-manager-photo-grid';

        current.photoIds.forEach(pid => {
            const photo = moduleState.photoMap.get(String(pid));
            if (!photo) return;
            const card = document.createElement('div');
            card.className = 'face-manager-photo-card';

            const imgWrap = document.createElement('div');
            imgWrap.className = 'face-manager-photo-thumb';
            const img = document.createElement('img');
            img.alt = photo.name || 'Ảnh';
            img.loading = 'lazy';
            if (global.PhotoSelectAPI?.bindDriveImage) {
                global.PhotoSelectAPI.bindDriveImage(img, photo, 'thumb');
            } else {
                img.src = photo.thumbnail;
            }
            const numBadge = document.createElement('span');
            numBadge.className = 'face-manager-order-tag';
            numBadge.textContent = `#${photo.orderNumber || '?'}`;
            imgWrap.append(img, numBadge);

            const moveSelect = document.createElement('select');
            moveSelect.className = 'face-mgr-select is-full';
            moveSelect.setAttribute('aria-label', `Chuyển ảnh #${photo.orderNumber || ''}`);

            const stayOpt = document.createElement('option');
            stayOpt.value = '';
            stayOpt.textContent = `Giữ ở ${current.label}`;
            moveSelect.appendChild(stayOpt);

            moduleState.clusters.forEach(other => {
                if (other.id === current.id) return;
                const opt = document.createElement('option');
                opt.value = other.id;
                opt.textContent = `Chuyển → ${other.label}`;
                moveSelect.appendChild(opt);
            });

            const newOpt = document.createElement('option');
            newOpt.value = '__new__';
            newOpt.textContent = '＋ Tách thành người mới';
            moveSelect.appendChild(newOpt);

            const remOpt = document.createElement('option');
            remOpt.value = '__remove__';
            remOpt.textContent = '✕ Bỏ khỏi nhóm này';
            moveSelect.appendChild(remOpt);

            moveSelect.addEventListener('change', () => {
                if (!moveSelect.value) return;
                movePhotoFromCluster(pid, current.id, moveSelect.value);
            });

            card.append(imgWrap, moveSelect);
            grid.appendChild(card);
        });
        photosEl.appendChild(grid);
    }

    function openGroupManagerModal() {
        const modal = document.getElementById('faceGroupManagerModal');
        if (!modal) return;
        activeManageClusterId = moduleState.selectedClusterIds[0] || moduleState.clusters[0]?.id || '';
        renderGroupManagerModal(activeManageClusterId);
        modal.classList.add('active');
    }

    function closeGroupManagerModal() {
        document.getElementById('faceGroupManagerModal')?.classList.remove('active');
    }

    function bindModalEvents() {
        if (bindModalEvents.bound) return;
        bindModalEvents.bound = true;

        document.getElementById('faceScanBtn')?.addEventListener('click', () => {
            const shouldRescanAll = moduleState.clusters.length > 0 && !moduleState.optedOut;
            runScan({ rescanAll: shouldRescanAll });
        });
        document.getElementById('faceManageBtn')?.addEventListener('click', openGroupManagerModal);
        document.getElementById('faceClearSelectionBtn')?.addEventListener('click', clearSelection);
        document.getElementById('faceDeleteDataBtn')?.addEventListener('click', () => {
            deleteFaceDataForAlbum();
        });
        document.getElementById('faceGroupManagerClose')?.addEventListener('click', closeGroupManagerModal);
        document.getElementById('faceGroupManagerDoneBtn')?.addEventListener('click', closeGroupManagerModal);
        document.getElementById('faceGroupManagerModal')?.addEventListener('click', event => {
            if (event.target.id === 'faceGroupManagerModal') closeGroupManagerModal();
        });
    }

    function initForAlbum({ albumKey, photos, onFilterChange }) {
        bindModalEvents();
        moduleState.scanToken += 1;
        moduleState.scanning = false;
        moduleState.albumKey = String(albumKey || '');
        moduleState.photos = Array.isArray(photos) ? photos : [];
        moduleState.photoMap = new Map(moduleState.photos.map(p => [String(p.id), p]));
        moduleState.selectedClusterIds = [];
        moduleState.lastError = '';
        moduleState.onFilterChange = typeof onFilterChange === 'function' ? onFilterChange : null;

        const saved = readPersistedAlbumIndex(moduleState.albumKey);
        if (saved) {
            moduleState.optedOut = Boolean(saved.optedOut);
            moduleState.clusters = Array.isArray(saved.clusters) ? saved.clusters : [];
            moduleState.scannedIds = new Set(Array.isArray(saved.scannedIds) ? saved.scannedIds.map(String) : []);
            pruneStaleClusters();
        } else {
            moduleState.optedOut = false;
            moduleState.clusters = [];
            moduleState.scannedIds = new Set();
        }

        updateFaceFilterUI();

        // Automatically group faces in album scope unless user deleted/opted out
        if (!moduleState.optedOut && moduleState.photos.length) {
            const hasUnscanned = moduleState.photos.some(p => !moduleState.scannedIds.has(String(p.id)));
            if (hasUnscanned) {
                global.setTimeout(() => runScan({ rescanAll: false }), 250);
            }
        }
    }

    function resetForAlbumSwitch() {
        moduleState.scanToken += 1;
        moduleState.scanning = false;
        moduleState.albumKey = '';
        moduleState.photos = [];
        moduleState.photoMap = new Map();
        moduleState.clusters = [];
        moduleState.selectedClusterIds = [];
        moduleState.scannedIds = new Set();
        const section = document.getElementById('faceFilterSection');
        if (section) section.hidden = true;
    }

    global.TeeMediaFaceFilter = {
        initForAlbum,
        resetForAlbumSwitch,
        matchesPhoto,
        clearSelection,
        getActiveFilterSummary,
        updateFaceFilterUI,
        deleteFaceDataForAlbum
    };
})(window);
