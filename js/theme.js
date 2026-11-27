/**
 * Quản lý giao diện Sáng/Tối và đồng bộ qua localStorage giữa các tab.
 */
(function initThemeModule(global) {
    const DASHBOARD_THEME_KEY = 'photoSelectDashboardTheme';

    function syncDashboardThemeButtons() {
        const activeTheme = document.documentElement.dataset.dashboardTheme === 'dark' ? 'dark' : 'sage';
        document.querySelectorAll('[data-dashboard-theme-option]').forEach(button => {
            button.setAttribute('aria-pressed', String(button.dataset.dashboardThemeOption === activeTheme));
        });
    }

    function setDashboardTheme(theme) {
        if (theme !== 'sage' && theme !== 'dark') return;
        document.documentElement.dataset.dashboardTheme = theme === 'dark' ? 'dark' : 'light';
        syncDashboardThemeButtons();
        try {
            const savedSettings = JSON.parse(localStorage.getItem('photoSelectInterfaceSettings') || '{}');
            savedSettings.theme = theme;
            localStorage.setItem('photoSelectInterfaceSettings', JSON.stringify(savedSettings));
            localStorage.setItem('photoSelectTheme', theme);
            localStorage.setItem(DASHBOARD_THEME_KEY, theme === 'dark' ? 'dark' : 'light');
            const status = document.getElementById('dashboardThemeStatus');
            if (status) status.textContent = `Đã áp dụng giao diện ${theme === 'dark' ? 'tối' : 'sáng'} cho các trang.`;
        } catch (error) {
            const status = document.getElementById('dashboardThemeStatus');
            if (status) status.textContent = 'Không thể lưu lựa chọn giao diện trên trình duyệt này.';
            console.error('Không thể lưu giao diện Dashboard.', error);
        }
    }

    global.addEventListener('storage', event => {
        if (event.key !== 'photoSelectInterfaceSettings') return;
        try {
            const savedSettings = JSON.parse(event.newValue || '{}');
            if (savedSettings.theme !== 'dark' && savedSettings.theme !== 'sage') return;
            document.documentElement.dataset.dashboardTheme = savedSettings.theme === 'dark' ? 'dark' : 'light';
            syncDashboardThemeButtons();
            const status = document.getElementById('dashboardThemeStatus');
            if (status) status.textContent = `Đã đồng bộ giao diện ${savedSettings.theme === 'dark' ? 'tối' : 'sáng'}.`;
        } catch (error) {
            console.error('Không thể đồng bộ giao diện Dashboard.', error);
        }
    });

    global.PhotoSelectTheme = {
        syncDashboardThemeButtons,
        setDashboardTheme
    };
})(window);
