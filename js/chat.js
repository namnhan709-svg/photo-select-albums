/**
 * Widget Chat Admin và gửi báo lỗi nhanh.
 */
(function initChatModule(global) {
    const { state } = global.PhotoSelectApp;
    const API = global.PhotoSelectAPI;

    function toggleDashboardAdminChat() {
        const chat = document.getElementById('adminChat');
        const isOpen = chat.classList.toggle('open');
        document.getElementById('adminChatToggle').setAttribute('aria-expanded', String(isOpen));
        if (isOpen) document.getElementById('adminChatInput').focus();
    }

    function setDashboardReportMode(enabled) {
        const form = document.getElementById('adminChatForm');
        const input = document.getElementById('adminChatInput');
        form.dataset.reportMode = String(enabled);
        input.maxLength = enabled ? 300 : 2000;
        input.placeholder = enabled ? 'Mô tả lỗi bạn gặp phải...' : 'Nhập nội dung bạn muốn gửi...';
        document.getElementById('adminChatReportToggle').classList.toggle('is-active', enabled);
        document.getElementById('adminChatReportToggle').setAttribute('aria-pressed', String(enabled));
        document.getElementById('adminChatSubmit').textContent = enabled ? 'Gửi báo lỗi' : 'Gửi góp ý';
    }

    function renderDashboardChat(messages) {
        const container = document.getElementById('adminChatMessages');
        container.replaceChildren();
        if (!messages.length) {
            const empty = document.createElement('div');
            empty.className = 'admin-chat-empty';
            empty.textContent = 'Chưa có tin nhắn nào.';
            container.appendChild(empty);
            return;
        }
        messages.forEach(item => {
            const bubble = document.createElement('div');
            bubble.className = `admin-chat-bubble ${item.sender_type === 'guest' ? 'guest' : 'admin'}`;
            const sender = document.createElement('small');
            sender.textContent = item.sender_type === 'guest' ? 'Bạn' : 'Admin';
            const text = document.createElement('span');
            text.textContent = item.message;
            bubble.append(sender, text);
            container.appendChild(bubble);
        });
        container.scrollTop = container.scrollHeight;
    }

    async function loadDashboardChat() {
        try {
            const { ok, result } = await API.callJson({
                action: 'load_chat',
                conversation_id: state.dashboardChatConversationId
            });
            if (!ok || !result.success) return;
            state.dashboardChatConversationId = result.conversation_id || state.dashboardChatConversationId;
            if (state.dashboardChatConversationId) {
                localStorage.setItem('photoSelectChatId', state.dashboardChatConversationId);
            }
            renderDashboardChat(result.data || []);
            document.getElementById('adminChatTyping').textContent = result.typing?.type === 'admin'
                ? `${result.typing.name || 'Admin'} đang nhập`
                : '';
        } catch (error) {
            console.warn('Không thể tải chat admin.', error);
        }
    }

    async function submitDashboardChat(event) {
        event.preventDefault();
        const input = document.getElementById('adminChatInput');
        const submit = document.getElementById('adminChatSubmit');
        const status = document.getElementById('adminChatMessage');
        const text = input.value.trim();
        if (!text) return;

        const isBugReport = document.getElementById('adminChatForm').dataset.reportMode === 'true';
        const message = isBugReport
            ? `[BÁO LỖI]\nTrang: ${global.location.pathname}\nThời gian: ${new Date().toLocaleString('vi-VN')}\nMô tả: ${text}`
            : text;

        submit.disabled = true;
        status.textContent = 'Đang gửi...';
        global.clearTimeout(state.dashboardChatTypingTimer);
        try {
            const { ok, result } = await API.callJson({ action: 'contact_admin', message });
            if (!ok || !result.success) throw new Error(result.message || 'Không thể gửi tin nhắn.');
            state.dashboardChatConversationId = result.conversation_id || state.dashboardChatConversationId;
            if (state.dashboardChatConversationId) {
                localStorage.setItem('photoSelectChatId', state.dashboardChatConversationId);
            }
            renderDashboardChat(result.data || []);
            input.value = '';
            if (isBugReport) setDashboardReportMode(false);
            status.textContent = result.message || (isBugReport ? 'Đã gửi báo lỗi tới admin.' : 'Đã gửi tin nhắn tới admin.');
        } catch (error) {
            status.textContent = error.message || 'Không thể kết nối máy chủ.';
        } finally {
            submit.disabled = false;
        }
    }

    function sendDashboardChatTyping(typing) {
        API.callJson({
            action: 'set_chat_typing',
            conversation_id: state.dashboardChatConversationId,
            typing
        }).then(({ result }) => {
            if (result?.conversation_id) state.dashboardChatConversationId = result.conversation_id;
        }).catch(() => {});
    }

    global.PhotoSelectChat = {
        toggleDashboardAdminChat,
        setDashboardReportMode,
        loadDashboardChat,
        submitDashboardChat,
        sendDashboardChatTyping
    };
})(window);
