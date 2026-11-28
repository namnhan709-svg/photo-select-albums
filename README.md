# selectphoto — Studio & Portfolio Management

Hệ thống quản trị Studio nhiếp ảnh, thiết lập **Portfolio** công khai và gửi link **chọn ảnh Google Drive** rút gọn cho khách hàng.

- **Website Live (GitHub Pages):** https://teemediaqn.github.io/photo-select-albums/
- **Repository:** https://github.com/TeeMediaQn/photo-select-albums

## Các trang & đường dẫn chính

- **`/`** ([index.html](index.html)) — Trang chủ Setup Portfolio (chọn ảnh/album đưa lên Portfolio, sắp xếp thứ tự, ảnh bìa, mô tả, Preview & Xuất bản). Khi chưa đăng nhập tự chuyển về `/login`; khi mở qua link chia sẻ `?a=<slug>` hoặc `?share=<token>` tự chuyển sang giao diện Khách xem & chọn ảnh.
- **`/portfolio`** ([portfolio.html](portfolio.html)) — Trang Portfolio công khai hiển thị các bộ ảnh theo chủ đề (hỗ trợ lọc sâu theo URL `portfolio?album=<slug>`).
- **`/albums`** ([albums.html](albums.html)) — Quản lý Album Google Drive, tạo link chia sẻ rút gọn (`/?a=<slug>`), bật/tắt quyền tải ảnh, xem ảnh, xuất danh sách `.txt` / tải `.zip`.
- **`/login`** ([login.html](login.html)) — Cổng đăng nhập nội bộ cho nhân sự được cấp tài khoản (`studio@gmail.com` / `123456`).
- **`/studio-contracts`** (alias `/contracts`), **`/studio-photographers`** (`/team`), **`/studio-customers`** (`/customers`), **`/studio-reports`** (`/reports`) — Quản lý hợp đồng, thợ chụp, khách hàng và báo cáo.

## Tiếp tục phát triển trên máy tính khác

1. **Clone mã nguồn & đăng nhập GitHub (`TeeMediaQn`):**
   ```bash
   git clone https://github.com/TeeMediaQn/photo-select-albums.git
   cd photo-select-albums
   ```
2. **Chạy local server trên Windows (không cần cài PHP/Node/Python):**
   Chạy `start-server.bat` hoặc lệnh:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\backend\server.ps1
   ```
   Truy cập `http://127.0.0.1:5500` (dữ liệu local lưu tại `data/db.json`, cấu hình Cloud mặc định nằm trong `js/api.js`).
3. **Đóng gói bản tĩnh & đẩy lên GitHub Pages:**
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\build-pages.ps1
   git add .
   git commit -m "Update selectphoto"
   git push origin main
   ```
