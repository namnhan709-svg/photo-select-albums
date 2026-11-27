/**
 * Quản lý thông báo trên thanh tiêu đề Dashboard.
 */
(function initNotificationsModule(global) {
    const { state } = global.PhotoSelectApp;
    const API = global.PhotoSelectAPI;

    async function loadDashboardNotifications() {
        try {
            const { ok, result } = await API.callJson({ action: 'get_notifications' });
            if (!ok || !result.success) return;
            state.dashboardNotifications = Array.isArray(result.notifications) ? result.notifications : [];
            const unread = state.dashboardNotifications.filter(item => Number(item.is_read) === 0).length;
            const badge = document.getElementById('dashboardNotificationBadge');
            const button = document.getElementById('dashboardNotificationButton');
            badge.hidden = unread === 0;
            badge.textContent = unread > 9 ? '9+' : String(unread);
            button.classList.toggle('has-alert', unread > 0);
        } catch {
            // Thông báo không được làm gián đoạn việc tải album.
        }
    }

    function renderDashboardNotifications() {
        const list = document.getElementById('dashboardNotificationList');
        list.replaceChildren();
        if (!state.dashboardNotifications.length) {
            const empty = document.createElement('span');
            empty.className = 'notification-empty';
            empty.textContent = 'Chưa có thông báo mới.';
            list.appendChild(empty);
            return;
        }
        state.dashboardNotifications.forEach(item => {
            const article = document.createElement('article');
            article.className = `notification-item ${Number(item.is_read) === 0 ? 'unread' : ''}`;
            const title = document.createElement('strong');
            title.textContent = item.title || 'Thông báo';
            const date = document.createElement('small');
            date.textContent = item.created_at || '';
            const message = document.createElement('p');
            message.textContent = item.message || '';
            article.append(title, date, message);
            list.appendChild(article);

            if (Number(item.is_read) === 0) {
                item.is_read = 1;
                API.callJson({ action: 'mark_notification_read', notification_id: item.id }).catch(() => {});
            }
        });
        document.getElementById('dashboardNotificationBadge').hidden = true;
        document.getElementById('dashboardNotificationButton').classList.remove('has-alert');
    }

    global.PhotoSelectNotifications = {
        loadDashboardNotifications,
        renderDashboardNotifications
    };
})(window);
