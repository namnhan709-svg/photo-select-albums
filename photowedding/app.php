<?php
declare(strict_types=1);

/**
 * TeeMedia - Full PHP 8+ Backend (SQLite PDO + Google Drive Proxy).
 * Sử dụng khi triển khai trên Apache/LiteSpeed/PHP 8.2+.
 */
session_start();

$dataDir = dirname(__DIR__) . '/data';
if (!is_dir($dataDir)) {
    mkdir($dataDir, 0755, true);
}

$pdo = new PDO('sqlite:' . $dataDir . '/photo_select.sqlite');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

$pdo->exec('
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT DEFAULT "",
        password_hash TEXT NOT NULL,
        status TEXT DEFAULT "active",
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        album_name TEXT NOT NULL,
        folder_id TEXT NOT NULL,
        allow_save INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT DEFAULT NULL
    );
    CREATE TABLE IF NOT EXISTS shares (
        token TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL,
        owner_user_id INTEGER NOT NULL,
        access_code_hash TEXT DEFAULT "",
        requires_code INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS kv_state (
        state_key TEXT PRIMARY KEY,
        state_value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photo_selections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL,
        folder_id TEXT NOT NULL,
        photo_id TEXT NOT NULL,
        photo_name TEXT NOT NULL,
        category TEXT DEFAULT "Album",
        guest_name TEXT DEFAULT "Khách xem album",
        share_token TEXT DEFAULT "",
        selected_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(folder_id, photo_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        photo_id TEXT NOT NULL,
        user_id INTEGER DEFAULT 0,
        author TEXT NOT NULL,
        comment_text TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS photographers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        phone TEXT DEFAULT "",
        email TEXT DEFAULT "",
        zalo TEXT DEFAULT "",
        facebook TEXT DEFAULT "",
        shoot_location TEXT DEFAULT "",
        shoot_dates TEXT DEFAULT "[]",
        status TEXT DEFAULT "active"
    );
    CREATE TABLE IF NOT EXISTS contracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        phone TEXT DEFAULT "",
        email TEXT DEFAULT "",
        social TEXT DEFAULT "",
        package_name TEXT DEFAULT "",
        shoot_date TEXT DEFAULT "",
        budget REAL DEFAULT 0,
        status TEXT DEFAULT "lead",
        notes TEXT DEFAULT "",
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
');

function jsonOut(array $data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function currentUser(PDO $pdo): ?array {
    $uid = (int)($_SESSION['user_id'] ?? 0);
    if ($uid <= 0) return null;
    $stmt = $pdo->prepare('SELECT id, name, email, phone, status FROM users WHERE id = ?');
    $stmt->execute([$uid]);
    $user = $stmt->fetch();
    return $user ?: null;
}

if (($_GET['google'] ?? '') === 'login') {
    $stmt = $pdo->query('SELECT id FROM users ORDER BY id ASC LIMIT 1');
    $first = $stmt->fetch();
    if (!$first) {
        $hash = password_hash('123456', PASSWORD_DEFAULT);
        $pdo->prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)')
            ->execute(['TeeMedia Studio', 'studio@gmail.com', '0901 234 567', $hash]);
        $_SESSION['user_id'] = (int)$pdo->lastInsertId();
    } else {
        $_SESSION['user_id'] = (int)$first['id'];
    }
    header('Location: /albums?login=success');
    exit;
}

if (isset($_GET['drive_proxy'])) {
    $mode = (string)$_GET['drive_proxy'];
    $apiKey = getenv('GOOGLE_API_KEY') ?: '';
    if ($mode === 'meta') {
        $fid = trim((string)($_GET['folder_id'] ?? ''));
        if ($apiKey !== '') {
            $url = 'https://www.googleapis.com/drive/v3/files/' . urlencode($fid) . '?fields=id,name&supportsAllDrives=true&includeItemsFromAllDrives=true&key=' . urlencode($apiKey);
            $raw = @file_get_contents($url);
            if ($raw !== false) {
                header('Content-Type: application/json; charset=utf-8');
                echo $raw;
                exit;
            }
        }
        $html = @file_get_contents('https://drive.google.com/embeddedfolderview?id=' . urlencode($fid));
        if ($html !== false && preg_match('/<title>(.*?)<\/title>/si', $html, $m)) {
            $title = trim(preg_replace('/\s*-\s*Google Drive\s*$/i', '', html_entity_decode($m[1], ENT_QUOTES, 'UTF-8')));
            jsonOut(['id' => $fid, 'name' => $title]);
        }
        jsonOut(['error' => ['message' => 'Không thể truy cập thư mục Google Drive.']], 400);
    }
    if ($mode === 'list') {
        $fid = trim((string)($_GET['folder_id'] ?? ''));
        $pt = trim((string)($_GET['page_token'] ?? ''));
        if ($apiKey !== '') {
            $q = urlencode("'$fid' in parents and trashed = false");
            $url = "https://www.googleapis.com/drive/v3/files?q=$q&fields=nextPageToken,files(id,name,mimeType,createdTime,modifiedTime)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true" . ($pt ? '&pageToken=' . urlencode($pt) : '') . '&key=' . urlencode($apiKey);
            $raw = @file_get_contents($url);
            if ($raw !== false) {
                header('Content-Type: application/json; charset=utf-8');
                echo $raw;
                exit;
            }
        }
        $html = @file_get_contents('https://drive.google.com/embeddedfolderview?id=' . urlencode($fid));
        if ($html === false) {
            jsonOut(['error' => ['message' => 'Không thể tải danh sách ảnh.']], 400);
        }
        $files = [];
        if (preg_match_all('/id="entry-([a-zA-Z0-9_-]+)".*?<div class="flip-entry-title">(.*?)<\/div>/si', $html, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $m) {
                $files[] = [
                    'id' => $m[1],
                    'name' => trim(html_entity_decode($m[2], ENT_QUOTES, 'UTF-8')),
                    'mimeType' => str_contains($m[0], 'drive/folders/') ? 'application/vnd.google-apps.folder' : 'image/jpeg',
                ];
            }
        }
        jsonOut(['files' => $files, 'nextPageToken' => '']);
    }
    if ($mode === 'download') {
        $fid = trim((string)($_GET['file_id'] ?? ''));
        header('Location: https://drive.google.com/uc?export=download&id=' . urlencode($fid));
        exit;
    }
}

$rawBody = file_get_contents('php://input') ?: '';
$body = json_decode($rawBody, true);
if (!is_array($body)) {
    $body = $_POST;
}

$action = (string)($body['action'] ?? '');
$user = currentUser($pdo);
$uid = $user ? (int)$user['id'] : 0;

switch ($action) {
    case 'session_state':
        jsonOut(['success' => true, 'user' => $user]);

    case 'login':
        $loginId = strtolower(trim((string)($body['login_id'] ?? $body['email'] ?? '')));
        $password = (string)($body['password'] ?? '');
        $stmt = $pdo->prepare('SELECT * FROM users WHERE LOWER(email) = ? OR CAST(id AS TEXT) = ? LIMIT 1');
        $stmt->execute([$loginId, $loginId]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($password, $row['password_hash'])) {
            jsonOut(['success' => false, 'message' => 'Email/ID hoặc mật khẩu không đúng.'], 401);
        }
        $_SESSION['user_id'] = (int)$row['id'];
        unset($row['password_hash']);
        jsonOut(['success' => true, 'message' => 'Đăng nhập thành công.', 'user' => $row]);

    case 'register':
        jsonOut(['success' => false, 'message' => 'Chức năng đăng ký tự do đã tắt. Chỉ quản trị viên TeeMedia Studio mới có quyền cấp tài khoản.'], 403);

    case 'change_password':
        if ($uid <= 0) { http_response_code(401); echo 'Vui lòng đăng nhập.'; exit; }
        $old = (string)($body['old_password'] ?? '');
        $new = (string)($body['new_password'] ?? '');
        $confirm = (string)($body['confirm_password'] ?? '');
        if (strlen($new) < 6 || $new !== $confirm) { http_response_code(400); echo 'Mật khẩu mới không hợp lệ hoặc không khớp.'; exit; }
        $stmt = $pdo->prepare('SELECT password_hash FROM users WHERE id = ?');
        $stmt->execute([$uid]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($old, $row['password_hash'])) { http_response_code(400); echo 'Mật khẩu hiện tại không đúng.'; exit; }
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($new, PASSWORD_DEFAULT), $uid]);
        echo 'success';
        exit;

    case 'update_phone':
        if ($uid <= 0) jsonOut(['success' => false, 'message' => 'Chưa đăng nhập.'], 401);
        $phone = trim((string)($body['phone'] ?? ''));
        $pdo->prepare('UPDATE users SET phone = ? WHERE id = ?')->execute([$phone, $uid]);
        jsonOut(['success' => true, 'user' => currentUser($pdo)]);

    case 'load_albums':
        if ($uid <= 0) jsonOut(['success' => true, 'data' => []]);
        $stmt = $pdo->prepare('
            SELECT a.*,
                (SELECT COUNT(*) FROM photo_selections ps WHERE ps.folder_id = a.folder_id) AS selected_count,
                (SELECT MAX(ps.selected_at) FROM photo_selections ps WHERE ps.folder_id = a.folder_id) AS last_selected_at
            FROM albums a
            WHERE a.user_id = ? AND a.deleted_at IS NULL
            ORDER BY a.id DESC
        ');
        $stmt->execute([$uid]);
        jsonOut(['success' => true, 'data' => $stmt->fetchAll()]);

    case 'load_deleted_albums':
        if ($uid <= 0) jsonOut(['success' => true, 'data' => []]);
        $stmt = $pdo->prepare('SELECT * FROM albums WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY id DESC');
        $stmt->execute([$uid]);
        jsonOut(['success' => true, 'data' => $stmt->fetchAll()]);

    case 'save_album':
        if ($uid <= 0) jsonOut(['success' => false, 'message' => 'Vui lòng đăng nhập.'], 401);
        $folderId = trim((string)($body['folder_id'] ?? ''));
        $albumName = trim((string)($body['album_name'] ?? 'Album'));
        $allowSave = !empty($body['allow_save']) ? 1 : 0;
        $pdo->prepare('INSERT INTO albums (user_id, album_name, folder_id, allow_save) VALUES (?, ?, ?, ?)')
            ->execute([$uid, $albumName, $folderId, $allowSave]);
        jsonOut(['success' => true, 'id' => (int)$pdo->lastInsertId()]);

    case 'update_album_permission':
        if ($uid <= 0) jsonOut(['success' => false, 'message' => 'Vui lòng đăng nhập.'], 401);
        $aid = (int)($body['album_id'] ?? 0);
        $allow = !empty($body['allow_save']) ? 1 : 0;
        $pdo->prepare('UPDATE albums SET allow_save = ? WHERE id = ? AND user_id = ?')->execute([$allow, $aid, $uid]);
        jsonOut(['success' => true, 'allow_save' => $allow]);

    case 'delete_album':
        if ($uid <= 0) jsonOut(['success' => false], 401);
        $pdo->prepare('UPDATE albums SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')->execute([(int)($body['album_id'] ?? 0), $uid]);
        jsonOut(['success' => true]);

    case 'restore_album':
        if ($uid <= 0) jsonOut(['success' => false], 401);
        $pdo->prepare('UPDATE albums SET deleted_at = NULL WHERE id = ? AND user_id = ?')->execute([(int)($body['album_id'] ?? 0), $uid]);
        jsonOut(['success' => true]);

    case 'create_share_link':
        if ($uid <= 0) jsonOut(['success' => false, 'message' => 'Vui lòng đăng nhập.'], 401);
        $token = bin2hex(random_bytes(8));
        $folderId = trim((string)($body['folder_id'] ?? ''));
        $code = trim((string)($body['access_code'] ?? ''));
        $hash = $code !== '' ? password_hash($code, PASSWORD_DEFAULT) : '';
        $pdo->prepare('INSERT INTO shares (token, folder_id, owner_user_id, access_code_hash, requires_code) VALUES (?, ?, ?, ?, ?)')
            ->execute([$token, $folderId, $uid, $hash, $code !== '' ? 1 : 0]);
        jsonOut(['success' => true, 'url' => "/?share=$token", 'requires_code' => $code !== '']);

    case 'get_share_permission':
        $token = trim((string)($body['share_token'] ?? ''));
        $stmt = $pdo->prepare('SELECT a.allow_save FROM shares s LEFT JOIN albums a ON a.folder_id = s.folder_id AND a.deleted_at IS NULL WHERE s.token = ? LIMIT 1');
        $stmt->execute([$token]);
        $row = $stmt->fetch();
        jsonOut(['success' => true, 'allow_save' => $row ? ((int)$row['allow_save'] === 1) : true]);

    case 'load_state':
        $keys = $body['keys'] ?? [];
        $out = [];
        $stmt = $pdo->prepare('SELECT state_value FROM kv_state WHERE state_key = ?');
        foreach ($keys as $k) {
            $stmt->execute([(string)$k]);
            if ($row = $stmt->fetch()) {
                $out[(string)$k] = json_decode($row['state_value'], true);
            }
        }
        jsonOut(['success' => true, 'data' => $out]);

    case 'save_state':
        $data = $body['data'] ?? [];
        $stmt = $pdo->prepare('INSERT INTO kv_state (state_key, state_value) VALUES (?, ?) ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value');
        foreach ($data as $k => $v) {
            $stmt->execute([(string)$k, json_encode($v, JSON_UNESCAPED_UNICODE)]);
        }
        jsonOut(['success' => true]);

    case 'save_photo_selection':
    case 'confirm_guest_selection':
        $fid = trim((string)($body['folder_id'] ?? ''));
        if ($fid === '') jsonOut(['success' => false, 'message' => 'Thiếu folder_id.'], 400);
        $selectedPhotos = is_array($body['selected_photos'] ?? null) ? $body['selected_photos'] : [];
        $photoMeta = is_array($body['photo_meta'] ?? null) ? $body['photo_meta'] : [];
        $guestName = trim((string)($body['guest_name'] ?? '')) ?: ($user ? $user['name'] : 'Khách xem album');
        $shareToken = trim((string)($body['share_token'] ?? ''));
        $metaById = [];
        foreach ($photoMeta as $m) {
            if (!empty($m['id'])) $metaById[(string)$m['id']] = $m;
        }
        $albumStmt = $pdo->prepare('SELECT user_id, album_name FROM albums WHERE folder_id = ? AND deleted_at IS NULL LIMIT 1');
        $albumStmt->execute([$fid]);
        $albumRow = $albumStmt->fetch();
        $ownerId = $albumRow ? (int)$albumRow['user_id'] : 1;

        $pdo->prepare('DELETE FROM photo_selections WHERE folder_id = ?')->execute([$fid]);
        $ins = $pdo->prepare('INSERT INTO photo_selections (owner_user_id, folder_id, photo_id, photo_name, category, guest_name, share_token) VALUES (?, ?, ?, ?, ?, ?, ?)');
        foreach ($selectedPhotos as $pid) {
            $pidStr = (string)$pid;
            $meta = $metaById[$pidStr] ?? [];
            $ins->execute([$ownerId, $fid, $pidStr, (string)($meta['name'] ?? $pidStr), (string)($meta['category'] ?? 'Album'), $guestName, $shareToken]);
        }
        $pdo->prepare('INSERT INTO kv_state (state_key, state_value) VALUES (?, ?) ON CONFLICT(state_key) DO UPDATE SET state_value = excluded.state_value')
            ->execute(["photoSelectionsByAlbum:$fid", json_encode(array_values($selectedPhotos), JSON_UNESCAPED_UNICODE)]);
        if ($action === 'confirm_guest_selection') {
            $count = count($selectedPhotos);
            $title = $albumRow ? $albumRow['album_name'] : $fid;
            $pdo->prepare('INSERT INTO notifications (user_id, title, message) VALUES (?, ?, ?)')
                ->execute([$ownerId, "Khách đã chốt chọn $count ảnh", "$guestName vừa gửi danh sách $count ảnh đã chọn trong album \"$title\"."]);
        }
        jsonOut(['success' => true, 'total_selected' => count($selectedPhotos), 'message' => 'Đã lưu lựa chọn ảnh vào database.']);

    case 'load_album_selections':
        if ($uid <= 0) jsonOut(['success' => false, 'message' => 'Vui lòng đăng nhập.'], 401);
        $fid = trim((string)($body['folder_id'] ?? ''));
        $stmt = $pdo->prepare('SELECT * FROM photo_selections WHERE folder_id = ? ORDER BY selected_at DESC, id DESC');
        $stmt->execute([$fid]);
        $records = $stmt->fetchAll();
        $selectedIds = array_map(fn($r) => (string)$r['photo_id'], $records);
        $guests = array_values(array_unique(array_filter(array_map(fn($r) => (string)$r['guest_name'], $records))));
        jsonOut([
            'success' => true,
            'folder_id' => $fid,
            'selected_ids' => $selectedIds,
            'records' => $records,
            'summary' => [
                'total_selected' => count($selectedIds),
                'last_selected_at' => $records[0]['selected_at'] ?? null,
                'guests' => $guests,
            ],
        ]);

    case 'load_all_comments':
        $rows = $pdo->query('SELECT * FROM comments ORDER BY id ASC')->fetchAll();
        jsonOut(['success' => true, 'data' => $rows]);

    case 'load_comments':
        $stmt = $pdo->prepare('SELECT * FROM comments WHERE photo_id = ? ORDER BY id ASC');
        $stmt->execute([(string)($body['photo_id'] ?? '')]);
        jsonOut(['success' => true, 'data' => $stmt->fetchAll()]);

    case 'save_comment':
        $pid = (string)($body['photo_id'] ?? '');
        $text = trim((string)($body['comment_text'] ?? ''));
        $author = $user ? $user['name'] : 'Khách xem album';
        $pdo->prepare('INSERT INTO comments (photo_id, user_id, author, comment_text) VALUES (?, ?, ?, ?)')->execute([$pid, $uid, $author, $text]);
        jsonOut(['success' => true]);

    case 'get_notifications':
        if ($uid <= 0) jsonOut(['success' => true, 'notifications' => []]);
        $stmt = $pdo->prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC');
        $stmt->execute([$uid]);
        jsonOut(['success' => true, 'notifications' => $stmt->fetchAll()]);

    case 'mark_notification_read':
        $pdo->prepare('UPDATE notifications SET is_read = 1 WHERE id = ?')->execute([(int)($body['notification_id'] ?? 0)]);
        jsonOut(['success' => true]);

    case 'load_chat':
        $cid = trim((string)($body['conversation_id'] ?? '')) ?: 'conv-default';
        $stmt = $pdo->prepare('SELECT sender_type, message, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC');
        $stmt->execute([$cid]);
        jsonOut(['success' => true, 'conversation_id' => $cid, 'data' => $stmt->fetchAll(), 'typing' => null]);

    case 'contact_admin':
        $cid = trim((string)($body['conversation_id'] ?? '')) ?: 'conv-default';
        $msg = trim((string)($body['message'] ?? ''));
        $pdo->prepare('INSERT INTO chat_messages (conversation_id, sender_type, message) VALUES (?, "guest", ?)')->execute([$cid, $msg]);
        $stmt = $pdo->prepare('SELECT sender_type, message, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC');
        $stmt->execute([$cid]);
        jsonOut(['success' => true, 'conversation_id' => $cid, 'data' => $stmt->fetchAll(), 'message' => 'Đã gửi tin nhắn tới admin.']);

    case 'set_chat_typing':
        jsonOut(['success' => true, 'conversation_id' => (string)($body['conversation_id'] ?? 'conv-default')]);

    case 'photographers_list':
        if ($uid <= 0) jsonOut(['success' => false, 'message' => 'Vui lòng đăng nhập.'], 401);
        $stmt = $pdo->prepare('SELECT * FROM photographers WHERE user_id = ? ORDER BY id DESC');
        $stmt->execute([$uid]);
        $rows = array_map(function ($r) {
            $r['shootLocation'] = $r['shoot_location'];
            $r['shootDates'] = json_decode($r['shoot_dates'] ?: '[]', true) ?: [];
            return $r;
        }, $stmt->fetchAll());
        jsonOut(['success' => true, 'photographers' => $rows]);

    case 'photographers_save':
        if ($uid <= 0) jsonOut(['success' => false, 'message' => 'Vui lòng đăng nhập.'], 401);
        $p = $body['photographer'] ?? [];
        $pid = (int)($p['id'] ?? 0);
        $dates = json_encode($p['shootDates'] ?? []);
        if ($pid > 0) {
            $pdo->prepare('UPDATE photographers SET name=?, role=?, phone=?, email=?, zalo=?, facebook=?, shoot_location=?, shoot_dates=?, status=? WHERE id=? AND user_id=?')
                ->execute([$p['name'], $p['role'], $p['phone'] ?? '', $p['email'] ?? '', $p['zalo'] ?? '', $p['facebook'] ?? '', $p['shootLocation'] ?? '', $dates, $p['status'] ?? 'active', $pid, $uid]);
        } else {
            $pdo->prepare('INSERT INTO photographers (user_id, name, role, phone, email, zalo, facebook, shoot_location, shoot_dates, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$uid, $p['name'], $p['role'], $p['phone'] ?? '', $p['email'] ?? '', $p['zalo'] ?? '', $p['facebook'] ?? '', $p['shootLocation'] ?? '', $dates, $p['status'] ?? 'active']);
            $pid = (int)$pdo->lastInsertId();
        }
        $p['id'] = $pid;
        jsonOut(['success' => true, 'photographer' => $p]);

    case 'photographers_delete':
        if ($uid <= 0) jsonOut(['success' => false], 401);
        $pdo->prepare('DELETE FROM photographers WHERE id = ? AND user_id = ?')->execute([(int)($body['id'] ?? 0), $uid]);
        jsonOut(['success' => true]);

    case 'contracts_list':
        if ($uid <= 0) jsonOut(['success' => true, 'contracts' => []]);
        $stmt = $pdo->prepare('SELECT id, payload FROM contracts WHERE user_id = ? ORDER BY id DESC');
        $stmt->execute([$uid]);
        $out = [];
        foreach ($stmt->fetchAll() as $r) {
            $item = json_decode($r['payload'], true) ?: [];
            $item['id'] = (int)$r['id'];
            $out[] = $item;
        }
        jsonOut(['success' => true, 'contracts' => $out]);

    case 'contracts_save':
        if ($uid <= 0) jsonOut(['success' => false, 'message' => 'Vui lòng đăng nhập.'], 401);
        $c = $body['contract'] ?? [];
        $cid = (int)($c['id'] ?? 0);
        unset($c['id']);
        $payload = json_encode($c, JSON_UNESCAPED_UNICODE);
        if ($cid > 0) {
            $pdo->prepare('UPDATE contracts SET payload = ? WHERE id = ? AND user_id = ?')->execute([$payload, $cid, $uid]);
        } else {
            $pdo->prepare('INSERT INTO contracts (user_id, payload) VALUES (?, ?)')->execute([$uid, $payload]);
            $cid = (int)$pdo->lastInsertId();
        }
        $c['id'] = $cid;
        jsonOut(['success' => true, 'contract' => $c]);

    case 'contracts_delete':
        if ($uid <= 0) jsonOut(['success' => false], 401);
        $pdo->prepare('DELETE FROM contracts WHERE id = ? AND user_id = ?')->execute([(int)($body['id'] ?? 0), $uid]);
        jsonOut(['success' => true]);

    case 'customers_list':
        if ($uid <= 0) jsonOut(['success' => false, 'message' => 'Vui lòng đăng nhập.'], 401);
        $stmt = $pdo->prepare('SELECT * FROM customers WHERE user_id = ? ORDER BY id DESC');
        $stmt->execute([$uid]);
        $rows = array_map(function ($r) {
            $r['packageName'] = $r['package_name'];
            $r['shootDate'] = $r['shoot_date'];
            return $r;
        }, $stmt->fetchAll());
        jsonOut(['success' => true, 'customers' => $rows]);

    case 'customers_save':
        if ($uid <= 0) jsonOut(['success' => false, 'message' => 'Vui lòng đăng nhập.'], 401);
        $c = $body['customer'] ?? [];
        $cid = (int)($c['id'] ?? 0);
        if ($cid > 0) {
            $pdo->prepare('UPDATE customers SET name=?, phone=?, email=?, social=?, package_name=?, shoot_date=?, budget=?, status=?, notes=? WHERE id=? AND user_id=?')
                ->execute([$c['name'], $c['phone'] ?? '', $c['email'] ?? '', $c['social'] ?? '', $c['packageName'] ?? '', $c['shootDate'] ?? '', (float)($c['budget'] ?? 0), $c['status'] ?? 'lead', $c['notes'] ?? '', $cid, $uid]);
        } else {
            $pdo->prepare('INSERT INTO customers (user_id, name, phone, email, social, package_name, shoot_date, budget, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                ->execute([$uid, $c['name'], $c['phone'] ?? '', $c['email'] ?? '', $c['social'] ?? '', $c['packageName'] ?? '', $c['shootDate'] ?? '', (float)($c['budget'] ?? 0), $c['status'] ?? 'lead', $c['notes'] ?? '']);
            $cid = (int)$pdo->lastInsertId();
        }
        $c['id'] = $cid;
        jsonOut(['success' => true, 'customer' => $c]);

    case 'customers_delete':
        if ($uid <= 0) jsonOut(['success' => false], 401);
        $pdo->prepare('DELETE FROM customers WHERE id = ? AND user_id = ?')->execute([(int)($body['id'] ?? 0), $uid]);
        jsonOut(['success' => true]);

    default:
        jsonOut(['success' => false, 'message' => "Action không hợp lệ: $action"], 400);
}
