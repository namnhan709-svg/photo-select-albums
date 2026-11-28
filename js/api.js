/**
 * TeeMedia API Layer
 * - Tự động nhận diện Backend thật (`photowedding/app.php` trả JSON) hoặc Static Mode (GitHub Pages / file://).
 * - Trên GitHub Pages (Static Mode):
 *   + Link chia sẻ tự mang dữ liệu (`?share=v1.<base64url>`) để khách mở xem được ngay trên mọi thiết bị.
 *   + Hỗ trợ cấu hình Google Drive API Key (đọc thư mục Drive công khai trực tiếp từ trình duyệt)
 *     và Firebase Realtime Database URL (đồng bộ ảnh khách chọn xuyên thiết bị miễn phí).
 */
(function initApiModule(global) {
    const CONFIG = {
        mode: 'auto', // 'auto' | 'remote' | 'mock'
        endpoint: 'photowedding/app.php'
    };

    const MOCK_STORAGE_KEY = 'photoSelectLocalMockState_v2';
    const CLOUD_CONFIG_KEY = 'photoSelectCloudConfig_v1';
    const DEFAULT_CLOUD_CONFIG = {
        googleApiKey: 'AIzaSyDDu8gjk3fzCMdiDo7TIQ4nLJsNWRaK35Q',
        firebaseDbUrl: 'https://photo-select-albums-default-rtdb.asia-southeast1.firebasedatabase.app'
    };
    const STATIC_SESSION_KEY = 'photoSelectStaticUserId';
    const nativeFetch = global.fetch.bind(global);

    let backendProbePromise = null;
    let resolvedMockMode = CONFIG.mode === 'mock' || global.location.protocol === 'file:';

    function getCloudConfig() {
        try {
            const stored = JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY) || '{}');
            return {
                googleApiKey: String(stored.googleApiKey || DEFAULT_CLOUD_CONFIG.googleApiKey || '').trim(),
                firebaseDbUrl: String(stored.firebaseDbUrl || DEFAULT_CLOUD_CONFIG.firebaseDbUrl || '').trim().replace(/\/+$/, '')
            };
        } catch {
            return { ...DEFAULT_CLOUD_CONFIG };
        }
    }

    function saveCloudConfig(cfg) {
        const clean = {
            googleApiKey: String(cfg?.googleApiKey || '').trim(),
            firebaseDbUrl: String(cfg?.firebaseDbUrl || '').trim().replace(/\/+$/, '')
        };
        localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(clean));
        return clean;
    }

    function encodeBase64Url(obj) {
        const json = JSON.stringify(obj);
        const bytes = new TextEncoder().encode(json);
        let binary = '';
        bytes.forEach(b => { binary += String.fromCharCode(b); });
        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function decodeBase64Url(token) {
        try {
            const raw = String(token || '').replace(/^v1\./, '');
            const padded = raw.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((raw.length + 3) % 4);
            const binary = atob(padded);
            const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            return null;
        }
    }

    async function sha256Hex(text) {
        const data = new TextEncoder().encode(String(text || ''));
        if (global.crypto?.subtle) {
            const hashBuffer = await global.crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        // Fallback hash if crypto.subtle unavailable on insecure context
        let h = 2166136261;
        for (let i = 0; i < data.length; i += 1) {
            h ^= data[i];
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(16);
    }

    function createDemoSvgDataUrl(title, subtitle, palette) {
        const [bgStart, bgEnd, accent] = palette || ['#334155', '#64748b', '#f8fafc'];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">
            <defs>
                <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stop-color="${bgStart}"/>
                    <stop offset="100%" stop-color="${bgEnd}"/>
                </linearGradient>
            </defs>
            <rect width="900" height="900" fill="url(#g)"/>
            <circle cx="450" cy="360" r="145" fill="${accent}" opacity="0.22"/>
            <circle cx="450" cy="360" r="98" fill="${accent}" opacity="0.35"/>
            <path d="M190 710 Q450 520 710 710 Z" fill="${accent}" opacity="0.25"/>
            <text x="450" y="376" font-family="sans-serif" font-size="44" font-weight="700" fill="#ffffff" text-anchor="middle">${title}</text>
            <text x="450" y="428" font-family="sans-serif" font-size="24" fill="#ffffff" opacity="0.88" text-anchor="middle">${subtitle}</text>
        </svg>`;
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }

    function getSeedDemoFolders() {
        return {
            'demo-album-dalat-01': {
                name: 'Pre-Wedding Minh & Lan - Đà Lạt',
                files: [
                    { id: 'img-dl-1001', name: 'IMG_1001.JPG', mimeType: 'image/jpeg', category: 'Đồi thông', createdTime: '2026-10-02T07:00:00Z', palette: ['#2f4858', '#33658a', '#f6ae2d'] },
                    { id: 'img-dl-1002', name: 'IMG_1002.JPG', mimeType: 'image/jpeg', category: 'Đồi thông', createdTime: '2026-10-02T07:05:00Z', palette: ['#3d5a80', '#98c1d9', '#ee6c4d'] },
                    { id: 'img-dl-1003', name: 'IMG_1003.JPG', mimeType: 'image/jpeg', category: 'Hồ Xuân Hương', createdTime: '2026-10-02T07:12:00Z', palette: ['#4a4e69', '#9a8c98', '#f2e9e4'] },
                    { id: 'img-dl-1004', name: 'IMG_1004.JPG', mimeType: 'image/jpeg', category: 'Hồ Xuân Hương', createdTime: '2026-10-02T07:18:00Z', palette: ['#264653', '#2a9d8f', '#e9c46a'] },
                    { id: 'img-dl-1005', name: 'IMG_1005.JPG', mimeType: 'image/jpeg', category: 'Phim trường', createdTime: '2026-10-02T07:25:00Z', palette: ['#6d597a', '#b56576', '#eaac8b'] },
                    { id: 'img-dl-1006', name: 'IMG_1006.JPG', mimeType: 'image/jpeg', category: 'Phim trường', createdTime: '2026-10-02T07:32:00Z', palette: ['#355070', '#6d597a', '#e56b6f'] }
                ]
            },
            'demo-album-tiectuoi-02': {
                name: 'Lễ Gia Tiên & Tiệc Cưới Hoàng Anh',
                files: [
                    { id: 'img-tc-2001', name: 'DSC_2001.JPG', mimeType: 'image/jpeg', category: 'Gia tiên', createdTime: '2026-10-01T08:00:00Z', palette: ['#7f4f24', '#936639', '#ede0d4'] },
                    { id: 'img-tc-2002', name: 'DSC_2002.JPG', mimeType: 'image/jpeg', category: 'Gia tiên', createdTime: '2026-10-01T08:10:00Z', palette: ['#582f0e', '#936639', '#e6ccb2'] },
                    { id: 'img-tc-2003', name: 'DSC_2003.JPG', mimeType: 'image/jpeg', category: 'Sảnh tiệc', createdTime: '2026-10-01T11:30:00Z', palette: ['#2b2d42', '#8d99ae', '#edf2f4'] },
                    { id: 'img-tc-2004', name: 'DSC_2004.JPG', mimeType: 'image/jpeg', category: 'Sảnh tiệc', createdTime: '2026-10-01T12:15:00Z', palette: ['#1d3557', '#457b9d', '#f1faee'] }
                ]
            },
            'demo-album-studio-03': {
                name: 'Studio Concept Minimalist 2026',
                files: [
                    { id: 'img-st-3001', name: 'RAW_3001.JPG', mimeType: 'image/jpeg', category: 'Studio', createdTime: '2026-09-28T15:00:00Z', palette: ['#22223b', '#4a4e69', '#c9ada7'] },
                    { id: 'img-st-3002', name: 'RAW_3002.JPG', mimeType: 'image/jpeg', category: 'Studio', createdTime: '2026-09-28T15:20:00Z', palette: ['#343a40', '#6c757d', '#dee2e6'] },
                    { id: 'img-st-3003', name: 'RAW_3003.JPG', mimeType: 'image/jpeg', category: 'Studio', createdTime: '2026-09-28T15:40:00Z', palette: ['#212529', '#495057', '#adb5bd'] }
                ]
            }
        };
    }

    function buildSeedMockState() {
        const today = new Date();
        const soonDate = new Date(today.getTime() + 2 * 86400000).toISOString().slice(0, 10);
        const laterDate = new Date(today.getTime() + 10 * 86400000).toISOString().slice(0, 10);
        return {
            nextId: 200,
            users: [
                {
                    id: 1,
                    name: 'TeeMedia Studio',
                    email: 'studio@gmail.com',
                    phone: '0901 234 567',
                    password: '123456',
                    status: 'active',
                    avatar: ''
                }
            ],
            albums: [
                { id: 1, user_id: 1, album_name: 'Pre-Wedding Minh & Lan - Đà Lạt', folder_id: 'demo-album-dalat-01', allow_save: 1, created_at: '2026-10-02 08:30:00', deleted_at: null },
                { id: 2, user_id: 1, album_name: 'Lễ Gia Tiên & Tiệc Cưới Hoàng Anh', folder_id: 'demo-album-tiectuoi-02', allow_save: 0, created_at: '2026-10-01 14:15:00', deleted_at: null },
                { id: 3, user_id: 1, album_name: 'Studio Concept Minimalist 2026', folder_id: 'demo-album-studio-03', allow_save: 1, created_at: '2026-09-28 19:05:00', deleted_at: null }
            ],
            driveFolders: getSeedDemoFolders(),
            savedState: {
                'photoSelectionsByAlbum:demo-album-dalat-01': ['img-dl-1001', 'img-dl-1004'],
                'photoSelectionsByAlbum:demo-album-tiectuoi-02': ['img-tc-2001']
            },
            photo_selections: [
                { id: 1, owner_user_id: 1, folder_id: 'demo-album-dalat-01', photo_id: 'img-dl-1001', photo_name: 'IMG_1001.JPG', category: 'Đồi thông', guest_name: 'Cô dâu Lan', share_token: '', selected_at: '2026-10-02 09:15:00' },
                { id: 2, owner_user_id: 1, folder_id: 'demo-album-dalat-01', photo_id: 'img-dl-1004', photo_name: 'IMG_1004.JPG', category: 'Hồ Xuân Hương', guest_name: 'Chú rể Minh', share_token: '', selected_at: '2026-10-02 09:22:00' },
                { id: 3, owner_user_id: 1, folder_id: 'demo-album-tiectuoi-02', photo_id: 'img-tc-2001', photo_name: 'DSC_2001.JPG', category: 'Gia tiên', guest_name: 'Hoàng Anh', share_token: '', selected_at: '2026-10-01 15:10:00' }
            ],
            comments: [
                { id: 1, photo_id: 'img-dl-1001', author: 'Cô dâu Lan', user_id: 0, comment_text: 'Tấm này ánh sáng đẹp quá, chỉnh màu ấm giúp em nhé!', created_at: '2026-10-02 09:15:00' },
                { id: 2, photo_id: 'img-dl-1004', author: 'Chú rể Minh', user_id: 0, comment_text: 'In ảnh cổng cỡ 60x90 tấm này.', created_at: '2026-10-02 09:22:00' }
            ],
            notifications: [
                { id: 101, user_id: 1, title: 'Khách hàng đã chọn xong ảnh', message: 'Album Pre-Wedding Minh & Lan - Đà Lạt vừa cập nhật 2 ảnh yêu thích và 2 bình luận mới.', created_at: '2026-10-02 09:25:00', is_read: 0 }
            ],
            chatMessages: [
                { sender_type: 'admin', message: 'Xin chào! Chào mừng bạn đến với TeeMedia phiên bản Static / GitHub Pages.' }
            ],
            photographers: [
                { id: 1, user_id: 1, name: 'Nguyễn Minh Anh', role: 'Chụp ảnh cưới chính', phone: '0903 111 222', email: 'minhanh@teemedia.vn', zalo: '0903111222', facebook: 'minhanh.photo', shootLocation: 'Đà Lạt / TP.HCM', shootDates: [soonDate, laterDate], status: 'active' },
                { id: 2, user_id: 1, name: 'Trần Quốc Thịnh', role: 'Phóng sự cưới', phone: '0908 333 444', email: 'quocthinh@teemedia.vn', zalo: '0908333444', facebook: 'quocthinh.studio', shootLocation: 'Quận 1, TP.HCM', shootDates: [laterDate], status: 'active' },
                { id: 3, user_id: 1, name: 'Lê Hà Linh', role: 'Chân dung & Studio', phone: '0912 555 666', email: 'halinh@teemedia.vn', zalo: '0912555666', facebook: 'halinh.portrait', shootLocation: 'Studio Quận 3', shootDates: [], status: 'leave' }
            ],
            contracts: [
                {
                    id: 1, user_id: 1, studioName: 'TeeMedia Studio', contractNumber: 'PS-20261002-001',
                    studioAddress: '12 Nguyễn Huệ, Quận 1, TP.HCM', studioPhone: '0901 234 567', contractDate: '2026-10-02',
                    clientName: 'Trần Minh & Ngọc Lan', clientPhone: '0987 654 321', clientEmail: 'minhlan@gmail.com',
                    servicePreset: 'Gói chụp ảnh cưới trọn gói', serviceName: 'Gói chụp ảnh cưới trọn gói', eventType: 'Chụp cưới',
                    shootDate: soonDate, shootDateSecondary: '', shootLocation: 'Đồi thông Đà Lạt & Studio', shootSchedule: 'Chụp ngoại cảnh Đà Lạt',
                    deliverables: '01 buổi chụp ngoại cảnh; 30 ảnh lớn 30x45; 200 ảnh chỉnh sửa; 01 album online.',
                    weddingAddon: 'Thêm 01 video highlight ngắn.', totalPrice: '25000000', deposit: '12000000',
                    paymentTerms: 'Đặt cọc 50% khi ký hợp đồng, thanh toán phần còn lại khi nhận ảnh.',
                    extraTerms: 'Hỗ trợ chỉnh sửa màu theo tone yêu cầu.'
                }
            ],
            customers: [
                { id: 1, user_id: 1, name: 'Trần Minh & Ngọc Lan', phone: '0987 654 321', email: 'minhlan@gmail.com', social: '0987654321', packageName: 'Gói chụp ảnh cưới trọn gói', shootDate: soonDate, budget: 25000000, status: 'confirmed', notes: 'Ưu tiên tone màu phim ấm Đà Lạt' },
                { id: 2, user_id: 1, name: 'Phạm Hoàng Anh', phone: '0909 888 777', email: 'hoanganh@gmail.com', social: '0909888777', packageName: 'Gói đám hỏi & tiệc cưới', shootDate: laterDate, budget: 18500000, status: 'shooting', notes: 'Đang hậu kỳ ảnh lễ gia tiên' },
                { id: 3, user_id: 1, name: 'Vũ Thảo Vy', phone: '0938 222 111', email: 'thaovy@gmail.com', social: 'thaovy.wedding', packageName: 'Gói chụp studio nghệ thuật', shootDate: '', budget: 9500000, status: 'lead', notes: 'Đang tư vấn concept Minimalist' }
            ],
            portfolio: {
                updated_at: null,
                headline: '',
                subtitle: '',
                albums: [],
                photos: []
            }
        };
    }

    function normalizePortfolioConfig(raw) {
        const src = (raw && typeof raw === 'object') ? raw : {};
        const rawAlbums = Array.isArray(src.albums)
            ? src.albums
            : (src.albums && typeof src.albums === 'object' ? Object.values(src.albums) : []);
        const rawPhotos = Array.isArray(src.photos)
            ? src.photos
            : (src.photos && typeof src.photos === 'object' ? Object.values(src.photos) : []);
        const albums = rawAlbums
            .filter(a => a && a.folder_id)
            .map(a => ({
                folder_id: String(a.folder_id),
                album_name: String(a.album_name || 'Album ảnh'),
                allow_save: Number(a.allow_save) === 1 ? 1 : 0,
                created_at: a.created_at || null,
                cover_photo_id: a.cover_photo_id ? String(a.cover_photo_id) : '',
                photo_ids: Array.isArray(a.photo_ids)
                    ? a.photo_ids.map(String)
                    : (a.photo_ids && typeof a.photo_ids === 'object' ? Object.values(a.photo_ids).map(String) : [])
            }));
        const seenPhotoKeys = new Set();
        const photos = [];
        for (const p of rawPhotos) {
            if (!p || !p.id) continue;
            const pid = String(p.id);
            const fid = String(p.folder_id || '');
            const key = `${fid}::${pid}`;
            if (seenPhotoKeys.has(key)) continue;
            seenPhotoKeys.add(key);
            const item = {
                id: pid,
                name: String(p.name || 'IMG.jpg'),
                folder_id: fid,
                album_name: String(p.album_name || 'Album ảnh'),
                category: String(p.category || p.album_name || 'Album ảnh'),
                thumbnailLink: String(p.thumbnailLink || ''),
                thumbnailUrl: String(p.thumbnailUrl || ''),
                fullUrl: String(p.fullUrl || ''),
                mimeType: String(p.mimeType || 'image/jpeg'),
                createdTime: p.createdTime || null,
                modifiedTime: p.modifiedTime || null
            };
            if (Number(p.size) > 0) item.size = Number(p.size);
            photos.push(item);
        }
        return {
            updated_at: src.updated_at || null,
            headline: String(src.headline || '').trim(),
            subtitle: String(src.subtitle || '').trim(),
            albums,
            photos
        };
    }

    function loadMockState() {
        try {
            const raw = localStorage.getItem(MOCK_STORAGE_KEY);
            if (!raw) {
                const seeded = buildSeedMockState();
                localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(seeded));
                return seeded;
            }
            const parsed = JSON.parse(raw);
            if (!parsed.driveFolders) parsed.driveFolders = getSeedDemoFolders();
            if (!Array.isArray(parsed.photo_selections)) parsed.photo_selections = [];
            if (Array.isArray(parsed.users)) {
                parsed.users.forEach(u => {
                    if (/(hd[\s-]*design|photo[\s-]*select|luna[\s-]*frame)/i.test(String(u?.name || ''))) {
                        u.name = 'TeeMedia Studio';
                    }
                });
            }
            return parsed;
        } catch {
            return buildSeedMockState();
        }
    }

    function saveMockState(state) {
        try {
            localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
        } catch (error) {
            console.warn('Không thể lưu dữ liệu cục bộ.', error);
        }
    }

    function getStaticSessionUser(state) {
        const raw = localStorage.getItem(STATIC_SESSION_KEY);
        const storedId = raw === null ? 0 : Number(raw);
        if (!storedId || storedId <= 0) return null;
        const user = (state.users || []).find(u => Number(u.id) === storedId);
        if (!user || user.status === 'disabled') return null;
        return { id: user.id, name: user.name, email: user.email, phone: user.phone, status: user.status || 'active', avatar: user.avatar || '' };
    }

    function enrichDemoFile(file) {
        const url = createDemoSvgDataUrl(file.name, file.category || 'Album', file.palette);
        return { ...file, thumbnailUrl: url, fullUrl: url };
    }

    function findDemoFileById(state, fileId) {
        for (const folder of Object.values(state.driveFolders || {})) {
            const found = (folder.files || []).find(item => String(item.id) === String(fileId));
            if (found) return enrichDemoFile(found);
        }
        return null;
    }

    function getActiveCloudUrl() {
        const params = new URLSearchParams(global.location.search);
        const shareRaw = params.get('share') || '';
        if (shareRaw.startsWith('v1.')) {
            const decoded = decodeBase64Url(shareRaw);
            if (decoded?.c) return String(decoded.c).replace(/\/+$/, '');
        }
        return getCloudConfig().firebaseDbUrl || '';
    }

    function getActiveDriveApiKey() {
        const params = new URLSearchParams(global.location.search);
        const shareRaw = params.get('share') || '';
        if (shareRaw.startsWith('v1.')) {
            const decoded = decodeBase64Url(shareRaw);
            if (decoded?.k) return String(decoded.k);
        }
        return getCloudConfig().googleApiKey || '';
    }

    async function cloudGet(path) {
        const base = getActiveCloudUrl();
        if (!base) return null;
        try {
            const res = await nativeFetch(`${base}/${path}.json`);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }

    async function cloudPut(path, data) {
        const base = getActiveCloudUrl();
        if (!base) return false;
        try {
            const res = await nativeFetch(`${base}/${path}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return res.ok;
        } catch {
            return false;
        }
    }

    const SEED_DEMO_FOLDER_IDS = new Set([
        'demo-album-dalat-01',
        'demo-album-tiectuoi-02',
        'demo-album-studio-03'
    ]);
    let workspaceSyncPromise = null;
    let lastWorkspaceSyncAt = 0;

    function mergeWorkspaceArray(localArr, cloudArr, keyFn, isSeedFn) {
        const safeLocal = Array.isArray(localArr) ? localArr : [];
        if (!Array.isArray(cloudArr)) {
            return { items: safeLocal, dirty: safeLocal.length > 0 };
        }
        const merged = [...cloudArr];
        const existing = new Set(merged.map(keyFn));
        let dirty = false;
        safeLocal.forEach(item => {
            const k = keyFn(item);
            if (!existing.has(k) && (!isSeedFn || !isSeedFn(item))) {
                merged.push(item);
                existing.add(k);
                dirty = true;
            }
        });
        return { items: merged, dirty };
    }

    function mergeWorkspaceUsers(localUsers, cloudUsers) {
        const seedDefault = buildSeedMockState().users[0];
        const { items, dirty } = mergeWorkspaceArray(
            localUsers,
            cloudUsers,
            u => String(u?.email || u?.id || '').trim().toLowerCase(),
            u => String(u?.email || '').trim().toLowerCase() === 'studio@gmail.com'
        );
        let nextDirty = dirty;
        if (!items.some(u => String(u?.email || '').trim().toLowerCase() === 'studio@gmail.com')) {
            items.unshift(seedDefault);
            nextDirty = true;
        }
        return { items, dirty: nextDirty };
    }

    async function ensureWorkspaceSynced(state, force = false) {
        const base = getActiveCloudUrl();
        if (!base) return state;
        const now = Date.now();
        if (!force && lastWorkspaceSyncAt > 0 && (now - lastWorkspaceSyncAt) < 2500) {
            return state;
        }
        if (workspaceSyncPromise && !force) {
            return workspaceSyncPromise;
        }

        workspaceSyncPromise = (async () => {
            try {
                const cloudWs = await cloudGet('workspace');
                if (!cloudWs || typeof cloudWs !== 'object') {
                    await cloudPut('workspace', {
                        users: state.users || [],
                        albums: state.albums || [],
                        customers: state.customers || [],
                        contracts: state.contracts || [],
                        photographers: state.photographers || [],
                        notifications: state.notifications || [],
                        portfolio: normalizePortfolioConfig(state.portfolio),
                        updated_at: new Date().toISOString()
                    });
                    lastWorkspaceSyncAt = Date.now();
                    return state;
                }

                let shouldPush = false;
                const usersMerge = mergeWorkspaceUsers(state.users, cloudWs.users);
                state.users = usersMerge.items;
                if (usersMerge.dirty) shouldPush = true;

                const albumsMerge = mergeWorkspaceArray(
                    state.albums,
                    cloudWs.albums,
                    a => String(a?.folder_id || a?.id || ''),
                    a => SEED_DEMO_FOLDER_IDS.has(String(a?.folder_id || ''))
                );
                state.albums = albumsMerge.items;
                if (albumsMerge.dirty) shouldPush = true;

                const customersMerge = mergeWorkspaceArray(
                    state.customers,
                    cloudWs.customers,
                    c => `${String(c?.phone || '').trim()}|${String(c?.email || '').trim()}|${String(c?.name || '').trim()}`.toLowerCase(),
                    c => Number(c?.id || 0) <= 3
                );
                state.customers = customersMerge.items;
                if (customersMerge.dirty) shouldPush = true;

                const contractsMerge = mergeWorkspaceArray(
                    state.contracts,
                    cloudWs.contracts,
                    c => String(c?.contractNumber || c?.id || '').trim().toLowerCase(),
                    c => Number(c?.id || 0) <= 1
                );
                state.contracts = contractsMerge.items;
                if (contractsMerge.dirty) shouldPush = true;

                const photographersMerge = mergeWorkspaceArray(
                    state.photographers,
                    cloudWs.photographers,
                    p => `${String(p?.email || '').trim()}|${String(p?.name || '').trim()}`.toLowerCase(),
                    p => Number(p?.id || 0) <= 3
                );
                state.photographers = photographersMerge.items;
                if (photographersMerge.dirty) shouldPush = true;

                if (Array.isArray(cloudWs.notifications)) {
                    const notifMerge = mergeWorkspaceArray(
                        state.notifications,
                        cloudWs.notifications,
                        n => `${String(n?.title || '')}|${String(n?.created_at || '')}|${String(n?.message || '')}`,
                        n => Number(n?.id || 0) <= 105
                    );
                    state.notifications = notifMerge.items;
                    if (notifMerge.dirty) shouldPush = true;
                }

                const localPortfolio = normalizePortfolioConfig(state.portfolio);
                if (cloudWs.portfolio && typeof cloudWs.portfolio === 'object') {
                    const cloudPortfolio = normalizePortfolioConfig(cloudWs.portfolio);
                    const localTs = Date.parse(localPortfolio.updated_at || '') || 0;
                    const cloudTs = Date.parse(cloudPortfolio.updated_at || '') || 0;
                    if (cloudTs >= localTs) {
                        state.portfolio = cloudPortfolio;
                    } else {
                        state.portfolio = localPortfolio;
                        shouldPush = true;
                    }
                } else {
                    state.portfolio = localPortfolio;
                    if (localPortfolio.updated_at || localPortfolio.albums.length || localPortfolio.photos.length) {
                        shouldPush = true;
                    }
                }

                const maxId = [
                    ...(state.users || []),
                    ...(state.albums || []),
                    ...(state.customers || []),
                    ...(state.contracts || []),
                    ...(state.photographers || []),
                    ...(state.notifications || [])
                ].reduce((acc, item) => Math.max(acc, Number(item?.id || 0)), Number(state.nextId || 200));
                state.nextId = maxId + 1;

                saveMockState(state);
                if (shouldPush) {
                    await cloudPut('workspace', {
                        users: state.users || [],
                        albums: state.albums || [],
                        customers: state.customers || [],
                        contracts: state.contracts || [],
                        photographers: state.photographers || [],
                        notifications: state.notifications || [],
                        portfolio: normalizePortfolioConfig(state.portfolio),
                        updated_at: new Date().toISOString()
                    });
                }
                lastWorkspaceSyncAt = Date.now();
            } catch (err) {
                console.warn('Không thể đồng bộ workspace Firebase:', err);
            } finally {
                workspaceSyncPromise = null;
            }
            return state;
        })();

        return workspaceSyncPromise;
    }

    async function pushWorkspaceSection(section, data) {
        if (!getActiveCloudUrl()) return false;
        lastWorkspaceSyncAt = Date.now();
        return cloudPut(`workspace/${section}`, data);
    }

    function syncMockPhotoSelections(state, folderId, selectedIds, guestName = 'Khách xem album', shareToken = '', photoMeta = []) {
        const cleanIds = [...new Set((selectedIds || []).map(String).filter(Boolean))];
        state.savedState[`photoSelectionsByAlbum:${folderId}`] = cleanIds;

        const metaMap = new Map((photoMeta || []).map(m => [String(m.id), m]));
        const prevMap = new Map((state.photo_selections || []).filter(r => r.folder_id === folderId).map(r => [String(r.photo_id), r]));
        state.photo_selections = (state.photo_selections || []).filter(r => r.folder_id !== folderId);

        const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
        cleanIds.forEach(pid => {
            const prev = prevMap.get(pid);
            const meta = metaMap.get(pid);
            const demo = findDemoFileById(state, pid);
            state.photo_selections.push({
                id: ++state.nextId,
                owner_user_id: 1,
                folder_id: folderId,
                photo_id: pid,
                photo_name: meta?.name || prev?.photo_name || demo?.name || pid,
                category: meta?.category || prev?.category || demo?.category || 'Album',
                guest_name: guestName || prev?.guest_name || 'Khách xem album',
                share_token: shareToken || prev?.share_token || '',
                selected_at: prev?.selected_at || now
            });
        });
    }

    async function handleMockAction(payload) {
        const state = loadMockState();
        const action = payload?.action;
        if ([
            'session_state',
            'login',
            'register',
            'forgot',
            'load_albums',
            'load_portfolio_setup',
            'save_portfolio_setup',
            'load_public_portfolio',
            'load_deleted_albums',
            'save_album',
            'update_album_permission',
            'delete_album',
            'restore_album',
            'get_notifications',
            'photographers_list',
            'contracts_list',
            'customers_list',
            'reports_summary',
            'list_staff_accounts',
            'create_staff_account',
            'toggle_staff_account',
            'delete_staff_account'
        ].includes(action)) {
            await ensureWorkspaceSynced(
                state,
                action === 'login' ||
                    action === 'load_albums' ||
                    action === 'list_staff_accounts' ||
                    action === 'load_portfolio_setup' ||
                    action === 'load_public_portfolio'
            );
        }
        const user = getStaticSessionUser(state);

        switch (action) {
            case 'session_state':
                return { success: true, user };

            case 'login': {
                const loginId = String(payload.login_id || payload.email || '').trim().toLowerCase();
                const pw = String(payload.password || '');
                const found = (state.users || []).find(u =>
                    (String(u.email).toLowerCase() === loginId || String(u.id) === loginId) && String(u.password) === pw
                );
                if (!found) return { success: false, message: 'Email/ID hoặc mật khẩu không đúng. Chỉ tài khoản được cấp mới có thể đăng nhập.' };
                if (found.status === 'disabled') return { success: false, message: 'Tài khoản này đang bị tạm khóa. Vui lòng liên hệ quản trị viên.' };
                localStorage.setItem(STATIC_SESSION_KEY, String(found.id));
                return { success: true, message: 'Đăng nhập thành công.', user: { id: found.id, name: found.name, email: found.email, phone: found.phone, status: found.status || 'active' } };
            }

            case 'register':
                return { success: false, message: 'Chức năng đăng ký tự do đã tắt. Chỉ quản trị viên TeeMedia Studio mới có quyền cấp tài khoản.' };

            case 'forgot':
                return { success: false, message: 'Vui lòng liên hệ trực tiếp quản trị viên TeeMedia Studio để được cấp lại mật khẩu.' };

            case 'logout':
                localStorage.setItem(STATIC_SESSION_KEY, '0');
                return { success: true };

            case 'update_phone': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const target = state.users.find(u => u.id === user.id);
                if (target) target.phone = String(payload.phone || '').trim();
                saveMockState(state);
                await pushWorkspaceSection('users', state.users);
                return { success: true, user: getStaticSessionUser(state), message: 'Đã cập nhật số điện thoại.' };
            }

            case 'load_albums': {
                if (!user) return { success: true, data: [] };
                const active = (state.albums || []).filter(a => !a.deleted_at);
                const enriched = await Promise.all(active.map(async a => {
                    const cloudData = await cloudGet(`selections/${encodeURIComponent(a.folder_id)}`);
                    const records = cloudData?.records || (state.photo_selections || []).filter(r => r.folder_id === a.folder_id);
                    const lastRec = records[records.length - 1];
                    return {
                        ...a,
                        selected_count: records.length,
                        last_selected_at: lastRec?.selected_at || null,
                        selected_guests: [...new Set(records.map(r => r.guest_name).filter(Boolean))]
                    };
                }));
                return { success: true, data: enriched };
            }

            case 'load_portfolio_setup': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const activeAlbums = (state.albums || []).filter(a => !a.deleted_at && String(a.folder_id) !== 'test_check_folder');
                const realAlbums = activeAlbums.filter(a => !SEED_DEMO_FOLDER_IDS.has(String(a.folder_id || '')));
                const availableAlbums = realAlbums.length ? realAlbums : activeAlbums;
                return {
                    success: true,
                    portfolio: normalizePortfolioConfig(state.portfolio),
                    albums: availableAlbums
                };
            }

            case 'save_portfolio_setup': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const normalized = normalizePortfolioConfig(payload.portfolio || payload);
                normalized.updated_at = new Date().toISOString();
                state.portfolio = normalized;
                saveMockState(state);
                await pushWorkspaceSection('portfolio', normalized);
                return {
                    success: true,
                    portfolio: normalized,
                    message: 'Đã lưu và xuất bản Portfolio thành công!'
                };
            }

            case 'load_public_portfolio': {
                const activeMap = new Map(
                    (state.albums || [])
                        .filter(a => !a.deleted_at && String(a.folder_id) !== 'test_check_folder')
                        .map(a => [String(a.folder_id), a])
                );
                const portfolio = normalizePortfolioConfig(state.portfolio);
                const primaryUser = (state.users || [])[0] || { name: 'TeeMedia Studio', phone: '0901 234 567', email: 'studio@gmail.com' };
                const studioName = /(hd[\s-]*design|photo[\s-]*select|luna[\s-]*frame)/i.test(String(primaryUser.name || ''))
                    ? 'TeeMedia Studio'
                    : (primaryUser.name || 'TeeMedia Studio');

                const enabledFolderIds = new Set();
                const albums = [];
                portfolio.albums.forEach(cfg => {
                    const fid = String(cfg.folder_id || '');
                    if (!fid) return;
                    if (activeMap.size > 0 && !activeMap.has(fid)) return;
                    const active = activeMap.get(fid);
                    enabledFolderIds.add(fid);
                    const albumPhotos = portfolio.photos.filter(p => String(p.folder_id) === fid);
                    if (!albumPhotos.length) return;
                    albums.push({
                        id: active?.id || fid,
                        album_name: active?.album_name || cfg.album_name || 'Album ảnh',
                        folder_id: fid,
                        allow_save: Number(active?.allow_save ?? cfg.allow_save) === 1 ? 1 : 0,
                        created_at: active?.created_at || cfg.created_at || null,
                        cover_photo_id: cfg.cover_photo_id || albumPhotos[0]?.id || '',
                        photo_count: albumPhotos.length
                    });
                });

                const curatedPhotos = portfolio.photos.filter(p => enabledFolderIds.has(String(p.folder_id || '')));
                // Fallback if owner saved photos without matching album entry
                const validAlbumIds = new Set(albums.map(a => String(a.folder_id)));
                const finalPhotos = curatedPhotos.filter(p => validAlbumIds.has(String(p.folder_id || '')));

                return {
                    success: true,
                    curated: true,
                    updated_at: portfolio.updated_at || null,
                    headline: portfolio.headline || '',
                    subtitle: portfolio.subtitle || '',
                    studio: {
                        name: studioName,
                        phone: primaryUser.phone || '0901 234 567',
                        email: primaryUser.email || 'studio@gmail.com'
                    },
                    albums,
                    photos: finalPhotos
                };
            }

            case 'load_deleted_albums':
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                return { success: true, data: (state.albums || []).filter(a => a.deleted_at) };

            case 'save_album': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const folderId = String(payload.folder_id || '').trim();
                if (state.albums.some(item => String(item.folder_id) === folderId && !item.deleted_at)) {
                    return { success: false, message: 'Album này đã có trong danh sách.' };
                }
                const newAlbum = {
                    id: ++state.nextId,
                    user_id: user?.id || 1,
                    album_name: payload.album_name || `Album ${folderId.slice(0, 8)}`,
                    folder_id: folderId,
                    allow_save: payload.allow_save ? 1 : 0,
                    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
                    deleted_at: null
                };
                state.albums.unshift(newAlbum);
                saveMockState(state);
                await pushWorkspaceSection('albums', state.albums);
                return { success: true, data: newAlbum };
            }

            case 'update_album_permission': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const album = state.albums.find(item => String(item.id) === String(payload.album_id));
                if (!album) return { success: false, message: 'Không tìm thấy album.' };
                album.allow_save = payload.allow_save ? 1 : 0;
                saveMockState(state);
                await pushWorkspaceSection('albums', state.albums);
                return { success: true, allow_save: album.allow_save };
            }

            case 'delete_album': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const album = state.albums.find(item => String(item.id) === String(payload.album_id));
                if (album) album.deleted_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
                saveMockState(state);
                await pushWorkspaceSection('albums', state.albums);
                return { success: true };
            }

            case 'restore_album': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const album = state.albums.find(item => String(item.id) === String(payload.album_id));
                if (album) album.deleted_at = null;
                saveMockState(state);
                await pushWorkspaceSection('albums', state.albums);
                return { success: true };
            }

            case 'create_share_link': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const folderId = String(payload.folder_id || '').trim();
                const album = state.albums.find(item => String(item.folder_id) === folderId && !item.deleted_at);
                const code = String(payload.access_code || '').trim();
                const cloudCfg = getCloudConfig();
                const shareObj = {
                    f: folderId,
                    n: album?.album_name || 'Album ảnh',
                    a: album ? (Number(album.allow_save) === 1 ? 1 : 0) : 1,
                    o: user?.name || 'TeeMedia'
                };
                if (code) shareObj.ch = await sha256Hex(code);
                if (cloudCfg.googleApiKey) shareObj.k = cloudCfg.googleApiKey;
                if (cloudCfg.firebaseDbUrl) shareObj.c = cloudCfg.firebaseDbUrl;

                const token = `v1.${encodeBase64Url(shareObj)}`;
                const baseUrl = new URL('./', global.location.href).toString();
                return {
                    success: true,
                    url: `${baseUrl}?share=${encodeURIComponent(token)}`,
                    requires_code: Boolean(code),
                    token
                };
            }

            case 'get_share_permission': {
                const token = String(payload.share_token || '');
                if (token.startsWith('v1.')) {
                    const decoded = decodeBase64Url(token);
                    if (decoded?.f) {
                        const cloudAlbums = await cloudGet('workspace/albums');
                        if (Array.isArray(cloudAlbums)) {
                            const matched = cloudAlbums.find(a => String(a?.folder_id || '') === String(decoded.f) && !a?.deleted_at);
                            if (matched) {
                                return { success: true, allow_save: Number(matched.allow_save) === 1 };
                            }
                        }
                    }
                    return { success: true, allow_save: decoded ? Boolean(decoded.a) : true };
                }
                return { success: true, allow_save: true };
            }

            case 'load_state': {
                const data = {};
                for (const key of (payload.keys || [])) {
                    const match = /^photoSelectionsByAlbum:(.+)$/.exec(String(key));
                    if (match) {
                        const cloud = await cloudGet(`selections/${encodeURIComponent(match[1])}`);
                        if (cloud?.selected_ids) {
                            data[key] = cloud.selected_ids;
                            continue;
                        }
                    }
                    if (key in state.savedState) data[key] = state.savedState[key];
                }
                return { success: true, data };
            }

            case 'save_state': {
                Object.entries(payload.data || {}).forEach(([k, v]) => {
                    state.savedState[k] = v;
                    const m = /^photoSelectionsByAlbum:(.+)$/.exec(k);
                    if (m) syncMockPhotoSelections(state, m[1], v);
                });
                saveMockState(state);
                return { success: true };
            }

            case 'save_photo_selection':
            case 'confirm_guest_selection': {
                const fid = String(payload.folder_id || '').trim();
                syncMockPhotoSelections(
                    state,
                    fid,
                    payload.selected_photos || [],
                    payload.guest_name || user?.name || 'Khách xem album',
                    payload.share_token || '',
                    payload.photo_meta || []
                );
                const records = (state.photo_selections || []).filter(r => r.folder_id === fid);
                await cloudPut(`selections/${encodeURIComponent(fid)}`, {
                    selected_ids: records.map(r => r.photo_id),
                    records,
                    updated_at: new Date().toISOString()
                });
                if (action === 'confirm_guest_selection') {
                    state.notifications.unshift({
                        id: ++state.nextId,
                        user_id: 1,
                        title: `Khách đã chốt chọn ${records.length} ảnh`,
                        message: `${payload.guest_name || 'Khách'} vừa gửi danh sách ${records.length} ảnh đã chọn.`,
                        created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
                        is_read: 0
                    });
                }
                saveMockState(state);
                return { success: true, total_selected: records.length, message: `Đã lưu và gửi danh sách ${records.length} ảnh đã chọn.` };
            }

            case 'load_album_selections': {
                const fid = String(payload.folder_id || '').trim();
                const cloud = await cloudGet(`selections/${encodeURIComponent(fid)}`);
                const records = cloud?.records || (state.photo_selections || []).filter(r => r.folder_id === fid);
                const selectedIds = records.length ? records.map(r => String(r.photo_id)) : (state.savedState[`photoSelectionsByAlbum:${fid}`] || []);
                const lastRec = records[records.length - 1];
                return {
                    success: true,
                    folder_id: fid,
                    selected_ids: selectedIds,
                    records,
                    summary: {
                        total_selected: selectedIds.length,
                        last_selected_at: lastRec?.selected_at || null,
                        guests: [...new Set(records.map(r => r.guest_name).filter(Boolean))]
                    }
                };
            }

            case 'load_all_comments': {
                const cloudComments = await cloudGet('comments');
                return { success: true, data: Array.isArray(cloudComments) ? cloudComments : state.comments };
            }

            case 'load_comments': {
                const cloudComments = await cloudGet('comments');
                const list = Array.isArray(cloudComments) ? cloudComments : state.comments;
                return { success: true, data: list.filter(item => String(item.photo_id) === String(payload.photo_id)) };
            }

            case 'save_comment': {
                const cloudComments = await cloudGet('comments');
                const list = Array.isArray(cloudComments) ? cloudComments : state.comments;
                const item = {
                    id: ++state.nextId,
                    photo_id: payload.photo_id,
                    author: user?.name || 'Khách xem album',
                    user_id: user?.id || 0,
                    comment_text: payload.comment_text,
                    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19)
                };
                list.push(item);
                state.comments = list;
                saveMockState(state);
                await cloudPut('comments', list);
                return { success: true, data: item };
            }

            case 'get_notifications':
                return { success: true, notifications: user ? state.notifications : [] };

            case 'mark_notification_read': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const target = state.notifications.find(item => String(item.id) === String(payload.notification_id));
                if (target) target.is_read = 1;
                saveMockState(state);
                await pushWorkspaceSection('notifications', state.notifications);
                return { success: true };
            }

            case 'load_chat':
                return { success: true, conversation_id: payload.conversation_id || 'demo-conversation', data: state.chatMessages, typing: null };

            case 'contact_admin':
                state.chatMessages.push({ sender_type: 'guest', message: payload.message });
                saveMockState(state);
                return { success: true, conversation_id: 'demo-conversation', data: state.chatMessages, message: 'Đã gửi tin nhắn (Static Mode).' };

            case 'set_chat_typing':
                return { success: true, conversation_id: payload.conversation_id || 'demo-conversation' };

            case 'photographers_list':
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                return { success: true, photographers: state.photographers || [] };

            case 'photographers_save': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const p = { ...(payload.photographer || {}) };
                if (p.id) {
                    const idx = state.photographers.findIndex(x => String(x.id) === String(p.id));
                    if (idx >= 0) state.photographers[idx] = p;
                } else {
                    p.id = ++state.nextId;
                    state.photographers.unshift(p);
                }
                saveMockState(state);
                await pushWorkspaceSection('photographers', state.photographers);
                return { success: true, photographer: p };
            }

            case 'photographers_delete':
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                state.photographers = (state.photographers || []).filter(x => String(x.id) !== String(payload.id));
                saveMockState(state);
                await pushWorkspaceSection('photographers', state.photographers);
                return { success: true };

            case 'contracts_list':
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                return { success: true, contracts: state.contracts || [] };

            case 'contracts_save': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const c = { ...(payload.contract || {}) };
                if (c.id) {
                    const idx = state.contracts.findIndex(x => String(x.id) === String(c.id));
                    if (idx >= 0) state.contracts[idx] = c;
                } else {
                    c.id = ++state.nextId;
                    state.contracts.unshift(c);
                }
                saveMockState(state);
                await pushWorkspaceSection('contracts', state.contracts);
                return { success: true, contract: c };
            }

            case 'contracts_delete':
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                state.contracts = (state.contracts || []).filter(x => String(x.id) !== String(payload.id));
                saveMockState(state);
                await pushWorkspaceSection('contracts', state.contracts);
                return { success: true };

            case 'customers_list':
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                return { success: true, customers: state.customers || [] };

            case 'customers_save': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const c = { ...(payload.customer || {}) };
                if (c.id) {
                    const idx = state.customers.findIndex(x => String(x.id) === String(c.id));
                    if (idx >= 0) state.customers[idx] = c;
                } else {
                    c.id = ++state.nextId;
                    state.customers.unshift(c);
                }
                saveMockState(state);
                await pushWorkspaceSection('customers', state.customers);
                return { success: true, customer: c };
            }

            case 'customers_delete':
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                state.customers = (state.customers || []).filter(x => String(x.id) !== String(payload.id));
                saveMockState(state);
                await pushWorkspaceSection('customers', state.customers);
                return { success: true };

            case 'reports_summary': {
                if (!user) return { success: false, message: 'Chưa đăng nhập.' };
                const albums = (state.albums || []).filter(a => !a.deleted_at);
                const contracts = state.contracts || [];
                const totalContractValue = contracts.reduce((s, c) => s + (Number(c.totalPrice) || 0), 0);
                const totalContractDeposit = contracts.reduce((s, c) => s + (Number(c.deposit) || 0), 0);
                return {
                    success: true,
                    report: {
                        totalAlbums: albums.length,
                        allowedAlbums: albums.filter(a => Number(a.allow_save) === 1).length,
                        totalSelectedPhotos: (state.photo_selections || []).length,
                        totalComments: (state.comments || []).length,
                        totalPhotographers: (state.photographers || []).length,
                        activePhotographers: (state.photographers || []).filter(p => p.status === 'active').length,
                        totalCustomers: (state.customers || []).length,
                        totalContracts: contracts.length,
                        totalContractValue,
                        totalContractDeposit,
                        recentContracts: contracts.slice(0, 6)
                    }
                };
            }

            case 'list_staff_accounts': {
                if (!user || Number(user.id) !== 1) return { success: false, message: 'Chỉ chủ Studio mới có quyền quản lý tài khoản.' };
                return {
                    success: true,
                    accounts: (state.users || []).map(u => ({
                        id: u.id,
                        name: u.name,
                        email: u.email,
                        phone: u.phone || '',
                        status: u.status || 'active'
                    }))
                };
            }

            case 'create_staff_account': {
                if (!user || Number(user.id) !== 1) return { success: false, message: 'Chỉ chủ Studio mới có quyền cấp tài khoản.' };
                const name = String(payload.name || '').trim();
                const email = String(payload.email || '').trim().toLowerCase();
                const phone = String(payload.phone || '').trim();
                const password = String(payload.password || '');
                if (!name || !email || password.length < 6) {
                    return { success: false, message: 'Vui lòng nhập đủ tên, email và mật khẩu từ 6 ký tự.' };
                }
                if ((state.users || []).some(u => String(u.email).toLowerCase() === email)) {
                    return { success: false, message: 'Email này đã tồn tại trong hệ thống.' };
                }
                const newUser = { id: ++state.nextId, name, phone, email, password, status: 'active', avatar: '' };
                state.users.push(newUser);
                saveMockState(state);
                await pushWorkspaceSection('users', state.users);
                return { success: true, message: `Đã cấp tài khoản cho ${email}.` };
            }

            case 'toggle_staff_account': {
                if (!user || Number(user.id) !== 1) return { success: false, message: 'Chỉ chủ Studio mới có quyền thao tác.' };
                const target = (state.users || []).find(u => Number(u.id) === Number(payload.user_id) && Number(u.id) !== 1);
                if (!target) return { success: false, message: 'Không tìm thấy tài khoản nhân sự.' };
                target.status = target.status === 'disabled' ? 'active' : 'disabled';
                saveMockState(state);
                await pushWorkspaceSection('users', state.users);
                return { success: true, status: target.status };
            }

            case 'delete_staff_account': {
                if (!user || Number(user.id) !== 1) return { success: false, message: 'Chỉ chủ Studio mới có quyền xóa tài khoản.' };
                const targetId = Number(payload.user_id);
                if (targetId === 1) return { success: false, message: 'Không thể xóa tài khoản quản trị chính.' };
                state.users = (state.users || []).filter(u => Number(u.id) !== targetId);
                saveMockState(state);
                await pushWorkspaceSection('users', state.users);
                return { success: true };
            }

            default:
                return { success: false, message: `Action không hỗ trợ ở Static Mode: ${action}` };
        }
    }

    async function ensureBackendMode() {
        if (resolvedMockMode) return true;
        if (CONFIG.mode === 'mock') { resolvedMockMode = true; return true; }
        if (CONFIG.mode === 'remote') return false;
        if (!backendProbePromise) {
            backendProbePromise = nativeFetch(CONFIG.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'session_state' })
            }).then(res => {
                const ct = res.headers.get('content-type') || '';
                if (!res.ok || !ct.includes('application/json')) {
                    resolvedMockMode = true;
                }
                return resolvedMockMode;
            }).catch(() => {
                resolvedMockMode = true;
                return true;
            });
        }
        return backendProbePromise;
    }

    async function callJson(payload) {
        if (await ensureBackendMode()) {
            return { ok: true, result: await handleMockAction(payload) };
        }
        const response = await nativeFetch(CONFIG.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const ct = response.headers.get('content-type') || '';
        if (CONFIG.mode === 'auto' && !ct.includes('application/json')) {
            resolvedMockMode = true;
            return { ok: true, result: await handleMockAction(payload) };
        }
        return { ok: response.ok, result: await response.json() };
    }

    async function submitFormData(formData) {
        if (await ensureBackendMode()) {
            const action = formData.get('action');
            if (action === 'change_password') {
                const oldPw = String(formData.get('old_password') || '');
                const newPw = String(formData.get('new_password') || '');
                const confirmPw = String(formData.get('confirm_password') || '');
                if (newPw.length < 6 || newPw !== confirmPw) {
                    return { ok: false, text: 'Mật khẩu mới không hợp lệ hoặc không khớp.' };
                }
                const state = loadMockState();
                const user = getStaticSessionUser(state);
                const target = user ? state.users.find(u => u.id === user.id) : null;
                if (!target) {
                    return { ok: false, text: 'Vui lòng đăng nhập lại.' };
                }
                if (oldPw && String(target.password) !== oldPw) {
                    return { ok: false, text: 'Mật khẩu hiện tại không đúng.' };
                }
                target.password = newPw;
                saveMockState(state);
                await pushWorkspaceSection('users', state.users);
                return { ok: true, text: 'success' };
            }
            return { ok: false, text: 'Không hỗ trợ tác vụ này.' };
        }
        const response = await nativeFetch(CONFIG.endpoint, { method: 'POST', body: formData });
        return { ok: response.ok, text: (await response.text()).trim() };
    }

    function enrichDriveFileUrls(file) {
        if (!file || file.mimeType === 'application/vnd.google-apps.folder') return file;
        const id = String(file.id || '');
        if (!id || (typeof file.thumbnailUrl === 'string' && file.thumbnailUrl.startsWith('data:'))) return file;
        const resizedThumb = file.thumbnailLink
            ? String(file.thumbnailLink).replace(/=[sw]\d+.*$/, '=w640')
            : '';
        const resizedFull = file.thumbnailLink
            ? String(file.thumbnailLink).replace(/=[sw]\d+.*$/, '=w2048')
            : '';
        return {
            ...file,
            size: Number(file.size || 0),
            webContentLink: file.webContentLink || `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`,
            thumbnailUrl: resizedThumb || `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w640`,
            fullUrl: resizedFull || `https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=w2048`
        };
    }

    function getDriveOriginalDownloadUrl(fileOrId) {
        const isObj = fileOrId && typeof fileOrId === 'object';
        const file = isObj ? fileOrId : { id: fileOrId };
        if (file.webContentLink) return String(file.webContentLink);
        const id = String(file.id || '');
        return id ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}` : '';
    }

    function getDriveImageCandidates(fileOrId, size = 'thumb') {
        const isObj = fileOrId && typeof fileOrId === 'object';
        const file = isObj ? fileOrId : { id: fileOrId };
        const directDataUrl = size === 'full' ? file.fullUrl : file.thumbnailUrl;
        if (typeof directDataUrl === 'string' && directDataUrl.startsWith('data:')) {
            return [directDataUrl];
        }
        const id = String(file.id || '');
        if (!id) return directDataUrl ? [directDataUrl] : [];
        const widthToken = size === 'full' ? 'w2048' : 'w640';
        const candidates = [];
        if (file.thumbnailLink) {
            candidates.push(String(file.thumbnailLink).replace(/=[sw]\d+.*$/, `=${widthToken}`));
            candidates.push(String(file.thumbnailLink));
        }
        if (directDataUrl && !directDataUrl.includes('drive.google.com/thumbnail')) {
            candidates.push(directDataUrl);
        }
        candidates.push(`https://lh3.googleusercontent.com/d/${encodeURIComponent(id)}=${widthToken}`);
        candidates.push(`https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=${widthToken}`);
        candidates.push(`https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`);
        return [...new Set(candidates.filter(Boolean))];
    }

    const driveBlobUrlCache = new Map();
    const driveBlobQueue = [];
    let driveBlobActiveCount = 0;

    function runNextDriveBlobJob() {
        if (driveBlobActiveCount >= 4 || !driveBlobQueue.length) return;
        const job = driveBlobQueue.shift();
        driveBlobActiveCount += 1;
        Promise.resolve()
            .then(job.task)
            .then(job.resolve, job.reject)
            .finally(() => {
                driveBlobActiveCount = Math.max(0, driveBlobActiveCount - 1);
                runNextDriveBlobJob();
            });
    }

    function fetchDriveBlobUrl(fileId) {
        const key = String(fileId || '');
        if (!key) return Promise.reject(new Error('Missing file id'));
        if (driveBlobUrlCache.has(key)) return driveBlobUrlCache.get(key);
        const promise = new Promise((resolve, reject) => {
            driveBlobQueue.push({
                resolve,
                reject,
                task: async () => {
                    const blob = await driveDownloadBlob(key);
                    if (!blob || !blob.size || (blob.type && blob.type.includes('text/html'))) {
                        throw new Error('Invalid image blob');
                    }
                    return URL.createObjectURL(blob);
                }
            });
            runNextDriveBlobJob();
        }).catch(err => {
            driveBlobUrlCache.delete(key);
            throw err;
        });
        driveBlobUrlCache.set(key, promise);
        return promise;
    }

    let driveImageBindSeq = 0;
    function bindDriveImage(imgEl, fileOrId, size = 'thumb', onFinalFail = null) {
        if (!imgEl) return;
        const token = String(++driveImageBindSeq);
        imgEl.dataset.driveBindToken = token;
        imgEl.referrerPolicy = 'no-referrer';
        const candidates = getDriveImageCandidates(fileOrId, size);
        const fileId = String((fileOrId && typeof fileOrId === 'object') ? (fileOrId.id || '') : (fileOrId || ''));
        if (!candidates.length) {
            onFinalFail?.();
            return;
        }
        let idx = 0;
        let triedBlobFallback = false;
        imgEl.onerror = () => {
            if (imgEl.dataset.driveBindToken !== token) return;
            idx += 1;
            if (idx < candidates.length) {
                imgEl.src = candidates[idx];
                return;
            }
            if (!triedBlobFallback && fileId && !candidates[0].startsWith('data:') && getActiveDriveApiKey()) {
                triedBlobFallback = true;
                fetchDriveBlobUrl(fileId).then(objectUrl => {
                    if (imgEl.dataset.driveBindToken !== token) return;
                    imgEl.onerror = () => {
                        if (imgEl.dataset.driveBindToken !== token) return;
                        imgEl.onerror = null;
                        onFinalFail?.();
                    };
                    imgEl.src = objectUrl;
                }).catch(() => {
                    if (imgEl.dataset.driveBindToken !== token) return;
                    imgEl.onerror = null;
                    onFinalFail?.();
                });
                return;
            }
            imgEl.onerror = null;
            onFinalFail?.();
        };
        imgEl.src = candidates[0];
    }

    async function driveMeta(folderId) {
        if (await ensureBackendMode()) {
            const state = loadMockState();
            const existing = state.driveFolders[folderId];
            if (existing) return { ok: true, result: { id: folderId, name: existing.name } };
            const apiKey = getActiveDriveApiKey();
            if (apiKey) {
                const res = await nativeFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name&supportsAllDrives=true&includeItemsFromAllDrives=true&key=${encodeURIComponent(apiKey)}`);
                if (res.ok) return { ok: true, result: await res.json() };
            }
            return { ok: true, result: { id: folderId, name: `Album Google Drive (${folderId.slice(0, 8)})` } };
        }
        const response = await nativeFetch(`${CONFIG.endpoint}?drive_proxy=meta&folder_id=${encodeURIComponent(folderId)}`);
        return { ok: response.ok, result: await response.json() };
    }

    async function driveList(folderId, pageToken = '') {
        if (await ensureBackendMode()) {
            const state = loadMockState();
            const folder = state.driveFolders[folderId];
            if (folder) {
                return { ok: true, result: { files: (folder.files || []).map(enrichDemoFile), nextPageToken: '' } };
            }
            const apiKey = getActiveDriveApiKey();
            if (apiKey) {
                const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
                const pt = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
                const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,thumbnailLink,hasThumbnail,webContentLink)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true${pt}&key=${encodeURIComponent(apiKey)}`;
                const res = await nativeFetch(url);
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    return {
                        ok: true,
                        result: {
                            ...data,
                            files: Array.isArray(data.files) ? data.files.map(enrichDriveFileUrls) : []
                        }
                    };
                }
                return { ok: false, result: { error: { message: data?.error?.message || `Google Drive API lỗi (${res.status}). Hãy đảm bảo thư mục Drive đã bật quyền "Bất kỳ ai có đường liên kết đều có thể xem".` } } };
            }
            return { ok: false, result: { error: { message: 'Trên GitHub Pages, cần cấu hình Google Drive API Key trong Cài đặt để đọc thư mục Google Drive công khai.' } } };
        }
        const tokenQuery = pageToken ? `&page_token=${encodeURIComponent(pageToken)}` : '';
        const response = await nativeFetch(`${CONFIG.endpoint}?drive_proxy=list&folder_id=${encodeURIComponent(folderId)}${tokenQuery}`);
        return { ok: response.ok, result: await response.json() };
    }

    async function driveDownloadBlob(fileId, signal) {
        if (await ensureBackendMode()) {
            const state = loadMockState();
            const file = findDemoFileById(state, fileId);
            if (file) {
                const response = await nativeFetch(file.fullUrl, { signal });
                return response.blob();
            }
            const apiKey = getActiveDriveApiKey();
            const url = apiKey
                ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`
                : `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1600`;
            const response = await nativeFetch(url, { signal });
            if (!response.ok) {
                throw new Error(`Không thể tải ảnh từ Drive (${response.status}).`);
            }
            const blob = await response.blob();
            if (!blob || (blob.type && /text\/html/i.test(blob.type))) {
                throw new Error('Google Drive trả về trang xác nhận thay vì tệp ảnh gốc.');
            }
            return blob;
        }
        const response = await nativeFetch(`${CONFIG.endpoint}?drive_proxy=download&file_id=${encodeURIComponent(fileId)}`, { cache: 'no-store', signal });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(text ? text.replace(/<.*?>/g, '').trim() : 'Không thể tải ảnh.');
        }
        return response.blob();
    }

    // Intercept fetch('photowedding/app.php...') for legacy inline scripts (index.js, login, contracts, photographers) on static hosts
    global.fetch = async function patchedFetch(input, init) {
        const urlStr = typeof input === 'string' ? input : (input?.url || '');
        if (!urlStr.includes('photowedding/app.php')) {
            return nativeFetch(input, init);
        }
        if (!(await ensureBackendMode())) {
            return nativeFetch(input, init);
        }

        const urlObj = new URL(urlStr, global.location.href);
        if (urlObj.searchParams.has('drive_proxy')) {
            const mode = urlObj.searchParams.get('drive_proxy');
            if (mode === 'meta') {
                const { ok, result } = await driveMeta(urlObj.searchParams.get('folder_id') || '');
                return new Response(JSON.stringify(result), { status: ok ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
            }
            if (mode === 'list') {
                const { ok, result } = await driveList(urlObj.searchParams.get('folder_id') || '', urlObj.searchParams.get('page_token') || '');
                return new Response(JSON.stringify(result), { status: ok ? 200 : 400, headers: { 'Content-Type': 'application/json' } });
            }
            if (mode === 'download') {
                const blob = await driveDownloadBlob(urlObj.searchParams.get('file_id') || '', init?.signal);
                return new Response(blob, { status: 200, headers: { 'Content-Type': blob.type || 'image/jpeg' } });
            }
        }

        if (init?.body instanceof FormData || (typeof init?.body === 'string' && init.body.includes('action=change_password') && !init.body.trim().startsWith('{'))) {
            let fd = init.body;
            if (!(fd instanceof FormData)) {
                const params = new URLSearchParams(fd);
                fd = new FormData();
                params.forEach((v, k) => fd.append(k, v));
            }
            const { ok, text } = await submitFormData(fd);
            return new Response(text, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
        }

        let bodyObj = {};
        if (typeof init?.body === 'string' && init.body.trim()) {
            try { bodyObj = JSON.parse(init.body); } catch {}
        }
        const result = await handleMockAction(bodyObj);
        const status = result && result.success === false && bodyObj.action === 'login' ? 401 : 200;
        return new Response(JSON.stringify(result), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    };

        // Handle ?logout=1 cleanly on static hosts (GitHub Pages)
        const bootParams = new URLSearchParams(global.location.search);
        if (bootParams.get('logout') === '1') {
            ensureBackendMode().then(isStatic => {
                if (isStatic) {
                    localStorage.setItem(STATIC_SESSION_KEY, '0');
                    const cleanUrl = new URL('./?home=1', global.location.href).toString();
                    global.history.replaceState({}, document.title, cleanUrl);
                }
            });
        }

        document.addEventListener('click', async event => {
            const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
            if (!link) return;
            const href = link.getAttribute('href') || '';
            if (href.includes('logout=1') && (await ensureBackendMode())) {
                event.preventDefault();
                localStorage.setItem(STATIC_SESSION_KEY, '0');
                global.location.href = './?home=1';
            }
        });

    global.PhotoSelectAPI = {
        CONFIG,
        isMockMode: () => resolvedMockMode,
        ensureBackendMode,
        getCloudConfig,
        saveCloudConfig,
        getActiveCloudUrl,
        getActiveDriveApiKey,
        getDriveImageCandidates,
        getDriveOriginalDownloadUrl,
        bindDriveImage,
        syncWorkspaceNow: () => ensureWorkspaceSynced(loadMockState(), true),
        encodeBase64Url,
        decodeBase64Url,
        sha256Hex,
        callJson,
        submitFormData,
        driveMeta,
        driveList,
        driveDownloadBlob
    };
})(window);
