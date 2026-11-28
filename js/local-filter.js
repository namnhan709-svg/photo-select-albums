/**
 * Lọc danh sách tên file (.txt hoặc danh sách ảnh đã chọn) trên máy tính,
 * tự động tạo thư mục con bên trong thư mục nguồn và copy ảnh thường + file RAW đi kèm.
 */
(function initLocalFilterModule(global) {
    const RAW_EXTENSION_RE = /\.(3fr|arw|bay|braw|cap|cin|cr2|cr3|crw|dcr|dng|erf|fff|iiq|k25|kdc|mef|mos|mrw|nef|nrw|orf|pef|raf|raw|rw2|rwl|sr2|srf|srw|x3f)$/i;
    const NON_RAW_IMAGE_EXTENSION_RE = /\.(avif|bmp|dib|exr|gif|heic|heif|heifs|heix|hif|jpeg|jpg|jpe|jp2|j2k|pbm|pcx|png|psd|rle|svg|tga|tif|tiff|webp)$/i;
    const SUPPORTED_IMAGE_EXTENSION_RE = /\.(3fr|arw|avif|bay|bmp|braw|cap|cin|cr2|cr3|crw|dcr|dib|dng|erf|exr|fff|gif|heic|heif|heifs|heix|hif|iiq|jpeg|jpg|jpe|jp2|j2k|k25|kdc|mef|mos|mrw|nef|nrw|orf|pbm|pcx|pef|png|psd|raf|raw|rle|rw2|rwl|sr2|srf|srw|svg|tga|tif|tiff|webp|x3f)$/i;

    const IGNORED_REPORT_LINE_RE = /^(?:[-=]{3,}|DANH SÁCH ẢNH|BÁO CÁO|Thời gian:|Tổng số|KHÔNG TÌM THẤY|COPY LỖI|LỖI HỆ THỐNG)/i;
    const FILE_WITH_EXT_TOKEN_RE = /[^\s,;|\t]+\.[a-z0-9]{2,5}/gi;

    function isRawFile(fileName) {
        return RAW_EXTENSION_RE.test(String(fileName || '').trim());
    }

    function isSupportedImage(fileName) {
        return SUPPORTED_IMAGE_EXTENSION_RE.test(String(fileName || '').trim());
    }

    function sanitizeFolderName(value, fallback = 'Anh_Da_Chon') {
        const cleaned = String(value || '')
            .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
            .replace(/\s+/g, ' ')
            .replace(/^\.+|\.+$/g, '')
            .trim();
        return cleaned || fallback;
    }

    function compactStem(value) {
        return String(value || '')
            .trim()
            .normalize('NFC')
            .toLocaleLowerCase()
            .replace(/[\s._-]+/g, '');
    }

    function stripExtension(fileName) {
        const clean = String(fileName || '').trim().normalize('NFC').toLocaleLowerCase();
        const dotIdx = clean.lastIndexOf('.');
        return dotIdx > 0 ? clean.slice(0, dotIdx) : clean;
    }

    /**
     * Loại bỏ hậu tố bản chỉnh sửa (-2, _2, (2), -edit, -retouch...) khi phần gốc vẫn giữ mã số >= 3 chữ số.
     * Ví dụ: "atep3366-2" -> "atep3366", nhưng không cắt số máy ảnh như "img_3366".
     */
    function stripEditSuffixForRaw(stem) {
        let current = String(stem || '').trim();
        for (let i = 0; i < 2; i += 1) {
            const match = current.match(/^(.+?)(?:[-_\s]*(?:\(\d{1,2}\)|edit\d*|edited|copy\d*|retouch\d*|final\d*|v\d{1,2})|-\d{1,2})$/i);
            if (!match) break;
            const candidate = match[1].replace(/[-_\s]+$/, '');
            if (!/\d{3,}/.test(candidate)) break;
            current = candidate;
        }
        return current;
    }

    function parseTargetList(rawText) {
        const lines = String(rawText || '').split(/\r?\n/);
        const results = [];
        const seen = new Set();

        const pushToken = token => {
            const cleaned = String(token || '')
                .replace(/^[-*•]\s+/, '')
                .replace(/^["'`]+|["'`]+$/g, '')
                .trim();
            if (!cleaned || IGNORED_REPORT_LINE_RE.test(cleaned)) return;
            const key = cleaned.normalize('NFC').toLocaleLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            results.push(cleaned);
        };

        for (const rawLine of lines) {
            const line = rawLine.replace(/^[-*•]\s+/, '').trim();
            if (!line || IGNORED_REPORT_LINE_RE.test(line)) continue;

            const delimitedParts = line.split(/[,;\t|]+/);
            for (const part of delimitedParts) {
                const segment = part.trim();
                if (!segment) continue;

                const extMatches = segment.match(FILE_WITH_EXT_TOKEN_RE);
                if (extMatches && extMatches.length > 1 && segment.includes(' ')) {
                    extMatches.forEach(pushToken);
                    continue;
                }
                if (/^(?:\d{3,6}\s+)+\d{3,6}$/.test(segment)) {
                    segment.split(/\s+/).forEach(pushToken);
                    continue;
                }
                pushToken(segment);
            }
        }
        return results;
    }

    /**
     * Tạo các khóa nhận diện từ tên dòng trong .txt, ví dụ:
     * - "3376-ATEP3376.jpg" -> lowerFull, stem "3376-atep3376", unprefixedStem "atep3376"
     * - "3662-ATEP3366-2.jpg" -> thêm rawBaseStem "atep3366" để khớp luôn file RAW gốc "ATEP3366.CR3"
     */
    function extractLookupKeys(entry) {
        const baseName = String(entry || '').split(/[\\/]/).pop().trim();
        const lowerFull = baseName.normalize('NFC').toLocaleLowerCase();
        const dotIdx = lowerFull.lastIndexOf('.');
        const hasExt = dotIdx > 0 && /\.[a-z0-9]{2,5}$/i.test(lowerFull);
        const stem = hasExt ? lowerFull.slice(0, dotIdx) : lowerFull;
        const isDigitsOnly = /^\d{3,6}$/.test(stem);

        const prefixMatch = stem.match(/^(?:\d{3,6}(?:\/\d{3,6})*)[-_]+(.+)$/);
        const unprefixedStem = prefixMatch && /[a-z0-9]{2,}/i.test(prefixMatch[1])
            ? prefixMatch[1].trim()
            : '';

        const primaryStems = [];
        const addUnique = (arr, val) => {
            if (val && !arr.includes(val)) arr.push(val);
        };
        addUnique(primaryStems, stem);
        if (unprefixedStem) addUnique(primaryStems, unprefixedStem);

        const rawFallbackStems = [];
        primaryStems.forEach(s => {
            const stripped = stripEditSuffixForRaw(s);
            if (stripped && stripped !== s) addUnique(rawFallbackStems, stripped);
        });

        return {
            raw: entry,
            baseName,
            lowerFull,
            hasExt,
            stem,
            unprefixedStem,
            primaryStems,
            rawFallbackStems,
            isDigitsOnly
        };
    }

    async function ensurePermission(directoryHandle, mode = 'read') {
        if (!directoryHandle) return false;
        if (typeof directoryHandle.queryPermission !== 'function') return true;
        const options = { mode };
        let permission = await directoryHandle.queryPermission(options);
        if (permission === 'granted') return true;
        if (typeof directoryHandle.requestPermission !== 'function') return false;
        permission = await directoryHandle.requestPermission(options);
        return permission === 'granted';
    }

    function addMapEntry(map, key, item) {
        if (!key) return;
        const list = map.get(key);
        if (list) list.push(item);
        else map.set(key, [item]);
    }

    async function scanFolderAndIndex(rootHandle, skipFolderNames = []) {
        const skipSet = new Set(
            (skipFolderNames || [])
                .map(name => String(name || '').trim().normalize('NFC').toLocaleLowerCase())
                .filter(Boolean)
        );
        const items = [];
        const byFull = new Map();
        const byStem = new Map();
        const byCompact = new Map();
        const byTrailingDigits = new Map();

        async function walk(dirHandle, prefixPath) {
            for await (const entry of dirHandle.values()) {
                const entryLower = String(entry.name || '').trim().normalize('NFC').toLocaleLowerCase();
                if (entry.kind === 'directory') {
                    if (skipSet.has(entryLower) || entryLower === '.git' || entryLower === '@eadir' || entryLower === '__macosx') {
                        continue;
                    }
                    await walk(entry, prefixPath ? `${prefixPath}/${entry.name}` : entry.name);
                } else if (entry.kind === 'file' && isSupportedImage(entry.name)) {
                    const relPath = prefixPath ? `${prefixPath}/${entry.name}` : entry.name;
                    const lowerStem = stripExtension(entry.name);
                    const cStem = compactStem(lowerStem);
                    const isRaw = isRawFile(entry.name);
                    const digitsGroups = lowerStem.match(/\d+/g) || [];
                    const joinedDigits = digitsGroups.join('');
                    const item = {
                        handle: entry,
                        name: entry.name,
                        relPath,
                        isRaw,
                        lowerFull: entryLower,
                        lowerStem,
                        compactStem: cStem,
                        joinedDigits
                    };
                    items.push(item);
                    addMapEntry(byFull, entryLower, item);
                    addMapEntry(byStem, lowerStem, item);
                    addMapEntry(byCompact, cStem, item);

                    if (joinedDigits) {
                        [3, 4, 5, 6].forEach(len => {
                            if (joinedDigits.length >= len) {
                                addMapEntry(byTrailingDigits, joinedDigits.slice(-len), item);
                            }
                        });
                    }
                    const tailMatch = lowerStem.match(/(\d{3,6})$/);
                    if (tailMatch && tailMatch[1] !== joinedDigits) {
                        addMapEntry(byTrailingDigits, tailMatch[1], item);
                    }
                }
            }
        }

        await walk(rootHandle, '');
        return {
            totalScanned: items.length,
            items,
            byFull,
            byStem,
            byCompact,
            byTrailingDigits
        };
    }

    function collectByStem(index, stem) {
        const exact = index.byStem.get(stem) || [];
        const compacted = index.byCompact.get(compactStem(stem)) || [];
        const merged = [];
        const seen = new Set();
        for (const item of [...exact, ...compacted]) {
            if (seen.has(item.relPath)) continue;
            seen.add(item.relPath);
            merged.push(item);
        }
        return merged;
    }

    function matchEntry(entry, index, includeRaw = true) {
        const keys = extractLookupKeys(entry);
        const primaryMatches = [];
        const rawMatches = [];
        const seenRel = new Set();

        const addMatch = (item, bucket) => {
            if (!item || seenRel.has(item.relPath)) return;
            seenRel.add(item.relPath);
            bucket.push(item);
        };

        if (keys.isDigitsOnly) {
            const candidates = index.byTrailingDigits.get(keys.stem) || [];
            candidates.forEach(item => {
                if (item.isRaw) {
                    if (includeRaw) addMatch(item, rawMatches);
                } else {
                    addMatch(item, primaryMatches);
                }
            });
            return { keys, primaryMatches, rawMatches };
        }

        // 1. Khớp chính xác tên file đầy đủ (nếu file trên máy giữ nguyên prefix như 3376-ATEP3376.jpg)
        if (keys.hasExt) {
            const fullHits = index.byFull.get(keys.lowerFull) || [];
            fullHits.forEach(item => addMatch(item, item.isRaw ? rawMatches : primaryMatches));
        }

        // 2. Khớp theo stem gốc và stem đã bỏ prefix số (3376-ATEP3376 -> ATEP3376, 3662-ATEP3366-2 -> ATEP3366-2)
        for (const stemCandidate of keys.primaryStems) {
            const hits = collectByStem(index, stemCandidate);
            hits.forEach(item => {
                if (item.isRaw) {
                    if (includeRaw) addMatch(item, rawMatches);
                } else {
                    // Nếu đã có file khớp đúng tên/stem đầy đủ thì không lấy nhầm đuôi khác nếu không cùng stem
                    addMatch(item, primaryMatches);
                }
            });
        }

        // 3. Nếu bật kèm RAW, dò thêm RAW theo tên gốc đã bỏ hậu tố -2 / -edit (ví dụ 3662-ATEP3366-2 -> ATEP3366.CR3)
        //    cũng như theo stem của chính các file ảnh đã tìm thấy.
        if (includeRaw) {
            const rawStemPool = [...keys.rawFallbackStems];
            primaryMatches.forEach(item => {
                if (!rawStemPool.includes(item.lowerStem)) rawStemPool.push(item.lowerStem);
                const itemStripped = stripEditSuffixForRaw(item.lowerStem);
                if (itemStripped && !rawStemPool.includes(itemStripped)) rawStemPool.push(itemStripped);
            });
            rawStemPool.forEach(rawStem => {
                collectByStem(index, rawStem).forEach(item => {
                    if (item.isRaw) addMatch(item, rawMatches);
                });
            });
        } else if (!primaryMatches.length && keys.rawFallbackStems.length) {
            // Fallback khi tắt kèm RAW nhưng chỉ có file gốc (hiếm) - giữ nguyên không lấy nhầm
        }

        return { keys, primaryMatches, rawMatches };
    }

    function resolveUniqueTargetName(originalName, usedDestNames) {
        const lower = originalName.toLocaleLowerCase();
        if (!usedDestNames.has(lower)) {
            usedDestNames.add(lower);
            return originalName;
        }
        const dotIdx = originalName.lastIndexOf('.');
        const base = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName;
        const ext = dotIdx > 0 ? originalName.slice(dotIdx) : '';
        let counter = 2;
        while (usedDestNames.has(`${base} (${counter})${ext}`.toLocaleLowerCase())) {
            counter += 1;
        }
        const uniqueName = `${base} (${counter})${ext}`;
        usedDestNames.add(uniqueName.toLocaleLowerCase());
        return uniqueName;
    }

    async function copyFileHandleToDir(fileHandle, destDirHandle, targetFileName) {
        const file = await fileHandle.getFile();
        const targetHandle = await destDirHandle.getFileHandle(targetFileName || file.name, { create: true });
        const writable = await targetHandle.createWritable();
        try {
            await writable.write(file);
        } finally {
            await writable.close();
        }
    }

    async function runFilterAndCopy(options) {
        const {
            entries = [],
            sourceHandle,
            destinationHandle = null,
            createSubfolderInsideSource = true,
            subfolderName = 'Anh_Da_Chon',
            includeRaw = true,
            onProgress = () => {},
            isCancelled = () => false
        } = options || {};

        if (!entries.length) {
            throw new Error('Danh sách lọc đang trống.');
        }
        if (!sourceHandle) {
            throw new Error('Vui lòng chọn thư mục chứa ảnh trong máy.');
        }
        if (!createSubfolderInsideSource && !destinationHandle) {
            throw new Error('Vui lòng chọn thư mục lưu kết quả.');
        }

        const cleanSubName = sanitizeFolderName(subfolderName, 'Anh_Da_Chon');
        const sourcePermMode = createSubfolderInsideSource ? 'readwrite' : 'read';
        const canSource = await ensurePermission(sourceHandle, sourcePermMode);
        if (!canSource) {
            throw new Error('Chưa được cấp quyền đọc/ghi cho thư mục chứa ảnh.');
        }
        if (!createSubfolderInsideSource) {
            const canDest = await ensurePermission(destinationHandle, 'readwrite');
            if (!canDest) {
                throw new Error('Chưa được cấp quyền ghi vào thư mục lưu.');
            }
        }

        onProgress('Đang quét thư mục nguồn (bao gồm thư mục con và file RAW)...');
        const index = await scanFolderAndIndex(
            sourceHandle,
            createSubfolderInsideSource ? [cleanSubName] : []
        );
        if (isCancelled()) return { cancelled: true };

        const usedRelPaths = new Set();
        const usedDestNames = new Set();
        const filesToCopy = [];
        const missingEntries = [];
        let matchedEntryCount = 0;

        entries.forEach(entry => {
            const { primaryMatches, rawMatches } = matchEntry(entry, index, includeRaw);
            const combined = [
                ...primaryMatches.map(item => ({ item, role: 'primary' })),
                ...rawMatches.map(item => ({ item, role: 'raw' }))
            ];
            let entryFound = false;
            combined.forEach(({ item, role }) => {
                if (usedRelPaths.has(item.relPath)) {
                    entryFound = true;
                    return;
                }
                usedRelPaths.add(item.relPath);
                entryFound = true;
                filesToCopy.push({
                    item,
                    role,
                    targetFileName: resolveUniqueTargetName(item.name, usedDestNames)
                });
            });
            if (entryFound) matchedEntryCount += 1;
            else missingEntries.push(entry);
        });

        let targetDirHandle = destinationHandle;
        let outputFolderLabel = destinationHandle?.name || '';
        if (createSubfolderInsideSource) {
            onProgress(`Đang tạo thư mục "${cleanSubName}" bên trong "${sourceHandle.name}"...`);
            targetDirHandle = await sourceHandle.getDirectoryHandle(cleanSubName, { create: true });
            outputFolderLabel = `${sourceHandle.name}/${cleanSubName}`;
        }

        if (!filesToCopy.length) {
            return {
                cancelled: false,
                totalScanned: index.totalScanned,
                totalEntries: entries.length,
                matchedEntryCount: 0,
                primaryCount: 0,
                rawCount: 0,
                copiedCount: 0,
                missingEntries,
                copyErrors: [],
                copiedNames: [],
                outputFolderLabel,
                targetDirHandle
            };
        }

        let copiedCount = 0;
        let primaryCount = 0;
        let rawCount = 0;
        const copiedNames = [];
        const copyErrors = [];

        for (let i = 0; i < filesToCopy.length; i += 1) {
            if (isCancelled()) return { cancelled: true };
            const task = filesToCopy[i];
            onProgress(`Đang copy (${i + 1}/${filesToCopy.length}): ${task.item.name}`);
            try {
                await copyFileHandleToDir(task.item.handle, targetDirHandle, task.targetFileName);
                copiedCount += 1;
                if (task.role === 'raw') rawCount += 1;
                else primaryCount += 1;
                copiedNames.push(task.targetFileName);
            } catch (err) {
                copyErrors.push(`${task.item.name}: ${err?.message || 'Không thể copy file'}`);
            }
        }

        return {
            cancelled: false,
            totalScanned: index.totalScanned,
            totalEntries: entries.length,
            matchedEntryCount,
            primaryCount,
            rawCount,
            copiedCount,
            missingEntries,
            copyErrors,
            copiedNames,
            outputFolderLabel,
            targetDirHandle
        };
    }

    global.PhotoSelectLocalFilter = {
        RAW_EXTENSION_RE,
        NON_RAW_IMAGE_EXTENSION_RE,
        SUPPORTED_IMAGE_EXTENSION_RE,
        isRawFile,
        isSupportedImage,
        sanitizeFolderName,
        parseTargetList,
        extractLookupKeys,
        ensurePermission,
        scanFolderAndIndex,
        matchEntry,
        copyFileHandleToDir,
        runFilterAndCopy
    };
})(window);
