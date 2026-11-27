(function initReportsPage(global) {
    const { state } = global.PhotoSelectApp;
    const API = global.PhotoSelectAPI;
    const Dialog = global.PhotoSelectDialog;
    const Theme = global.PhotoSelectTheme;

    let latestReport = null;

    function formatMoney(value) {
        return `${new Intl.NumberFormat('vi-VN').format(Math.max(0, Number(value) || 0))} VNĐ`;
    }

    function escapeHtml(value) {
        return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
    }

    function renderBars(rows) {
        const container = document.getElementById('reportBars');
        const maxVal = Math.max(1, ...rows.map(r => r.value));
        container.innerHTML = rows.map(row => `
            <div class="report-bar-row">
                <div class="report-bar-head"><span>${escapeHtml(row.label)}</span><span>${row.value}</span></div>
                <div class="report-bar-track"><div class="report-bar-fill" style="width:${Math.round((row.value / maxVal) * 100)}%"></div></div>
            </div>
        `).join('');
    }

    async function loadReports() {
        const statusMsg = document.getElementById('reportStatusMsg');
        try {
            const { result: session } = await API.callJson({ action: 'session_state' });
            if (session?.user) {
                state.dashboardUser = session.user;
                Dialog.updateDashboardUser(session.user);
            }
            const { ok, result } = await API.callJson({ action: 'reports_summary' });
            if (!ok || !result.success) throw new Error(result.message || 'Không thể tải báo cáo.');

            const rep = result.report || {};
            latestReport = rep;
            document.getElementById('repContractRevenue').textContent = formatMoney(rep.totalContractValue);
            document.getElementById('repContractDeposit').textContent = formatMoney(rep.totalContractDeposit);
            document.getElementById('repSelectedPhotos').textContent = String(rep.totalSelectedPhotos || 0);
            document.getElementById('repTotalComments').textContent = String(rep.totalComments || 0);

            renderBars([
                { label: 'Album đang hoạt động', value: rep.totalAlbums || 0 },
                { label: 'Album cho khách lưu ảnh', value: rep.allowedAlbums || 0 },
                { label: 'Khách hàng đang chăm sóc / đã chốt', value: rep.totalCustomers || 0 },
                { label: 'Thợ chụp đang hoạt động', value: rep.activePhotographers || 0 },
                { label: 'Hợp đồng đã lưu', value: rep.totalContracts || 0 }
            ]);

            const contracts = Array.isArray(rep.recentContracts) ? rep.recentContracts : [];
            const tbody = document.getElementById('repContractsBody');
            tbody.innerHTML = contracts.length
                ? contracts.map(item => `<tr><td><strong>${escapeHtml(item.contractNumber || '—')}</strong></td><td>${escapeHtml(item.clientName || '—')}</td><td>${formatMoney(item.totalPrice)}</td><td>${formatMoney(item.deposit)}</td></tr>`).join('')
                : '<tr><td colspan="4" style="color:var(--muted);text-align:center;">Chưa có hợp đồng nào được lưu.</td></tr>';

            statusMsg.textContent = 'Số liệu đã cập nhật từ máy chủ.';
        } catch (error) {
            statusMsg.textContent = error.message || 'Không thể tải báo cáo.';
            statusMsg.classList.add('error');
        }
    }

    document.getElementById('exportReportCsvBtn').addEventListener('click', () => {
        if (!latestReport) return;
        const lines = [
            'Chi tieu,Gia tri',
            `Tong album,${latestReport.totalAlbums || 0}`,
            `Album cho khach luu,${latestReport.allowedAlbums || 0}`,
            `Anh khach da chon,${latestReport.totalSelectedPhotos || 0}`,
            `Tong binh luan,${latestReport.totalComments || 0}`,
            `Tong tho chup,${latestReport.totalPhotographers || 0}`,
            `Tho dang hoat dong,${latestReport.activePhotographers || 0}`,
            `Tong khach hang,${latestReport.totalCustomers || 0}`,
            `Tong hop dong,${latestReport.totalContracts || 0}`,
            `Doanh thu hop dong,${latestReport.totalContractValue || 0}`,
            `Da dat coc,${latestReport.totalContractDeposit || 0}`
        ];
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `photo-select-report-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
    });

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

    loadReports();
})(window);
