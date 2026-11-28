/**
 * TeeMedia — Hóa đơn in ảnh & Phiếu giao hàng
 * Hỗ trợ setup sẵn danh mục Sản phẩm & Đơn giá để chọn dropdown / nhập nhanh tự ra đơn giá.
 */
(function initInvoicesPage(global) {
    const API = global.PhotoSelectAPI;
    const state = global.PhotoSelectApp?.state || {};
    const Dialog = global.PhotoSelectDialog;
    if (!API) return;

    const DEFAULT_CATALOG = [
        { id: 'cat-1318', name: 'In ảnh ép lụa 13×18 cm', price: 15000, note: 'Ép lụa mịn' },
        { id: 'cat-1521', name: 'In ảnh ép lụa 15×21 cm', price: 25000, note: 'Ép lụa mịn' },
        { id: 'cat-go-2030', name: 'Ảnh ép gỗ 20×30 cm', price: 80000, note: 'Gỗ Laminate' },
        { id: 'cat-go-3045', name: 'Ảnh ép gỗ 30×45 cm', price: 180000, note: 'Gỗ Laminate' },
        { id: 'cat-cong-6090', name: 'Ảnh cổng Pha lê 60×90 cm', price: 950000, note: 'Tráng gương kèm khung' },
        { id: 'cat-pb-2535', name: 'Album Photobook 25×35 cm (20 trang)', price: 1800000, note: 'Mở phẳng bìa da' }
    ];

    const LOCAL_CATALOG_KEY = 'teemediaInvoiceCatalog_v1';

    const pageState = {
        activeId: null,
        items: [],
        invoices: [],
        customers: [],
        catalog: [...DEFAULT_CATALOG]
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

    function computeDefaultInvoiceNumber() {
        const now = new Date();
        const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const hms = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        return `HD-${ymd}-${hms}`;
    }

    function getGrandTotal() {
        return pageState.items.reduce((sum, item) => {
            const qty = Math.max(0, Number(item.qty) || 0);
            const price = Math.max(0, Number(item.price) || 0);
            return sum + (qty * price);
        }, 0);
    }

    function findCatalogItemByName(name) {
        const key = String(name || '').trim().toLowerCase();
        if (!key) return null;
        return pageState.catalog.find(c => String(c.name || '').trim().toLowerCase() === key) || null;
    }

    function refreshCatalogWidgets() {
        const quickSel = byId('quickAddCatalogSelect');
        if (quickSel) {
            quickSel.replaceChildren();
            const head = document.createElement('option');
            head.value = '';
            head.textContent = '-- Chọn nhanh sản phẩm đã setup --';
            quickSel.appendChild(head);
            pageState.catalog.forEach((cat, idx) => {
                const opt = document.createElement('option');
                opt.value = String(idx);
                opt.textContent = `${cat.name} — ${formatMoney(cat.price)}`;
                quickSel.appendChild(opt);
            });
        }

        const datalist = byId('printCatalogDatalist');
        if (datalist) {
            datalist.replaceChildren();
            pageState.catalog.forEach(cat => {
                const opt = document.createElement('option');
                opt.value = cat.name;
                datalist.appendChild(opt);
            });
        }

        renderCatalogList();
    }

    async function persistCatalog(statusText = '') {
        try {
            localStorage.setItem(LOCAL_CATALOG_KEY, JSON.stringify(pageState.catalog));
        } catch {}
        try {
            await API.callJson({
                action: 'invoice_catalog_save',
                catalog: pageState.catalog
            });
            if (statusText) {
                const el = byId('catalogStatusMsg');
                if (el) el.textContent = statusText;
            }
        } catch {}
    }

    function renderCatalogList() {
        const listEl = byId('catalogItemsList');
        if (!listEl) return;
        listEl.replaceChildren();
        if (!pageState.catalog.length) {
            listEl.innerHTML = '<div style="color:var(--muted);font-size:.82rem;">Chưa có sản phẩm nào. Thêm sản phẩm ở hàng trên để dùng nhanh khi lập hóa đơn.</div>';
            return;
        }
        pageState.catalog.forEach((cat, idx) => {
            const row = document.createElement('div');
            row.className = 'catalog-item-row';
            row.innerHTML = `
                <input type="text" data-cat-field="name" value="${escapeHtml(cat.name)}" placeholder="Tên sản phẩm">
                <input type="number" min="0" step="1000" data-cat-field="price" value="${Number(cat.price) || 0}" placeholder="Đơn giá">
                <input type="text" data-cat-field="note" value="${escapeHtml(cat.note || '')}" placeholder="Ghi chú">
                <button type="button" class="inv-remove-btn" title="Xóa sản phẩm" aria-label="Xóa sản phẩm">✕</button>
            `;
            row.querySelectorAll('input').forEach(inp => {
                inp.addEventListener('change', () => {
                    const field = inp.dataset.catField;
                    pageState.catalog[idx][field] = field === 'price'
                        ? Math.max(0, Number(inp.value) || 0)
                        : inp.value.trim();
                    refreshCatalogWidgets();
                    renderItemsTable();
                    persistCatalog('✅ Đã cập nhật danh mục sản phẩm.');
                });
            });
            row.querySelector('.inv-remove-btn').addEventListener('click', () => {
                pageState.catalog.splice(idx, 1);
                refreshCatalogWidgets();
                renderItemsTable();
                persistCatalog('🗑️ Đã xóa sản phẩm khỏi danh mục.');
            });
            listEl.appendChild(row);
        });
    }

    function addCatalogProduct() {
        const nameEl = byId('newCatName');
        const priceEl = byId('newCatPrice');
        const noteEl = byId('newCatNote');
        const name = String(nameEl?.value || '').trim();
        const price = Math.max(0, Number(priceEl?.value) || 0);
        const note = String(noteEl?.value || '').trim();
        if (!name) {
            byId('catalogStatusMsg').textContent = '⚠️ Vui lòng nhập tên sản phẩm.';
            nameEl?.focus();
            return;
        }
        pageState.catalog.push({
            id: `cat-${Date.now().toString(36)}`,
            name,
            price,
            note
        });
        if (nameEl) nameEl.value = '';
        if (priceEl) priceEl.value = '';
        if (noteEl) noteEl.value = '';
        refreshCatalogWidgets();
        renderItemsTable();
        persistCatalog(`✅ Đã thêm "${name}" (${formatMoney(price)}) vào danh mục.`);
    }

    function renderItemsTable() {
        const tbody = byId('invItemsBody');
        if (!tbody) return;
        if (!pageState.items.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:1rem;">Chưa có sản phẩm nào. Chọn từ dropdown hoặc bấm "+ Thêm dòng trống".</td></tr>';
            updateTotalsAndPreview();
            return;
        }

        tbody.replaceChildren();
        pageState.items.forEach((item, idx) => {
            const tr = document.createElement('tr');
            const lineTotal = (Number(item.qty) || 0) * (Number(item.price) || 0);

            const catalogOptions = pageState.catalog.map((cat, catIdx) => {
                const isSelected = String(cat.name || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase();
                return `<option value="${catIdx}" ${isSelected ? 'selected' : ''}>${escapeHtml(cat.name)} — ${formatMoney(cat.price)}</option>`;
            }).join('');

            tr.innerHTML = `
                <td style="padding-top:.72rem;font-weight:700;">${idx + 1}</td>
                <td>
                    <div class="inv-product-cell">
                        <select class="inv-row-catalog-select" aria-label="Chọn sản phẩm cài sẵn">
                            <option value="">-- Chọn từ danh mục --</option>
                            ${catalogOptions}
                        </select>
                        <input type="text" list="printCatalogDatalist" class="inv-row-name-input" data-field="name" value="${escapeHtml(item.name)}" placeholder="Hoặc nhập tên sản phẩm...">
                    </div>
                </td>
                <td><input type="number" min="1" step="1" data-field="qty" value="${Number(item.qty) || 1}"></td>
                <td><input type="number" min="0" step="1000" data-field="price" value="${Number(item.price) || 0}"></td>
                <td class="inv-line-total">${formatMoney(lineTotal)}</td>
                <td><input type="text" data-field="note" value="${escapeHtml(item.note || '')}" placeholder="Ghi chú..."></td>
                <td style="padding-top:.48rem;"><button type="button" class="inv-remove-btn" title="Xóa dòng" aria-label="Xóa dòng">✕</button></td>
            `;

            const catSelect = tr.querySelector('.inv-row-catalog-select');
            const nameInput = tr.querySelector('[data-field="name"]');
            const qtyInput = tr.querySelector('[data-field="qty"]');
            const priceInput = tr.querySelector('[data-field="price"]');
            const noteInput = tr.querySelector('[data-field="note"]');
            const lineEl = tr.querySelector('.inv-line-total');

            const refreshRowTotal = () => {
                const val = (Number(pageState.items[idx].qty) || 0) * (Number(pageState.items[idx].price) || 0);
                lineEl.textContent = formatMoney(val);
                updateTotalsAndPreview();
            };

            catSelect.addEventListener('change', () => {
                const picked = pageState.catalog[Number(catSelect.value)];
                if (!picked) return;
                pageState.items[idx].name = picked.name;
                pageState.items[idx].price = Number(picked.price) || 0;
                if (!String(pageState.items[idx].note || '').trim() && picked.note) {
                    pageState.items[idx].note = picked.note;
                    noteInput.value = picked.note;
                }
                nameInput.value = picked.name;
                priceInput.value = String(pageState.items[idx].price);
                refreshRowTotal();
            });

            nameInput.addEventListener('input', () => {
                pageState.items[idx].name = nameInput.value;
                const matched = findCatalogItemByName(nameInput.value);
                if (matched) {
                    pageState.items[idx].price = Number(matched.price) || 0;
                    priceInput.value = String(pageState.items[idx].price);
                    if (!String(pageState.items[idx].note || '').trim() && matched.note) {
                        pageState.items[idx].note = matched.note;
                        noteInput.value = matched.note;
                    }
                    const matchIdx = pageState.catalog.indexOf(matched);
                    if (matchIdx >= 0) catSelect.value = String(matchIdx);
                }
                refreshRowTotal();
            });

            qtyInput.addEventListener('input', () => {
                pageState.items[idx].qty = Math.max(0, Number(qtyInput.value) || 0);
                refreshRowTotal();
            });
            priceInput.addEventListener('input', () => {
                pageState.items[idx].price = Math.max(0, Number(priceInput.value) || 0);
                refreshRowTotal();
            });
            noteInput.addEventListener('input', () => {
                pageState.items[idx].note = noteInput.value;
                updateTotalsAndPreview();
            });
            tr.querySelector('.inv-remove-btn').addEventListener('click', () => {
                pageState.items.splice(idx, 1);
                renderItemsTable();
            });
            tbody.appendChild(tr);
        });

        updateTotalsAndPreview();
    }

    function updateTotalsAndPreview() {
        const grandTotal = getGrandTotal();
        const formTotalEl = byId('formGrandTotalText');
        if (formTotalEl) formTotalEl.textContent = formatMoney(grandTotal);

        const sheet = byId('invoicePreviewSheet');
        if (!sheet) return;

        const studioName = byId('invStudioName').value.trim() || 'TeeMedia';
        const studioAddress = byId('invStudioAddress').value.trim() || '81/62 Ngô Mây, Quy Nhơn Nam';
        const studioPhone = byId('invStudioPhone').value.trim() || '0386038930';
        const invNumber = byId('invNumber').value.trim() || computeDefaultInvoiceNumber();
        const issueDate = formatDateVi(byId('invIssueDate').value);

        const clientName = byId('invClientName').value.trim() || '—';
        const clientPhone = byId('invClientPhone').value.trim() || '—';
        const clientAddress = byId('invClientAddress').value.trim() || '—';

        const rowsHtml = pageState.items.length
            ? pageState.items.map((item, i) => `
                <tr>
                    <td>${i + 1}</td>
                    <td><strong>${escapeHtml(item.name || 'Sản phẩm')}</strong></td>
                    <td class="num">${Number(item.qty) || 0}</td>
                    <td class="num">${formatMoney(item.price)}</td>
                    <td class="num"><strong>${formatMoney((Number(item.qty) || 0) * (Number(item.price) || 0))}</strong></td>
                    <td>${escapeHtml(item.note || '')}</td>
                </tr>
            `).join('')
            : '<tr><td colspan="6" style="text-align:center;color:#7a6d5f;padding:1rem;">Chưa có sản phẩm nào.</td></tr>';

        sheet.innerHTML = `
            <div class="sheet-head">
                <div class="sheet-brand">
                    <img src="photowedding/logo/teemedia-logo-mark.svg" alt="">
                    <div>
                        <h2>${escapeHtml(studioName)}</h2>
                        <div class="sheet-studio-meta">
                            <div>Địa chỉ: <strong>${escapeHtml(studioAddress)}</strong></div>
                            <div>SĐT: <strong>${escapeHtml(studioPhone)}</strong></div>
                        </div>
                    </div>
                </div>
                <div class="sheet-doc-meta">
                    <span class="sheet-doc-type">PHIẾU GIAO HÀNG</span>
                    <div class="sheet-doc-no">Số hóa đơn: <strong>${escapeHtml(invNumber)}</strong></div>
                    <div class="sheet-doc-no">Ngày in phiếu: <strong>${escapeHtml(issueDate)}</strong></div>
                </div>
            </div>

            <div class="sheet-customer-box">
                <h4>Thông tin khách hàng</h4>
                <div>Tên khách hàng: <strong>${escapeHtml(clientName)}</strong></div>
                <div>Số điện thoại: <strong>${escapeHtml(clientPhone)}</strong></div>
                <div>Địa chỉ: <strong>${escapeHtml(clientAddress)}</strong></div>
            </div>

            <table class="sheet-table">
                <thead>
                    <tr>
                        <th style="width:42px;">STT</th>
                        <th>Sản phẩm</th>
                        <th class="num" style="width:72px;">Số lượng</th>
                        <th class="num" style="width:105px;">Đơn giá</th>
                        <th class="num" style="width:115px;">Thành tiền</th>
                        <th>Ghi chú</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
                <tfoot>
                    <tr>
                        <td colspan="4" style="text-align:right;">Tổng cộng</td>
                        <td class="num">${formatMoney(grandTotal)}</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        `;
    }

    function collectInvoicePayload() {
        return {
            id: pageState.activeId || undefined,
            invoiceNumber: byId('invNumber').value.trim(),
            issueDate: byId('invIssueDate').value,
            studioName: byId('invStudioName').value.trim() || 'TeeMedia',
            studioAddress: byId('invStudioAddress').value.trim() || '81/62 Ngô Mây, Quy Nhơn Nam',
            studioPhone: byId('invStudioPhone').value.trim() || '0386038930',
            clientName: byId('invClientName').value.trim(),
            clientPhone: byId('invClientPhone').value.trim(),
            clientAddress: byId('invClientAddress').value.trim(),
            items: pageState.items.map(i => ({
                name: String(i.name || ''),
                qty: Math.max(1, Number(i.qty) || 1),
                price: Math.max(0, Number(i.price) || 0),
                note: String(i.note || '')
            }))
        };
    }

    function loadInvoiceIntoForm(inv) {
        pageState.activeId = inv?.id || null;
        byId('invNumber').value = inv?.invoiceNumber || computeDefaultInvoiceNumber();
        const todayIso = new Date().toISOString().slice(0, 10);
        byId('invIssueDate').value = inv?.issueDate || todayIso;
        byId('invStudioName').value = inv?.studioName || 'TeeMedia';
        byId('invStudioAddress').value = inv?.studioAddress || '81/62 Ngô Mây, Quy Nhơn Nam';
        byId('invStudioPhone').value = inv?.studioPhone || '0386038930';
        byId('invClientName').value = inv?.clientName || '';
        byId('invClientPhone').value = inv?.clientPhone || '';
        byId('invClientAddress').value = inv?.clientAddress || '';

        const firstCat = pageState.catalog[0] || { name: 'In ảnh ép lụa 13×18 cm', price: 15000, note: '' };
        pageState.items = Array.isArray(inv?.items) && inv.items.length
            ? inv.items.map(i => ({
                name: i.name || '',
                qty: Math.max(1, Number(i.qty) || 1),
                price: Math.max(0, Number(i.price) || 0),
                note: i.note || i.spec || ''
            }))
            : [{ name: firstCat.name, qty: 1, price: firstCat.price, note: firstCat.note || '' }];

        byId('deleteCurrentInvoiceBtn').hidden = !pageState.activeId;
        renderItemsTable();
        renderSavedInvoices();
    }

    function createBlankInvoice() {
        const firstCat = pageState.catalog[0] || { name: 'In ảnh ép lụa 13×18 cm', price: 15000, note: '' };
        loadInvoiceIntoForm({
            id: null,
            invoiceNumber: computeDefaultInvoiceNumber(),
            issueDate: new Date().toISOString().slice(0, 10),
            studioName: 'TeeMedia',
            studioAddress: '81/62 Ngô Mây, Quy Nhơn Nam',
            studioPhone: '0386038930',
            items: [{ name: firstCat.name, qty: 1, price: firstCat.price, note: firstCat.note || '' }]
        });
        byId('invoiceStatusMsg').textContent = 'Đã tạo phiếu mới.';
    }

    function renderSavedInvoices() {
        const listEl = byId('savedInvoicesList');
        const countEl = byId('savedInvoicesCount');
        if (!listEl) return;
        if (countEl) countEl.textContent = `${pageState.invoices.length} phiếu`;
        if (!pageState.invoices.length) {
            listEl.innerHTML = '<div style="color:var(--muted);font-size:.82rem;">Chưa có phiếu giao hàng nào được lưu.</div>';
            return;
        }
        listEl.replaceChildren();
        pageState.invoices.forEach(inv => {
            const total = (inv.items || []).reduce((s, it) => s + ((Number(it.qty) || 0) * (Number(it.price) || 0)), 0);
            const row = document.createElement('div');
            row.className = `inv-saved-item${String(inv.id) === String(pageState.activeId) ? ' is-active' : ''}`;
            row.innerHTML = `
                <div>
                    <strong>${escapeHtml(inv.invoiceNumber || 'HD')} · ${escapeHtml(inv.clientName || 'Khách hàng')}</strong>
                    <div style="font-size:.76rem;color:var(--muted);">
                        ${escapeHtml(formatDateVi(inv.issueDate))} · <strong>${formatMoney(total)}</strong>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;">
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
        statusMsg.textContent = 'Đang lưu phiếu...';
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
        if (!id || !global.confirm('Bạn có chắc muốn xóa phiếu này không?')) return;
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
        updateTotalsAndPreview();
        try {
            const canvas = await global.html2canvas(source, { backgroundColor: '#ffffff', scale: 2, useCORS: true });
            const code = (byId('invNumber').value.trim() || 'hoa-don-in-anh').replace(/[^a-zA-Z0-9-_]+/g, '-');
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

    function bindCustomerPicker() {
        const custSel = byId('invCustomerPicker');
        if (!custSel) return;
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
            updateTotalsAndPreview();
        });
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

            // Hydrate product catalog (local fallback first, then server/Firebase)
            try {
                const localCat = JSON.parse(localStorage.getItem(LOCAL_CATALOG_KEY) || 'null');
                if (Array.isArray(localCat) && localCat.length) pageState.catalog = localCat;
            } catch {}

            const [catRes, invRes, custRes] = await Promise.all([
                API.callJson({ action: 'invoice_catalog_load' }).catch(() => null),
                API.callJson({ action: 'invoices_list' }).catch(() => ({ result: { invoices: [] } })),
                API.callJson({ action: 'customers_list' }).catch(() => ({ result: { customers: [] } }))
            ]);

            if (Array.isArray(catRes?.result?.catalog) && catRes.result.catalog.length) {
                pageState.catalog = catRes.result.catalog;
            }
            pageState.invoices = Array.isArray(invRes?.result?.invoices) ? invRes.result.invoices : [];
            pageState.customers = Array.isArray(custRes?.result?.customers) ? custRes.result.customers : [];

            refreshCatalogWidgets();
            bindCustomerPicker();

            if (pageState.invoices.length) {
                loadInvoiceIntoForm(pageState.invoices[0]);
            } else {
                createBlankInvoice();
            }

            byId('toggleCatalogSetupBtn')?.addEventListener('click', () => {
                const card = byId('catalogSetupCard');
                if (card) card.hidden = !card.hidden;
            });
            byId('closeCatalogSetupBtn')?.addEventListener('click', () => {
                const card = byId('catalogSetupCard');
                if (card) card.hidden = true;
            });
            byId('addCatalogProductBtn')?.addEventListener('click', addCatalogProduct);

            byId('quickAddCatalogSelect')?.addEventListener('change', event => {
                const picked = pageState.catalog[Number(event.currentTarget.value)];
                if (!picked) return;
                pageState.items.push({
                    name: picked.name,
                    qty: 1,
                    price: Number(picked.price) || 0,
                    note: picked.note || ''
                });
                event.currentTarget.value = '';
                renderItemsTable();
            });

            byId('invoiceForm').addEventListener('input', updateTotalsAndPreview);
            byId('invoiceForm').addEventListener('change', updateTotalsAndPreview);
            byId('invoiceForm').addEventListener('submit', saveInvoice);
            byId('saveInvoiceTopBtn').addEventListener('click', saveInvoice);
            byId('newInvoiceBtn').addEventListener('click', createBlankInvoice);
            byId('deleteCurrentInvoiceBtn').addEventListener('click', () => deleteInvoiceById(pageState.activeId));
            byId('addCustomItemBtn').addEventListener('click', () => {
                pageState.items.push({ name: '', qty: 1, price: 0, note: '' });
                renderItemsTable();
            });
            byId('printInvoiceBtn').addEventListener('click', () => {
                updateTotalsAndPreview();
                global.print();
            });
            byId('exportInvoicePdfBtn').addEventListener('click', () => exportInvoiceFile('pdf'));
            byId('exportInvoicePngBtn').addEventListener('click', () => exportInvoiceFile('png'));
        } catch (err) {
            console.error('Lỗi khởi tạo trang Hóa đơn in ảnh:', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})(window);
