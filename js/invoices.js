/**
 * selectphoto — Hóa đơn in ảnh & Phiếu giao hàng
 * Luồng thao tác: Chọn sản phẩm đã thiết lập -> Nhập số lượng, đơn giá, ghi chú -> Kiểm tra tổng cộng -> Lưu phiếu.
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
        saving: false,
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

    function normalizeRowItem(raw = {}) {
        const name = String(raw.name || '');
        const matched = findCatalogItemByName(name);
        const explicitMode = raw.mode === 'manual' || raw.mode === 'preset' ? raw.mode : '';
        const mode = explicitMode || (name && !matched ? 'manual' : 'preset');
        return {
            mode,
            name,
            qty: raw.qty === '' ? '' : Math.max(1, Number(raw.qty) || 1),
            price: raw.price === '' ? '' : Math.max(0, Number(raw.price) || 0),
            note: String(raw.note || raw.spec || '')
        };
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
                <button type="button" class="inv-delete-row-btn" title="Xóa sản phẩm khỏi danh mục" aria-label="Xóa sản phẩm khỏi danh mục">Xóa</button>
            `;
            row.querySelectorAll('input').forEach(inp => {
                inp.addEventListener('change', () => {
                    const field = inp.dataset.catField;
                    pageState.catalog[idx][field] = field === 'price'
                        ? Math.max(0, Number(inp.value) || 0)
                        : inp.value.trim();
                    renderCatalogList();
                    renderItemsTable();
                    persistCatalog('✅ Đã cập nhật danh mục sản phẩm.');
                });
            });
            row.querySelector('.inv-delete-row-btn').addEventListener('click', () => {
                pageState.catalog.splice(idx, 1);
                renderCatalogList();
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
        renderCatalogList();
        renderItemsTable();
        persistCatalog(`✅ Đã thêm "${name}" (${formatMoney(price)}) vào danh mục.`);
    }

    function setRowFieldError(cellEl, inputEl, message) {
        if (!cellEl) return;
        let errEl = cellEl.querySelector('.inv-field-error');
        if (!message) {
            if (errEl) errEl.remove();
            inputEl?.classList.remove('is-invalid');
            inputEl?.removeAttribute('aria-invalid');
            return;
        }
        if (!errEl) {
            errEl = document.createElement('div');
            errEl.className = 'inv-field-error';
            cellEl.appendChild(errEl);
        }
        errEl.textContent = message;
        inputEl?.classList.add('is-invalid');
        inputEl?.setAttribute('aria-invalid', 'true');
    }

    function validateClientNameField() {
        const input = byId('invClientName');
        const err = byId('invClientNameError');
        if (!input || !err) return true;
        const ok = input.value.trim().length > 0;
        input.classList.toggle('is-invalid', !ok);
        input.setAttribute('aria-invalid', String(!ok));
        err.hidden = ok;
        err.textContent = ok ? '' : 'Vui lòng nhập tên khách hàng.';
        return ok;
    }

    function validateRowData(item) {
        const errors = { name: '', qty: '', price: '' };
        if (!String(item.name || '').trim()) {
            errors.name = item.mode === 'manual'
                ? 'Vui lòng nhập tên sản phẩm.'
                : 'Vui lòng chọn sản phẩm.';
        }
        const qtyVal = Number(item.qty);
        if (item.qty === '' || !Number.isFinite(qtyVal) || qtyVal < 1 || !Number.isInteger(qtyVal)) {
            errors.qty = 'Số lượng phải là số nguyên >= 1.';
        }
        const priceVal = Number(item.price);
        if (item.price === '' || !Number.isFinite(priceVal) || priceVal < 0) {
            errors.price = 'Đơn giá phải >= 0.';
        }
        return errors;
    }

    function validateAllFields() {
        let firstInvalidEl = null;
        let isValid = validateClientNameField();
        if (!isValid) firstInvalidEl = byId('invClientName');

        const rows = [...document.querySelectorAll('#invItemsBody tr.inv-item-row')];
        if (!pageState.items.length) {
            isValid = false;
            setStatusBanner('⚠️ Vui lòng thêm ít nhất 1 sản phẩm trước khi lưu phiếu.', 'is-error');
            return false;
        }

        pageState.items.forEach((item, idx) => {
            const tr = rows[idx];
            if (!tr) return;
            const errs = validateRowData(item);
            const prodCell = tr.querySelector('.inv-col-product');
            const prodCtrl = prodCell?.querySelector('.inv-product-select, .inv-product-input');
            const qtyCell = tr.querySelector('.inv-col-qty');
            const qtyInput = qtyCell?.querySelector('input');
            const priceCell = tr.querySelector('.inv-col-price');
            const priceInput = priceCell?.querySelector('input');

            setRowFieldError(prodCell, prodCtrl, errs.name);
            setRowFieldError(qtyCell, qtyInput, errs.qty);
            setRowFieldError(priceCell, priceInput, errs.price);

            if (errs.name || errs.qty || errs.price) {
                isValid = false;
                if (!firstInvalidEl) {
                    firstInvalidEl = (errs.name && prodCtrl) || (errs.qty && qtyInput) || (errs.price && priceInput) || null;
                }
            }
        });

        if (!isValid && firstInvalidEl) {
            firstInvalidEl.focus();
            firstInvalidEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return isValid;
    }

    function setStatusBanner(message, variant = '') {
        const el = byId('invoiceStatusMsg');
        if (!el) return;
        el.textContent = message || '';
        el.className = `inv-status-banner${variant ? ` ${variant}` : ''}`;
    }

    function buildSourceBadgeHtml(item) {
        const matched = findCatalogItemByName(item.name);
        if (item.mode === 'manual' || !matched) {
            return '<span class="inv-source-badge is-manual">✎ Nhập thủ công</span>';
        }
        return '<span class="inv-source-badge is-preset">✓ Đã thiết lập</span>';
    }

    function renderItemsTable() {
        const tbody = byId('invItemsBody');
        const emptyBox = byId('invEmptyProducts');
        if (!tbody) return;

        tbody.replaceChildren();
        if (!pageState.items.length) {
            if (emptyBox) emptyBox.hidden = false;
            updateTotalsAndPreview();
            return;
        }
        if (emptyBox) emptyBox.hidden = true;

        pageState.items.forEach((item, idx) => {
            const tr = document.createElement('tr');
            tr.className = 'inv-item-row';
            const qtyNum = Math.max(0, Number(item.qty) || 0);
            const priceNum = Math.max(0, Number(item.price) || 0);
            const lineTotal = qtyNum * priceNum;

            const isManual = item.mode === 'manual';
            const catalogOptions = pageState.catalog.map((cat, catIdx) => {
                const selected = String(cat.name || '').trim().toLowerCase() === String(item.name || '').trim().toLowerCase();
                return `<option value="cat:${catIdx}" ${selected ? 'selected' : ''}>${escapeHtml(cat.name)} — ${formatMoney(cat.price)}</option>`;
            }).join('');

            const productControlHtml = isManual
                ? `
                    <input type="text" class="inv-product-input" data-field="name" value="${escapeHtml(item.name)}" placeholder="Nhập tên sản phẩm mới...">
                    <div class="inv-product-meta-bar">
                        <span class="inv-source-badge is-manual">✎ Nhập thủ công</span>
                        <button type="button" class="inv-switch-mode-btn">← Chọn từ danh mục</button>
                    </div>
                `
                : `
                    <select class="inv-product-select" aria-label="Chọn sản phẩm cho dòng ${idx + 1}">
                        <option value="">-- Chọn sản phẩm đã thiết lập --</option>
                        ${catalogOptions}
                        <option value="__custom__">＋ Tạo sản phẩm mới / Nhập thủ công...</option>
                    </select>
                    <div class="inv-product-meta-bar">
                        ${buildSourceBadgeHtml(item)}
                    </div>
                `;

            tr.innerHTML = `
                <td class="is-center inv-col-stt">
                    <span class="inv-stt-pill">${idx + 1}</span>
                </td>
                <td class="inv-col-product">
                    <span class="inv-cell-label">Sản phẩm</span>
                    <div class="inv-product-control">${productControlHtml}</div>
                </td>
                <td class="is-center inv-col-qty">
                    <span class="inv-cell-label">Số lượng</span>
                    <input type="number" min="1" step="1" data-field="qty" value="${item.qty === '' ? '' : Number(item.qty) || 1}" aria-label="Số lượng dòng ${idx + 1}">
                </td>
                <td class="is-num inv-col-price">
                    <span class="inv-cell-label">Đơn giá (VNĐ)</span>
                    <input type="number" min="0" step="1000" data-field="price" value="${item.price === '' ? '' : Number(item.price) || 0}" aria-label="Đơn giá dòng ${idx + 1}">
                </td>
                <td class="is-num inv-col-total">
                    <span class="inv-cell-label">Thành tiền</span>
                    <span class="inv-line-total">${formatMoney(lineTotal)}</span>
                </td>
                <td class="inv-col-note">
                    <span class="inv-cell-label">Ghi chú</span>
                    <input type="text" data-field="note" value="${escapeHtml(item.note || '')}" placeholder="Ghi chú..." aria-label="Ghi chú dòng ${idx + 1}">
                </td>
                <td class="is-center inv-col-action">
                    <button type="button" class="inv-delete-row-btn" title="Xóa sản phẩm" aria-label="Xóa sản phẩm dòng ${idx + 1}">Xóa</button>
                </td>
            `;

            const prodCell = tr.querySelector('.inv-col-product');
            const qtyCell = tr.querySelector('.inv-col-qty');
            const priceCell = tr.querySelector('.inv-col-price');
            const qtyInput = qtyCell.querySelector('input');
            const priceInput = priceCell.querySelector('input');
            const noteInput = tr.querySelector('[data-field="note"]');
            const lineEl = tr.querySelector('.inv-line-total');

            const refreshRowTotal = () => {
                const q = Math.max(0, Number(pageState.items[idx].qty) || 0);
                const p = Math.max(0, Number(pageState.items[idx].price) || 0);
                lineEl.textContent = formatMoney(q * p);
                updateTotalsAndPreview();
            };

            if (isManual) {
                const nameInput = tr.querySelector('.inv-product-input');
                const switchBtn = tr.querySelector('.inv-switch-mode-btn');
                nameInput.addEventListener('input', () => {
                    pageState.items[idx].name = nameInput.value;
                    const errs = validateRowData(pageState.items[idx]);
                    setRowFieldError(prodCell, nameInput, errs.name);
                    updateTotalsAndPreview();
                });
                switchBtn?.addEventListener('click', () => {
                    pageState.items[idx].mode = 'preset';
                    if (!findCatalogItemByName(pageState.items[idx].name)) {
                        pageState.items[idx].name = '';
                        pageState.items[idx].price = 0;
                    }
                    renderItemsTable();
                });
            } else {
                const catSelect = tr.querySelector('.inv-product-select');
                catSelect.addEventListener('change', () => {
                    const val = catSelect.value;
                    if (val === '__custom__') {
                        pageState.items[idx].mode = 'manual';
                        pageState.items[idx].name = '';
                        renderItemsTable();
                        const newInput = byId('invItemsBody')?.querySelectorAll('tr.inv-item-row')?.[idx]?.querySelector('.inv-product-input');
                        newInput?.focus();
                        return;
                    }
                    if (!val.startsWith('cat:')) {
                        pageState.items[idx].name = '';
                        pageState.items[idx].price = 0;
                        priceInput.value = '0';
                        setRowFieldError(prodCell, catSelect, 'Vui lòng chọn sản phẩm.');
                        refreshRowTotal();
                        return;
                    }
                    const picked = pageState.catalog[Number(val.slice(4))];
                    if (!picked) return;
                    pageState.items[idx].mode = 'preset';
                    pageState.items[idx].name = picked.name;
                    pageState.items[idx].price = Number(picked.price) || 0;
                    if (!String(pageState.items[idx].note || '').trim() && picked.note) {
                        pageState.items[idx].note = picked.note;
                        noteInput.value = picked.note;
                    }
                    priceInput.value = String(pageState.items[idx].price);
                    setRowFieldError(prodCell, catSelect, '');
                    setRowFieldError(priceCell, priceInput, '');
                    refreshRowTotal();
                });
            }

            qtyInput.addEventListener('input', () => {
                pageState.items[idx].qty = qtyInput.value === '' ? '' : Number(qtyInput.value);
                const errs = validateRowData(pageState.items[idx]);
                setRowFieldError(qtyCell, qtyInput, errs.qty);
                refreshRowTotal();
            });
            priceInput.addEventListener('input', () => {
                pageState.items[idx].price = priceInput.value === '' ? '' : Number(priceInput.value);
                const errs = validateRowData(pageState.items[idx]);
                setRowFieldError(priceCell, priceInput, errs.price);
                refreshRowTotal();
            });
            noteInput.addEventListener('input', () => {
                pageState.items[idx].note = noteInput.value;
                updateTotalsAndPreview();
            });
            tr.querySelector('.inv-delete-row-btn').addEventListener('click', () => {
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

        const studioName = byId('invStudioName').value.trim() || 'selectphoto';
        const studioAddress = byId('invStudioAddress').value.trim() || '81/62 Ngô Mây, Quy Nhơn Nam';
        const studioPhone = byId('invStudioPhone').value.trim() || '0386038930';
        const studioEmail = byId('invStudioEmail')?.value.trim() || 'thongtrong10@gmail.com';
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
                    <img src="photowedding/logo/selectphoto-logo-mark.svg" alt="">
                    <div>
                        <h2>${escapeHtml(studioName)}</h2>
                        <div class="sheet-studio-meta">
                            <div>Địa chỉ: <strong>${escapeHtml(studioAddress)}</strong></div>
                            <div>SĐT: <strong>${escapeHtml(studioPhone)}</strong></div>
                            <div>Email: <strong>${escapeHtml(studioEmail)}</strong></div>
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
            studioName: byId('invStudioName').value.trim() || 'selectphoto',
            studioAddress: byId('invStudioAddress').value.trim() || '81/62 Ngô Mây, Quy Nhơn Nam',
            studioPhone: byId('invStudioPhone').value.trim() || '0386038930',
            studioEmail: byId('invStudioEmail')?.value.trim() || 'thongtrong10@gmail.com',
            clientName: byId('invClientName').value.trim(),
            clientPhone: byId('invClientPhone').value.trim(),
            clientAddress: byId('invClientAddress').value.trim(),
            items: pageState.items.map(i => ({
                mode: i.mode || 'preset',
                name: String(i.name || '').trim(),
                qty: Math.max(1, Number(i.qty) || 1),
                price: Math.max(0, Number(i.price) || 0),
                note: String(i.note || '').trim()
            }))
        };
    }

    function loadInvoiceIntoForm(inv) {
        pageState.activeId = inv?.id || null;
        byId('invNumber').value = inv?.invoiceNumber || computeDefaultInvoiceNumber();
        const todayIso = new Date().toISOString().slice(0, 10);
        byId('invIssueDate').value = inv?.issueDate || todayIso;
        byId('invStudioName').value = inv?.studioName || 'selectphoto';
        byId('invStudioAddress').value = inv?.studioAddress || '81/62 Ngô Mây, Quy Nhơn Nam';
        byId('invStudioPhone').value = inv?.studioPhone || '0386038930';
        if (byId('invStudioEmail')) byId('invStudioEmail').value = inv?.studioEmail || 'thongtrong10@gmail.com';
        byId('invClientName').value = inv?.clientName || '';
        byId('invClientPhone').value = inv?.clientPhone || '';
        byId('invClientAddress').value = inv?.clientAddress || '';

        const firstCat = pageState.catalog[0] || { name: 'In ảnh ép lụa 13×18 cm', price: 15000, note: '' };
        pageState.items = Array.isArray(inv?.items) && inv.items.length
            ? inv.items.map(normalizeRowItem)
            : [normalizeRowItem({ mode: 'preset', name: firstCat.name, qty: 1, price: firstCat.price, note: firstCat.note || '' })];

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
            studioName: 'selectphoto',
            studioAddress: '81/62 Ngô Mây, Quy Nhơn Nam',
            studioPhone: '0386038930',
            studioEmail: 'thongtrong10@gmail.com',
            items: [{ mode: 'preset', name: firstCat.name, qty: 1, price: firstCat.price, note: firstCat.note || '' }]
        });
        setStatusBanner('Đã tạo mẫu phiếu mới.');
    }

    function renderSavedInvoices() {
        const listEl = byId('savedInvoicesList');
        const countEl = byId('savedInvoicesCount');
        if (!listEl) return;
        if (countEl) countEl.textContent = `${pageState.invoices.length} phiếu`;
        if (!pageState.invoices.length) {
            listEl.innerHTML = '<div class="inv-saved-empty">Chưa có phiếu giao hàng nào.</div>';
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
                    <div style="font-size:.78rem;color:var(--muted);">
                        Ngày in: ${escapeHtml(formatDateVi(inv.issueDate))} · Tổng: <strong>${formatMoney(total)}</strong>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;">
                    <button type="button" class="button" data-action="open">Mở phiếu</button>
                    <button type="button" class="inv-delete-row-btn" data-action="delete" title="Xóa phiếu giao hàng">Xóa</button>
                </div>
            `;
            row.querySelector('[data-action="open"]').addEventListener('click', () => {
                loadInvoiceIntoForm(inv);
                setStatusBanner(`Đang mở phiếu ${inv.invoiceNumber || ''}.`);
            });
            row.querySelector('[data-action="delete"]').addEventListener('click', () => deleteInvoiceById(inv.id));
            listEl.appendChild(row);
        });
    }

    async function saveInvoice(event) {
        if (event) event.preventDefault();
        if (pageState.saving) return;

        if (!validateAllFields()) {
            if (pageState.items.length) {
                setStatusBanner('⚠️ Vui lòng kiểm tra lại các trường báo đỏ bên trên trước khi lưu.', 'is-error');
            }
            return;
        }

        pageState.saving = true;
        const saveBtns = [byId('saveInvoiceBtn'), byId('saveInvoiceTopBtn')].filter(Boolean);
        saveBtns.forEach(btn => {
            btn.disabled = true;
            btn.dataset.prevText = btn.textContent;
            btn.textContent = '⏳ Đang lưu...';
        });
        setStatusBanner('Đang lưu phiếu giao hàng...');

        try {
            const payload = collectInvoicePayload();
            const { ok, result } = await API.callJson({
                action: 'invoices_save',
                invoice: payload
            });
            if (!ok || !result?.success) throw new Error(result?.message || 'Không thể lưu phiếu.');
            const saved = result.invoice;
            pageState.activeId = saved.id;
            const idx = pageState.invoices.findIndex(x => String(x.id) === String(saved.id));
            if (idx >= 0) pageState.invoices[idx] = saved;
            else pageState.invoices.unshift(saved);

            loadInvoiceIntoForm(saved);
            setStatusBanner(`✅ Đã lưu phiếu ${saved.invoiceNumber || ''} thành công! (Bấm lưu lại sẽ cập nhật phiếu này, không tạo trùng)`, 'is-success');
        } catch (err) {
            setStatusBanner(`❌ ${err.message || 'Lỗi khi lưu.'}`, 'is-error');
        } finally {
            pageState.saving = false;
            saveBtns.forEach(btn => {
                btn.disabled = false;
                if (btn.dataset.prevText) btn.textContent = btn.dataset.prevText;
            });
        }
    }

    async function deleteInvoiceById(id) {
        if (!id || !global.confirm('Bạn có chắc muốn xóa phiếu giao hàng này không?')) return;
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
            setStatusBanner('🗑️ Đã xóa phiếu giao hàng.');
        } catch (err) {
            setStatusBanner(`❌ ${err.message || 'Lỗi khi xóa.'}`, 'is-error');
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
            validateClientNameField();
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

            renderCatalogList();
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

            byId('addProductRowBtn')?.addEventListener('click', () => {
                pageState.items.push(normalizeRowItem({ mode: 'preset', name: '', qty: 1, price: 0, note: '' }));
                renderItemsTable();
                const selects = document.querySelectorAll('#invItemsBody .inv-product-select');
                selects[selects.length - 1]?.focus();
            });
            byId('addBlankRowBtn')?.addEventListener('click', () => {
                pageState.items.push(normalizeRowItem({ mode: 'manual', name: '', qty: 1, price: 0, note: '' }));
                renderItemsTable();
                const inputs = document.querySelectorAll('#invItemsBody .inv-product-input');
                inputs[inputs.length - 1]?.focus();
            });

            byId('invClientName')?.addEventListener('input', validateClientNameField);
            byId('invoiceEditorCard').addEventListener('input', updateTotalsAndPreview);
            byId('invoiceEditorCard').addEventListener('change', updateTotalsAndPreview);
            byId('invoiceEditorCard').addEventListener('submit', saveInvoice);
            byId('saveInvoiceTopBtn').addEventListener('click', saveInvoice);
            byId('newInvoiceBtn').addEventListener('click', createBlankInvoice);
            byId('deleteCurrentInvoiceBtn').addEventListener('click', () => deleteInvoiceById(pageState.activeId));
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
