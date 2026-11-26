/* Inventory app – phone front end. Talks to the Apps Script API in config.js. */

let CODE = '', ME = null, CUR = null, DATA = null, CAT = 'ALL', EDIT_ID = null;
let TEAM = [], MEMBER = null;
const pending = {};
let inflight = 0;

const $ = id => document.getElementById(id);
const store = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
};
const fmt = n => (Math.round(n * 100) / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const num = n => (Math.round(n * 100) / 100).toLocaleString('fr-FR');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms || 2400); }
function busy(on) { $('busy').classList.toggle('hidden', !on); }
function closeSheet(e, el) { if (e.target === el) el.classList.remove('open'); }
function closeAll() { document.querySelectorAll('.sheet.open').forEach(s => s.classList.remove('open')); }
function open(id) { closeAll(); $(id).classList.add('open'); }
const role = () => (ME && CUR) ? (ME.inventories.find(i => i.key === CUR) || {}).role : '';
const isMgr = () => role() === 'manager';

async function api(action, params) {
  const body = JSON.stringify(Object.assign({ action: action, code: CODE }, params || {}));
  let res;
  try { res = await fetch(API_URL, { method: 'POST', body: body }); }
  catch (e) { throw new Error('No connection. Check your internet and try again.'); }
  let j;
  try { j = await res.json(); } catch (e) { throw new Error('The server did not answer correctly. Try again.'); }
  if (!j.ok) {
    if (/Wrong code/.test(j.error) && action !== 'login') { logout(true); }
    throw new Error(j.error);
  }
  return j.data;
}

/* ---------------- login ---------------- */
let pin = '';
function buildKeypad() {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
  $('keypad').innerHTML = keys.map(k =>
    `<button class="${k === 'OK' ? 'ok' : k === '⌫' ? 'small' : ''}" data-k="${k}">${k}</button>`).join('');
  $('keypad').onclick = e => { const k = e.target.dataset && e.target.dataset.k; if (k) press(k); };
  document.addEventListener('keydown', e => {
    if ($('login').classList.contains('hidden')) return;
    if (/^\d$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); else if (e.key === 'Enter') press('OK');
  });
}
function drawPin() { $('pinDots').innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join(''); }
function press(k) {
  const lbl = $('pinLabel'); lbl.classList.remove('err'); lbl.textContent = 'Enter your code';
  if (k === '⌫') pin = pin.slice(0, -1);
  else if (k === 'OK') return submitPin();
  else if (pin.length < 12) pin += k;
  drawPin();
}
async function submitPin() {
  if (pin.length < 4) { $('pinLabel').textContent = 'Codes have at least 4 digits'; $('pinLabel').classList.add('err'); return; }
  CODE = pin; busy(true);
  try {
    ME = await api('login');
    store.set('inv.code', CODE);
    pin = ''; drawPin();
    await enterApp();
  } catch (e) {
    CODE = ''; pin = ''; drawPin();
    $('pinLabel').textContent = e.message; $('pinLabel').classList.add('err');
  } finally { busy(false); }
}
function logout(silent) {
  store.set('inv.code', null);
  CODE = ''; ME = null; DATA = null; CUR = null; closeAll();
  $('main').classList.add('hidden'); $('login').classList.remove('hidden');
  if (silent) { $('pinLabel').textContent = 'Please enter your code again'; }
}

/* ---------------- app ---------------- */
async function enterApp() {
  if (!ME.inventories.length) { logout(); $('pinLabel').textContent = 'You have no inventory yet. Ask an owner.'; $('pinLabel').classList.add('err'); return; }
  $('login').classList.add('hidden'); $('main').classList.remove('hidden');
  const last = store.get('inv.last');
  CUR = ME.inventories.some(i => i.key === last) ? last : ME.inventories[0].key;
  $('invCaret').style.display = ME.inventories.length > 1 ? '' : 'none';
  fillMonths();
  await loadInventory();
}

async function loadInventory() {
  const meta = ME.inventories.find(i => i.key === CUR);
  $('invName').textContent = meta.name;
  document.title = meta.name + ' Inventory';
  $('list').innerHTML = '<div class="empty-state">Loading…</div>';
  CAT = 'ALL'; $('search').value = '';
  DATA = await api('getInventory', { inv: CUR });
  DATA.products.forEach(p => { p.q = (p.q === null || p.q === undefined || p.q === '') ? null : Number(p.q); });
  document.body.classList.toggle('is-mgr', isMgr());
  drawChips(); render();
  $('saveStatus').textContent = 'Ready';
}

async function refresh(manual) {
  if (!DATA || !allSaved()) { if (manual) toast('Still saving, try again in a second.'); return; }
  closeAll();
  try { await loadInventory(); if (manual) toast('Up to date ✓'); } catch (e) { toast(e.message, 4000); }
}

function openInvPicker() {
  if (ME.inventories.length < 2) return;
  const lbl = r => r === 'manager' ? 'Manager' : 'Count';
  $('invList').innerHTML = ME.inventories.map(i =>
    `<button class="inv-option ${i.key === CUR ? 'on' : ''}" onclick="switchInv('${i.key}')">${esc(i.name)} <small>${lbl(i.role)}</small></button>`).join('');
  open('invSheet');
}
async function switchInv(key) {
  closeAll();
  if (key === CUR) return;
  if (!allSaved()) { toast('Still saving, try again in a second.'); return; }
  CUR = key; store.set('inv.last', key);
  try { await loadInventory(); } catch (e) { toast(e.message, 4000); }
}

function drawChips() {
  const cats = ['ALL'].concat(DATA.categories);
  $('chips').innerHTML = cats.map(c => `<button class="chip ${c === CAT ? 'on' : ''}" data-c="${esc(c)}">${c === 'ALL' ? 'All' : esc(c)}</button>`).join('');
  $('chips').onclick = e => { const c = e.target.dataset && e.target.dataset.c; if (c) { CAT = c; drawChips(); render(); } };
  $('eCat').innerHTML = DATA.categories.map(c => `<option>${esc(c)}</option>`).join('');
  $('supList').innerHTML = [...new Set(DATA.products.map(p => p.supplier).filter(Boolean))].sort().map(s => `<option value="${esc(s)}">`).join('');
}

function render() {
  if (!DATA) return;
  const q = $('search').value.trim().toLowerCase(), f = $('filter').value;
  let html = '', last = null;
  DATA.products.forEach(p => {
    if (CAT !== 'ALL' && p.category !== CAT) return;
    if (q && !(p.name + ' ' + p.supplier).toLowerCase().includes(q)) return;
    if (f === 'todo' && p.q !== null) return;
    if (f === 'done' && p.q === null) return;
    if (p.category !== last) { html += `<h2>${esc(p.category)}</h2>`; last = p.category; }
    html += `<div class="item ${p.q !== null ? 'done' : ''}" id="it-${esc(p.id)}">
      <div class="info"><div class="name">${esc(p.name)}</div>
        <div class="meta">${esc(p.supplier)}${p.supplier ? ' · ' : ''}${fmt(p.price)}</div>
        <div class="who" id="who-${esc(p.id)}">${whoLine(p)}</div>
        ${isMgr() ? `<button class="edit" onclick="openEdit('${esc(p.id)}')">Edit</button>` : ''}</div>
      <div class="qty">
        <button onclick="step('${esc(p.id)}',-1)" aria-label="minus">−</button>
        <input id="q-${esc(p.id)}" class="${p.q === null ? 'empty' : ''}" inputmode="decimal" value="${p.q === null ? '' : p.q}" placeholder="–" onchange="typed('${esc(p.id)}',this.value)" onfocus="this.select()">
        <button onclick="step('${esc(p.id)}',1)" aria-label="plus">+</button>
      </div></div>`;
  });
  if (!DATA.products.length) {
    html = `<div class="empty-state">No products in ${esc(DATA.name)} yet.${isMgr() ? '<br><br><button class="btn" onclick="openEdit(null)">＋ Add the first product</button>' : '<br>Ask a manager to add them.'}</div>`;
  } else if (!html) html = '<div class="empty-state">No products match.</div>';
  $('list').innerHTML = html;
  totals();
}

function totals() {
  const ps = DATA.products, done = ps.filter(p => p.q !== null).length;
  const b = ps.reduce((s, p) => s + (p.q || 0), 0), v = ps.reduce((s, p) => s + (p.q || 0) * p.price, 0);
  $('totBottles').textContent = num(b); $('totValue').textContent = fmt(v);
  $('counted').textContent = done + ' / ' + ps.length + ' counted';
  $('prog').style.width = (ps.length ? done / ps.length * 100 : 0) + '%';
  return { done, b, v, total: ps.length };
}

/* ---------------- who counted ---------------- */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function when(at) {            // 'yyyy-MM-dd HH:mm' → '16:42' today, else '25 Nov 16:42'
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(at || '');
  if (!m) return at || '';
  const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return (m[1] + '-' + m[2] + '-' + m[3] === today) ? m[4] : Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + m[4];
}
function whoLine(p) { return p.by ? '✓ ' + esc(p.by) + ' · ' + esc(when(p.at)) : ''; }

/* ---------------- counting ---------------- */
function setQty(id, q) {
  const p = DATA.products.find(x => x.id === id);
  p.q = q;
  const inp = $('q-' + id), it = $('it-' + id);
  if (inp) { inp.value = q === null ? '' : q; inp.classList.toggle('empty', q === null); }
  if (it) it.classList.toggle('done', q !== null);
  totals();
  clearTimeout(pending[id]);
  $('saveStatus').textContent = 'Saving…';
  const inv = CUR;
  pending[id] = setTimeout(() => save(inv, id, q, 0), 500);
}
let STEP = Number(store.get('inv.step')) === 0.1 ? 0.1 : 1;
function drawStep() { const b = $('stepBtn'); b.textContent = STEP === 1 ? '±1' : '±0.1'; b.classList.toggle('fine', STEP !== 1); }
function toggleStep() {
  STEP = STEP === 1 ? 0.1 : 1; store.set('inv.step', String(STEP)); drawStep();
  toast(STEP === 1 ? '+ and − now count whole bottles' : '+ and − now count 0.1 of a bottle');
}
function step(id, d) {
  d = d * STEP;
  const p = DATA.products.find(x => x.id === id);
  let q = (p.q === null ? 0 : p.q) + d;
  if (p.q === null && d < 0) q = 0;
  setQty(id, Math.max(0, Math.round(q * 100) / 100));
}
function typed(id, v) {
  v = String(v).replace(',', '.').trim();
  if (v === '') return setQty(id, null);
  const n = Number(v);
  if (isNaN(n) || n < 0) { toast('Please enter a number, e.g. 3 or 0.5'); return render(); }
  setQty(id, Math.round(n * 100) / 100);
}
function save(inv, id, q, tries) {
  delete pending[id]; inflight++;
  api('saveCount', { inv: inv, id: id, q: q }).then(r => {
    inflight--; if (allSaved()) $('saveStatus').textContent = 'All saved ✓';
    const p = DATA && CUR === inv && DATA.products.find(x => x.id === id);
    if (p && r && p.q === q) { p.by = r.by; p.at = r.at; const w = $('who-' + id); if (w) w.innerHTML = whoLine(p); }
  }).catch(e => {
    inflight--;
    if (/access|Wrong code/.test(e.message)) { toast(e.message, 4000); return; }
    if (tries < 5) { $('saveStatus').textContent = 'Retrying…'; setTimeout(() => save(inv, id, q, tries + 1), 2000 * (tries + 1)); }
    else { $('saveStatus').textContent = 'Not saved – check connection'; toast('Could not save. Check your connection.', 4000); }
  });
}
function allSaved() { return !inflight && !Object.keys(pending).length; }
window.addEventListener('beforeunload', e => { if (!allSaved()) { e.preventDefault(); e.returnValue = ''; } });

/* ---------------- finish ---------------- */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fillMonths() {
  const d = new Date();
  const def = new Date(d.getFullYear(), d.getMonth() - (d.getDate() <= 7 ? 1 : 0), 1); // early in the month = last month's count
  const opts = [];
  for (let i = -2; i <= 1; i++) {
    const m = new Date(def.getFullYear(), def.getMonth() + i, 1);
    opts.push(`<option ${i === 0 ? 'selected' : ''}>${MONTHS[m.getMonth()]} ${m.getFullYear()}</option>`);
  }
  $('monthSel').innerHTML = opts.join('');
  $('monthLabel').textContent = MONTHS[def.getMonth()] + ' ' + def.getFullYear();
}
function openFinish() {
  const t = totals();
  $('fInv').textContent = DATA.name;
  $('fCounted').textContent = t.done + ' / ' + t.total;
  $('fBottles').textContent = num(t.b);
  $('fValue').textContent = fmt(t.v);
  $('fBy').textContent = ME.name;
  const missing = t.total - t.done;
  $('fWarn').textContent = missing ? missing + ' products are not counted yet. They will be sent as 0.' : '';
  open('finishSheet');
}
function buildXlsx(month) {
  const ps = DATA.products;
  const aoa = [['', 'Supplier', 'Product Name', 'Q', 'H.T', 'Value']];
  ps.forEach(p => aoa.push([p.category, p.supplier, p.name, p.q === null ? 0 : p.q, p.price, null]));
  const last = ps.length + 1;
  aoa.push(['', '', 'TOTAL BOTTLES', null, 'TOTAL', null]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  let tb = 0, tv = 0;
  ps.forEach((p, i) => {
    const r = i + 2, q = p.q === null ? 0 : p.q, v = Math.round(q * p.price * 1000) / 1000;
    tb += q; tv += v;
    ws['F' + r] = { t: 'n', f: 'SUM(E' + r + '*D' + r + ')', v: v, z: '#,##0.00' };
    ws['E' + r].z = '#,##0.00';
  });
  const t = last + 1;
  ws['D' + t] = { t: 'n', f: 'SUM(D2:D' + last + ')', v: Math.round(tb * 100) / 100 };
  ws['F' + t] = { t: 'n', f: 'SUM(F2:F' + last + ')', v: Math.round(tv * 100) / 100, z: '#,##0.00' };
  ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 42 }, { wch: 8 }, { wch: 10 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return { name: DATA.name + ' Inventory - ' + month + '.xlsx', b64: XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) };
}
function downloadXlsx() {
  if (!allSaved()) return toast('Still saving, try again in a second.');
  const r = buildXlsx($('monthSel').value);
  const bytes = Uint8Array.from(atob(r.b64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const file = new File([blob], r.name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {   // phones: open the share sheet (save, WhatsApp, mail…)
    navigator.share({ files: [file], title: r.name }).catch(() => {});
    return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = r.name;
  document.body.appendChild(a); a.click(); a.remove();
}
async function send() {
  if (!allSaved()) return toast('Still saving, try again in a second.');
  const month = $('monthSel').value;
  if (!confirm('Send the ' + DATA.name + ' inventory for ' + month + ' to the office?')) return;
  const b = $('sendBtn'); b.disabled = true; b.textContent = 'Sending…';
  try {
    const x = buildXlsx(month);
    const r = await api('send', { inv: CUR, month: month, xlsx: x.b64, fileName: x.name });
    closeAll(); toast('Sent to ' + r.to + ' ✓', 4500);
  } catch (e) { toast(e.message || 'Sending failed', 4500); }
  finally { b.disabled = false; b.textContent = 'Send to office'; }
}

/* ---------------- menu ---------------- */
function openMenu() {
  $('menuName').textContent = ME.name;
  const r = role();
  $('menuRole').textContent = (ME.owner ? 'Owner' : r === 'manager' ? 'Manager' : 'Count') + ' · ' + DATA.name;
  document.querySelectorAll('.mgr-only').forEach(b => b.classList.toggle('hidden', !isMgr()));
  document.querySelectorAll('.owner-only').forEach(b => b.classList.toggle('hidden', !ME.owner));
  open('menuSheet');
}
async function resetCounts() {
  if (!confirm('Clear ALL counts in ' + DATA.name + ' to start a new month?\n\nMake sure last month was sent to the office first.')) return;
  closeAll(); busy(true);
  try { DATA = await api('resetCounts', { inv: CUR }); drawChips(); render(); toast('Counts cleared. Ready for a new month.'); }
  catch (e) { toast(e.message, 4000); } finally { busy(false); }
}

/* ---------------- products (managers) ---------------- */
function openEdit(id) {
  EDIT_ID = id;
  const p = id ? DATA.products.find(x => x.id === id) : { name: '', category: CAT !== 'ALL' ? CAT : DATA.categories[0], supplier: '', price: '' };
  $('editTitle').textContent = id ? 'Edit product' : 'Add a product to ' + DATA.name;
  $('eName').value = p.name; $('eCat').value = p.category; $('eSup').value = p.supplier; $('ePrice').value = p.price;
  $('removeBtn').classList.toggle('hidden', !id); $('removeHint').classList.toggle('hidden', !id);
  open('editSheet');
}
async function saveEdit() {
  const p = { id: EDIT_ID, name: $('eName').value.trim(), category: $('eCat').value, supplier: $('eSup').value.trim(),
              price: Number(String($('ePrice').value).replace(',', '.')) || 0 };
  if (!p.name) return toast('Please enter a product name.');
  if (!allSaved()) return toast('Still saving, try again in a second.');
  const b = $('eSave'); b.disabled = true;
  try {
    DATA = await api(EDIT_ID ? 'updateProduct' : 'addProduct', { inv: CUR, product: p });
    closeAll(); drawChips(); render(); toast(EDIT_ID ? 'Saved ✓' : 'Product added ✓');
  } catch (e) { toast(e.message, 4000); } finally { b.disabled = false; }
}
async function removeProduct() {
  const p = DATA.products.find(x => x.id === EDIT_ID);
  if (!confirm('Remove "' + p.name + '" from ' + DATA.name + '?')) return;
  if (!allSaved()) return toast('Still saving, try again in a second.');
  busy(true);
  try { DATA = await api('removeProduct', { inv: CUR, id: EDIT_ID }); closeAll(); drawChips(); render(); toast('Removed'); }
  catch (e) { toast(e.message, 4000); } finally { busy(false); }
}

/* ---------------- my code ---------------- */
function openChangeCode() { $('cNew').value = ''; $('cNew2').value = ''; open('codeSheet'); }
async function changeCode() {
  const n = $('cNew').value.trim(), n2 = $('cNew2').value.trim();
  if (n.length < 4) return toast('The new code needs at least 4 characters.');
  if (n !== n2) return toast('The two codes are different.');
  const b = $('cBtn'); b.disabled = true;
  try { await api('changeMyCode', { newCode: n }); CODE = n; store.set('inv.code', n); closeAll(); toast('Code changed ✓'); }
  catch (e) { toast(e.message, 4000); } finally { b.disabled = false; }
}

/* ---------------- team (owners) ---------------- */
const INV_NAMES = { 'zoutra': 'Zoutra', 'adraba-wine': 'Adraba Wine', 'adraba-alcohol': 'Adraba Alcohol' };
async function openTeam() {
  busy(true);
  try { TEAM = await api('listUsers'); drawTeam(); open('teamSheet'); }
  catch (e) { toast(e.message, 4000); } finally { busy(false); }
}
function roleSummary(u) {
  if (u.owner) return 'Owner · all inventories';
  const parts = Object.keys(INV_NAMES).filter(k => u.roles[k]).map(k => INV_NAMES[k] + ': ' + (u.roles[k] === 'manager' ? 'Manager' : 'Count'));
  return parts.length ? parts.join(' · ') : 'No access yet';
}
function drawTeam() {
  $('teamList').innerHTML = TEAM.map((u, i) =>
    `<button class="member" onclick="openMember(${i})"><span><b>${esc(u.name)}</b><small>${esc(roleSummary(u))}</small></span><span>›</span></button>`).join('')
    || '<p class="muted">No team members yet.</p>';
}
function openMember(i) {
  MEMBER = i === null ? { name: '', code: '', owner: false, roles: {} } : JSON.parse(JSON.stringify(TEAM[i]));
  MEMBER.originalName = i === null ? null : TEAM[i].name;
  $('mTitle').textContent = i === null ? 'Add a team member' : 'Edit ' + MEMBER.name;
  $('mName').value = MEMBER.name; $('mCode').value = MEMBER.code; $('mOwner').checked = MEMBER.owner;
  $('mRemove').classList.toggle('hidden', i === null || MEMBER.name === ME.name);
  drawRoles(); open('memberSheet');
}
function drawRoles() {
  const opts = [['', 'None'], ['count', 'Count'], ['manager', 'Manager']];
  $('mRoles').innerHTML = Object.keys(INV_NAMES).map(k =>
    `<div class="role-row"><div class="rname">${INV_NAMES[k]}</div>
      <div class="seg ${MEMBER.owner ? 'disabled' : ''}">${opts.map(([v, l]) =>
        `<button class="${(MEMBER.owner ? 'manager' : (MEMBER.roles[k] || '')) === v ? 'on' : ''}" onclick="setRole('${k}','${v}')">${l}</button>`).join('')}</div></div>`).join('');
}
function setRole(k, v) { MEMBER.roles[k] = v; drawRoles(); }
function ownerToggle() { MEMBER.owner = $('mOwner').checked; drawRoles(); }
async function saveMember() {
  MEMBER.name = $('mName').value.trim(); MEMBER.code = $('mCode').value.trim(); MEMBER.owner = $('mOwner').checked;
  if (!MEMBER.name) return toast('Please enter a name.');
  if (MEMBER.code.length < 4) return toast('The code needs at least 4 characters.');
  const b = $('mSave'); b.disabled = true;
  try {
    TEAM = await api('saveUser', { user: MEMBER });
    if (MEMBER.originalName === ME.name) { // my own row changed
      if (MEMBER.code !== CODE) { CODE = MEMBER.code; store.set('inv.code', CODE); }
      ME = await api('login');
    }
    drawTeam(); open('teamSheet'); toast('Saved ✓');
  } catch (e) { toast(e.message, 4000); } finally { b.disabled = false; }
}
async function removeMember() {
  if (!confirm('Remove ' + MEMBER.originalName + ' from the team? Their code will stop working.')) return;
  busy(true);
  try { TEAM = await api('removeUser', { name: MEMBER.originalName }); drawTeam(); open('teamSheet'); toast('Removed'); }
  catch (e) { toast(e.message, 4000); } finally { busy(false); }
}

/* ---------------- activity (owners) ---------------- */
const INV_KEYS = { 'Zoutra': 'zoutra', 'Adraba Wine': 'adraba-wine', 'Adraba Alcohol': 'adraba-alcohol' };
async function openActivity() {
  $('aInv').innerHTML = '<option value="">All inventories</option>' + Object.keys(INV_NAMES).map(k => `<option value="${k}">${INV_NAMES[k]}</option>`).join('');
  $('activityList').innerHTML = '<p class="muted">Loading…</p>';
  open('activitySheet');
  await loadActivity(true);
}
async function loadActivity(first) {
  const person = $('aPerson').value, inv = $('aInv').value;
  try {
    const r = await api('listActivity', { person: person, inv: inv, limit: 300 });
    if (first) {
      $('aPerson').innerHTML = '<option value="">Everyone</option>' + r.people.map(n => `<option>${esc(n)}</option>`).join('');
      $('aPerson').value = person;
    }
    let html = '', day = null;
    r.rows.forEach(x => {
      if (x.date !== day) { day = x.date; html += `<div class="act-day">${esc(dayLabel(x.date))}</div>`; }
      html += `<div class="act"><div class="t">${esc(x.time)}</div><div class="a"><b>${esc(x.person)}</b> · ${esc(x.action)}${x.product ? ' · ' + esc(x.product) : ''}
        <div class="d">${x.inv ? esc(x.inv) : 'Team'}${x.details ? ' · ' + esc(x.details) : ''}</div></div></div>`;
    });
    $('activityList').innerHTML = html || '<p class="muted">Nothing yet.</p>';
  } catch (e) { $('activityList').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; }
}
function dayLabel(d) {
  const t = when(d + ' 00:00');
  return /^\d{2}:\d{2}$/.test(t) ? 'Today' : t.replace(' 00:00', '');
}

/* ---------------- start ---------------- */
document.addEventListener('visibilitychange', () => {   // back to the app: pick up counts made on other phones
  if (document.visibilityState === 'visible' && DATA && allSaved() && !document.querySelector('.sheet.open')) refresh(false);
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

(async function start() {
  buildKeypad(); drawPin(); drawStep();
  const saved = store.get('inv.code');
  if (!saved) return;
  CODE = saved; busy(true);
  try { ME = await api('login'); await enterApp(); }
  catch (e) { if (/Wrong code/.test(e.message)) logout(true); else { $('pinLabel').textContent = e.message; } }
  finally { busy(false); }
})();
