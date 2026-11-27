(function initEarlyTheme() {
    try {
        const savedSettings = JSON.parse(localStorage.getItem('photoSelectInterfaceSettings') || '{}');
        const savedDashboardTheme = localStorage.getItem('photoSelectDashboardTheme');
        const savedLegacyTheme = localStorage.getItem('photoSelectTheme');
        const theme = savedSettings.theme === 'dark' || savedSettings.theme === 'sage'
            ? savedSettings.theme
            : (savedDashboardTheme === 'dark' || savedDashboardTheme === 'light'
                ? (savedDashboardTheme === 'dark' ? 'dark' : 'sage')
                : (savedLegacyTheme === 'dark' ? 'dark' : 'sage'));
        document.documentElement.dataset.dashboardTheme = theme === 'dark' ? 'dark' : 'light';
    } catch (error) {
        console.warn('Không thể đọc giao diện Dashboard đã lưu.', error);
    }
})();
