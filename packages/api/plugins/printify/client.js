/**
 * Printify config page (framework-agnostic ESM). Renders the credential form,
 * a Save button, and a "Test connection" button that lists the account's shops
 * so the operator can confirm the shop id. Product syncing lives in the Shop
 * admin ("Sync from Printify" on Shop → Products).
 */
export default {
    mountConfig(el, host) {
        const cfg = { ...(host.config || {}) };
        const wrap = document.createElement('div');

        const { group, input, checkbox } = host.ui.form(cfg);

        wrap.appendChild(group('API access token', input('apiToken', { type: 'password', placeholder: 'Printify personal access token' })));
        wrap.appendChild(group('Shop ID', input('shopId', { placeholder: 'e.g. 28333614' })));
        wrap.appendChild(group('Publish synced products immediately', checkbox('autoPublish')));
        wrap.appendChild(group('Auto-sync interval (minutes)', input('syncIntervalMinutes', { type: 'number', placeholder: '60' })));
        wrap.appendChild(group('Price markup (%)', input('priceMarkupPercent', { type: 'number', placeholder: '0' })));

        const status = document.createElement('div');
        status.style.cssText = 'margin-top:10px;font-size:13px;line-height:1.5;';

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn btn--primary';
        saveBtn.textContent = 'Save configuration';
        saveBtn.onclick = async () => {
            status.textContent = 'Saving…';
            try { await host.saveConfig(cfg); status.textContent = '✓ Saved.'; }
            catch (e) { status.textContent = '✕ ' + (e && e.message || 'Save failed'); }
        };

        const testBtn = document.createElement('button');
        testBtn.className = 'btn btn--secondary';
        testBtn.textContent = 'Test connection';
        testBtn.onclick = async () => {
            status.textContent = 'Saving + testing…';
            try {
                await host.saveConfig(cfg);
                const r = await host.api.post('/action/testConnection', {});
                if (!r || r.ok === false) { status.textContent = '✕ ' + ((r && r.error) || 'Connection failed'); return; }
                const shops = (r.shops || []).map((s) => `#${s.id} — ${s.title}${s.channel ? ' (' + s.channel + ')' : ''}`).join('<br>');
                status.innerHTML = (r.shopFound
                    ? `✓ Connected. Using shop: <strong>${r.shopTitle}</strong>.`
                    : `⚠ Connected, but shop id not found in this account. Your shops:`) +
                    (shops ? `<div style="margin-top:6px;color:#555">${shops}</div>` : '');
            } catch (e) {
                status.textContent = '✕ ' + (e && e.message || 'Test failed');
            }
        };

        row.appendChild(saveBtn);
        row.appendChild(testBtn);
        wrap.appendChild(row);
        wrap.appendChild(status);

        const note = document.createElement('p');
        note.style.cssText = 'margin-top:16px;font-size:12px;color:#666;';
        note.innerHTML = 'After saving your token + shop id, go to <strong>Shop → Products</strong> and click <strong>Sync from Printify</strong> to import your catalog. Products auto-refresh on the interval above.';
        wrap.appendChild(note);

        el.appendChild(wrap);
    },
};
