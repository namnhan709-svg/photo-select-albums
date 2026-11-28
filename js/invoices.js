/**
 * TeeMedia Studio Invoices & Photo Print Price Quote Module
 */
(function initInvoicesPage(global) {
    const API = global.PhotoSelectAPI;
    const state = global.PhotoSelectApp?.state || {};
    const Dialog = global.PhotoSelectDialog;
    if (!API) return;

    const PRINT_PRESETS = [
        { label: 'Ảnh 13×18 Lụa (15k)', name: 'In ảnh ép lụa cao cấp', spec: '13×18 cm', unit: 'Tờ', price: 15000, qty: 20 },
        { label: 'Ảnh 15×21 Lụa (25k)', name: 'In ảnh ép lụa cao cấp', spec: '15×21 cm', unit: 'Tờ', price: 25000, qty: 20 },
        { label: 'Ép gỗ 20×30 (80k)', name: 'Ảnh ép gỗ Laminate', spec: '20×30 cm để bàn', unit: 'Tấm', price: 80000, qty: 2 },
        { label: 'Ép gỗ 30×45 (180k)', name: 'Ảnh ép gỗ Laminate', spec: '30×45 cm treo tường', unit: 'Tấm', price: 180000, qty: 2 },
        { label: 'Ảnh cổng 60×90 Pha lê (950k)', name: 'Ảnh cổng Tráng gương Pha lê', spec: '60×90 cm kèm khung', unit: 'Tấm', price: 950000, qty: 1 },
        { label: 'Ảnh cổng 70×110 Khung gỗ (1.45tr)', name: 'Ảnh cổng Khung gỗ cao cấp', spec: '70×110 cm', unit: 'Tấm', price: 1450000, qty: 1 },
        { label: 'Photobook 25×35 20tr (1.8tr)', name: 'Album Photobook mở phẳng', spec: '25×35 cm · 20 trang bìa da', unit: 'Cuốn', price: 1800000, qty: 1 },
        { label: 'Photobook 30×30 30tr (2.5tr)', name: 'Album Photobook cao cấp', spec: '30×30 cm · 30 trang', unit: 'Cuốn', price: 2500000, qty: 1 },
        { label: 'Retouch ảnh (30k)', name: 'Chỉnh sửa & Retouch chuyên sâu', spec: 'Theo ảnh chọn', unit: 'Ảnh', price: 30000, qty: 10 },
        { label: 'Đóng gói & Ship (50k)', name: 'Đóng gói chống sốc & Giao hàng', spec: 'Nội thành / Toàn quốc', unit: 'Lần', price: 50000, qty: 1 }
    ];

    const STATUS_LABELS = {
        quote: 'Báo giá mới',
        pending: 'Chờ thanh toán',
        deposit: 'Đã đặt cọc',
        paid: 'Đã thanh toán đủ'
    };

    const pageState = {
        activeId: null,
        items: [],
        invoices: [],
        customers: [],
        albums: []
    };

    const byId = id => document.getElementById(id);

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatMoney(value) {
        return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
    }

    function formatDateVi(iso) {
        if (!iso) return '—';
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
        return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
    }

    function computeDefaultDocNumber(docType) {
        const now = new Date();
        const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const hms = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        return `${docType === 'invoice' ? 'HD' : 'BG'}-${ymd}-${hms}`;
    }

    function getCleanZaloDigits(phone, fallback = '0386038930') {
        const digits = String(phone || '').replace(/\D+/g, '');
        return digits.length >= 9 ? digits : fallback;
    }

    function calculateTotals() {
        const subtotal = pageState.items.reduce((sum, item) => {
            const qty = Math.max(0, Number(item.qty) || 0);
            const price = Math.max(0, Number(item.price) || 0);
            return sum + (qty * price);
        }, 0);
        const discountVal = Math.max(0, Number(byId('invDiscountVal').value) || 0);
        const discountType = byId('invDiscountType').value;
        const discountAmount = discountType === 'percent'
            ? Math.min(subtotal, Math.round(subtotal * (Math.min(100, discountVal) / 100)))
            : Math.min(subtotal, discountVal);
        const afterDiscount = Math.max(0, subtotal - discountAmount);
        const vatPercent = Math.max(0, Number(byId('invVatPercent').value) || 0);
        const vatAmount = Math.round(afterDiscount * (vatPercent / 100));
        const grandTotal = afterDiscount + vatAmount;
        const depositAmount = Math.max(0, Number(byId('invDepositAmount').value) || 0);
        const balanceDue = Math.max(0, grandTotal - depositAmount);
        return { subtotal, discountAmount, vatPercent, vatAmount, grandTotal, depositAmount, balanceDue };
    }

    function renderItemsTable() {
        const tbody = byId('invItemsBody');
        if (!tbody) return;
        if (!pageState.items.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:1rem;">Chưa có hạng mục nào. Hãy bấm các nút quy cách in phía trên để thêm nhanh.</td></tr>';
            updatePreview();
            return;
        }
        tbody.replaceChildren();
        pageState.items.forEach((item, idx) => {
            const tr = document.createElement('tr');
            const lineTotal = (Number(item.qty) || 0) * (Number(item.price) || 0);

            tr.innerHTML = `
                <td><input type="text" data-field="name" value="${escapeHtml(item.name)}" placeholder="Tên dịch vụ / quy cách"></td>
                <td><input type="text" data-field="spec" value="${escapeHtml(item.spec)}" placeholder="Kích thước / chất liệu"></td>
                <td><input type="text" data-field="unit" value="${escapeHtml(item.unit || 'Tấm')}"></td>
                <td><input type="number" min="1" step="1" data-field="qty" value="${Number(item.qty) || 1}"></td>
                <td><input type="number" min="0" step="1000" data-field="price" value="${Number(item.price) || 0}"></td>
                <td class="inv-line-total">${formatMoney(lineTotal)}</td>
                <td><button type="button" class="inv-remove-btn" title="Xóa dòng" aria-label="Xóa dòng">✕</button></td>
            `;

            tr.querySelectorAll('input').forEach(input => {
                input.addEventListener('input', () => {
                    const field = input.dataset.field;
                    pageState.items[idx][field] = (field === 'qty' || field === 'price')
                        ? Math.max(0, Number(input.value) || 0)
                        : input.value;
                    const updatedLine = (Number(pageState.items[idx].qty) || 0) * (Number(pageState.items[idx].price) || 0);
                    tr.querySelector('.inv-line-total').textContent = formatMoney(updatedLine);
                    updatePreview();
                });
            });
            tr.querySelector('.inv-remove-btn').addEventListener('click', () => {
                pageState.items.splice(idx, 1);
                renderItemsTable();
            });
            tbody.appendChild(tr);
        });
        updatePreview();
    }

    function updatePreview() {
        const sheet = byId('invoicePreviewSheet');
        if (!sheet) return;
        const docType = byId('invDocType').value;
        const docTitle = docType === 'invoice' ? 'HÓA ĐƠN THANH TOÁN' : 'BÁO GIÁ IN ẢNH & DỊCH VỤ';
        const statusKey = byId('invStatus').value;
        const studioName = byId('invStudioName').value.trim() || 'TeeMedia Atelier';
        const studioPhone = byId('invStudioPhone').value.trim() || '0386 038 930';
        const studioEmail = byId('invStudioEmail').value.trim() || 'thongtrong10@gmail.com';
        const clientName = byId('invClientName').value.trim() || 'Quý khách hàng';
        const clientPhone = byId('invClientPhone').value.trim();
        const clientEmail = byId('invClientEmail').value.trim();
        const albumName = byId('invAlbumName').value.trim();
        const invNumber = byId('invNumber').value.trim() || computeDefaultDocNumber(docType);
        const issueDate = formatDateVi(byId('invIssueDate').value);
        const dueDate = formatDateVi(byId('invDueDate').value);
        const notes = byId('invNotes').value.trim();

        const zaloBtn = byId('openClientZaloBtn');
        if (zaloBtn) {
            const targetDigits = clientPhone ? getCleanZaloDigits(clientPhone) : getCleanZaloDigits(studioPhone);
            zaloBtn.href = `https://zalo.me/${targetDigits}`;
            zaloBtn.textContent = clientPhone ? `💬 Zalo khách (${clientPhone})` : `💬 Chat Zalo Studio`;
        }

        const totals = calculateTotals();

        const rowsHtml = pageState.items.length
            ? pageState.items.map((item, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td><strong>${escapeHtml(item.name || 'Dịch vụ')}</strong>${item.spec ? `<br><small style="color:#6a5d50">${escapeHtml(item.spec)}</small>` : ''}</td>
                    <td>${escapeHtml(item.unit || 'Tấm')}</td>
                    <td class="num">${Number(item.qty) || 0}</td>
                    <td class="num">${formatMoney(item.price)}</td>
                    <td class="num"><strong>${formatMoney((Number(item.qty) || 0) * (Number(item.price) || 0))}</strong></td>
                </tr>
            `).join('')
            : '<tr><td colspan="6" style="text-align:center;color:#7a6d5f;padding:1rem;">Chưa có hạng mục in ấn hoặc dịch vụ nào.</td></tr>';

        sheet.innerHTML = `
            <div class="sheet-head">
                <div class="sheet-brand">
                    <img src="photowedding/logo/teemedia-logo-mark.svg" alt="">
                    <div>
                        <h2>${escapeHtml(studioName)}</h2>
                        <div class="sheet-studio-meta">
                            Zalo / Hotline: <strong>${escapeHtml(studioPhone)}</strong> · Email: ${escapeHtml(studioEmail)}
                        </div>
                    </div>
                </div>
                <div class="sheet-doc-meta">
                    <span class="sheet-doc-type">${docTitle}</span>
                    <div class="sheet-doc-no">Mã: ${escapeHtml(invNumber)}</div>
                    <div class="sheet-doc-no">Ngày: ${escapeHtml(issueDate)} · ${escapeHtml(STATUS_LABELS[statusKey] || 'Báo giá mới')}</div>
                </div>
            </div>

            <div class="sheet-parties">
                <div>
                    <h4>Khách hàng</h4>
                    <div><strong>${escapeHtml(clientName)}</strong></div>
                    ${clientPhone ? `<div>SĐT / Zalo: ${escapeHtml(clientPhone)}</div>` : ''}
                    ${clientEmail ? `<div>Email: ${escapeHtml(clientEmail)}</div>` : ''}
                </div>
                <div>
                    <h4>Chi tiết đơn hàng</h4>
                    <div>Album / Gói: <strong>${escapeHtml(albumName || 'Theo danh sách ảnh đã chọn')}</strong></div>
                    <div>Hạn / Giao dự kiến: <strong>${escapeHtml(dueDate)}</strong></div>
                    <div>Zalo tư vấn: <strong>${escapeHtml(studioPhone)}</strong></div>
                </div>
            </div>

            <table class="sheet-table">
                <thead>
                    <tr>
                        <th style="width:32px;">#</th>
                        <th>Hạng mục &amp; Quy cách in</th>
                        <th>ĐVT</th>
                        <th class="num">SL</th>
                        <th class="num">Đơn giá</th>
                        <th class="num">Thành tiền</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>

            <div class="sheet-summary">
                <div class="sheet-summary-row"><span>Tạm tính</span><strong>${formatMoney(totals.subtotal)}</strong></div>
                ${totals.discountAmount > 0 ? `<div class="sheet-summary-row"><span>Chiết khấu</span><strong>−${formatMoney(totals.discountAmount)}</strong></div>` : ''}
                ${totals.vatPercent > 0 ? `<div class="sheet-summary-row"><span>Thuế VAT (${totals.vatPercent}%)</span><strong>+${formatMoney(totals.vatAmount)}</strong></div>` : ''}
                <div class="sheet-summary-row is-grand"><span>TỔNG CỘNG</span><span>${formatMoney(totals.grandTotal)}</span></div>
                ${totals.depositAmount > 0 ? `<div class="sheet-summary-row"><span>Đã đặt cọc</span><strong>−${formatMoney(totals.depositAmount)}</strong></div>` : ''}
                <div class="sheet-summary-row is-balance"><span>Còn cần thanh toán</span><span>${formatMoney(totals.balanceDue)}</span></div>
            </div>

            <div class="sheet-footer">
                <div style="flex:1;min-width:200px;">
                    <strong>Ghi chú:</strong> ${escapeHtml(notes || 'Thời gian hoàn thiện sản phẩm in từ 5–7 ngày làm việc sau khi chốt danh sách ảnh. Hỗ trợ nhanh qua Zalo 0386 038 930.')}
                </div>
                <div style="text-align:right;min-width:150px;">
                    <strong>${escapeHtml(studioName)}</strong><br>
                    <span>Zalo: ${escapeHtml(studioPhone)}</span>
                </div>
            </div>
        `;
    }

    function collectInvoicePayload() {
        return {
            id: pageState.activeId || undefined,
            docType: byId('invDocType').value,
            invoiceNumber: byId('invNumber').value.trim(),
            issueDate: byId('invIssueDate').value,
            dueDate: byId('invDueDate').value,
            status: byId('invStatus').value,
            studioName: byId('invStudioName').value.trim() || 'TeeMedia Atelier',
            studioPhone: byId('invStudioPhone').value.trim() || '0386 038 930',
            studioEmail: byId('invStudioEmail').value.trim() || 'thongtrong10@gmail.com',
            studioZalo: getCleanZaloDigits(byId('invStudioPhone').value),
            clientName: byId('invClientName').value.trim(),
            clientPhone: byId('invClientPhone').value.trim(),
            clientEmail: byId('invClientEmail').value.trim(),
            albumName: byId('invAlbumName').value.trim(),
            discountValue: Math.max(0, Number(byId('invDiscountVal').value) || 0),
            discountType: byId('invDiscountType').value,
            vatPercent: Math.max(0, Number(byId('invVatPercent').value) || 0),
            depositAmount: Math.max(0, Number(byId('invDepositAmount').value) || 0),
            notes: byId('invNotes').value.trim(),
            items: pageState.items.map(i => ({
                name: String(i.name || ''),
                spec: String(i.spec || ''),
                unit: String(i.unit || 'Tấm'),
                qty: Math.max(1, Number(i.qty) || 1),
                price: Math.max(0, Number(i.price) || 0)
            }))
        };
    }

    function loadInvoiceIntoForm(inv) {
        pageState.activeId = inv?.id || null;
        byId('invDocType').value = inv?.docType || 'quote';
        byId('invNumber').value = inv?.invoiceNumber || computeDefaultDocNumber(byId('invDocType').value);
        const todayIso = new Date().toISOString().slice(0, 10);
        byId('invIssueDate').value = inv?.issueDate || todayIso;
        byId('invDueDate').value = inv?.dueDate || '';
        byId('invStatus').value = inv?.status || 'quote';
        byId('invStudioName').value = inv?.studioName || 'TeeMedia Atelier';
        byId('invStudioPhone').value = inv?.studioPhone || '0386 038 930';
        byId('invStudioEmail').value = inv?.studioEmail || 'thongtrong10@gmail.com';
        byId('invClientName').value = inv?.clientName || '';
        byId('invClientPhone').value = inv?.clientPhone || '';
        byId('invClientEmail').value = inv?.clientEmail || '';
        byId('invAlbumName').value = inv?.albumName || '';
        byId('invDiscountVal').value = Number(inv?.discountValue || 0);
        byId('invDiscountType').value = inv?.discountType || 'vnd';
        byId('invVatPercent').value = String(Number(inv?.vatPercent || 0));
        byId('invDepositAmount').value = Number(inv?.depositAmount || 0);
        byId('invNotes').value = inv?.notes || '';
        pageState.items = Array.isArray(inv?.items) && inv.items.length
            ? inv.items.map(i => ({ ...i }))
            : [{ name: 'In ảnh ép lụa cao cấp', spec: '13×18 cm', unit: 'Tờ', qty: 20, price: 15000 }];
        byId('deleteCurrentInvoiceBtn').hidden = !pageState.activeId;
        const albPicker = byId('invAlbumPicker');
        const syncBtn = byId('fillFromAlbumSelectedBtn');
        if (albPicker) {
            const matchedAlbum = pageState.albums.find(a =>
                String(a.album_name || '').trim().toLowerCase() === String(inv?.albumName || '').trim().toLowerCase()
            );
            albPicker.value = matchedAlbum ? String(matchedAlbum.folder_id || matchedAlbum.id) : '';
            const selCount = Number(matchedAlbum?.selected_count || 0);
            if (syncBtn) {
                syncBtn.hidden = !(matchedAlbum && selCount > 0);
                if (!syncBtn.hidden) {
                    syncBtn.textContent = `❤️ Tạo dòng in cho ${selCount} ảnh đã chọn`;
                }
            }
        }
        renderItemsTable();
        renderSavedInvoices();
    }

    function createBlankInvoice() {
        loadInvoiceIntoForm({
            id: null,
            docType: 'quote',
            invoiceNumber: computeDefaultDocNumber('quote'),
            issueDate: new Date().toISOString().slice(0, 10),
            status: 'quote',
            items: [
                { name: 'Ảnh ép gỗ Laminate để bàn', spec: '20×30 cm', unit: 'Tấm', qty: 2, price: 80000 },
                { name: 'In ảnh ép lụa cao cấp', spec: '13×18 cm', unit: 'Tờ', qty: 20, price: 15000 }
            ]
        });
        byId('invoiceStatusMsg').textContent = 'Đã tạo mẫu phiếu mới.';
    }

    function renderSavedInvoices() {
        const listEl = byId('savedInvoicesList');
        const countEl = byId('savedInvoicesCount');
        if (!listEl) return;
        if (countEl) countEl.textContent = `${pageState.invoices.length} phiếu`;
        if (!pageState.invoices.length) {
            listEl.innerHTML = '<div style="color:var(--muted);font-size:.82rem;">Chưa có hóa đơn hoặc báo giá nào được lưu.</div>';
            return;
        }
        listEl.replaceChildren();
        pageState.invoices.forEach(inv => {
            const total = (inv.items || []).reduce((s, it) => s + ((Number(it.qty) || 0) * (Number(it.price) || 0)), 0);
            const row = document.createElement('div');
            row.className = `inv-saved-item${String(inv.id) === String(pageState.activeId) ? ' is-active' : ''}`;
            const badgeClass = inv.status === 'paid' ? 'is-paid' : (inv.status === 'deposit' ? 'is-deposit' : '');
            row.innerHTML = `
                <div>
                    <strong>${escapeHtml(inv.invoiceNumber || 'BG')} · ${escapeHtml(inv.clientName || 'Khách hàng')}</strong>
                    <div style="font-size:.76rem;color:var(--muted);">
                        ${escapeHtml(inv.albumName || 'In ấn / Dịch vụ')} · <strong>${formatMoney(total)}</strong>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;">
                    <span class="inv-badge ${badgeClass}">${escapeHtml(STATUS_LABELS[inv.status] || 'Báo giá')}</span>
                    <button type="button" class="button" data-action="open">Mở</button>
                    <button type="button" class="button" data-action="delete">Xóa</button>
                </div>
            `;
            row.querySelector('[data-action="open"]').addEventListener('click', () => loadInvoiceIntoForm(inv));
            row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteInvoiceById(inv.id));
            listEl.appendChild(row);
        });
    }

    async function saveInvoice(event) {
        if (event) event.preventDefault();
        const form = byId('invoiceForm');
        if (form && !form.reportValidity()) return;
        const statusMsg = byId('invoiceStatusMsg');
        statusMsg.textContent = 'Đang lưu hóa đơn / báo giá...';
        try {
            const { ok, result } = await API.callJson({
                action: 'invoices_save',
                invoice: collectInvoicePayload()
            });
            if (!ok || !result?.success) throw new Error(result?.message || 'Không thể lưu phiếu.');
            const saved = result.invoice;
            const idx = pageState.invoices.findIndex(x => String(x.id) === String(saved.id));
            if (idx >= 0) pageState.invoices[idx] = saved;
            else pageState.invoices.unshift(saved);
            loadInvoiceIntoForm(saved);
            statusMsg.textContent = `✅ Đã lưu phiếu ${saved.invoiceNumber || ''}.`;
        } catch (err) {
            statusMsg.textContent = `❌ ${err.message || 'Lỗi khi lưu.'}`;
        }
    }

    async function deleteInvoiceById(id) {
        if (!id || !global.confirm('Bạn có chắc muốn xóa hóa đơn / báo giá này không?')) return;
        const statusMsg = byId('invoiceStatusMsg');
        try {
            const { ok, result } = await API.callJson({ action: 'invoices_delete', id });
            if (!ok || !result?.success) throw new Error(result?.message || 'Không thể xóa.');
            pageState.invoices = pageState.invoices.filter(x => String(x.id) !== String(id));
            if (String(pageState.activeId) === String(id)) {
                if (pageState.invoices.length) loadInvoiceIntoForm(pageState.invoices[0]);
                else createBlankInvoice();
            } else {
                renderSavedInvoices();
            }
            statusMsg.textContent = '🗑️ Đã xóa phiếu.';
        } catch (err) {
            statusMsg.textContent = `❌ ${err.message || 'Lỗi khi xóa.'}`;
        }
    }

    async function exportInvoiceFile(format) {
        const source = byId('invoicePreviewSheet');
        if (!source || !global.html2canvas) {
            global.alert('Thư viện xuất file chưa sẵn sàng, bạn có thể dùng nút "In / Lưu PDF".');
            return;
        }
        updatePreview();
        try {
            const canvas = await global.html2canvas(source, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
            const code = (byId('invNumber').value.trim() || 'bao-gia-teemedia').replace(/[^a-zA-Z0-9-_]+/g, '-');
            if (format === 'pdf') {
                if (!global.jspdf?.jsPDF) {
                    global.alert('Thư viện xuất PDF chưa sẵn sàng.');
                    return;
                }
                const { jsPDF } = global.jspdf;
                const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                const pageWidth = pdf.internal.pageSize.getWidth();
                const margin = 10;
                const usableWidth = pageWidth - margin * 2;
                const scaledHeight = (canvas.height * usableWidth) / canvas.width;
                pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin, usableWidth, scaledHeight, undefined, 'FAST');
                pdf.save(`${code}.pdf`);
                return;
            }
            const link = document.createElement('a');
            link.href = canvas.toDataURL('image/png');
            link.download = `${code}.png`;
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            console.warn('Xuất phiếu thất bại:', err);
            global.alert('Không thể xuất file. Vui lòng thử nút In / Lưu PDF.');
        }
    }

    function copyQuoteForZalo() {
        const totals = calculateTotals();
        const docType = byId('invDocType').value === 'invoice' ? 'HÓA ĐƠN' : 'BÁO GIÁ IN ẢNH';
        const lines = [
            `✨ ${docType} — ${byId('invStudioName').value.trim() || 'TeeMedia Atelier'}`,
            `Mã phiếu: ${byId('invNumber').value.trim()}`,
            `Khách hàng: ${byId('invClientName').value.trim() || 'Quý khách'}`,
            byId('invAlbumName').value.trim() ? `Album: ${byId('invAlbumName').value.trim()}` : '',
            '--------------------------------',
            ...pageState.items.map((it, idx) => `${idx + 1}. ${it.name}${it.spec ? ` (${it.spec})` : ''}: ${it.qty} ${it.unit} × ${formatMoney(it.price)} = ${formatMoney((Number(it.qty) || 0) * (Number(it.price) || 0))}`),
            '--------------------------------',
            `Tổng cộng: ${formatMoney(totals.grandTotal)}`,
            totals.depositAmount > 0 ? `Đã đặt cọc: ${formatMoney(totals.depositAmount)}` : '',
            `Còn cần thanh toán: ${formatMoney(totals.balanceDue)}`,
            `📞 Zalo hỗ trợ: ${byId('invStudioPhone').value.trim() || '0386 038 930'}`
        ].filter(Boolean).join('\n');

        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(lines).then(() => {
                byId('invoiceStatusMsg').textContent = '✅ Đã sao chép nội dung báo giá để gửi qua Zalo!';
            }).catch(() => prompt('Copy báo giá:', lines));
        } else {
            prompt('Copy báo giá:', lines);
        }
    }

    function renderPresetButtons() {
        const container = byId('printPresetPills');
        if (!container) return;
        container.replaceChildren();
        PRINT_PRESETS.forEach(preset => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'preset-pill-btn';
            btn.textContent = `+ ${preset.label}`;
            btn.addEventListener('click', () => {
                pageState.items.push({
                    name: preset.name,
                    spec: preset.spec,
                    unit: preset.unit,
                    qty: preset.qty,
                    price: preset.price
                });
                renderItemsTable();
            });
            container.appendChild(btn);
        });
    }

    function bindPickers() {
        const custSel = byId('invCustomerPicker');
        if (custSel) {
            pageState.customers.forEach(c => {
                const opt = document.createElement('option');
                opt.value = String(c.id);
                opt.textContent = `${c.name}${c.phone ? ` (${c.phone})` : ''}`;
                custSel.appendChild(opt);
            });
            custSel.addEventListener('change', () => {
                const c = pageState.customers.find(x => String(x.id) === custSel.value);
                if (!c) return;
                byId('invClientName').value = c.name || '';
                byId('invClientPhone').value = c.phone || '';
                byId('invClientEmail').value = c.email || '';
                if (!byId('invAlbumName').value.trim() && c.packageName) {
                    byId('invAlbumName').value = c.packageName;
                }
                updatePreview();
            });
        }

        const albSel = byId('invAlbumPicker');
        const syncBtn = byId('fillFromAlbumSelectedBtn');
        if (albSel) {
            pageState.albums.forEach(a => {
                const opt = document.createElement('option');
                opt.value = String(a.folder_id || a.id);
                const selCount = Number(a.selected_count || 0);
                opt.textContent = `${a.album_name}${selCount > 0 ? ` (${selCount} ảnh đã chọn)` : ''}`;
                albSel.appendChild(opt);
            });
            albSel.addEventListener('change', () => {
                const a = pageState.albums.find(x => String(x.folder_id || x.id) === albSel.value);
                if (!a) {
                    if (syncBtn) syncBtn.hidden = true;
                    return;
                }
                byId('invAlbumName').value = a.album_name || '';
                const selCount = Number(a.selected_count || 0);
                if (syncBtn) {
                    syncBtn.hidden = selCount <= 0;
                    syncBtn.textContent = `❤️ Tạo dòng in cho ${selCount} ảnh đã chọn`;
                }
                updatePreview();
            });
            syncBtn?.addEventListener('click', () => {
                const a = pageState.albums.find(x => String(x.folder_id || x.id) === albSel.value);
                const selCount = Number(a?.selected_count || 0);
                if (!a || selCount <= 0) return;
                pageState.items.push({
                    name: `In ảnh chọn lọc — ${a.album_name}`,
                    spec: '13×18 cm ép lụa',
                    unit: 'Tờ',
                    qty: selCount,
                    price: 15000
                });
                renderItemsTable();
            });
        }
    }

    async function boot() {
        try {
            const { result: session } = await API.callJson({ action: 'session_state' });
            if (!session?.user?.id) {
                const loginPath = global.location.protocol === 'file:' ? 'login.html' : 'login';
                global.location.replace(`${loginPath}?to=studio-invoices`);
                return;
            }
            state.dashboardUser = session.user;
            Dialog?.updateDashboardUser?.(session.user);

            renderPresetButtons();

            const [invRes, custRes, albRes] = await Promise.all([
                API.callJson({ action: 'invoices_list' }).catch(() => ({ result: { invoices: [] } })),
                API.callJson({ action: 'customers_list' }).catch(() => ({ result: { customers: [] } })),
                API.callJson({ action: 'load_albums' }).catch(() => ({ result: { data: [] } }))
            ]);

            pageState.invoices = Array.isArray(invRes?.result?.invoices) ? invRes.result.invoices : [];
            pageState.customers = Array.isArray(custRes?.result?.customers) ? custRes.result.customers : [];
            pageState.albums = Array.isArray(albRes?.result?.data) ? albRes.result.data : [];
            bindPickers();

            if (pageState.invoices.length) {
                loadInvoiceIntoForm(pageState.invoices[0]);
            } else {
                createBlankInvoice();
            }

            byId('invoiceForm').addEventListener('input', updatePreview);
            byId('invoiceForm').addEventListener('change', updatePreview);
            byId('invDocType').addEventListener('change', () => {
                const val = byId('invNumber').value.trim();
                if (!val || /^(BG|HD)-/.test(val)) {
                    byId('invNumber').value = computeDefaultDocNumber(byId('invDocType').value);
                }
                updatePreview();
            });
            byId('invoiceForm').addEventListener('submit', saveInvoice);
            byId('saveInvoiceTopBtn').addEventListener('click', saveInvoice);
            byId('newInvoiceBtn').addEventListener('click', createBlankInvoice);
            byId('deleteCurrentInvoiceBtn').addEventListener('click', () => deleteInvoiceById(pageState.activeId));
            byId('addCustomItemBtn').addEventListener('click', () => {
                pageState.items.push({ name: 'Hạng mục in / dịch vụ', spec: '', unit: 'Tấm', qty: 1, price: 0 });
                renderItemsTable();
            });
            byId('copyQuoteTextBtn').addEventListener('click', copyQuoteForZalo);
            byId('printInvoiceBtn').addEventListener('click', () => {
                updatePreview();
                global.print();
            });
            byId('exportInvoicePdfBtn').addEventListener('click', () => exportInvoiceFile('pdf'));
            byId('exportInvoicePngBtn').addEventListener('click', () => exportInvoiceFile('png'));
        } catch (err) {
            console.error('Lỗi khởi tạo trang Hóa đơn:', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window);
