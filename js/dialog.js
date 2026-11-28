/**
 * Quản lý hồ sơ người dùng và hộp thoại Cài đặt (giao diện, tài khoản, bảo mật).
 */
(function initDialogModule(global) {
    const { state } = global.PhotoSelectApp;
    const API = global.PhotoSelectAPI;
    const Theme = global.PhotoSelectTheme;

    function updateDashboardUser(user) {
        const name = String(user?.name || 'Người dùng').trim();
        const email = String(user?.email || '').trim();
        const avatarUrl = String(user?.avatar || localStorage.getItem('photoSelectCurrentUserAvatar') || '').trim();
        const initials = name.charAt(0).toUpperCase() || 'U';
        document.getElementById('userNameText').textContent = name;
        document.getElementById('userEmailText').textContent = email || 'Tài khoản selectphoto';
        document.getElementById('greetingName').textContent = name;
        document.getElementById('greetingEmail').textContent = email || 'Tài khoản selectphoto';
        ['userAvatar', 'accountAvatar'].forEach(id => {
            const avatar = document.getElementById(id);
            avatar.textContent = initials;
            avatar.style.backgroundImage = avatarUrl ? `url('${avatarUrl}')` : '';
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    function getDashboardDialogContent(type) {
        const user = state.dashboardUser || {};
        return {
            profile: {
                title: 'Thông tin cá nhân',
                html: `<dl class="dashboard-profile-list">
                    <div><dt>Họ và tên</dt><dd>${escapeHtml(user.name || 'Người dùng')}</dd></div>
                    <div><dt>Email</dt><dd>${escapeHtml(user.email || 'Chưa cập nhật')}</dd></div>
                    <div><dt>Số điện thoại</dt><dd>${escapeHtml(user.phone || 'Chưa cập nhật')}</dd></div>
                    <div><dt>Trạng thái</dt><dd>${escapeHtml(user.status === 'active' ? 'Đang hoạt động' : (user.status || 'Đang hoạt động'))}</dd></div>
                </dl>`
            },
            account: {
                title: 'Tài khoản & Cấp quyền truy cập',
                html: Number(user.id) === 1
                    ? `<p class="dashboard-dialog-message" style="margin-bottom:.85rem;">Hệ thống đã khóa đăng ký tự do và đăng nhập Google công khai. Chỉ chủ Studio và các tài khoản được cấp bên dưới mới có thể đăng nhập quản trị.</p>
                    <form class="dashboard-password-form" id="dashboardCreateStaffForm" style="margin-bottom:1rem;">
                        <label>Tên nhân sự / cộng tác viên
                            <input name="name" type="text" required placeholder="VD: Minh Anh Photographer">
                        </label>
                        <label>Email đăng nhập
                            <input name="email" type="email" required placeholder="nhanvien@selectphoto.vn">
                        </label>
                        <label>Số điện thoại
                            <input name="phone" type="tel" placeholder="0386 038 930">
                        </label>
                        <label>Mật khẩu cấp (tối thiểu 6 ký tự)
                            <input name="password" type="password" minlength="6" required placeholder="Nhập mật khẩu cấp">
                        </label>
                        <button class="button button-primary dashboard-password-submit" type="submit">Cấp tài khoản mới</button>
                        <p class="dashboard-password-status" id="dashboardStaffStatus" role="status"></p>
                    </form>
                    <div id="dashboardStaffList" class="dashboard-staff-list" style="display:flex;flex-direction:column;gap:.5rem;">Đang tải danh sách tài khoản...</div>`
                    : '<p class="dashboard-dialog-message">Tài khoản nội bộ do quản trị viên selectphoto cấp. Bạn có thể đổi mật khẩu tại mục Bảo mật.</p>'
            },
            settings: {
                title: 'Cài đặt giao diện',
                html: `<div class="dashboard-theme-options" role="group" aria-label="Chọn giao diện">
                    <button class="dashboard-theme-option" type="button" data-dashboard-theme-option="sage" aria-pressed="false">
                        <span class="dashboard-theme-option-icon" aria-hidden="true">☼</span>
                        <strong>Giao diện sáng</strong>
                        <small>Sáng rõ, tinh tế và dễ quan sát.</small>
                    </button>
                    <button class="dashboard-theme-option" type="button" data-dashboard-theme-option="dark" aria-pressed="false">
                        <span class="dashboard-theme-option-icon" aria-hidden="true">◐</span>
                        <strong>Giao diện tối</strong>
                        <small>Nền trầm, chữ sáng, dịu mắt.</small>
                    </button>
                </div>
                <p class="dashboard-theme-status" id="dashboardThemeStatus" role="status" aria-live="polite"></p>`
            },
            security: {
                title: 'Bảo mật',
                html: `<form class="dashboard-password-form" id="dashboardPasswordForm">
                    <label>Mật khẩu hiện tại
                        <input name="old_password" type="password" autocomplete="current-password" required>
                    </label>
                    <label>Mật khẩu mới
                        <input name="new_password" type="password" autocomplete="new-password" minlength="6" required>
                    </label>
                    <label>Xác nhận mật khẩu mới
                        <input name="confirm_password" type="password" autocomplete="new-password" minlength="6" required>
                    </label>
                    <button class="button button-primary dashboard-password-submit" type="submit">Đổi mật khẩu</button>
                    <p class="dashboard-password-status" id="dashboardPasswordStatus" role="status" aria-live="polite"></p>
                </form>`
            },
            activity: {
                title: 'Lịch sử hoạt động',
                message: 'Lịch sử hoạt động chi tiết hiện chưa có dữ liệu hiển thị.'
            },
            cloud: {
                title: 'Đồng bộ Cloud & GitHub Pages',
                html: (() => {
                    const cfg = API.getCloudConfig ? API.getCloudConfig() : {};
                    return `<p class="dashboard-dialog-message" style="margin-bottom:.85rem;">Khi deploy lên GitHub Pages (static), link chia sẻ đã tự chứa thông tin album. Bạn có thể cấu hình thêm API Key Google Drive công khai và Firebase Realtime DB để đồng bộ lựa chọn ảnh của khách xuyên thiết bị.</p>
                    <form class="dashboard-password-form" id="dashboardCloudForm">
                        <label>Google Drive API Key (tùy chọn, để khách mở folder Drive thật trên GitHub Pages)
                            <input name="googleApiKey" type="text" value="${escapeHtml(cfg.googleApiKey || '')}" placeholder="AIzaSy...">
                        </label>
                        <label>Firebase Realtime Database URL (tùy chọn, đồng bộ ❤️ & bình luận xuyên thiết bị)
                            <input name="firebaseDbUrl" type="url" value="${escapeHtml(cfg.firebaseDbUrl || '')}" placeholder="https://your-project-default-rtdb.firebaseio.com">
                        </label>
                        <button class="button button-primary dashboard-password-submit" type="submit">Lưu cấu hình Cloud</button>
                        <p class="dashboard-password-status" id="dashboardCloudStatus" role="status"></p>
                    </form>`;
                })()
            }
        }[type] || null;
    }

    function renderDashboardSettingsSection(type) {
        const content = getDashboardDialogContent(type);
        if (!content) return;
        const panel = document.getElementById('dashboardSettingsPanel');
        panel.innerHTML = `<h3>${content.title}</h3>${content.html || `<p class="dashboard-dialog-message">${content.message}</p>`}`;
        document.querySelectorAll('[data-dashboard-setting-section]').forEach(button => {
            if (button.dataset.dashboardSettingSection === type) {
                button.setAttribute('aria-current', 'page');
            } else {
                button.removeAttribute('aria-current');
            }
        });
        if (type === 'settings') Theme.syncDashboardThemeButtons();
        if (type === 'account') loadStaffAccountsIntoPanel();
    }

    async function loadStaffAccountsIntoPanel() {
        const listEl = document.getElementById('dashboardStaffList');
        if (!listEl || !API.callJson) return;
        try {
            const { ok, result } = await API.callJson({ action: 'list_staff_accounts' });
            if (!ok || !result?.success) {
                listEl.textContent = '';
                return;
            }
            const accounts = Array.isArray(result.accounts) ? result.accounts : [];
            listEl.replaceChildren();
            accounts.forEach(acc => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.55rem .7rem;border:1px solid var(--border);border-radius:10px;font-size:.82rem;';
                const info = document.createElement('div');
                info.innerHTML = `<strong>${escapeHtml(acc.name)}</strong><br><small style="color:var(--muted);">${escapeHtml(acc.email)} · ${acc.status === 'disabled' ? 'Đang khóa' : 'Đang hoạt động'}</small>`;
                row.appendChild(info);
                if (Number(acc.id) !== 1) {
                    const actions = document.createElement('div');
                    actions.style.cssText = 'display:flex;gap:.35rem;';
                    const toggleBtn = document.createElement('button');
                    toggleBtn.type = 'button';
                    toggleBtn.className = 'button';
                    toggleBtn.textContent = acc.status === 'disabled' ? 'Mở khóa' : 'Khóa';
                    toggleBtn.addEventListener('click', async () => {
                        await API.callJson({ action: 'toggle_staff_account', user_id: acc.id });
                        loadStaffAccountsIntoPanel();
                    });
                    const delBtn = document.createElement('button');
                    delBtn.type = 'button';
                    delBtn.className = 'button';
                    delBtn.textContent = 'Xóa';
                    delBtn.addEventListener('click', async () => {
                        await API.callJson({ action: 'delete_staff_account', user_id: acc.id });
                        loadStaffAccountsIntoPanel();
                    });
                    actions.append(toggleBtn, delBtn);
                    row.appendChild(actions);
                }
                listEl.appendChild(row);
            });
        } catch {
            listEl.textContent = 'Không thể tải danh sách tài khoản.';
        }
    }

    function openDashboardDialog(type) {
        const title = document.getElementById('dashboardDialogTitle');
        const body = document.getElementById('dashboardDialogBody');
        const dialogContent = document.querySelector('.dashboard-dialog-content');
        const userPanel = document.getElementById('userPanel');

        if (type === 'settings-menu') {
            title.textContent = 'Cài đặt';
            dialogContent.classList.add('has-settings-sidebar');
            body.innerHTML = `<div class="dashboard-settings-layout">
                <nav class="dashboard-settings-nav" aria-label="Danh mục cài đặt">
                    <button type="button" data-dashboard-setting-section="settings">Cài đặt giao diện</button>
                    <button type="button" data-dashboard-setting-section="profile">Thông tin cá nhân</button>
                    <button type="button" data-dashboard-setting-section="account">Tài khoản</button>
                    <button type="button" data-dashboard-setting-section="security">Bảo mật</button>
                    <button type="button" data-dashboard-setting-section="cloud">Đồng bộ GitHub Pages</button>
                    <button type="button" data-dashboard-setting-section="activity">Lịch sử hoạt động</button>
                </nav>
                <section class="dashboard-settings-panel" id="dashboardSettingsPanel" aria-live="polite"></section>
            </div>`;
            renderDashboardSettingsSection('settings');
        } else {
            dialogContent.classList.remove('has-settings-sidebar');
            const content = getDashboardDialogContent(type);
            if (!content) return;
            title.textContent = content.title;
            body.innerHTML = content.html || `<p class="dashboard-dialog-message">${content.message}</p>`;
            if (type === 'account') loadStaffAccountsIntoPanel();
        }

        document.getElementById('dashboardDialog').classList.add('is-open');
        userPanel.classList.remove('open');
        userPanel.setAttribute('aria-expanded', 'false');
    }

    async function handlePasswordSubmit(event) {
        const staffForm = event.target.closest('#dashboardCreateStaffForm');
        if (staffForm) {
            event.preventDefault();
            const fd = new FormData(staffForm);
            const st = document.getElementById('dashboardStaffStatus');
            const btn = staffForm.querySelector('[type="submit"]');
            if (btn) btn.disabled = true;
            try {
                const { ok, result } = await API.callJson({
                    action: 'create_staff_account',
                    name: fd.get('name'),
                    email: fd.get('email'),
                    phone: fd.get('phone'),
                    password: fd.get('password')
                });
                if (!ok || !result?.success) throw new Error(result?.message || 'Không thể cấp tài khoản.');
                staffForm.reset();
                if (st) {
                    st.textContent = result.message || 'Đã cấp tài khoản.';
                    st.className = 'dashboard-password-status is-success';
                }
                loadStaffAccountsIntoPanel();
            } catch (err) {
                if (st) {
                    st.textContent = err.message || 'Lỗi khi cấp tài khoản.';
                    st.className = 'dashboard-password-status is-error';
                }
            } finally {
                if (btn) btn.disabled = false;
            }
            return;
        }
        const cloudForm = event.target.closest('#dashboardCloudForm');
        if (cloudForm) {
            event.preventDefault();
            const fd = new FormData(cloudForm);
            API.saveCloudConfig({
                googleApiKey: fd.get('googleApiKey'),
                firebaseDbUrl: fd.get('firebaseDbUrl')
            });
            const st = document.getElementById('dashboardCloudStatus');
            if (st) {
                st.textContent = 'Đã lưu cấu hình Cloud. Các link chia sẻ mới sẽ tự động đính kèm cấu hình này.';
                st.classList.add('is-success');
            }
            return;
        }
        const form = event.target.closest('#dashboardPasswordForm');
        if (!form) return;
        event.preventDefault();

        const formData = new FormData(form);
        const newPassword = String(formData.get('new_password') || '');
        const confirmPassword = String(formData.get('confirm_password') || '');
        const status = document.getElementById('dashboardPasswordStatus');
        const submitButton = form.querySelector('[type="submit"]');

        if (newPassword !== confirmPassword) {
            status.textContent = 'Xác nhận mật khẩu mới không khớp.';
            status.classList.add('is-error');
            status.classList.remove('is-success');
            return;
        }

        formData.set('action', 'change_password');
        submitButton.disabled = true;
        status.textContent = 'Đang cập nhật mật khẩu...';
        status.classList.remove('is-error', 'is-success');

        try {
            const { ok, text } = await API.submitFormData(formData);
            if (!ok || text !== 'success') {
                throw new Error(text || 'Không thể đổi mật khẩu. Vui lòng thử lại.');
            }
            form.reset();
            status.textContent = 'Đổi mật khẩu thành công.';
            status.classList.add('is-success');
        } catch (error) {
            status.textContent = error.message || 'Không thể kết nối máy chủ.';
            status.classList.add('is-error');
        } finally {
            submitButton.disabled = false;
        }
    }

    global.PhotoSelectDialog = {
        updateDashboardUser,
        renderDashboardSettingsSection,
        openDashboardDialog,
        handlePasswordSubmit
    };
})(window);
