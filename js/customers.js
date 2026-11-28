(function initCustomersPage(global) {
    const { state } = global.PhotoSelectApp;
    const API = global.PhotoSelectAPI;
    const Dialog = global.PhotoSelectDialog;
    const Theme = global.PhotoSelectTheme;

    const STATUS_LABELS = {
        lead: 'Mới tư vấn',
        confirmed: 'Đã chốt lịch',
        shooting: 'Đang chụp / Hậu kỳ',
        completed: 'Đã bàn giao'
    };

    let customers = [];
    const dialog = document.getElementById('customerDialog');
    const form = document.getElementById('customerForm');
    const statusMsg = document.getElementById('customerStatusMsg');

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    }

    function formatMoney(value) {
        return `${new Intl.NumberFormat('vi-VN').format(Math.max(0, Number(value) || 0))} VNĐ`;
    }

    function formatDate(value) {
        if (!value) return 'Chưa chốt ngày';
        const d = new Date(`${value}T00:00:00`);
        return Number.isNaN(d.getTime()) ? value : new Intl.DateTimeFormat('vi-VN').format(d);
    }

    function renderCustomers() {
        const tbody = document.getElementById('customerTableBody');
        const query = document.getElementById('customerSearch').value.trim().toLowerCase();
        const filter = document.getElementById('customerStatusFilter').value;

        const filtered = customers.filter(item => {
            const matchStatus = filter === 'all' || item.status === filter;
            const hay = [item.name, item.phone, item.email, item.packageName, item.notes].join(' ').toLowerCase();
            return matchStatus && (!query || hay.includes(query));
        });

        document.getElementById('customerTotal').textContent = String(customers.length);
        document.getElementById('customerActive').textContent = String(customers.filter(c => c.status === 'confirmed' || c.status === 'shooting').length);
        document.getElementById('customerRevenue').textContent = formatMoney(customers.reduce((sum, c) => sum + (Number(c.budget) || 0), 0));

        if (!filtered.length) {
            tbody.innerHTML = `<tr><td class="crm-empty" colspan="6">${customers.length ? 'Không tìm thấy khách hàng phù hợp.' : 'Chưa có khách hàng nào.'}</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(c => {
            const contractUrl = `studio-contracts.html?customerName=${encodeURIComponent(c.name || '')}&customerPhone=${encodeURIComponent(c.phone || '')}&customerEmail=${encodeURIComponent(c.email || '')}&package=${encodeURIComponent(c.packageName || '')}&budget=${encodeURIComponent(c.budget || 0)}&shootDate=${encodeURIComponent(c.shootDate || '')}`;
            return `<tr>
                <td><strong>${escapeHtml(c.name)}</strong>${c.notes ? `<br><small style="color:var(--muted)">${escapeHtml(c.notes)}</small>` : ''}</td>
                <td><div>${escapeHtml(c.phone || '—')}</div><small style="color:var(--muted)">${escapeHtml(c.email || '')}</small></td>
                <td><div>${escapeHtml(c.packageName || '—')}</div><small style="color:var(--muted)">Chụp: ${escapeHtml(formatDate(c.shootDate))}</small></td>
                <td><strong>${formatMoney(c.budget)}</strong></td>
                <td><span class="crm-badge ${escapeHtml(c.status || 'lead')}">${escapeHtml(STATUS_LABELS[c.status] || STATUS_LABELS.lead)}</span></td>
                <td>
                    <div class="crm-actions">
                        <a class="button" href="${contractUrl}">Lập HĐ</a>
                        <button class="button" type="button" data-action="edit" data-id="${escapeHtml(c.id)}">Sửa</button>
                        <button class="button" type="button" data-action="delete" data-id="${escapeHtml(c.id)}">Xóa</button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    function openCustomerModal(customer = null) {
        form.reset();
        document.getElementById('customerId').value = customer ? customer.id : '';
        document.getElementById('customerName').value = customer ? customer.name || '' : '';
        document.getElementById('customerPhone').value = customer ? customer.phone || '' : '';
        document.getElementById('customerEmail').value = customer ? customer.email || '' : '';
        document.getElementById('customerSocial').value = customer ? customer.social || '' : '';
        document.getElementById('customerPackage').value = customer ? customer.packageName || '' : 'Gói chụp ảnh cưới trọn gói';
        document.getElementById('customerShootDate').value = customer ? customer.shootDate || '' : '';
        document.getElementById('customerBudget').value = customer ? customer.budget || 0 : 20000000;
        document.getElementById('customerStatus').value = customer ? customer.status || 'lead' : 'lead';
        document.getElementById('customerNotes').value = customer ? customer.notes || '' : '';
        document.getElementById('customerDialogTitle').textContent = customer ? 'Chỉnh sửa khách hàng' : 'Thêm khách hàng mới';
        dialog.showModal();
    }

    async function loadCustomers() {
        statusMsg.textContent = 'Đang tải danh sách khách hàng...';
        try {
            const { result: session } = await API.callJson({ action: 'session_state' });
            if (!session?.user?.id) {
                global.location.replace('login.html?redirect=studio-customers.html');
                return;
            }
            state.dashboardUser = session.user;
            Dialog.updateDashboardUser(session.user);
            const { ok, result } = await API.callJson({ action: 'customers_list' });
            if (!ok || !result.success) throw new Error(result.message || 'Không thể tải danh sách khách hàng.');
            customers = Array.isArray(result.customers) ? result.customers : [];
            statusMsg.textContent = `Đã tải ${customers.length} khách hàng.`;
            renderCustomers();
        } catch (error) {
            statusMsg.textContent = error.message || 'Không thể tải dữ liệu khách hàng.';
            statusMsg.classList.add('error');
        }
    }

    document.getElementById('addCustomerBtn').addEventListener('click', () => openCustomerModal(null));
    document.getElementById('closeCustomerDialog').addEventListener('click', () => dialog.close());
    document.getElementById('cancelCustomerDialog').addEventListener('click', () => dialog.close());
    document.getElementById('customerSearch').addEventListener('input', renderCustomers);
    document.getElementById('customerStatusFilter').addEventListener('change', renderCustomers);

    document.getElementById('customerTableBody').addEventListener('click', async event => {
        const btn = event.target.closest('button[data-action]');
        if (!btn) return;
        const target = customers.find(c => String(c.id) === btn.dataset.id);
        if (!target) return;
        if (btn.dataset.action === 'edit') {
            openCustomerModal(target);
        } else if (btn.dataset.action === 'delete' && confirm(`Xóa khách hàng "${target.name}"?`)) {
            const { ok, result } = await API.callJson({ action: 'customers_delete', id: target.id });
            if (ok && result.success) {
                customers = customers.filter(c => String(c.id) !== String(target.id));
                renderCustomers();
                statusMsg.textContent = `Đã xóa khách hàng ${target.name}.`;
            }
        }
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const id = document.getElementById('customerId').value;
        const payload = {
            name: document.getElementById('customerName').value.trim(),
            phone: document.getElementById('customerPhone').value.trim(),
            email: document.getElementById('customerEmail').value.trim(),
            social: document.getElementById('customerSocial').value.trim(),
            packageName: document.getElementById('customerPackage').value.trim(),
            shootDate: document.getElementById('customerShootDate').value,
            budget: Number(document.getElementById('customerBudget').value) || 0,
            status: document.getElementById('customerStatus').value,
            notes: document.getElementById('customerNotes').value.trim()
        };
        if (id) payload.id = Number(id);
        const { ok, result } = await API.callJson({ action: 'customers_save', customer: payload });
        if (ok && result.success && result.customer) {
            const idx = customers.findIndex(c => String(c.id) === String(result.customer.id));
            if (idx >= 0) customers[idx] = result.customer;
            else customers.unshift(result.customer);
            renderCustomers();
            dialog.close();
            statusMsg.textContent = `Đã lưu thông tin khách hàng ${result.customer.name}.`;
        }
    });

    // Shared Settings & Account Menu Wiring
    document.querySelectorAll('[data-dashboard-dialog]').forEach(button => {
        button.addEventListener('click', event => {
            event.stopPropagation();
            Dialog.openDashboardDialog(button.dataset.dashboardDialog);
        });
    });
    document.getElementById('dashboardDialogBody').addEventListener('click', event => {
        const sectionBtn = event.target.closest('[data-dashboard-setting-section]');
        if (sectionBtn) {
            Dialog.renderDashboardSettingsSection(sectionBtn.dataset.dashboardSettingSection);
            return;
        }
        const themeBtn = event.target.closest('[data-dashboard-theme-option]');
        if (themeBtn) Theme.setDashboardTheme(themeBtn.dataset.dashboardThemeOption);
    });
    document.getElementById('dashboardDialogBody').addEventListener('submit', Dialog.handlePasswordSubmit);
    document.getElementById('dashboardDialogClose').addEventListener('click', () => document.getElementById('dashboardDialog').classList.remove('is-open'));
    document.getElementById('dashboardDialog').addEventListener('click', event => {
        if (event.target.id === 'dashboardDialog') event.currentTarget.classList.remove('is-open');
    });
    document.getElementById('userPanel').addEventListener('click', event => {
        if (event.target.closest('.account-action')) return;
        const isOpen = event.currentTarget.classList.toggle('open');
        event.currentTarget.setAttribute('aria-expanded', String(isOpen));
    });

    loadCustomers();
})(window);
