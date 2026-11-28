param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [int]$Port = 5500
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
Add-Type -AssemblyName System.Net.Http

$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Json = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$Json.MaxJsonLength = 67108864

$DataDir = Join-Path $Root 'data'
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir -Force | Out-Null }
$DbPath = Join-Path $DataDir 'db.json'
$ConfigPath = Join-Path $DataDir 'config.json'

function New-RandomHex([int]$Bytes = 16) {
    $buf = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($buf)
    ($buf | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Get-PasswordHash([string]$Password, [string]$Salt) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $bytes = $Utf8.GetBytes("${Salt}:${Password}")
    $hash = $sha.ComputeHash($bytes)
    ($hash | ForEach-Object { $_.ToString('x2') }) -join ''
}

function New-PasswordRecord([string]$Password) {
    $salt = New-RandomHex 8
    @{ salt = $salt; hash = (Get-PasswordHash $Password $salt) }
}

function Test-Password([string]$Password, [string]$Salt, [string]$ExpectedHash) {
    (Get-PasswordHash $Password $Salt) -eq $ExpectedHash
}

function Get-NowIso {
    (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')
}

function Initialize-Database {
    if (Test-Path $DbPath) { return }
    $pw = New-PasswordRecord '123456'
    $today = Get-Date
    $soonDate = $today.AddDays(2).ToString('yyyy-MM-dd')
    $laterDate = $today.AddDays(10).ToString('yyyy-MM-dd')

    $seed = @{
        nextId = 100
        users = @(
            @{
                id = 1
                name = 'TeeMedia Studio'
                email = 'studio@gmail.com'
                phone = '0386 038 930'
                contactEmail = 'thongtrong10@gmail.com'
                zalo = '0386038930'
                passwordSalt = $pw.salt
                passwordHash = $pw.hash
                status = 'active'
                avatar = ''
                created_at = (Get-NowIso)
            }
        )
        sessions = @{}
        albums = @(
            @{ id = 1; user_id = 1; album_name = 'Pre-Wedding Minh & Lan - Đà Lạt'; folder_id = 'demo-album-dalat-01'; allow_save = 1; created_at = '2026-10-02 08:30:00'; deleted_at = $null },
            @{ id = 2; user_id = 1; album_name = 'Lễ Gia Tiên & Tiệc Cưới Hoàng Anh'; folder_id = 'demo-album-tiectuoi-02'; allow_save = 0; created_at = '2026-10-01 14:15:00'; deleted_at = $null },
            @{ id = 3; user_id = 1; album_name = 'Studio Concept Minimalist 2026'; folder_id = 'demo-album-studio-03'; allow_save = 1; created_at = '2026-09-28 19:05:00'; deleted_at = $null }
        )
        shares = @{
            'demo-share-dalat' = @{
                token = 'demo-share-dalat'
                folder_id = 'demo-album-dalat-01'
                owner_user_id = 1
                access_code_hash = ''
                access_code_salt = ''
                requires_code = $false
                created_at = (Get-NowIso)
            }
        }
        states = @{
            'photoSelectionsByAlbum:demo-album-dalat-01' = @('img-dl-1001', 'img-dl-1004')
            'photoSelectionsByAlbum:demo-album-tiectuoi-02' = @('img-tc-2001')
        }
        photo_selections = @(
            @{ id = 1; owner_user_id = 1; folder_id = 'demo-album-dalat-01'; photo_id = 'img-dl-1001'; photo_name = 'IMG_1001.JPG'; category = 'Đồi thông'; guest_name = 'Cô dâu Lan'; share_token = 'demo-share-dalat'; selected_at = '2026-10-02 09:15:00' },
            @{ id = 2; owner_user_id = 1; folder_id = 'demo-album-dalat-01'; photo_id = 'img-dl-1004'; photo_name = 'IMG_1004.JPG'; category = 'Hồ Xuân Hương'; guest_name = 'Chú rể Minh'; share_token = 'demo-share-dalat'; selected_at = '2026-10-02 09:22:00' },
            @{ id = 3; owner_user_id = 1; folder_id = 'demo-album-tiectuoi-02'; photo_id = 'img-tc-2001'; photo_name = 'DSC_2001.JPG'; category = 'Gia tiên'; guest_name = 'Hoàng Anh'; share_token = ''; selected_at = '2026-10-01 15:10:00' }
        )
        comments = @(
            @{ id = 1; photo_id = 'img-dl-1001'; user_id = 0; author = 'Cô dâu Lan'; comment_text = 'Tấm này ánh sáng đẹp quá, chỉnh màu ấm giúp em nhé!'; created_at = '2026-10-02 09:15:00' },
            @{ id = 2; photo_id = 'img-dl-1004'; user_id = 0; author = 'Chú rể Minh'; comment_text = 'In ảnh cổng cỡ 60x90 tấm này.'; created_at = '2026-10-02 09:22:00' }
        )
        notifications = @(
            @{ id = 1; user_id = 1; title = 'Khách hàng đã chọn xong ảnh'; message = 'Album Pre-Wedding Minh & Lan - Đà Lạt vừa có 2 ảnh yêu thích và 2 bình luận mới.'; created_at = '2026-10-02 09:25:00'; is_read = 0 },
            @{ id = 2; user_id = 1; title = 'Hệ thống Backend đã sẵn sàng'; message = 'Tất cả dữ liệu album, hợp đồng, thợ chụp, khách hàng và báo cáo đang được lưu trực tiếp vào data/db.json.'; created_at = (Get-NowIso); is_read = 0 }
        )
        chats = @{
            'conv-default' = @(
                @{ id = 1; sender_type = 'admin'; message = 'Xin chào! Hệ thống backend TeeMedia đang hoạt động. Bạn có thể gửi góp ý hoặc báo lỗi tại đây.'; created_at = (Get-NowIso) }
            )
        }
        photographers = @(
            @{ id = 1; user_id = 1; name = 'Nguyễn Minh Anh'; role = 'Chụp ảnh cưới chính'; phone = '0903 111 222'; email = 'minhanh@teemedia.vn'; zalo = '0903111222'; facebook = 'minhanh.photo'; shootLocation = 'Đà Lạt / TP.HCM'; shootDates = @($soonDate, $laterDate); status = 'active' },
            @{ id = 2; user_id = 1; name = 'Trần Quốc Thịnh'; role = 'Phóng sự cưới'; phone = '0908 333 444'; email = 'quocthinh@teemedia.vn'; zalo = '0908333444'; facebook = 'quocthinh.studio'; shootLocation = 'Quận 1, TP.HCM'; shootDates = @($laterDate); status = 'active' },
            @{ id = 3; user_id = 1; name = 'Lê Hà Linh'; role = 'Chân dung & Studio'; phone = '0912 555 666'; email = 'halinh@teemedia.vn'; zalo = '0912555666'; facebook = 'halinh.portrait'; shootLocation = 'Studio Quận 3'; shootDates = @(); status = 'leave' }
        )
        contracts = @(
            @{
                id = 1; user_id = 1; studioName = 'TeeMedia Studio'; contractNumber = 'PS-20261002-001'
                studioAddress = '12 Nguyễn Huệ, Quận 1, TP.HCM'; studioPhone = '0386 038 930'; contractDate = '2026-10-02'
                clientName = 'Trần Minh & Ngọc Lan'; clientPhone = '0987 654 321'; clientEmail = 'minhlan@gmail.com'
                servicePreset = 'Gói chụp ảnh cưới trọn gói'; serviceName = 'Gói chụp ảnh cưới trọn gói'; eventType = 'Chụp cưới'
                shootDate = $soonDate; shootDateSecondary = ''; shootLocation = 'Đồi thông Đà Lạt & Studio'; shootSchedule = 'Chụp ngoại cảnh Đà Lạt'
                deliverables = '01 buổi chụp ngoại cảnh; 30 ảnh lớn 30x45; 200 ảnh chỉnh sửa; 01 album online.'
                weddingAddon = 'Thêm 01 video highlight ngắn.'
                totalPrice = '25000000'; deposit = '12000000'
                paymentTerms = 'Đặt cọc 50% khi ký hợp đồng, thanh toán phần còn lại khi nhận ảnh.'
                extraTerms = 'Hỗ trợ chỉnh sửa màu theo tone yêu cầu.'
                created_at = (Get-NowIso)
            }
        )
        invoices = @(
            @{
                id = 1; user_id = 1; docType = 'quote'; invoiceNumber = 'BG-20261128-001'
                issueDate = '2026-11-28'; dueDate = $laterDate; status = 'quote'
                studioName = 'TeeMedia Atelier'; studioPhone = '0386 038 930'; studioEmail = 'thongtrong10@gmail.com'; studioZalo = '0386038930'
                clientName = 'Trần Minh & Ngọc Lan'; clientPhone = '0987 654 321'; clientEmail = 'minhlan@gmail.com'
                albumName = 'Pre-Wedding Đà Lạt'; discountValue = 0; discountType = 'vnd'; vatPercent = 0; depositAmount = 1000000
                notes = 'Báo giá in ấn hoàn thiện từ danh sách ảnh khách đã thả tim.'
                items = @(
                    @{ name = 'Album Photobook mở phẳng cao cấp'; spec = '25x35 cm · 20 trang bìa da'; unit = 'Cuốn'; qty = 1; price = 1800000 },
                    @{ name = 'Ảnh cổng Tráng gương Pha lê'; spec = '60x90 cm kèm khung'; unit = 'Tấm'; qty = 1; price = 950000 }
                )
                created_at = (Get-NowIso)
            }
        )
        customers = @(
            @{ id = 1; user_id = 1; name = 'Trần Minh & Ngọc Lan'; phone = '0987 654 321'; email = 'minhlan@gmail.com'; social = '0987654321'; packageName = 'Gói chụp ảnh cưới trọn gói'; shootDate = $soonDate; budget = 25000000; status = 'confirmed'; notes = 'Ưu tiên tone màu phim ấm Đà Lạt'; created_at = (Get-NowIso) },
            @{ id = 2; user_id = 1; name = 'Phạm Hoàng Anh'; phone = '0909 888 777'; email = 'hoanganh@gmail.com'; social = '0909888777'; packageName = 'Gói đám hỏi & tiệc cưới'; shootDate = $laterDate; budget = 18500000; status = 'shooting'; notes = 'Đang hậu kỳ ảnh lễ gia tiên'; created_at = (Get-NowIso) },
            @{ id = 3; user_id = 1; name = 'Vũ Thảo Vy'; phone = '0938 222 111'; email = 'thaovy@gmail.com'; social = 'thaovy.wedding'; packageName = 'Gói chụp studio nghệ thuật'; shootDate = ''; budget = 9500000; status = 'lead'; notes = 'Đang tư vấn concept Minimalist'; created_at = (Get-NowIso) }
        )
        portfolio = @{
            updated_at = $null
            albums = @()
            photos = @()
        }
        demoFolders = @{
            'demo-album-dalat-01' = @{
                name = 'Pre-Wedding Minh & Lan - Đà Lạt'
                files = @(
                    @{ id = 'img-dl-1001'; name = 'IMG_1001.JPG'; mimeType = 'image/jpeg'; category = 'Đồi thông'; createdTime = '2026-10-02T07:00:00Z'; palette = @('#2f4858', '#33658a', '#f6ae2d') },
                    @{ id = 'img-dl-1002'; name = 'IMG_1002.JPG'; mimeType = 'image/jpeg'; category = 'Đồi thông'; createdTime = '2026-10-02T07:05:00Z'; palette = @('#3d5a80', '#98c1d9', '#ee6c4d') },
                    @{ id = 'img-dl-1003'; name = 'IMG_1003.JPG'; mimeType = 'image/jpeg'; category = 'Hồ Xuân Hương'; createdTime = '2026-10-02T07:12:00Z'; palette = @('#4a4e69', '#9a8c98', '#f2e9e4') },
                    @{ id = 'img-dl-1004'; name = 'IMG_1004.JPG'; mimeType = 'image/jpeg'; category = 'Hồ Xuân Hương'; createdTime = '2026-10-02T07:18:00Z'; palette = @('#264653', '#2a9d8f', '#e9c46a') },
                    @{ id = 'img-dl-1005'; name = 'IMG_1005.JPG'; mimeType = 'image/jpeg'; category = 'Phim trường'; createdTime = '2026-10-02T07:25:00Z'; palette = @('#6d597a', '#b56576', '#eaac8b') },
                    @{ id = 'img-dl-1006'; name = 'IMG_1006.JPG'; mimeType = 'image/jpeg'; category = 'Phim trường'; createdTime = '2026-10-02T07:32:00Z'; palette = @('#355070', '#6d597a', '#e56b6f') }
                )
            }
            'demo-album-tiectuoi-02' = @{
                name = 'Lễ Gia Tiên & Tiệc Cưới Hoàng Anh'
                files = @(
                    @{ id = 'img-tc-2001'; name = 'DSC_2001.JPG'; mimeType = 'image/jpeg'; category = 'Gia tiên'; createdTime = '2026-10-01T08:00:00Z'; palette = @('#7f4f24', '#936639', '#ede0d4') },
                    @{ id = 'img-tc-2002'; name = 'DSC_2002.JPG'; mimeType = 'image/jpeg'; category = 'Gia tiên'; createdTime = '2026-10-01T08:10:00Z'; palette = @('#582f0e', '#936639', '#e6ccb2') },
                    @{ id = 'img-tc-2003'; name = 'DSC_2003.JPG'; mimeType = 'image/jpeg'; category = 'Sảnh tiệc'; createdTime = '2026-10-01T11:30:00Z'; palette = @('#2b2d42', '#8d99ae', '#edf2f4') },
                    @{ id = 'img-tc-2004'; name = 'DSC_2004.JPG'; mimeType = 'image/jpeg'; category = 'Sảnh tiệc'; createdTime = '2026-10-01T12:15:00Z'; palette = @('#1d3557', '#457b9d', '#f1faee') }
                )
            }
            'demo-album-studio-03' = @{
                name = 'Studio Concept Minimalist 2026'
                files = @(
                    @{ id = 'img-st-3001'; name = 'RAW_3001.JPG'; mimeType = 'image/jpeg'; category = 'Studio'; createdTime = '2026-09-28T15:00:00Z'; palette = @('#22223b', '#4a4e69', '#c9ada7') },
                    @{ id = 'img-st-3002'; name = 'RAW_3002.JPG'; mimeType = 'image/jpeg'; category = 'Studio'; createdTime = '2026-09-28T15:20:00Z'; palette = @('#343a40', '#6c757d', '#dee2e6') },
                    @{ id = 'img-st-3003'; name = 'RAW_3003.JPG'; mimeType = 'image/jpeg'; category = 'Studio'; createdTime = '2026-09-28T15:40:00Z'; palette = @('#212529', '#495057', '#adb5bd') }
                )
            }
        }
    }

    $jsonText = $Json.Serialize($seed)
    [System.IO.File]::WriteAllText($DbPath, $jsonText, $Utf8)
}

function Read-Db {
    Initialize-Database
    $raw = [System.IO.File]::ReadAllText($DbPath, $Utf8)
    $db = $Json.DeserializeObject($raw)
    if (-not $db.ContainsKey('photo_selections')) {
        $migrated = New-Object System.Collections.ArrayList
        $nid = 1
        foreach ($sk in $db['states'].Keys) {
            if ([string]$sk -match '^photoSelectionsByAlbum:(.+)$') {
                $fid = $Matches[1]
                $album = $db['albums'] | Where-Object { [string]$_['folder_id'] -eq $fid } | Select-Object -First 1
                $ownerId = if ($album) { [int]$album['user_id'] } else { 1 }
                foreach ($itemId in @($db['states'][$sk])) {
                    $df = Find-DemoFile $db ([string]$itemId)
                    [void]$migrated.Add(@{
                        id = $nid++
                        owner_user_id = $ownerId
                        folder_id = $fid
                        photo_id = [string]$itemId
                        photo_name = if ($df) { [string]$df['name'] } else { [string]$itemId }
                        category = if ($df) { [string]$df['category'] } else { 'Album' }
                        guest_name = 'Khách xem album'
                        share_token = ''
                        selected_at = (Get-NowIso)
                    })
                }
            }
        }
        $db['photo_selections'] = $migrated
        Save-Db $db
    }
    $db
}

function Sync-PhotoSelections($Db, [string]$FolderId, $SelectedIds, [string]$GuestName = 'Khách xem album', [string]$ShareToken = '', $PhotoMetaList = @()) {
    if (-not $FolderId) { return }
    $idList = @($SelectedIds | ForEach-Object { [string]$_ } | Where-Object { $_ } | Select-Object -Unique)
    $Db['states']["photoSelectionsByAlbum:$FolderId"] = $idList

    $album = $Db['albums'] | Where-Object { [string]$_['folder_id'] -eq $FolderId -and -not $_['deleted_at'] } | Select-Object -First 1
    $ownerId = if ($album) { [int]$album['user_id'] } else { 1 }

    $metaLookup = @{}
    foreach ($m in @($PhotoMetaList)) {
        if ($m -and $m['id']) { $metaLookup[[string]$m['id']] = $m }
    }
    $existingLookup = @{}
    foreach ($r in @($Db['photo_selections'])) {
        if ([string]$r['folder_id'] -eq $FolderId) { $existingLookup[[string]$r['photo_id']] = $r }
    }

    $remaining = @($Db['photo_selections'] | Where-Object { [string]$_['folder_id'] -ne $FolderId })
    $updated = New-Object System.Collections.ArrayList
    foreach ($item in $remaining) { [void]$updated.Add($item) }

    $now = Get-NowIso
    $cleanGuest = if ($GuestName -and $GuestName.Trim()) { $GuestName.Trim() } else { 'Khách xem album' }
    foreach ($itemId in $idList) {
        $prev = $existingLookup[$itemId]
        $meta = $metaLookup[$itemId]
        $df = Find-DemoFile $Db $itemId
        $pName = if ($meta -and $meta['name']) { [string]$meta['name'] } elseif ($prev -and $prev['photo_name']) { [string]$prev['photo_name'] } elseif ($df) { [string]$df['name'] } else { $itemId }
        $pCat = if ($meta -and $meta['category']) { [string]$meta['category'] } elseif ($prev -and $prev['category']) { [string]$prev['category'] } elseif ($df) { [string]$df['category'] } else { 'Album' }
        $gName = if ($prev -and $prev['guest_name'] -and $cleanGuest -eq 'Khách xem album') { [string]$prev['guest_name'] } else { $cleanGuest }
        $sAt = if ($prev -and $prev['selected_at']) { [string]$prev['selected_at'] } else { $now }
        [void]$updated.Add(@{
            id = (Get-NextId $Db)
            owner_user_id = $ownerId
            folder_id = $FolderId
            photo_id = $itemId
            photo_name = $pName
            category = $pCat
            guest_name = $gName
            share_token = if ($ShareToken) { $ShareToken } elseif ($prev) { [string]$prev['share_token'] } else { '' }
            selected_at = $sAt
        })
    }
    $Db['photo_selections'] = $updated
}

function Save-Db($Db) {
    $jsonText = ConvertTo-Json -InputObject $Db -Depth 20 -Compress
    [System.IO.File]::WriteAllText($DbPath, $jsonText, $Utf8)
}

function Get-NextId($Db) {
    $Db['nextId'] = [int]$Db['nextId'] + 1
    [int]$Db['nextId']
}

function Get-DemoSvgText([string]$Title, [string]$Subtitle, $Palette) {
    $bg1 = if ($Palette -and $Palette.Count -ge 1) { $Palette[0] } else { '#334155' }
    $bg2 = if ($Palette -and $Palette.Count -ge 2) { $Palette[1] } else { '#64748b' }
    $accent = if ($Palette -and $Palette.Count -ge 3) { $Palette[2] } else { '#f8fafc' }
    @"
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 900 900">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="$bg1"/>
      <stop offset="100%" stop-color="$bg2"/>
    </linearGradient>
  </defs>
  <rect width="900" height="900" fill="url(#g)"/>
  <circle cx="450" cy="360" r="145" fill="$accent" opacity="0.22"/>
  <circle cx="450" cy="360" r="98" fill="$accent" opacity="0.35"/>
  <path d="M190 710 Q450 520 710 710 Z" fill="$accent" opacity="0.25"/>
  <text x="450" y="376" font-family="sans-serif" font-size="44" font-weight="700" fill="#ffffff" text-anchor="middle">$Title</text>
  <text x="450" y="428" font-family="sans-serif" font-size="24" fill="#ffffff" opacity="0.88" text-anchor="middle">$Subtitle</text>
</svg>
"@
}

function Get-DriveApiKey {
    if ($env:GOOGLE_API_KEY) { return $env:GOOGLE_API_KEY }
    if (Test-Path $ConfigPath) {
        try {
            $cfg = $Json.DeserializeObject([System.IO.File]::ReadAllText($ConfigPath, $Utf8))
            if ($cfg['GOOGLE_API_KEY']) { return [string]$cfg['GOOGLE_API_KEY'] }
        } catch {}
    }
    return ''
}

$HttpClientHandler = New-Object System.Net.Http.HttpClientHandler
$HttpClientHandler.AllowAutoRedirect = $true
$HttpClient = New-Object System.Net.Http.HttpClient($HttpClientHandler)
$HttpClient.Timeout = [TimeSpan]::FromSeconds(20)
$HttpClient.DefaultRequestHeaders.UserAgent.ParseAdd('Mozilla/5.0 (Windows NT 10.0; Win64; x64) PhotoSelect/1.0')

function Fetch-ExternalString([string]$Url) {
    $resp = $HttpClient.GetAsync($Url).GetAwaiter().GetResult()
    $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    @{ ok = $resp.IsSuccessStatusCode; status = [int]$resp.StatusCode; body = $body }
}

function Get-DriveMeta($Db, [string]$FolderId) {
    if ($Db['demoFolders'].ContainsKey($FolderId)) {
        $f = $Db['demoFolders'][$FolderId]
        return @{ id = $FolderId; name = $f['name'] }
    }
    $apiKey = Get-DriveApiKey
    if ($apiKey) {
        $u = "https://www.googleapis.com/drive/v3/files/$([Uri]::EscapeDataString($FolderId))?fields=id,name,mimeType&supportsAllDrives=true&includeItemsFromAllDrives=true&key=$([Uri]::EscapeDataString($apiKey))"
        $res = Fetch-ExternalString $u
        if ($res.ok) { return $Json.DeserializeObject($res.body) }
    }
    # Public Google Drive folder HTML fallback
    $pub = Fetch-ExternalString "https://drive.google.com/embeddedfolderview?id=$([Uri]::EscapeDataString($FolderId))"
    if ($pub.ok -and $pub.body -match '<title>(.*?)</title>') {
        $title = [System.Net.WebUtility]::HtmlDecode($Matches[1]) -replace '\s*-\s*Google Drive\s*$', ''
        if ($title) { return @{ id = $FolderId; name = $title.Trim() } }
    }
    $pub2 = Fetch-ExternalString "https://drive.google.com/drive/folders/$([Uri]::EscapeDataString($FolderId))"
    if ($pub2.ok -and $pub2.body -match '<title>(.*?)</title>') {
        $title = [System.Net.WebUtility]::HtmlDecode($Matches[1]) -replace '\s*-\s*Google Drive\s*$', ''
        if ($title) { return @{ id = $FolderId; name = $title.Trim() } }
    }
    throw "Không thể đọc thông tin thư mục Google Drive ($FolderId). Hãy kiểm tra quyền chia sẻ công khai."
}

function Get-DriveList($Db, [string]$FolderId, [string]$PageToken = '') {
    if ($Db['demoFolders'].ContainsKey($FolderId)) {
        $folder = $Db['demoFolders'][$FolderId]
        $enriched = New-Object System.Collections.ArrayList
        foreach ($f in $folder['files']) {
            $clone = @{}
            foreach ($k in $f.Keys) { $clone[$k] = $f[$k] }
            $clone['thumbnailUrl'] = "photowedding/app.php?drive_proxy=thumb&file_id=$([Uri]::EscapeDataString([string]$f['id']))"
            $clone['fullUrl'] = "photowedding/app.php?drive_proxy=thumb&file_id=$([Uri]::EscapeDataString([string]$f['id']))"
            [void]$enriched.Add($clone)
        }
        return @{ files = $enriched; nextPageToken = '' }
    }
    $apiKey = Get-DriveApiKey
    if ($apiKey) {
        $q = [Uri]::EscapeDataString("'$FolderId' in parents and trashed = false")
        $pt = if ($PageToken) { "&pageToken=$([Uri]::EscapeDataString($PageToken))" } else { '' }
        $u = "https://www.googleapis.com/drive/v3/files?q=$q&fields=nextPageToken,files(id,name,mimeType,createdTime,modifiedTime)&pageSize=200&supportsAllDrives=true&includeItemsFromAllDrives=true$pt&key=$([Uri]::EscapeDataString($apiKey))"
        $res = Fetch-ExternalString $u
        if ($res.ok) { return $Json.DeserializeObject($res.body) }
    }
    # Public embeddedfolderview fallback
    $pub = Fetch-ExternalString "https://drive.google.com/embeddedfolderview?id=$([Uri]::EscapeDataString($FolderId))"
    if (-not $pub.ok) { throw "Không thể tải danh sách file từ Google Drive." }
    $files = New-Object System.Collections.ArrayList
    $pattern = 'id="entry-([a-zA-Z0-9_-]+)".*?<div class="flip-entry-title">(.*?)</div>'
    $matches = [regex]::Matches($pub.body, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
    foreach ($m in $matches) {
        $fid = $m.Groups[1].Value
        $fname = [System.Net.WebUtility]::HtmlDecode($m.Groups[2].Value.Trim())
        $isFolder = $m.Value -match 'drive/folders/'
        [void]$files.Add(@{
            id = $fid
            name = $fname
            mimeType = if ($isFolder) { 'application/vnd.google-apps.folder' } else { 'image/jpeg' }
        })
    }
    return @{ files = $files; nextPageToken = '' }
}

function Send-Response($Context, [int]$StatusCode, [string]$ContentType, [byte[]]$Bytes) {
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = $ContentType
    $Context.Response.Headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    $Context.Response.ContentLength64 = $Bytes.Length
    $Context.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $Context.Response.Close()
}

function Send-Json($Context, [int]$StatusCode, $Obj) {
    $text = ConvertTo-Json -InputObject $Obj -Depth 20 -Compress
    Send-Response $Context $StatusCode 'application/json; charset=utf-8' ($Utf8.GetBytes($text))
}

function Send-Text($Context, [int]$StatusCode, [string]$Text) {
    Send-Response $Context $StatusCode 'text/plain; charset=utf-8' ($Utf8.GetBytes($Text))
}

function Send-Html($Context, [int]$StatusCode, [string]$Html) {
    Send-Response $Context $StatusCode 'text/html; charset=utf-8' ($Utf8.GetBytes($Html))
}

function Send-Redirect($Context, [string]$Location) {
    $Context.Response.StatusCode = 302
    $Context.Response.RedirectLocation = $Location
    $Context.Response.Close()
}

function Parse-QueryString([string]$Query) {
    $map = @{}
    if ([string]::IsNullOrWhiteSpace($Query)) { return $map }
    $q = $Query.TrimStart('?')
    foreach ($pair in $q.Split('&')) {
        if (-not $pair) { continue }
        $parts = $pair.Split('=', 2)
        $k = [Uri]::UnescapeDataString($parts[0].Replace('+', ' '))
        $v = if ($parts.Length -gt 1) { [Uri]::UnescapeDataString($parts[1].Replace('+', ' ')) } else { '' }
        $map[$k] = $v
    }
    $map
}

function Read-RequestBody($Request) {
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $Utf8)
    $text = $reader.ReadToEnd()
    $ct = [string]$Request.ContentType
    if ($ct -match 'application/json') {
        if ([string]::IsNullOrWhiteSpace($text)) { return @{} }
        return $Json.DeserializeObject($text)
    }
    if ($ct -match 'application/x-www-form-urlencoded') {
        return (Parse-QueryString $text)
    }
    if ($ct -match 'multipart/form-data;\s*boundary=([^\s;]+)') {
        $boundary = $Matches[1].Trim('"')
        $map = @{}
        $sections = $text -split [regex]::Escape("--$boundary")
        foreach ($sec in $sections) {
            if ($sec -match 'name="([^"]+)"\r?\n\r?\n([\s\S]*?)\r?\n$') {
                $map[$Matches[1]] = $Matches[2]
            }
        }
        return $map
    }
    if ($text.TrimStart().StartsWith('{')) {
        try { return $Json.DeserializeObject($text) } catch {}
    }
    return @{}
}

function Get-SessionContext($Context, $Db) {
    $sid = ''
    $cookie = $Context.Request.Cookies['PHPSESSID']
    if ($cookie) { $sid = $cookie.Value }
    if (-not $sid -or -not $Db['sessions'].ContainsKey($sid)) {
        $sid = New-RandomHex 16
        $Db['sessions'][$sid] = @{
            userId = 0
            unlockedShares = @()
            remember = $false
            created_at = (Get-NowIso)
        }
        Save-Db $Db
        $newCookie = New-Object System.Net.Cookie('PHPSESSID', $sid, '/')
        $newCookie.HttpOnly = $true
        $Context.Response.Cookies.Add($newCookie)
    }
    $sess = $Db['sessions'][$sid]
    $user = $null
    $uid = [int]$sess['userId']
    if ($uid -gt 0) {
        $found = $Db['users'] | Where-Object { [int]$_['id'] -eq $uid } | Select-Object -First 1
        if ($found) {
            $user = @{
                id = [int]$found['id']
                name = $found['name']
                email = $found['email']
                phone = $found['phone']
                status = $found['status']
                avatar = $found['avatar']
            }
        }
    }
    @{ sid = $sid; session = $sess; user = $user }
}

function Find-DemoFile($Db, [string]$FileId) {
    foreach ($folder in $Db['demoFolders'].Values) {
        foreach ($f in $folder['files']) {
            if ([string]$f['id'] -eq $FileId) { return $f }
        }
    }
    return $null
}

function ConvertTo-CleanSlug([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return '' }
    $normalized = $Text.Normalize([System.Text.NormalizationForm]::FormD)
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $normalized.ToCharArray()) {
        $cat = [System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)
        if ($cat -ne [System.Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$sb.Append($ch)
        }
    }
    $clean = $sb.ToString().Replace('đ', 'd').Replace('Đ', 'd').ToLowerInvariant()
    $clean = [System.Text.RegularExpressions.Regex]::Replace($clean, '[^a-z0-9]+', '-')
    return $clean.Trim('-')
}

function Resolve-ShareRecord($Db, [string]$TokenOrSlug) {
    $key = ([string]$TokenOrSlug).Trim()
    if (-not $key -or -not ($Db['shares'] -is [hashtable])) { return $null }
    if ($Db['shares'].ContainsKey($key)) {
        return @{ key = $key; share = $Db['shares'][$key] }
    }
    $slugLower = ConvertTo-CleanSlug $key
    foreach ($entryKey in $Db['shares'].Keys) {
        $rec = $Db['shares'][$entryKey]
        if ($rec -and $slugLower -and (([string]$rec['slug']).ToLowerInvariant() -eq $slugLower -or ([string]$entryKey).ToLowerInvariant() -eq $slugLower)) {
            return @{ key = [string]$entryKey; share = $rec }
        }
    }
    return $null
}

function Render-HomeHtml($Db, $SessionCtx, [string]$ShareToken = '') {
    $htmlPath = Join-Path $Root 'index.html'
    $html = [System.IO.File]::ReadAllText($htmlPath, $Utf8)

    $userObj = if ($SessionCtx.user) {
        @{ id = $SessionCtx.user.id; name = $SessionCtx.user.name; email = $SessionCtx.user.email; phone = $SessionCtx.user.phone; status = $SessionCtx.user.status }
    } else {
        @{ id = 0; name = ''; email = ''; phone = '' }
    }

    $sharedFolderId = ''
    $sharedOwnerId = 0
    $allowSave = $true

    $resolved = Resolve-ShareRecord $Db $ShareToken
    if ($resolved) {
        $shareKey = $resolved.key
        $share = $resolved.share
        $sharedFolderId = [string]$share['folder_id']
        $sharedOwnerId = [int]$share['owner_user_id']
        $album = $Db['albums'] | Where-Object { [string]$_['folder_id'] -eq $sharedFolderId -and -not $_['deleted_at'] } | Select-Object -First 1
        if ($album) { $allowSave = ([int]$album['allow_save'] -eq 1) }

        $unlocked = @($SessionCtx.session['unlockedShares'])
        $isOwner = ($userObj.id -gt 0 -and $userObj.id -eq $sharedOwnerId)
        if ($share['requires_code'] -and -not $isOwner -and ($unlocked -notcontains $shareKey) -and ($unlocked -notcontains $ShareToken)) {
            $actionAttr = if ($share['slug']) { "/?a=$([Uri]::EscapeDataString([string]$share['slug']))" } else { "/?share=$([Uri]::EscapeDataString($ShareToken))" }
            $gateHtml = @"
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nhập mã bảo mật - TeeMedia</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Manrope,system-ui,sans-serif;background:#141311;color:#f7f3ea;padding:1rem;}
.card{width:min(100%,400px);padding:1.8rem;border-radius:18px;background:#1e1b17;border:1px solid rgba(212,175,55,.28);box-shadow:0 24px 50px rgba(0,0,0,.45);}
h1{margin:0 0 .5rem;font-size:1.3rem;} p{margin:0 0 1rem;color:#c8c1b4;font-size:.86rem;line-height:1.5;}
input{width:100%;box-sizing:border-box;padding:.75rem;border-radius:10px;border:1px solid rgba(212,175,55,.35);background:#12110f;color:#fff;font-size:.92rem;margin-bottom:.75rem;}
button{width:100%;padding:.8rem;border:0;border-radius:10px;background:linear-gradient(135deg,#d4af37,#f0cb5f);color:#171510;font-weight:800;cursor:pointer;font-size:.9rem;}
.err{color:#ff8f86;font-size:.82rem;margin-top:.6rem;min-height:1.1rem;}
</style>
</head>
<body>
<form class="card" method="POST" action="$actionAttr">
<h1>Album được bảo vệ</h1>
<p>Vui lòng nhập mã bảo mật do studio cung cấp để xem album này.</p>
<input type="password" name="access_code" placeholder="Nhập mã bảo mật..." required autofocus>
<button type="submit">Mở album</button>
<div class="err" id="err"></div>
</form>
</body>
</html>
"@
            return $gateHtml
        }
    }

    $inject = "<script>window.__APP_USER__ = $($Json.Serialize($userObj));window.__SHARED_FOLDER_ID__ = $($Json.Serialize($sharedFolderId));window.__SHARED_OWNER_USER_ID__ = $sharedOwnerId;window.__SHARED_ALBUM_ALLOW_SAVE__ = $(if ($allowSave) { 'true' } else { 'false' });</script>"
    $html -replace '<script>window\.__APP_USER__[\s\S]*?</script>', $inject
}

function Handle-ApiRequest($Context, $Db, $SessionCtx) {
    $req = $Context.Request
    $query = Parse-QueryString $req.Url.Query

    # Google OAuth local shortcut
    if ($query['google'] -eq 'login') {
        $SessionCtx.session['userId'] = 1
        Save-Db $Db
        Send-Redirect $Context '/albums?login=success'
        return
    }

    # Drive Proxy GET endpoints
    if ($query.ContainsKey('drive_proxy')) {
        $mode = $query['drive_proxy']
        if ($mode -eq 'meta') {
            try {
                $meta = Get-DriveMeta $Db ([string]$query['folder_id'])
                Send-Json $Context 200 $meta
            } catch {
                Send-Json $Context 400 @{ error = @{ message = $_.Exception.Message } }
            }
            return
        }
        if ($mode -eq 'list') {
            try {
                $list = Get-DriveList $Db ([string]$query['folder_id']) ([string]$query['page_token'])
                Send-Json $Context 200 $list
            } catch {
                Send-Json $Context 400 @{ error = @{ message = $_.Exception.Message } }
            }
            return
        }
        if ($mode -eq 'thumb' -or $mode -eq 'download') {
            $fid = [string]$query['file_id']
            $demoFile = Find-DemoFile $Db $fid
            if ($demoFile) {
                $svg = Get-DemoSvgText $demoFile['name'] $demoFile['category'] $demoFile['palette']
                if ($mode -eq 'download') {
                    $Context.Response.Headers['Content-Disposition'] = "attachment; filename=`"$($demoFile['name'])`""
                }
                Send-Response $Context 200 'image/svg+xml; charset=utf-8' ($Utf8.GetBytes($svg))
                return
            }
            try {
                $url = if ($mode -eq 'thumb') {
                    "https://drive.google.com/thumbnail?id=$([Uri]::EscapeDataString($fid))&sz=w1280"
                } else {
                    "https://drive.google.com/uc?export=download&id=$([Uri]::EscapeDataString($fid))"
                }
                $resp = $HttpClient.GetAsync($url).GetAwaiter().GetResult()
                $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
                $ct = if ($resp.Content.Headers.ContentType) { $resp.Content.Headers.ContentType.ToString() } else { 'application/octet-stream' }
                Send-Response $Context ([int]$resp.StatusCode) $ct $bytes
            } catch {
                Send-Text $Context 502 "Không thể tải file từ Google Drive."
            }
            return
        }
    }

    $body = Read-RequestBody $req
    $action = [string]$body['action']
    $uid = if ($SessionCtx.user) { [int]$SessionCtx.user.id } else { 0 }

    switch ($action) {
        'session_state' {
            Send-Json $Context 200 @{ success = $true; user = $SessionCtx.user }
            return
        }

        'login' {
            $rawLogin = if ($body['login_id']) { $body['login_id'] } elseif ($body['email']) { $body['email'] } else { '' }
            $loginId = ([string]$rawLogin).Trim().ToLowerInvariant()
            $password = [string]$body['password']
            $found = $Db['users'] | Where-Object {
                ([string]$_['email']).ToLowerInvariant() -eq $loginId -or ([string]$_['id']) -eq $loginId
            } | Select-Object -First 1

            if (-not $found -or -not (Test-Password $password $found['passwordSalt'] $found['passwordHash'])) {
                Send-Json $Context 401 @{ success = $false; message = 'Email/ID hoặc mật khẩu không đúng. Chỉ tài khoản được cấp mới có thể đăng nhập.' }
                return
            }
            if ($found['status'] -eq 'disabled') {
                Send-Json $Context 403 @{ success = $false; message = 'Tài khoản này đang bị tạm khóa.' }
                return
            }
            $SessionCtx.session['userId'] = [int]$found['id']
            $SessionCtx.session['remember'] = ($body['remember_me'] -eq '1' -or $body['remember_me'] -eq $true)
            Save-Db $Db
            $userOut = @{ id = [int]$found['id']; name = $found['name']; email = $found['email']; phone = $found['phone']; status = $found['status']; avatar = $found['avatar'] }
            Send-Json $Context 200 @{ success = $true; message = 'Đăng nhập thành công.'; user = $userOut }
            return
        }

        'register' {
            Send-Json $Context 403 @{ success = $false; message = 'Chức năng đăng ký tự do đã tắt. Chỉ quản trị viên TeeMedia Studio mới có quyền cấp tài khoản.' }
            return
        }

        'forgot' {
            Send-Json $Context 403 @{ success = $false; message = 'Vui lòng liên hệ trực tiếp quản trị viên TeeMedia Studio để được cấp lại mật khẩu.' }
            return
        }

        'change_password' {
            if ($uid -le 0) { Send-Text $Context 401 'Vui lòng đăng nhập trước.'; return }
            $oldPw = [string]$body['old_password']
            $newPw = [string]$body['new_password']
            $confirmPw = [string]$body['confirm_password']
            if ($newPw.Length -lt 6) { Send-Text $Context 400 'Mật khẩu mới tối thiểu 6 ký tự.'; return }
            if ($newPw -ne $confirmPw) { Send-Text $Context 400 'Xác nhận mật khẩu mới không khớp.'; return }
            $user = $Db['users'] | Where-Object { [int]$_['id'] -eq $uid } | Select-Object -First 1
            if (-not $user -or -not (Test-Password $oldPw $user['passwordSalt'] $user['passwordHash'])) {
                Send-Text $Context 400 'Mật khẩu hiện tại không đúng.'
                return
            }
            $pw = New-PasswordRecord $newPw
            $user['passwordSalt'] = $pw.salt
            $user['passwordHash'] = $pw.hash
            Save-Db $Db
            Send-Text $Context 200 'success'
            return
        }

        'update_phone' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Chưa đăng nhập.' }; return }
            $phone = ([string]$body['phone']).Trim()
            $user = $Db['users'] | Where-Object { [int]$_['id'] -eq $uid } | Select-Object -First 1
            $user['phone'] = $phone
            Save-Db $Db
            $userOut = @{ id = [int]$user['id']; name = $user['name']; email = $user['email']; phone = $phone; status = $user['status'] }
            Send-Json $Context 200 @{ success = $true; message = 'Đã cập nhật số điện thoại.'; user = $userOut }
            return
        }

        'load_portfolio_setup' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Chưa đăng nhập.' }; return }
            $active = @($Db['albums'] | Where-Object { -not $_['deleted_at'] -and [string]$_['folder_id'] -ne 'test_check_folder' })
            $real = @($active | Where-Object { [string]$_['folder_id'] -notlike 'demo-*' })
            $available = if ($real.Count -gt 0) { $real } else { $active }
            $portfolio = if ($Db.ContainsKey('portfolio') -and $Db['portfolio']) { $Db['portfolio'] } else { @{ updated_at = $null; albums = @(); photos = @() } }
            Send-Json $Context 200 @{ success = $true; portfolio = $portfolio; albums = @($available) }
            return
        }
        'save_portfolio_setup' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Chưa đăng nhập.' }; return }
            $pIn = if ($Payload['portfolio']) { $Payload['portfolio'] } else { $Payload }
            $savedAlbums = @()
            if ($pIn['albums']) { $savedAlbums = @($pIn['albums']) }
            $savedPhotos = @()
            if ($pIn['photos']) { $savedPhotos = @($pIn['photos']) }
            $Db['portfolio'] = @{
                updated_at = (Get-NowIso)
                albums = $savedAlbums
                photos = $savedPhotos
            }
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; portfolio = $Db['portfolio']; message = 'Đã lưu và xuất bản Portfolio thành công!' }
            return
        }
        'load_public_portfolio' {
            $primaryUser = @($Db['users'])[0]
            $studioName = if ($primaryUser -and $primaryUser['name']) { [string]$primaryUser['name'] } else { 'TeeMedia Studio' }
            $portfolio = if ($Db.ContainsKey('portfolio') -and $Db['portfolio']) { $Db['portfolio'] } else { @{ updated_at = $null; albums = @(); photos = @() } }
            $allAlbums = if ($portfolio['albums']) { @($portfolio['albums']) } else { @() }
            $visibleAlbums = @($allAlbums | Where-Object {
                ($_.ContainsKey('visible') -eq $false -or [bool]$_['visible']) -and
                ($_.ContainsKey('photos') -eq $false -or @($_['photos']).Count -gt 0)
            } | Sort-Object { if ($_.ContainsKey('order')) { [int]$_['order'] } else { 999 } })
            $savedPhotos = if ($portfolio['photos']) { @($portfolio['photos']) } else { @() }
            Send-Json $Context 200 @{
                success = $true
                curated = $true
                updated_at = $portfolio['updated_at']
                studio = @{
                    name = $studioName
                    phone = if ($primaryUser -and $primaryUser['phone'] -and $primaryUser['phone'] -ne '0901 234 567') { [string]$primaryUser['phone'] } else { '0386 038 930' }
                    email = if ($primaryUser -and $primaryUser['contactEmail']) { [string]$primaryUser['contactEmail'] } elseif ($primaryUser -and $primaryUser['email'] -and $primaryUser['email'] -ne 'studio@gmail.com') { [string]$primaryUser['email'] } else { 'thongtrong10@gmail.com' }
                    zalo = if ($primaryUser -and $primaryUser['zalo']) { [string]$primaryUser['zalo'] } else { '0386038930' }
                }
                albums = @($visibleAlbums)
                photos = @($savedPhotos)
            }
            return
        }
        'load_albums' {
            if ($uid -le 0) { Send-Json $Context 200 @{ success = $true; data = @() }; return }
            $items = @($Db['albums'] | Where-Object { [int]$_['user_id'] -eq $uid -and -not $_['deleted_at'] })
            $enriched = New-Object System.Collections.ArrayList
            foreach ($album in $items) {
                $fid = [string]$album['folder_id']
                $selRecords = @($Db['photo_selections'] | Where-Object { [string]$_['folder_id'] -eq $fid })
                $selCount = if ($selRecords.Count -gt 0) { $selRecords.Count } elseif ($Db['states'].ContainsKey("photoSelectionsByAlbum:$fid")) { @($Db['states']["photoSelectionsByAlbum:$fid"]).Count } else { 0 }
                $lastRec = $selRecords | Sort-Object { $_['selected_at'] } -Descending | Select-Object -First 1
                $lastAt = if ($lastRec) { $lastRec['selected_at'] } else { $null }
                $guests = @($selRecords | ForEach-Object { [string]$_['guest_name'] } | Where-Object { $_ } | Select-Object -Unique)
                $copy = @{}
                foreach ($k in $album.Keys) { $copy[$k] = $album[$k] }
                $copy['selected_count'] = $selCount
                $copy['last_selected_at'] = $lastAt
                $copy['selected_guests'] = $guests
                [void]$enriched.Add($copy)
            }
            Send-Json $Context 200 @{ success = $true; data = $enriched }
            return
        }

        'load_deleted_albums' {
            if ($uid -le 0) { Send-Json $Context 200 @{ success = $true; data = @() }; return }
            $items = @($Db['albums'] | Where-Object { [int]$_['user_id'] -eq $uid -and $_['deleted_at'] })
            Send-Json $Context 200 @{ success = $true; data = $items }
            return
        }

        'save_album' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $folderId = ([string]$body['folder_id']).Trim()
            $albumName = ([string]$body['album_name']).Trim()
            if (-not $folderId) { Send-Json $Context 400 @{ success = $false; message = 'Thiếu folder_id.' }; return }
            $exists = $Db['albums'] | Where-Object { [int]$_['user_id'] -eq $uid -and [string]$_['folder_id'] -eq $folderId -and -not $_['deleted_at'] } | Select-Object -First 1
            if ($exists) { Send-Json $Context 409 @{ success = $false; message = 'Album này đã có trong danh sách.' }; return }
            $newAlbum = @{
                id = (Get-NextId $Db)
                user_id = $uid
                album_name = if ($albumName) { $albumName } else { "Album $($folderId.Substring(0, [Math]::Min(8, $folderId.Length)))" }
                folder_id = $folderId
                allow_save = if ($body['allow_save']) { 1 } else { 0 }
                created_at = (Get-NowIso)
                deleted_at = $null
            }
            $Db['albums'] = @($newAlbum) + @($Db['albums'])
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; data = $newAlbum }
            return
        }

        'update_album_permission' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $aid = [int]$body['album_id']
            $album = $Db['albums'] | Where-Object { [int]$_['id'] -eq $aid -and [int]$_['user_id'] -eq $uid } | Select-Object -First 1
            if (-not $album) { Send-Json $Context 404 @{ success = $false; message = 'Không tìm thấy album.' }; return }
            $album['allow_save'] = if ($body['allow_save']) { 1 } else { 0 }
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; allow_save = $album['allow_save'] }
            return
        }

        'delete_album' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $aid = [int]$body['album_id']
            $album = $Db['albums'] | Where-Object { [int]$_['id'] -eq $aid -and [int]$_['user_id'] -eq $uid } | Select-Object -First 1
            if ($album) { $album['deleted_at'] = (Get-NowIso); Save-Db $Db }
            Send-Json $Context 200 @{ success = $true }
            return
        }

        'restore_album' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $aid = [int]$body['album_id']
            $album = $Db['albums'] | Where-Object { [int]$_['id'] -eq $aid -and [int]$_['user_id'] -eq $uid } | Select-Object -First 1
            if ($album) { $album['deleted_at'] = $null; Save-Db $Db }
            Send-Json $Context 200 @{ success = $true }
            return
        }

        'create_share_link' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $folderId = ([string]$body['folder_id']).Trim()
            $code = ([string]$body['access_code']).Trim()
            $albumMatch = $Db['albums'] | Where-Object { [string]$_['folder_id'] -eq $folderId -and -not $_['deleted_at'] } | Select-Object -First 1
            $rawName = if ([string]$body['album_name']) { [string]$body['album_name'] } elseif ($albumMatch) { [string]$albumMatch['album_name'] } else { '' }
            $baseSlug = ConvertTo-CleanSlug $rawName
            if (-not $baseSlug) { $baseSlug = "album-$($folderId.Substring(0, [Math]::Min(6, $folderId.Length)).ToLowerInvariant())" }

            $slug = $baseSlug
            $counter = 2
            while ($true) {
                $existingSlugRec = $null
                foreach ($ek in $Db['shares'].Keys) {
                    if (([string]$Db['shares'][$ek]['slug']).ToLowerInvariant() -eq $slug) {
                        $existingSlugRec = $Db['shares'][$ek]
                        break
                    }
                }
                if (-not $existingSlugRec -or [string]$existingSlugRec['folder_id'] -eq $folderId) { break }
                $slug = "$baseSlug-$counter"
                $counter++
            }

            $token = New-RandomHex 8
            $salt = if ($code) { New-RandomHex 6 } else { '' }
            $hash = if ($code) { Get-PasswordHash $code $salt } else { '' }
            $Db['shares'][$token] = @{
                token = $token
                slug = $slug
                folder_id = $folderId
                album_name = $rawName
                owner_user_id = $uid
                access_code_salt = $salt
                access_code_hash = $hash
                requires_code = [bool]($code.Length -gt 0)
                created_at = (Get-NowIso)
            }
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; url = "/?a=$slug"; slug = $slug; requires_code = [bool]($code.Length -gt 0); token = $token }
            return
        }

        'resolve_share_slug' {
            $slug = ([string]$body['slug']).Trim()
            $resolved = Resolve-ShareRecord $Db $slug
            if (-not $resolved) {
                Send-Json $Context 404 @{ success = $false; message = 'Link chia sẻ không tồn tại hoặc đã bị gỡ.' }
                return
            }
            $s = $resolved.share
            $album = $Db['albums'] | Where-Object { [string]$_['folder_id'] -eq [string]$s['folder_id'] -and -not $_['deleted_at'] } | Select-Object -First 1
            $allow = if ($album) { ([int]$album['allow_save'] -eq 1) } else { $true }
            Send-Json $Context 200 @{
                success = $true
                share = @{
                    slug = [string]$s['slug']
                    token = [string]$s['token']
                    folder_id = [string]$s['folder_id']
                    owner_user_id = [int]$s['owner_user_id']
                    album_name = if ($album) { [string]$album['album_name'] } else { [string]$s['album_name'] }
                    requires_code = [bool]$s['requires_code']
                    access_code_hash = [string]$s['access_code_hash']
                    allow_save = $allow
                }
            }
            return
        }

        'get_share_permission' {
            $keyOrSlug = if ($body['share_slug']) { [string]$body['share_slug'] } else { [string]$body['share_token'] }
            $resolved = Resolve-ShareRecord $Db $keyOrSlug
            if (-not $resolved) {
                Send-Json $Context 404 @{ success = $false; allow_save = $true }
                return
            }
            $share = $resolved.share
            $album = $Db['albums'] | Where-Object { [string]$_['folder_id'] -eq [string]$share['folder_id'] -and -not $_['deleted_at'] } | Select-Object -First 1
            $allow = if ($album) { ([int]$album['allow_save'] -eq 1) } else { $true }
            Send-Json $Context 200 @{ success = $true; allow_save = $allow }
            return
        }

        'load_state' {
            $out = @{}
            foreach ($k in @($body['keys'])) {
                if ($Db['states'].ContainsKey([string]$k)) { $out[[string]$k] = $Db['states'][[string]$k] }
            }
            Send-Json $Context 200 @{ success = $true; data = $out }
            return
        }

        'save_state' {
            $data = $body['data']
            if ($data -is [System.Collections.IDictionary]) {
                foreach ($k in $data.Keys) {
                    $keyStr = [string]$k
                    $Db['states'][$keyStr] = $data[$k]
                    if ($keyStr -match '^photoSelectionsByAlbum:(.+)$') {
                        $fid = $Matches[1]
                        $gName = if ($body['guest_name']) { [string]$body['guest_name'] } elseif ($SessionCtx.user) { $SessionCtx.user.name } else { 'Khách xem album' }
                        Sync-PhotoSelections $Db $fid $data[$k] $gName ([string]$body['share_token']) $body['photo_meta']
                    }
                }
                Save-Db $Db
            }
            Send-Json $Context 200 @{ success = $true }
            return
        }

        'save_photo_selection' {
            $fid = ([string]$body['folder_id']).Trim()
            if (-not $fid) { Send-Json $Context 400 @{ success = $false; message = 'Thiếu folder_id.' }; return }
            $gName = if ($body['guest_name']) { [string]$body['guest_name'] } elseif ($SessionCtx.user) { $SessionCtx.user.name } else { 'Khách xem album' }
            Sync-PhotoSelections $Db $fid $body['selected_photos'] $gName ([string]$body['share_token']) $body['photo_meta']
            Save-Db $Db
            $count = @($Db['photo_selections'] | Where-Object { [string]$_['folder_id'] -eq $fid }).Count
            Send-Json $Context 200 @{ success = $true; total_selected = $count }
            return
        }

        'confirm_guest_selection' {
            $fid = ([string]$body['folder_id']).Trim()
            if (-not $fid) { Send-Json $Context 400 @{ success = $false; message = 'Thiếu folder_id.' }; return }
            $gName = if ($body['guest_name']) { [string]$body['guest_name'] } else { 'Khách xem album' }
            Sync-PhotoSelections $Db $fid $body['selected_photos'] $gName ([string]$body['share_token']) $body['photo_meta']
            $album = $Db['albums'] | Where-Object { [string]$_['folder_id'] -eq $fid -and -not $_['deleted_at'] } | Select-Object -First 1
            $ownerId = if ($album) { [int]$album['user_id'] } else { 1 }
            $albumTitle = if ($album) { [string]$album['album_name'] } else { $fid }
            $count = @($Db['photo_selections'] | Where-Object { [string]$_['folder_id'] -eq $fid }).Count
            $Db['notifications'] = @(@{
                id = (Get-NextId $Db)
                user_id = $ownerId
                title = "Khách đã chốt chọn $count ảnh"
                message = "$gName vừa gửi danh sách $count ảnh đã chọn trong album `"$albumTitle`"."
                created_at = (Get-NowIso)
                is_read = 0
            }) + @($Db['notifications'])
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; total_selected = $count; message = "Đã gửi danh sách $count ảnh đã chọn cho Studio." }
            return
        }

        'load_album_selections' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $fid = ([string]$body['folder_id']).Trim()
            if (-not $fid) { Send-Json $Context 400 @{ success = $false; message = 'Thiếu folder_id.' }; return }
            $records = @($Db['photo_selections'] | Where-Object { [string]$_['folder_id'] -eq $fid })
            $selectedIds = @($records | ForEach-Object { [string]$_['photo_id'] })
            if ($selectedIds.Count -eq 0 -and $Db['states'].ContainsKey("photoSelectionsByAlbum:$fid")) {
                $selectedIds = @($Db['states']["photoSelectionsByAlbum:$fid"] | ForEach-Object { [string]$_ })
            }
            $lastRec = $records | Sort-Object { $_['selected_at'] } -Descending | Select-Object -First 1
            $lastAt = if ($lastRec) { $lastRec['selected_at'] } else { $null }
            $guests = @($records | ForEach-Object { [string]$_['guest_name'] } | Where-Object { $_ } | Select-Object -Unique)
            Send-Json $Context 200 @{
                success = $true
                folder_id = $fid
                selected_ids = $selectedIds
                records = $records
                summary = @{
                    total_selected = $selectedIds.Count
                    last_selected_at = $lastAt
                    guests = $guests
                }
            }
            return
        }

        'load_all_comments' {
            Send-Json $Context 200 @{ success = $true; data = @($Db['comments']) }
            return
        }

        'load_comments' {
            $itemId = [string]$body['photo_id']
            $items = @($Db['comments'] | Where-Object { [string]$_['photo_id'] -eq $itemId })
            Send-Json $Context 200 @{ success = $true; data = $items }
            return
        }

        'save_comment' {
            $itemId = [string]$body['photo_id']
            $text = ([string]$body['comment_text']).Trim()
            if (-not $itemId -or -not $text) { Send-Json $Context 400 @{ success = $false; message = 'Thiếu nội dung bình luận.' }; return }
            $author = if ($SessionCtx.user) { $SessionCtx.user.name } else { 'Khách xem album' }
            $c = @{
                id = (Get-NextId $Db)
                photo_id = $itemId
                user_id = $uid
                author = $author
                comment_text = $text
                created_at = (Get-NowIso)
            }
            $Db['comments'] = @($Db['comments']) + @($c)
            $Db['notifications'] = @(@{
                id = (Get-NextId $Db); user_id = 1; title = "Bình luận mới từ $author"
                message = "Ảnh $itemId`: $text"; created_at = (Get-NowIso); is_read = 0
            }) + @($Db['notifications'])
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; data = $c }
            return
        }

        'get_notifications' {
            if ($uid -le 0) { Send-Json $Context 200 @{ success = $true; notifications = @() }; return }
            $items = @($Db['notifications'] | Where-Object { [int]$_['user_id'] -eq $uid })
            Send-Json $Context 200 @{ success = $true; notifications = $items }
            return
        }

        'mark_notification_read' {
            $nid = [int]$body['notification_id']
            $n = $Db['notifications'] | Where-Object { [int]$_['id'] -eq $nid } | Select-Object -First 1
            if ($n) { $n['is_read'] = 1; Save-Db $Db }
            Send-Json $Context 200 @{ success = $true }
            return
        }

        'load_chat' {
            $cid = ([string]$body['conversation_id']).Trim()
            if (-not $cid -or -not $Db['chats'].ContainsKey($cid)) { $cid = 'conv-default' }
            Send-Json $Context 200 @{ success = $true; conversation_id = $cid; data = @($Db['chats'][$cid]); typing = $null }
            return
        }

        'contact_admin' {
            $cid = ([string]$body['conversation_id']).Trim()
            if (-not $cid) { $cid = 'conv-default' }
            if (-not $Db['chats'].ContainsKey($cid)) { $Db['chats'][$cid] = @() }
            $msg = ([string]$body['message']).Trim()
            if (-not $msg) { Send-Json $Context 400 @{ success = $false; message = 'Tin nhắn trống.' }; return }
            $Db['chats'][$cid] = @($Db['chats'][$cid]) + @(@{ id = (Get-NextId $Db); sender_type = 'guest'; message = $msg; created_at = (Get-NowIso) })
            if ($msg -match '\[BÁO LỖI\]') {
                $Db['chats'][$cid] = @($Db['chats'][$cid]) + @(@{ id = (Get-NextId $Db); sender_type = 'admin'; message = 'Admin đã tiếp nhận báo lỗi của bạn và ghi nhận vào hệ thống.'; created_at = (Get-NowIso) })
            }
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; conversation_id = $cid; data = @($Db['chats'][$cid]); message = 'Đã gửi tin nhắn tới admin.' }
            return
        }

        'set_chat_typing' {
            $cid = ([string]$body['conversation_id']).Trim()
            if (-not $cid) { $cid = 'conv-default' }
            Send-Json $Context 200 @{ success = $true; conversation_id = $cid }
            return
        }

        'photographers_list' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập để quản lý thợ chụp.' }; return }
            $items = @($Db['photographers'] | Where-Object { [int]$_['user_id'] -eq $uid })
            Send-Json $Context 200 @{ success = $true; photographers = $items }
            return
        }

        'photographers_save' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $p = $body['photographer']
            if (-not $p -or -not $p['name']) { Send-Json $Context 400 @{ success = $false; message = 'Thiếu tên thợ chụp.' }; return }
            $itemId = if ($p['id']) { [int]$p['id'] } else { 0 }
            $existing = if ($itemId -gt 0) { $Db['photographers'] | Where-Object { [int]$_['id'] -eq $itemId -and [int]$_['user_id'] -eq $uid } | Select-Object -First 1 } else { $null }
            if ($existing) {
                foreach ($k in @('name','role','phone','email','zalo','facebook','shootLocation','shootDates','status')) {
                    if ($p.ContainsKey($k)) { $existing[$k] = $p[$k] }
                }
                Save-Db $Db
                Send-Json $Context 200 @{ success = $true; photographer = $existing }
                return
            }
            $newStaff = @{
                id = (Get-NextId $Db); user_id = $uid
                name = $p['name']; role = $p['role']; phone = $p['phone']; email = $p['email']
                zalo = $p['zalo']; facebook = $p['facebook']; shootLocation = $p['shootLocation']
                shootDates = @($p['shootDates']); status = if ($p['status']) { $p['status'] } else { 'active' }
            }
            $Db['photographers'] = @($newStaff) + @($Db['photographers'])
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; photographer = $newStaff }
            return
        }

        'photographers_delete' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $itemId = [int]$body['id']
            $Db['photographers'] = @($Db['photographers'] | Where-Object { -not ([int]$_['id'] -eq $itemId -and [int]$_['user_id'] -eq $uid) })
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true }
            return
        }

        'contracts_list' {
            if ($uid -le 0) { Send-Json $Context 200 @{ success = $true; contracts = @() }; return }
            $items = @($Db['contracts'] | Where-Object { [int]$_['user_id'] -eq $uid })
            Send-Json $Context 200 @{ success = $true; contracts = $items }
            return
        }

        'contracts_save' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập để lưu hợp đồng.' }; return }
            $c = $body['contract']
            $cid = if ($c['id']) { [int]$c['id'] } else { 0 }
            $existing = if ($cid -gt 0) { $Db['contracts'] | Where-Object { [int]$_['id'] -eq $cid -and [int]$_['user_id'] -eq $uid } | Select-Object -First 1 } else { $null }
            if ($existing) {
                foreach ($k in $c.Keys) { if ($k -ne 'id' -and $k -ne 'user_id') { $existing[$k] = $c[$k] } }
                Save-Db $Db
                Send-Json $Context 200 @{ success = $true; contract = $existing }
                return
            }
            $newContract = @{ id = (Get-NextId $Db); user_id = $uid; created_at = (Get-NowIso) }
            foreach ($k in $c.Keys) { if ($k -ne 'id' -and $k -ne 'user_id') { $newContract[$k] = $c[$k] } }
            $Db['contracts'] = @($newContract) + @($Db['contracts'])
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; contract = $newContract }
            return
        }

        'contracts_delete' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $cid = [int]$body['id']
            $Db['contracts'] = @($Db['contracts'] | Where-Object { -not ([int]$_['id'] -eq $cid -and [int]$_['user_id'] -eq $uid) })
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true }
            return
        }

        'invoices_list' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập để quản lý hóa đơn.' }; return }
            if (-not $Db.ContainsKey('invoices')) { $Db['invoices'] = @() }
            $items = @($Db['invoices'] | Where-Object { [int]$_['user_id'] -eq $uid })
            Send-Json $Context 200 @{ success = $true; invoices = $items }
            return
        }

        'invoices_save' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            if (-not $Db.ContainsKey('invoices')) { $Db['invoices'] = @() }
            $inv = $body['invoice']
            $iid = if ($inv['id']) { [int]$inv['id'] } else { 0 }
            $existing = if ($iid -gt 0) { $Db['invoices'] | Where-Object { [int]$_['id'] -eq $iid -and [int]$_['user_id'] -eq $uid } | Select-Object -First 1 } else { $null }
            if ($existing) {
                foreach ($k in $inv.Keys) {
                    if ($k -ne 'id' -and $k -ne 'user_id') { $existing[$k] = $inv[$k] }
                }
                $existing['updated_at'] = (Get-NowIso)
                Save-Db $Db
                Send-Json $Context 200 @{ success = $true; invoice = $existing }
                return
            }
            $newInv = @{ id = (Get-NextId $Db); user_id = $uid; created_at = (Get-NowIso); updated_at = (Get-NowIso) }
            foreach ($k in $inv.Keys) { if ($k -ne 'id' -and $k -ne 'user_id') { $newInv[$k] = $inv[$k] } }
            $Db['invoices'] = @($newInv) + @($Db['invoices'])
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; invoice = $newInv }
            return
        }

        'invoices_delete' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $iid = [int]$body['id']
            if ($Db.ContainsKey('invoices')) {
                $Db['invoices'] = @($Db['invoices'] | Where-Object { -not ([int]$_['id'] -eq $iid -and [int]$_['user_id'] -eq $uid) })
                Save-Db $Db
            }
            Send-Json $Context 200 @{ success = $true }
            return
        }

        'customers_list' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập để quản lý khách hàng.' }; return }
            $items = @($Db['customers'] | Where-Object { [int]$_['user_id'] -eq $uid })
            Send-Json $Context 200 @{ success = $true; customers = $items }
            return
        }

        'customers_save' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $c = $body['customer']
            $cid = if ($c['id']) { [int]$c['id'] } else { 0 }
            $existing = if ($cid -gt 0) { $Db['customers'] | Where-Object { [int]$_['id'] -eq $cid -and [int]$_['user_id'] -eq $uid } | Select-Object -First 1 } else { $null }
            if ($existing) {
                foreach ($k in @('name','phone','email','social','packageName','shootDate','budget','status','notes')) {
                    if ($c.ContainsKey($k)) { $existing[$k] = $c[$k] }
                }
                Save-Db $Db
                Send-Json $Context 200 @{ success = $true; customer = $existing }
                return
            }
            $newCustomer = @{
                id = (Get-NextId $Db); user_id = $uid
                name = $c['name']; phone = $c['phone']; email = $c['email']; social = $c['social']
                packageName = $c['packageName']; shootDate = $c['shootDate']; budget = if ($c['budget']) { [double]$c['budget'] } else { 0 }
                status = if ($c['status']) { $c['status'] } else { 'lead' }; notes = $c['notes']
                created_at = (Get-NowIso)
            }
            $Db['customers'] = @($newCustomer) + @($Db['customers'])
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true; customer = $newCustomer }
            return
        }

        'customers_delete' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập.' }; return }
            $cid = [int]$body['id']
            $Db['customers'] = @($Db['customers'] | Where-Object { -not ([int]$_['id'] -eq $cid -and [int]$_['user_id'] -eq $uid) })
            Save-Db $Db
            Send-Json $Context 200 @{ success = $true }
            return
        }

        'reports_summary' {
            if ($uid -le 0) { Send-Json $Context 401 @{ success = $false; message = 'Vui lòng đăng nhập để xem báo cáo.' }; return }
            $userAlbums = @($Db['albums'] | Where-Object { [int]$_['user_id'] -eq $uid -and -not $_['deleted_at'] })
            $userContracts = @($Db['contracts'] | Where-Object { [int]$_['user_id'] -eq $uid })
            $userStaff = @($Db['photographers'] | Where-Object { [int]$_['user_id'] -eq $uid })
            $userCustomers = @($Db['customers'] | Where-Object { [int]$_['user_id'] -eq $uid })

            $selectedTotal = 0
            foreach ($a in $userAlbums) {
                $k = "photoSelectionsByAlbum:$($a['folder_id'])"
                if ($Db['states'].ContainsKey($k)) { $selectedTotal += @($Db['states'][$k]).Count }
            }
            $rev = ($userContracts | ForEach-Object { if ($_['totalPrice']) { [double]$_['totalPrice'] } else { 0 } } | Measure-Object -Sum).Sum
            $dep = ($userContracts | ForEach-Object { if ($_['deposit']) { [double]$_['deposit'] } else { 0 } } | Measure-Object -Sum).Sum

            Send-Json $Context 200 @{
                success = $true
                report = @{
                    totalAlbums = $userAlbums.Count
                    allowedAlbums = @($userAlbums | Where-Object { [int]$_['allow_save'] -eq 1 }).Count
                    totalSelectedPhotos = $selectedTotal
                    totalComments = @($Db['comments']).Count
                    totalPhotographers = $userStaff.Count
                    activePhotographers = @($userStaff | Where-Object { $_['status'] -eq 'active' }).Count
                    totalCustomers = $userCustomers.Count
                    totalContracts = $userContracts.Count
                    totalContractValue = if ($rev) { [double]$rev } else { 0 }
                    totalContractDeposit = if ($dep) { [double]$dep } else { 0 }
                    recentContracts = @($userContracts | Select-Object -First 6)
                }
            }
            return
        }

        default {
            Send-Json $Context 400 @{ success = $false; message = "Action không hợp lệ: $action" }
            return
        }
    }
}

$MimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
}

Initialize-Database
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "TeeMedia Full-Stack Server running at http://127.0.0.1:$Port/ (DB: $DbPath)"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $db = Read-Db
            $sessCtx = Get-SessionContext $context $db
            $req = $context.Request
            $path = $req.Url.AbsolutePath
            $query = Parse-QueryString $req.Url.Query

            if ($path -eq '/photowedding/app.php') {
                Handle-ApiRequest $context $db $sessCtx
                continue
            }

            if (($path -eq '/app' -or $path -eq '/') -and $query['logout'] -eq '1') {
                $sessCtx.session['userId'] = 0
                Save-Db $db
                Send-Redirect $context '/login'
                continue
            }

            if ($path -match '^/a/([^/]+)/?$') {
                $slugParam = [Uri]::EscapeDataString($Matches[1])
                Send-Redirect $context "/?a=$slugParam"
                continue
            }

            if ($path -match '^/portfolio/([^/]+)/?$') {
                $albumParam = [Uri]::EscapeDataString($Matches[1])
                Send-Redirect $context "/portfolio?album=$albumParam"
                continue
            }

            if ($path -eq '/' -or $path -eq '/index.html' -or $path -eq '/app') {
                $shareToken = if ($query['a']) { [string]$query['a'] } elseif ($query['s']) { [string]$query['s'] } else { [string]$query['share'] }
                $resolvedShare = Resolve-ShareRecord $db $shareToken
                if ($req.HttpMethod -eq 'POST' -and $resolvedShare) {
                    $form = Read-RequestBody $req
                    $share = $resolvedShare.share
                    if (Test-Password ([string]$form['access_code']) $share['access_code_salt'] $share['access_code_hash']) {
                        $sessCtx.session['unlockedShares'] = @($sessCtx.session['unlockedShares']) + @($resolvedShare.key)
                        Save-Db $db
                        $destQuery = if ($share['slug']) { "/?a=$([Uri]::EscapeDataString([string]$share['slug']))" } else { "/?share=$([Uri]::EscapeDataString($shareToken))" }
                        Send-Redirect $context $destQuery
                        continue
                    }
                    $html = (Render-HomeHtml $db $sessCtx $shareToken) -replace '<div class="err" id="err"></div>', '<div class="err" id="err">Mã bảo mật không chính xác.</div>'
                    Send-Html $context 403 $html
                    continue
                }
                Send-Html $context 200 (Render-HomeHtml $db $sessCtx $shareToken)
                continue
            }

            $mappedRel = switch ($path.TrimEnd('/').ToLowerInvariant()) {
                '/albums'               { 'albums.html' }
                '/login'                { 'login.html' }
                '/portfolio'            { 'portfolio.html' }
                '/studio-contracts'     { 'studio-contracts.html' }
                '/contracts'            { 'studio-contracts.html' }
                '/hop-dong'             { 'studio-contracts.html' }
                '/studio-invoices'      { 'studio-invoices.html' }
                '/invoices'             { 'studio-invoices.html' }
                '/hoa-don'              { 'studio-invoices.html' }
                '/bao-gia'              { 'studio-invoices.html' }
                '/studio-photographers' { 'studio-photographers.html' }
                '/team'                 { 'studio-photographers.html' }
                '/photographers'        { 'studio-photographers.html' }
                '/tho'                  { 'studio-photographers.html' }
                '/studio-customers'     { 'studio-customers.html' }
                '/customers'            { 'studio-customers.html' }
                '/khach-hang'           { 'studio-customers.html' }
                '/studio-reports'       { 'studio-reports.html' }
                '/reports'              { 'studio-reports.html' }
                '/bao-cao'              { 'studio-reports.html' }
                default { $path.TrimStart('/') }
            }
            $safeRel = $mappedRel -replace '/', '\'
            $fullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $safeRel))
            $rootFull = [System.IO.Path]::GetFullPath($Root)

            if (-not $fullPath.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $fullPath -PathType Leaf)) {
                Send-Text $context 404 "404 Not Found: $path"
                continue
            }

            $ext = [System.IO.Path]::GetExtension($fullPath).ToLowerInvariant()
            $ct = if ($MimeTypes.ContainsKey($ext)) { $MimeTypes[$ext] } else { 'application/octet-stream' }
            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            Send-Response $context 200 $ct $bytes
        } catch {
            Write-Host "Request error: $($_.Exception.Message)"
            try { Send-Json $context 500 @{ success = $false; message = $_.Exception.Message } } catch {}
        }
    }
} finally {
    $listener.Stop()
}
