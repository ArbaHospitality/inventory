/* Inventory app – phone front end. Talks to the Apps Script API in config.js. Texts are in i18n.js. */

let TOKEN = '', ME = null, CUR = null, DATA = null, CAT = 'ALL', EDIT_ID = null;
let TEAM = [], MEMBER = null, RESET = null;
const pending = {};
const LOCALQ = {};   // counts typed on this phone that the server has not confirmed yet
let inflight = 0;

const $ = id => document.getElementById(id);
const store = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} }
};
const locale = () => LANG === 'he' ? 'he-IL' : LANG === 'fr' ? 'fr-FR' : 'en-GB';
const iso = s => '\u2066' + s + '\u2069';   // keeps numbers left-to-right inside Hebrew text
const fmt = n => iso((Math.round(n * 100) / 100).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '\u00a0€');
const num = n => iso((Math.round(n * 100) / 100).toLocaleString(locale()));
let STATUS = 'ready';
function setStatus(k) { STATUS = k; $('saveStatus').textContent = t(k); }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(el._h); el._h = setTimeout(() => el.classList.remove('show'), ms || 2400); }
function busy(on) { $('busy').classList.toggle('hidden', !on); }
function closeSheet(e, el) { if (e.target === el) el.classList.remove('open'); }
function closeAll() { document.querySelectorAll('.sheet.open').forEach(s => s.classList.remove('open')); }
function open(id) { closeAll(); $(id).classList.add('open'); }
const meta = () => (ME && CUR) ? ME.inventories.find(i => i.key === CUR) || {} : {};
const role = () => meta().role || '';
const isMgr = () => role() === 'manager';
const isFood = () => !!(DATA && DATA.food);
const restOf = name => (ME && ME.restaurants || []).find(r => r.name === name) || { name: name, colour: '#1e4d2b', logo: '' };
const roleText = r => r === 'manager' ? t('manager') : r === 'count' ? t('count') : t('none');

async function api(action, params) {
  const body = JSON.stringify(Object.assign({ action: action, token: TOKEN }, params || {}));
  let res;
  try { res = await fetch(API_URL, { method: 'POST', body: body }); }
  catch (e) { throw new Error(t('noConn')); }
  let j;
  try { j = await res.json(); } catch (e) { throw new Error(t('badServer')); }
  if (!j.ok) {
    const msg = tServer(String(j.error || 'Something went wrong.').replace(/^AUTH: /, ''));
    if (j.auth) { logout(true); showAuth('login', msg); }
    throw new Error(msg);
  }
  return j.data;
}

/* ---------------- language ---------------- */
function drawLangPickers() {
  ['loginLang', 'menuLang'].forEach(id => {
    $(id).innerHTML = Object.keys(LANGS).map(l =>
      `<button type="button" class="${l === LANG ? 'on' : ''}" onclick="setLang('${l}')">${l === 'he' ? 'עב' : l.toUpperCase()}</button>`).join('');
  });
}
function setLang(l) {
  LANG = l; store.set('inv.lang', l);
  applyTexts(); drawLangPickers(); drawStep();
  if (DATA) { fillMonths(); drawHeader(); drawChips(); render(); setStatus(STATUS); }
  if (!$('login').classList.contains('hidden')) { $('authMsg').textContent = ''; $('authMsg').className = 'auth-msg'; }
  if ($('menuSheet').classList.contains('open')) openMenu();
}

/* ---------------- login / register / forgot / reset ---------------- */
function showAuth(pane, msg, ok) {
  ['login', 'register', 'forgot', 'reset', 'done'].forEach(p => $('a-' + p).classList.toggle('hidden', p !== pane));
  const m = $('authMsg'); m.textContent = msg || ''; m.className = 'auth-msg' + (msg ? (ok ? ' ok' : ' err') : '');
  $('main').classList.add('hidden'); $('login').classList.remove('hidden');
  document.querySelector('meta[name=theme-color]').content = '#1e4d2b';
}
function authBusy(btn, on, label) { btn.disabled = on; if (on) { btn._t = btn.textContent; btn.textContent = label || t('pleaseWait'); } else if (btn._t) btn.textContent = btn._t; }
function deviceName() { const u = navigator.userAgent; return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : 'Computer'; }

async function doLogin() {
  const email = $('lEmail').value.trim(), password = $('lPass').value;
  if (!email || !password) return showAuth('login', t('errEmailPw'));
  const b = $('lBtn'); authBusy(b, true, t('loggingIn'));
  try {
    const r = await api('login', { email: email, password: password, device: deviceName(), inv: store.get('inv.last') || '' });
    TOKEN = r.token; ME = r.me; store.set('inv.token', TOKEN); store.set('inv.email', email); saveMe();
    $('lPass').value = '';
    enterApp(r.inventory);
  } catch (e) { showAuth('login', e.message); } finally { authBusy(b, false); }
}
async function doRegister() {
  const name = $('rName').value.trim(), email = $('rEmail').value.trim(), p1 = $('rPass').value, p2 = $('rPass2').value;
  if (!name || !email) return showAuth('register', t('errNameEmail'));
  if (p1.length < 10) return showAuth('register', t('errPwLen'));
  if (p1 !== p2) return showAuth('register', t('errPwDiff'));
  const b = $('rBtn'); authBusy(b, true, t('sending'));
  try {
    await api('register', { name: name, email: email, password: p1 });
    store.set('inv.email', email); $('lEmail').value = email; $('rPass').value = $('rPass2').value = '';
    $('doneText').textContent = t('doneRegister', { name: name });
    showAuth('done');
  } catch (e) { showAuth('register', e.message); } finally { authBusy(b, false); }
}
async function doForgot() {
  const email = $('fEmail').value.trim();
  if (!email) return showAuth('forgot', t('errEmail'));
  const b = $('fBtn'); authBusy(b, true, t('sending'));
  try {
    await api('forgot', { email: email });
    $('doneText').textContent = t('doneForgot', { email: email });
    showAuth('done');
  } catch (e) { showAuth('forgot', e.message); } finally { authBusy(b, false); }
}
async function doReset() {
  const p1 = $('xPass').value, p2 = $('xPass2').value;
  if (p1.length < 10) return showAuth('reset', t('errPwLen'));
  if (p1 !== p2) return showAuth('reset', t('errPwDiff'));
  const b = $('xBtn'); authBusy(b, true, t('savingBtn'));
  try {
    const r = await api('resetPassword', { email: RESET.email, token: RESET.token, password: p1 });
    $('lEmail').value = RESET.email; store.set('inv.email', RESET.email); RESET = null;
    $('xPass').value = $('xPass2').value = '';
    showAuth('login', r.status === 'Pending' ? t('pwSavedPending') : t('pwSaved'), true);
  } catch (e) { showAuth('reset', e.message); } finally { authBusy(b, false); }
}
function logout(silent) {
  if (!silent && TOKEN) api('logout').catch(() => {});
  store.set('inv.token', null); clearSaved();
  TOKEN = ''; ME = null; DATA = null; CUR = null; closeAll();
  showAuth('login');
}

/* ---------------- app ---------------- */
/* What was last shown is kept on this phone, so the app opens instantly and then refreshes.
   (Product names, prices and counts only; cleared on log out.) */
function saveMe() { store.set('inv.me', JSON.stringify(ME)); }
let saveTimer = null;
function saveData() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (DATA) store.set('inv.data.' + DATA.key, JSON.stringify(DATA)); }, 800); }
function savedData(key) { try { return JSON.parse(store.get('inv.data.' + key) || 'null'); } catch (e) { return null; } }
function clearSaved() {
  store.set('inv.me', null);
  try { Object.keys(localStorage).filter(k => k.indexOf('inv.data.') === 0).forEach(k => localStorage.removeItem(k)); } catch (e) {}
}

/** Shows an inventory; counts typed here and not yet confirmed by the server are kept. */
function showInventory(d, fromServer) {
  d.products.forEach(p => { p.q = (p.q === null || p.q === undefined || p.q === '') ? null : Number(p.q); });
  if (fromServer) d.products.forEach(p => { const l = LOCALQ[d.key + '|' + p.id]; if (l !== undefined) p.q = l; });
  const typing = document.activeElement && document.activeElement.id && document.activeElement.id.indexOf('q-') === 0;
  const same = DATA && DATA.key === d.key;
  const scroll = window.scrollY;
  DATA = d;
  document.body.classList.toggle('is-mgr', isMgr());
  if (typing && same) {   // don't redraw under the person's finger: update numbers only
    d.products.forEach(p => { const el = $('q-' + p.id); if (el && el !== document.activeElement) { el.value = p.q === null ? '' : p.q; el.classList.toggle('empty', p.q === null); } });
    totals();
  } else {
    if (!same) { CAT = 'ALL'; $('search').value = ''; }
    drawChips(); render();
    if (same) window.scrollTo(0, scroll);
  }
  if (fromServer) saveData();
}

function enterApp(preloaded) {
  if (!ME.inventories.length) { logout(true); showAuth('login', t('noInventory')); return; }
  $('login').classList.add('hidden'); $('main').classList.remove('hidden');
  const last = store.get('inv.last');
  CUR = ME.inventories.some(i => i.key === last) ? last : ME.inventories[0].key;
  $('invCaret').style.display = ME.inventories.length > 1 ? '' : 'none';
  fillMonths(); drawHeader();
  if (preloaded && preloaded.key === CUR) { showInventory(preloaded, true); setStatus('ready'); return; }
  loadInventory().catch(e => toast(e.message, 4000));
}

function setLogo(el, rest) {
  el.className = 'mark' + (rest.logo ? '' : ' letter');
  el.style.setProperty('--logo', rest.logo ? `url(logos/${rest.logo}.png)` : 'none');
  el.textContent = rest.logo ? '' : rest.name.slice(0, 1);
}
function drawHeader() {
  const m = meta(), rest = restOf(m.restaurant);
  document.documentElement.style.setProperty('--brand', rest.colour);
  document.querySelector('meta[name=theme-color]').content = rest.colour;
  setLogo($('hdrLogo'), rest);
  $('restName').textContent = rest.name;
  $('invType').textContent = tType(m.type);
  document.title = m.name + ' · Inventory';
}

async function loadInventory() {
  drawHeader();
  const key = CUR, saved = savedData(key);
  if (saved) showInventory(saved, false);           // instant: last known list
  else { $('list').innerHTML = '<div class="empty-state">…</div>'; DATA = null; }
  const d = await api('getInventory', { inv: key });
  if (CUR === key) { showInventory(d, true); setStatus(allSaved() ? 'ready' : STATUS); }
}

async function refresh(manual) {
  if (!DATA || !allSaved()) { if (manual) toast(t('stillSaving')); return; }
  closeAll();
  try { await loadInventory(); if (manual) toast(t('upToDate')); } catch (e) { toast(e.message, 4000); }
}

function openInvPicker() {
  if (ME.inventories.length < 2) return;
  $('invList').innerHTML = ME.restaurants.map(r => {
    const invs = ME.inventories.filter(i => i.restaurant === r.name);
    return `<div class="rest"><div class="rest-head" style="background:${esc(r.colour)}"><span class="mark" data-r="${esc(r.name)}"></span>${esc(r.name)}</div>
      <div class="rest-invs">${invs.map(i => `<button class="inv-option ${i.key === CUR ? 'on' : ''}" onclick="switchInv('${esc(i.key)}')">
        ${esc(tType(i.type))} <small>${esc(roleText(i.role))}</small></button>`).join('')}</div></div>`;
  }).join('');
  $('invList').querySelectorAll('.mark[data-r]').forEach(el => setLogo(el, restOf(el.dataset.r)));
  open('invSheet');
}
async function switchInv(key) {
  closeAll();
  if (key === CUR) return;
  if (!allSaved()) { toast(t('stillSaving')); return; }
  CUR = key; store.set('inv.last', key);
  try { await loadInventory(); } catch (e) { toast(e.message, 4000); }
}

function drawChips() {
  const cats = ['ALL'].concat(DATA.categories);
  $('chips').innerHTML = cats.map(c => `<button class="chip ${c === CAT ? 'on' : ''}" data-c="${esc(c)}">${c === 'ALL' ? t('all') : esc(c)}</button>`).join('');
  $('chips').onclick = e => { const c = e.target.dataset && e.target.dataset.c; if (c) { CAT = c; drawChips(); render(); } };
  $('eCat').innerHTML = DATA.categories.map(c => `<option>${esc(c)}</option>`).join('');
  $('supList').innerHTML = [...new Set(DATA.products.map(p => p.supplier).filter(Boolean))].sort().map(s => `<option value="${esc(s)}">`).join('');
}

function priceLine(p) { return fmt(p.price) + (isFood() ? ' / ' + esc(tUnit(p.unit)) : ''); }
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
    const id = esc(p.id);
    html += `<div class="item ${p.q !== null ? 'done' : ''}" id="it-${id}">
      <div class="info"><div class="name">${esc(p.name)}</div>
        <div class="meta">${esc(p.supplier)}${p.supplier ? ' · ' : ''}${priceLine(p)}</div>
        <div class="who" id="who-${id}">${whoLine(p)}</div>
        ${isMgr() ? `<button class="edit" onclick="openEdit('${id}')">${t('edit')}</button>` : ''}</div>
      <div class="qty">
        <button onclick="step('${id}',-1)" aria-label="minus">−</button>
        <div class="box"><input id="q-${id}" class="${p.q === null ? 'empty' : ''}" inputmode="decimal" value="${p.q === null ? '' : p.q}" placeholder="–" onchange="typed('${id}',this.value)" onfocus="this.select()">
          ${isFood() ? `<span class="u">${esc(tUnit(p.unit))}</span>` : ''}</div>
        <button class="plus" onclick="step('${id}',1)" aria-label="plus">+</button>
      </div></div>`;
  });
  if (!DATA.products.length) {
    html = `<div class="empty-state">${esc(t('noProducts', { inv: tType(DATA.type) }))}${isMgr() ? `<br><br><button class="btn" onclick="openEdit(null)">${t('addFirst')}</button>` : '<br>' + t('askManager')}</div>`;
  } else if (!html) html = `<div class="empty-state">${t('noMatch')}</div>`;
  $('list').innerHTML = html;
  totals();
}

function totals() {
  const ps = DATA.products, done = ps.filter(p => p.q !== null).length;
  const b = ps.reduce((s, p) => s + (p.q || 0), 0), v = ps.reduce((s, p) => s + (p.q || 0) * p.price, 0);
  $('totLine').innerHTML = isFood() ? `<b>${fmt(v)}</b>` : `<b>${num(b)}</b> ${t('bottles')} · <b>${fmt(v)}</b>`;
  $('counted').textContent = t('counted', { n: done, t: ps.length });
  $('prog').style.width = (ps.length ? done / ps.length * 100 : 0) + '%';
  $('nextBtn').classList.toggle('hidden', !ps.length || done === ps.length);
  return { done, b, v, total: ps.length };
}

/** Scrolls to the next product that has not been counted yet (after the one on screen). */
function nextUncounted(fromId) {
  const todo = DATA.products.filter(p => p.q === null);
  if (!todo.length) return toast(t('allCounted'));
  if ($('filter').value === 'done' || CAT !== 'ALL' || $('search').value) {
    if (!document.getElementById('it-' + todo[0].id)) { $('filter').value = 'all'; $('search').value = ''; CAT = 'ALL'; drawChips(); render(); }
  }
  let target = null;
  if (!fromId) {
    const y = 200;   // first uncounted below the header, else the first one
    target = todo.find(p => { const el = $('it-' + p.id); return el && el.getBoundingClientRect().top > y; }) || todo[0];
  } else target = todo.find(p => p.id === fromId) || todo[0];
  const el = $('it-' + target.id);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* ---------------- who counted ---------------- */
function when(at) {            // 'yyyy-MM-dd HH:mm' → '16:42' today, else '25 Nov 16:42'
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})/.exec(at || '');
  if (!m) return at || '';
  const d = new Date(), today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return iso((m[1] + '-' + m[2] + '-' + m[3] === today) ? m[4] : Number(m[3]) + ' ' + t('mon')[Number(m[2]) - 1] + ' ' + m[4]);
}
function whoLine(p) { return p.by ? '✓ ' + esc(p.by) + ' · ' + esc(when(p.at)) : ''; }

/* ---------------- counting ---------------- */
function setQty(id, q) {
  const p = DATA.products.find(x => x.id === id);
  p.q = q; LOCALQ[CUR + '|' + id] = q;
  const inp = $('q-' + id), it = $('it-' + id);
  if (inp) { inp.value = q === null ? '' : q; inp.classList.toggle('empty', q === null); }
  if (it) it.classList.toggle('done', q !== null);
  totals();
  clearTimeout(pending[id]);
  setStatus('saving');
  const inv = CUR;
  pending[id] = setTimeout(() => save(inv, id, q, 0), 500);
}
let STEP = Number(store.get('inv.step')) === 0.1 ? 0.1 : 1;
function drawStep() { const b = $('stepBtn'); b.textContent = STEP === 1 ? '±1' : '±0.1'; b.classList.toggle('fine', STEP !== 1); }
function toggleStep() { STEP = STEP === 1 ? 0.1 : 1; store.set('inv.step', String(STEP)); drawStep(); toast(STEP === 1 ? t('stepWhole') : t('stepFine')); }
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
  if (isNaN(n) || n < 0) { toast(t('enterNumber')); return render(); }
  setQty(id, Math.round(n * 100) / 100);
}
function save(inv, id, q, tries) {
  delete pending[id]; inflight++;
  api('saveCount', { inv: inv, id: id, q: q }).then(r => {
    inflight--; if (allSaved()) setStatus('allSaved');
    if (LOCALQ[inv + '|' + id] === q) delete LOCALQ[inv + '|' + id];
    const p = DATA && CUR === inv && DATA.products.find(x => x.id === id);
    if (DATA && CUR === inv) saveData();
    if (p && r && p.q === q) { p.by = r.by; p.at = r.at; const w = $('who-' + id); if (w) w.innerHTML = whoLine(p); }
  }).catch(e => {
    inflight--;
    if (!TOKEN) return;
    if (/access|accès|גישה/.test(e.message)) { toast(e.message, 4000); return; }
    if (tries < 5) { setStatus('retrying'); setTimeout(() => save(inv, id, q, tries + 1), 2000 * (tries + 1)); }
    else { setStatus('notSaved'); toast(t('couldNotSave'), 4000); }
  });
}
function allSaved() { return !inflight && !Object.keys(pending).length; }
window.addEventListener('beforeunload', e => { if (!allSaved()) { e.preventDefault(); e.returnValue = ''; } });

/* ---------------- finish ---------------- */
const MONTHS_EN = TEXT.en.months;
function fillMonths() {
  const d = new Date();
  const def = new Date(d.getFullYear(), d.getMonth() - (d.getDate() <= 7 ? 1 : 0), 1); // early in the month = last month's count
  const opts = [];
  for (let i = -2; i <= 1; i++) {
    const m = new Date(def.getFullYear(), def.getMonth() + i, 1), v = MONTHS_EN[m.getMonth()] + ' ' + m.getFullYear();
    opts.push(`<option value="${v}" ${i === 0 ? 'selected' : ''}>${tMonth(v)}</option>`);
  }
  const keep = $('monthSel').value;
  $('monthSel').innerHTML = opts.join('');
  if (keep && opts.some(o => o.includes('"' + keep + '"'))) $('monthSel').value = keep;
  $('monthLabel').textContent = tMonth(MONTHS_EN[def.getMonth()] + ' ' + def.getFullYear());
}
function openFinish() {
  const s = totals(), m = meta();
  $('fInv').textContent = restOf(m.restaurant).name + ' · ' + tType(m.type);
  $('fCounted').textContent = s.done + ' / ' + s.total;
  $('fBottlesRow').classList.toggle('hidden', isFood());
  $('fBottles').textContent = num(s.b);
  $('fValue').textContent = fmt(s.v);
  $('fBy').textContent = ME.name;
  const todo = DATA.products.filter(p => p.q === null);
  $('fMissing').innerHTML = todo.length ? `<div class="missing"><p>${esc(t('notCountedList', { n: todo.length }))}</p>${todo.slice(0, 40).map(p =>
    `<button onclick="closeAll(); nextUncounted('${esc(p.id)}')">${esc(p.name)} <small>· ${esc(p.category)}</small></button>`).join('')}${todo.length > 40 ? '<button disabled>…</button>' : ''}</div>` : '';
  open('finishSheet');
  loadXlsx().catch(() => {});   // get the Excel tool ready while the person reads
}
let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  return xlsxLoading || (xlsxLoading = new Promise((ok, no) => {
    const sc = document.createElement('script'); sc.src = 'xlsx.full.min.js';
    sc.onload = ok; sc.onerror = () => { xlsxLoading = null; no(new Error(t('noConn'))); };
    document.head.appendChild(sc);
  }));
}
async function buildXlsx(month) {
  await loadXlsx();
  const ps = DATA.products, food = isFood();
  // columns: (Category) | Supplier | Product Name | [Unit] | Q | H.T | Value
  const head = ['', 'Supplier', 'Product Name'].concat(food ? ['Unit'] : []).concat(['Q', 'H.T', 'Value']);
  const C = food ? { q: 'E', p: 'F', v: 'G' } : { q: 'D', p: 'E', v: 'F' };
  const aoa = [head];
  ps.forEach(p => aoa.push([p.category, p.supplier, p.name].concat(food ? [p.unit] : []).concat([p.q === null ? 0 : p.q, p.price, null])));
  const last = ps.length + 1;
  aoa.push(['', '', food ? '' : 'TOTAL BOTTLES'].concat(food ? [''] : []).concat([null, 'TOTAL', null]));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  let tb = 0, tv = 0;
  ps.forEach((p, i) => {
    const r = i + 2, q = p.q === null ? 0 : p.q, v = Math.round(q * p.price * 1000) / 1000;
    tb += q; tv += v;
    ws[C.v + r] = { t: 'n', f: 'SUM(' + C.p + r + '*' + C.q + r + ')', v: v, z: '#,##0.00' };
    ws[C.p + r].z = '#,##0.00';
  });
  const tr = last + 1;
  if (!food) ws[C.q + tr] = { t: 'n', f: 'SUM(' + C.q + '2:' + C.q + last + ')', v: Math.round(tb * 100) / 100 };
  ws[C.v + tr] = { t: 'n', f: 'SUM(' + C.v + '2:' + C.v + last + ')', v: Math.round(tv * 100) / 100, z: '#,##0.00' };
  ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 42 }].concat(food ? [{ wch: 8 }] : []).concat([{ wch: 8 }, { wch: 10 }, { wch: 12 }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return { name: DATA.name + ' Inventory - ' + month + '.xlsx', b64: XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) };
}
async function downloadXlsx() {
  if (!allSaved()) return toast(t('stillSaving'));
  let r;
  try { r = await buildXlsx($('monthSel').value); } catch (e) { return toast(e.message, 4000); }
  const bytes = Uint8Array.from(atob(r.b64), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const file = new File([blob], r.name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file], title: r.name }).catch(() => {}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = r.name;
  document.body.appendChild(a); a.click(); a.remove();
}
async function send() {
  if (!allSaved()) return toast(t('stillSaving'));
  const month = $('monthSel').value;
  if (!confirm(t('confirmSend', { inv: DATA.name, month: tMonth(month) }))) return;
  const b = $('sendBtn'); b.disabled = true; b.textContent = t('sending');
  try {
    const x = await buildXlsx(month);
    const r = await api('send', { inv: CUR, month: month, xlsx: x.b64 });
    closeAll(); toast(t('sentTo', { to: r.to }), 4500);
  } catch (e) { toast(e.message || t('sendFailed'), 4500); }
  finally { b.disabled = false; b.textContent = t('sendOffice'); }
}

/* ---------------- menu ---------------- */
function openMenu() {
  $('menuName').textContent = ME.name;
  const m = meta();
  $('menuRole').textContent = (ME.owner ? t('owner') : roleText(role())) + ' · ' + restOf(m.restaurant).name + ' · ' + tType(m.type);
  document.querySelectorAll('.mgr-only').forEach(b => b.classList.toggle('hidden', !isMgr()));
  document.querySelectorAll('.owner-only').forEach(b => b.classList.toggle('hidden', !ME.owner));
  drawLangPickers();
  open('menuSheet');
}
async function resetCounts() {
  if (!confirm(t('confirmReset', { inv: DATA.name }))) return;
  closeAll(); busy(true);
  try { showInventory(await api('resetCounts', { inv: CUR }), true); drawChips(); render(); toast(t('countsCleared')); }
  catch (e) { toast(e.message, 4000); } finally { busy(false); }
}

/* ---------------- products (managers) ---------------- */
function drawPriceLabel() { $('ePriceLbl').textContent = isFood() ? t('pricePer') + ' ' + tUnit($('eUnit').value) : t('priceHT'); }
function openEdit(id) {
  EDIT_ID = id;
  const p = id ? DATA.products.find(x => x.id === id)
               : { name: '', category: CAT !== 'ALL' ? CAT : DATA.categories[0], supplier: '', price: '', unit: isFood() ? 'kg' : '' };
  $('editTitle').textContent = id ? t('editProduct') : t('addProductTo', { inv: DATA.name });
  $('eName').value = p.name; $('eCat').value = p.category; $('eSup').value = p.supplier; $('ePrice').value = p.price;
  $('eUnitWrap').classList.toggle('hidden', !isFood());
  $('eUnit').innerHTML = (DATA.units || []).map(u => `<option value="${u}">${esc(tUnit(u))}</option>`).join('');
  if (isFood()) $('eUnit').value = p.unit || 'kg';
  drawPriceLabel();
  $('removeBtn').classList.toggle('hidden', !id); $('removeHint').classList.toggle('hidden', !id);
  open('editSheet');
}
async function saveEdit() {
  const p = { id: EDIT_ID, name: $('eName').value.trim(), category: $('eCat').value, supplier: $('eSup').value.trim(),
              price: Number(String($('ePrice').value).replace(',', '.')) || 0, unit: isFood() ? $('eUnit').value : '' };
  if (!p.name) return toast(t('enterProductName'));
  if (!allSaved()) return toast(t('stillSaving'));
  const b = $('eSave'); b.disabled = true;
  try {
    showInventory(await api(EDIT_ID ? 'updateProduct' : 'addProduct', { inv: CUR, product: p }), true);
    closeAll(); drawChips(); render(); toast(EDIT_ID ? t('saved') : t('productAdded'));
  } catch (e) { toast(e.message, 4000); } finally { b.disabled = false; }
}
async function removeProduct() {
  const p = DATA.products.find(x => x.id === EDIT_ID);
  if (!confirm(t('confirmRemoveProduct', { name: p.name, inv: DATA.name }))) return;
  if (!allSaved()) return toast(t('stillSaving'));
  busy(true);
  try { showInventory(await api('removeProduct', { inv: CUR, id: EDIT_ID }), true); closeAll(); drawChips(); render(); toast(t('removed')); }
  catch (e) { toast(e.message, 4000); } finally { busy(false); }
}

/* ---------------- my password ---------------- */
function openChangePass() { $('cCur').value = $('cNew').value = $('cNew2').value = ''; pwHint($('cNew')); open('codeSheet'); }
async function changePass() {
  const cur = $('cCur').value, n = $('cNew').value, n2 = $('cNew2').value;
  if (n.length < 10) return toast(t('errPwLen'));
  if (n !== n2) return toast(t('errPwDiff'));
  const b = $('cBtn'); b.disabled = true;
  try { await api('changePassword', { current: cur, password: n }); closeAll(); toast(t('pwChanged'), 3500); }
  catch (e) { toast(e.message, 4000); } finally { b.disabled = false; }
}

/* ---------------- team (owners) ---------------- */
async function openTeam() {
  busy(true);
  try { TEAM = await api('listUsers'); drawTeam(); open('teamSheet'); }
  catch (e) { toast(e.message, 4000); } finally { busy(false); }
}
function roleSummary(u) {
  if (u.owner) return t('ownerAll');
  const parts = ME.inventories.filter(i => u.roles[i.key]).map(i => i.name + ': ' + roleText(u.roles[i.key]));
  return parts.length ? parts.join(' · ') : t('noAccess');
}
function memberBtn(u) {
  const i = TEAM.indexOf(u);
  const tag = u.status === 'Blocked' ? ` <span class="tag red">${t('blocked')}</span>` : '';
  const sub = u.status === 'Pending' ? `<span dir="ltr">${esc(u.email)}</span> · ${esc(t('asked', { when: when(u.created) }))}`
                                      : esc(roleSummary(u)) + (u.hasPassword ? '' : ' · ' + t('noPwYet'));
  return `<button class="member" onclick="openMember(${i})"><span><b>${esc(u.name)}${tag}</b><small>${sub}</small></span><span>›</span></button>`;
}
function drawTeam() {
  const pend = TEAM.filter(u => u.status === 'Pending'), rest = TEAM.filter(u => u.status !== 'Pending');
  $('teamList').innerHTML =
    (pend.length ? `<div class="team-head">${t('waiting', { n: pend.length })}</div>` + pend.map(memberBtn).join('') : '') +
    (pend.length ? `<div class="team-head">${t('teamHead')}</div>` : '') + (rest.map(memberBtn).join('') || `<p class="muted">${t('noTeam')}</p>`);
}
function openMember(i) {
  MEMBER = JSON.parse(JSON.stringify(TEAM[i]));
  const pend = MEMBER.status === 'Pending', mine = MEMBER.email === ME.email;
  $('mTitle').textContent = pend ? t('approveQ', { name: MEMBER.name }) : MEMBER.name;
  $('mName').value = MEMBER.name; $('mEmail').textContent = MEMBER.email; $('mOwner').checked = MEMBER.owner;
  $('mNameWrap').classList.toggle('hidden', pend);
  $('mHint').textContent = pend ? t('approveHint', { name: MEMBER.name }) : '';
  $('mSave').textContent = pend ? t('approve') : t('save');
  $('mRemove').textContent = pend ? t('rejectReq') : t('removeTeam');
  $('mRemove').classList.toggle('hidden', mine);
  $('mBlock').textContent = MEMBER.status === 'Blocked' ? t('unblock') : t('block');
  $('mBlock').classList.toggle('hidden', pend || mine);
  $('mReset').textContent = MEMBER.hasPassword ? t('emailReset') : t('emailSet');
  $('mReset').classList.toggle('hidden', pend || MEMBER.status === 'Blocked');
  drawRoles(); open('memberSheet');
}
function drawRoles() {
  const opts = [['', t('none')], ['count', t('count')], ['manager', t('manager')]];
  $('mRoles').innerHTML = ME.restaurants.map(r => `<div class="role-group">${esc(r.name)}</div>` +
    ME.inventories.filter(i => i.restaurant === r.name).map(i =>
      `<div class="role-row"><div class="rname">${esc(tType(i.type))}</div>
        <div class="seg ${MEMBER.owner ? 'disabled' : ''}">${opts.map(([v, l]) =>
          `<button class="${(MEMBER.owner ? 'manager' : (MEMBER.roles[i.key] || '')) === v ? 'on' : ''}" onclick="setRole('${esc(i.key)}','${v}')">${l}</button>`).join('')}</div></div>`).join('')).join('');
}
function setRole(k, v) { if (!MEMBER.owner) { MEMBER.roles[k] = v; drawRoles(); } }
function ownerToggle() { MEMBER.owner = $('mOwner').checked; drawRoles(); }
async function saveMember() {
  MEMBER.owner = $('mOwner').checked;
  const b = $('mSave'); b.disabled = true;
  try {
    if (MEMBER.status === 'Pending') {
      TEAM = await api('approveUser', { email: MEMBER.email, roles: MEMBER.roles, owner: MEMBER.owner });
      toast(t('approvedToast', { name: MEMBER.name }), 3500);
    } else {
      MEMBER.name = $('mName').value.trim();
      if (!MEMBER.name) { b.disabled = false; return toast(t('errNameEmail')); }
      TEAM = await api('saveUser', { user: { email: MEMBER.email, name: MEMBER.name, owner: MEMBER.owner, roles: MEMBER.roles } });
      if (MEMBER.email === ME.email) ME = await api('me');
      toast(t('saved'));
    }
    drawTeam(); open('teamSheet');
  } catch (e) { toast(e.message, 4000); } finally { b.disabled = false; }
}
async function removeMember() {
  const pend = MEMBER.status === 'Pending';
  if (!confirm(pend ? t('confirmReject', { name: MEMBER.name }) : t('confirmRemoveMember', { name: MEMBER.name }))) return;
  busy(true);
  try { TEAM = await api('removeUser', { email: MEMBER.email }); drawTeam(); open('teamSheet'); toast(pend ? t('rejected') : t('removed')); }
  catch (e) { toast(e.message, 4000); } finally { busy(false); }
}
async function blockMember() {
  const block = MEMBER.status !== 'Blocked';
  if (block && !confirm(t('confirmBlock', { name: MEMBER.name }))) return;
  busy(true);
  try { TEAM = await api('setBlocked', { email: MEMBER.email, blocked: block }); drawTeam(); open('teamSheet'); toast(block ? t('blockedToast') : t('unblockedToast')); }
  catch (e) { toast(e.message, 4000); } finally { busy(false); }
}
async function resetMember() {
  busy(true);
  try { await api('sendReset', { email: MEMBER.email }); toast(t('linkSent', { email: MEMBER.email }), 3500); }
  catch (e) { toast(e.message, 4000); } finally { busy(false); }
}
function shareInvite() {
  const url = location.origin + location.pathname;
  if (navigator.share) navigator.share({ title: 'Inventory', text: t('inviteText'), url: url }).catch(() => {});
  else { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast(t('linkCopied'))).catch(() => toast(url, 6000)); }
}

/* Rough strength hint while typing. The server makes the real check (common passwords etc). */
function pwScore(pw) {
  const low = pw.toLowerCase();
  if (pw.length < 10) return 0;
  if (/^\d+$/.test(pw) || /^(.{1,4})\1+$/.test(low) || /(zoutra|adraba|password|motdepasse|azerty|qwerty|123456|abcdef)/.test(low)) return 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length;
  const words = pw.trim().split(/[\s\-_.]+/).filter(w => w.length >= 3).length;
  if (pw.length >= 16 || words >= 3 || (pw.length >= 12 && kinds >= 3)) return 3;
  return pw.length >= 12 || kinds >= 3 ? 2 : 1;
}
function pwHint(input) {
  const box = $(input.id + 'Hint'), s = pwScore(input.value);
  if (input.closest('.auth')) { $('authMsg').textContent = ''; $('authMsg').className = 'auth-msg'; }
  const txt = [t('pwShort', { n: input.value.length }), t('pwWeak'), t('pwOk'), t('pwStrong')][s];
  box.className = 'pw-hint' + (input.value ? ' s' + s : '');
  box.querySelector('small').textContent = input.value ? txt : t('pwTip');
}

/* ---------------- start ---------------- */
document.addEventListener('visibilitychange', () => {   // back to the app: pick up counts made on other phones
  if (document.visibilityState === 'visible' && DATA && allSaved() && !document.querySelector('.sheet.open')) refresh(false);
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

(async function start() {
  LANG = store.get('inv.lang') || detectLang();
  applyTexts(); drawLangPickers(); drawStep();
  document.querySelectorAll('.pw-hint small').forEach(s => { s.textContent = t('pwTip'); });
  store.set('inv.code', null);   // old PIN codes are no longer used
  const q = new URLSearchParams(location.search);
  if (q.get('reset')) {
    RESET = { token: q.get('reset'), email: q.get('e') || '' };
    history.replaceState(null, '', location.pathname);   // remove the secret from the address bar
    $('xEmail').textContent = RESET.email;
    return showAuth('reset');
  }
  $('lEmail').value = store.get('inv.email') || '';
  const saved = store.get('inv.token');
  if (!saved) return showAuth('login');
  TOKEN = saved;
  let quick = false;
  try {
    const me = JSON.parse(store.get('inv.me') || 'null'), last = store.get('inv.last');
    const key = me && (me.inventories.some(i => i.key === last) ? last : (me.inventories[0] || {}).key);
    const d = key && savedData(key);
    if (me && d) { ME = me; quick = true; enterApp(d); setStatus('ready'); }   // instant
  } catch (e) {}
  if (!quick) busy(true);
  try {
    const r = await api('start', { inv: store.get('inv.last') || '' });
    ME = r.me; saveMe();
    if (!quick) enterApp(r.inventory);
    else {
      $('invCaret').style.display = ME.inventories.length > 1 ? '' : 'none';
      if (!ME.inventories.some(i => i.key === CUR)) enterApp(r.inventory);
      else { drawHeader(); if (r.inventory && r.inventory.key === CUR && allSaved()) showInventory(r.inventory, true); else if (r.inventory) loadInventory().catch(() => {}); }
    }
  } catch (e) { if (TOKEN && !quick) showAuth('login', e.message); else if (TOKEN) toast(e.message, 4000); }
  finally { busy(false); }
})();
