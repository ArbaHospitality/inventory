/**
 * @OnlyCurrentDoc
 * Inventory app - backend API (Google Apps Script attached to the Sheet
 * "Zoutra Inventory App - Data"). It can only open that one spreadsheet
 * and send email. The phone app talks to it with JSON over POST.
 *
 * Tabs: Zoutra, Adraba Wine, Adraba Alcohol (products), Users, Settings, History, Activity.
 */

const INVENTORIES = [
  { key: 'zoutra',         name: 'Zoutra',         tab: 'Zoutra',         prefix: 'Z'  },
  { key: 'adraba-wine',    name: 'Adraba Wine',    tab: 'Adraba Wine',    prefix: 'AW' },
  { key: 'adraba-alcohol', name: 'Adraba Alcohol', tab: 'Adraba Alcohol', prefix: 'AA' }
];
const USERS = 'Users';
const SETTINGS = 'Settings';
const HISTORY = 'History';
const ACTIVITY = 'Activity';
const ROLES = { '': 0, 'count': 1, 'manager': 2 };
const MAX_FAILS = 25;          // wrong codes allowed in the lock window
const LOCK_SECONDS = 15 * 60;  // lock window

/* ---------------- entry points ---------------- */

function doGet() {
  return json_({ ok: true, app: 'Inventory API' });
}

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'Bad request.' }); }
  try { return json_({ ok: true, data: route_(req) }); }
  catch (err) { return json_({ ok: false, error: String(err && err.message || err) }); }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function route_(r) {
  const user = auth_(r.code);
  switch (r.action) {
    case 'login':         return me_(user);
    case 'getInventory':  need_(user, r.inv, 'count');   return getInventory_(r.inv);
    case 'saveCount':     need_(user, r.inv, 'count');   return saveCount_(user, r.inv, r.id, r.q);
    case 'send':          need_(user, r.inv, 'count');   return send_(user, r.inv, r.month, r.xlsx, r.fileName);
    case 'addProduct':    need_(user, r.inv, 'manager'); return addProduct_(user, r.inv, r.product);
    case 'updateProduct': need_(user, r.inv, 'manager'); return updateProduct_(user, r.inv, r.product);
    case 'removeProduct': need_(user, r.inv, 'manager'); return removeProduct_(user, r.inv, r.id);
    case 'resetCounts':   need_(user, r.inv, 'manager'); return resetCounts_(user, r.inv);
    case 'changeMyCode':  return changeMyCode_(user, r.newCode);
    case 'listUsers':     owner_(user); return listUsers_();
    case 'saveUser':      owner_(user); return saveUser_(user, r.user);
    case 'removeUser':    owner_(user); return removeUser_(user, r.name);
    case 'listActivity':  owner_(user); return listActivity_(r.person, r.inv, r.limit);
    default: throw new Error('Unknown action.');
  }
}

/* ---------------- helpers ---------------- */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab in the Sheet: ' + name);
  return sh;
}
function inv_(key) {
  const inv = INVENTORIES.find(i => i.key === key);
  if (!inv) throw new Error('Unknown inventory.');
  return inv;
}
function getSetting_(name) {
  const rows = sheet_(SETTINGS).getDataRange().getValues();
  for (const r of rows) if (String(r[0]).trim() === name) return String(r[1]).trim();
  return '';
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function round2_(n) { return Math.round(n * 100) / 100; }
function now_() { return Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd HH:mm'); }

/* ---------------- activity log ---------------- */

// Activity tab: Date | Time | Person | Inventory | Action | Product | Details
function log_(user, invName, action, product, details) {
  const t = now_().split(' ');
  sheet_(ACTIVITY).appendRow([t[0], t[1], user.name, invName || '', action, product || '', details || '']);
}

function listActivity_(person, invKey, limit) {
  const sh = sheet_(ACTIVITY);
  const last = sh.getLastRow();
  const people = readUsers_().map(u => u.name);
  if (last < 2) return { rows: [], people: people };
  const max = Math.min(Number(limit) || 300, 1000);
  const invName = invKey ? inv_(invKey).name : '';
  const out = [];
  // read the newest rows in blocks until enough match the filters
  let end = last;
  while (end >= 2 && out.length < max) {
    const start = Math.max(2, end - 499);
    const rows = sh.getRange(start, 1, end - start + 1, 7).getValues();
    for (let i = rows.length - 1; i >= 0 && out.length < max; i--) {
      const r = rows[i];
      if (person && String(r[2]) !== person) continue;
      if (invName && String(r[3]) !== invName) continue;
      out.push({ date: fmtDate_(r[0]), time: fmtTime_(r[1]), person: String(r[2]), inv: String(r[3]),
                 action: String(r[4]), product: String(r[5]), details: String(r[6]) });
    }
    end = start - 1;
  }
  return { rows: out, people: people };
}
function fmtDate_(v) { return v instanceof Date ? Utilities.formatDate(v, 'Europe/Paris', 'yyyy-MM-dd') : String(v); }
function fmtTime_(v) { return v instanceof Date ? Utilities.formatDate(v, 'Europe/Paris', 'HH:mm') : String(v); }

/* ---------------- users & access ---------------- */

// Users tab: Name | Code | Owner | Zoutra | Adraba Wine | Adraba Alcohol
function readUsers_() {
  const sh = sheet_(USERS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = 3 + INVENTORIES.length;
  return sh.getRange(2, 1, last - 1, width).getValues().map((r, i) => {
    const roles = {};
    INVENTORIES.forEach((inv, j) => { roles[inv.key] = normRole_(r[3 + j]); });
    return {
      row: i + 2, name: String(r[0]).trim(), code: String(r[1]).trim(),
      owner: /^(yes|y|true|1|owner)$/i.test(String(r[2]).trim()), roles: roles
    };
  }).filter(u => u.name && u.code);
}
function normRole_(v) {
  v = String(v || '').trim().toLowerCase();
  if (v.startsWith('man')) return 'manager';
  if (v.startsWith('count')) return 'count';
  return '';
}
function roleOf_(user, key) { return user.owner ? 'manager' : (user.roles[key] || ''); }

function auth_(code) {
  code = String(code || '').trim();
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= MAX_FAILS) throw new Error('Too many wrong codes. Try again in 15 minutes.');
  const user = code && readUsers_().find(u => u.code === code);
  if (!user) {
    cache.put('fails', String(fails + 1), LOCK_SECONDS);
    Utilities.sleep(700);
    throw new Error('Wrong code.');
  }
  return user;
}
function need_(user, key, min) {
  inv_(key);
  if (ROLES[roleOf_(user, key)] < ROLES[min]) throw new Error('You do not have access to this.');
}
function owner_(user) { if (!user.owner) throw new Error('Only an owner can do this.'); }

function me_(user) {
  return {
    name: user.name, owner: user.owner,
    inventories: INVENTORIES.filter(i => roleOf_(user, i.key))
      .map(i => ({ key: i.key, name: i.name, role: roleOf_(user, i.key) }))
  };
}

function checkNewCode_(code, exceptRow) {
  code = String(code || '').trim();
  if (code.length < 4) throw new Error('A code needs at least 4 characters.');
  if (readUsers_().some(u => u.code === code && u.row !== exceptRow)) {
    throw new Error('This code is already used by someone else. Choose another one.');
  }
  return code;
}

function changeMyCode_(user, newCode) {
  return withLock_(() => {
    const code = checkNewCode_(newCode, user.row);
    sheet_(USERS).getRange(user.row, 2).setNumberFormat('@').setValue(code);
    log_(user, '', 'Changed own code', '', '');
    return true;
  });
}

function listUsers_() {
  return readUsers_().map(u => ({ name: u.name, code: u.code, owner: u.owner, roles: u.roles }));
}

/** u = { originalName?, name, code, owner, roles: {key: ''|'count'|'manager'} } */
function saveUser_(me, u) {
  return withLock_(() => {
    const name = String(u.name || '').trim();
    if (!name) throw new Error('Please enter a name.');
    const users = readUsers_();
    const existing = u.originalName ? users.find(x => x.name === u.originalName) : null;
    if (u.originalName && !existing) throw new Error('Team member not found.');
    if (users.some(x => x.name.toLowerCase() === name.toLowerCase() && x !== existing)) {
      throw new Error('There is already a team member with this name.');
    }
    const code = checkNewCode_(u.code, existing ? existing.row : -1);
    const owner = !!u.owner;
    if (existing && existing.owner && !owner && users.filter(x => x.owner).length === 1) {
      throw new Error('There must always be at least one owner.');
    }
    const roleLabel = r => r === 'manager' ? 'Manager' : r === 'count' ? 'Count' : '';
    const row = [name, code, owner ? 'Yes' : 'No']
      .concat(INVENTORIES.map(i => roleLabel(normRole_((u.roles || {})[i.key]))));
    const sh = sheet_(USERS);
    const r = existing ? existing.row : sh.getLastRow() + 1;
    sh.getRange(r, 2).setNumberFormat('@');
    sh.getRange(r, 1, 1, row.length).setValues([row]);
    const access = owner ? 'Owner' : INVENTORIES.map((i, j) => row[3 + j] ? i.name + ': ' + row[3 + j] : '').filter(Boolean).join(', ') || 'No access';
    const renamed = existing && existing.name !== name ? ' (was ' + existing.name + ')' : '';
    const codeNote = existing && existing.code !== code ? ', code changed' : '';
    log_(me, '', existing ? 'Edited team member' : 'Added team member', name, access + renamed + codeNote);
    return listUsers_();
  });
}

function removeUser_(me, name) {
  return withLock_(() => {
    const users = readUsers_();
    const u = users.find(x => x.name === name);
    if (!u) throw new Error('Team member not found.');
    if (u.row === me.row) throw new Error('You cannot remove yourself.');
    if (u.owner && users.filter(x => x.owner).length === 1) throw new Error('There must always be at least one owner.');
    sheet_(USERS).deleteRow(u.row);
    log_(me, '', 'Removed team member', u.name, '');
    return listUsers_();
  });
}

/* ---------------- products & counts ---------------- */

function categories_(inv) {
  const raw = getSetting_('Categories: ' + inv.name);
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Product tabs: ID | Category | Supplier | Product Name | Q | H.T | Value | Counted by | Counted at
function readProducts_(inv) {
  const sh = sheet_(inv.tab);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 9).getValues()
    .filter(r => r[0] !== '' && r[3] !== '')
    .map(r => ({
      id: String(r[0]), category: String(r[1]), supplier: String(r[2]), name: String(r[3]),
      q: r[4] === '' ? null : Number(r[4]), price: Number(r[5]) || 0,
      by: String(r[7] || ''), at: r[8] instanceof Date ? Utilities.formatDate(r[8], 'Europe/Paris', 'yyyy-MM-dd HH:mm') : String(r[8] || '')
    }));
}

function getInventory_(key) {
  const inv = inv_(key);
  const products = readProducts_(inv);
  const cats = categories_(inv);
  products.forEach(p => { if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category); });
  return { key: inv.key, name: inv.name, categories: cats, products: products };
}

function findRow_(inv, id) {
  const sh = sheet_(inv.tab);
  const n = Math.max(sh.getLastRow() - 1, 1);
  const ids = sh.getRange(2, 1, n, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  throw new Error('Product not found. Pull down to refresh.');
}

function saveCount_(user, key, id, q) {
  const inv = inv_(key);
  return withLock_(() => {
    const row = findRow_(inv, id);
    const v = (q === null || q === '' || q === undefined) ? '' : Number(q);
    if (v !== '' && (isNaN(v) || v < 0)) throw new Error('Not a valid number.');
    const sh = sheet_(inv.tab);
    const cur = sh.getRange(row, 1, 1, 5).getValues()[0];
    const at = now_();
    sh.getRange(row, 5).setValue(v);
    sh.getRange(row, 8, 1, 2).setValues([v === '' ? ['', ''] : [user.name, at]]);
    const before = cur[4] === '' ? '–' : String(cur[4]);
    log_(user, inv.name, v === '' ? 'Cleared count' : 'Counted', String(cur[3]), before + ' → ' + (v === '' ? '–' : String(v)));
    return { by: v === '' ? '' : user.name, at: v === '' ? '' : at };
  });
}

function cleanProduct_(p) {
  const name = String(p.name || '').trim();
  const category = String(p.category || '').trim();
  if (!name || !category) throw new Error('Name and category are required.');
  return { name: name, category: category, supplier: String(p.supplier || '').trim(), price: Number(p.price) || 0 };
}

function addProduct_(user, key, p) {
  const inv = inv_(key);
  const c = cleanProduct_(p);
  return withLock_(() => {
    const sh = sheet_(inv.tab);
    let max = 0;
    readProducts_(inv).forEach(x => {
      if (x.id.indexOf(inv.prefix) === 0) {
        const n = parseInt(x.id.slice(inv.prefix.length), 10);
        if (n > max) max = n;
      }
    });
    const id = inv.prefix + String(max + 1).padStart(3, '0');
    // insert after the last product of the same category so the list stays grouped
    const last = sh.getLastRow();
    let after = last;
    if (last >= 2) {
      const cats = sh.getRange(2, 2, last - 1, 1).getValues();
      let found = -1;
      for (let i = cats.length - 1; i >= 0; i--) if (String(cats[i][0]) === c.category) { found = i + 2; break; }
      if (found > 0) after = found;
    }
    sh.insertRowAfter(Math.max(after, 1));
    sh.getRange(after + 1, 1, 1, 6).setValues([[id, c.category, c.supplier, c.name, '', c.price]]);
    sh.getRange(after + 1, 8, 1, 2).setValues([['', '']]);
    log_(user, inv.name, 'Added product', c.name, [c.category, c.supplier, c.price.toFixed(2) + ' €'].filter(Boolean).join(' · '));
    return getInventory_(key);
  });
}

function updateProduct_(user, key, p) {
  const inv = inv_(key);
  const c = cleanProduct_(p);
  return withLock_(() => {
    const row = findRow_(inv, p.id);
    const sh = sheet_(inv.tab);
    const old = sh.getRange(row, 1, 1, 6).getValues()[0];
    sh.getRange(row, 2, 1, 3).setValues([[c.category, c.supplier, c.name]]);
    sh.getRange(row, 6).setValue(c.price);
    const changes = [];
    if (String(old[3]) !== c.name) changes.push('name: ' + old[3] + ' → ' + c.name);
    if (String(old[1]) !== c.category) changes.push('category: ' + old[1] + ' → ' + c.category);
    if (String(old[2]) !== c.supplier) changes.push('supplier: ' + old[2] + ' → ' + c.supplier);
    if (Number(old[5]) !== c.price) changes.push('price: ' + Number(old[5]).toFixed(2) + ' → ' + c.price.toFixed(2) + ' €');
    if (changes.length) log_(user, inv.name, 'Edited product', c.name, changes.join('; '));
    return getInventory_(key);
  });
}

function removeProduct_(user, key, id) {
  const inv = inv_(key);
  return withLock_(() => {
    const row = findRow_(inv, id);
    const sh = sheet_(inv.tab);
    const name = String(sh.getRange(row, 4).getValues()[0][0]);
    sh.deleteRow(row);
    log_(user, inv.name, 'Removed product', name, '');
    return getInventory_(key);
  });
}

function resetCounts_(user, key) {
  const inv = inv_(key);
  return withLock_(() => {
    const sh = sheet_(inv.tab);
    if (sh.getLastRow() > 1) {
      sh.getRange(2, 5, sh.getLastRow() - 1, 1).clearContent();
      sh.getRange(2, 8, sh.getLastRow() - 1, 2).clearContent();
    }
    log_(user, inv.name, 'Cleared all counts', '', 'New month started');
    return getInventory_(key);
  });
}

/* ---------------- send to office ---------------- */

function send_(user, key, month, xlsxBase64, fileName) {
  const inv = inv_(key);
  const to = getSetting_('Office email');
  if (!to) throw new Error('No office email set in the Settings tab.');
  if (!xlsxBase64) throw new Error('The Excel file is missing.');
  month = String(month || '').trim();

  const products = readProducts_(inv);
  const missing = products.filter(p => p.q === null).length;
  const bottles = products.reduce((s, p) => s + (p.q || 0), 0);
  const value = products.reduce((s, p) => s + (p.q || 0) * p.price, 0);
  const blob = Utilities.newBlob(Utilities.base64Decode(xlsxBase64),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    String(fileName || (inv.name + ' Inventory - ' + month + '.xlsx')));

  const body =
    'Hello,\n\nPlease find attached the ' + inv.name + ' inventory for ' + month + '.\n\n' +
    'Total bottles: ' + round2_(bottles) + '\n' +
    'Total value (H.T): ' + round2_(value).toFixed(2) + ' EUR\n' +
    'Counted by: ' + user.name + '\n' +
    (missing ? 'Not counted: ' + missing + ' products (sent as 0)\n' : '') +
    '\nSent from the inventory app.';

  const opts = { attachments: [blob], name: inv.name + ' Inventory' };
  const cc = getSetting_('Copy to');
  if (cc) opts.cc = cc;
  MailApp.sendEmail(to, inv.name + ' Inventory - ' + month, body, opts);

  const now = now_();
  const hist = products.map(p => [inv.name, month, now, user.name, p.id, p.category, p.supplier, p.name,
    p.q === null ? 0 : p.q, p.price, round2_((p.q || 0) * p.price)]);
  const hs = sheet_(HISTORY);
  if (hist.length) hs.getRange(hs.getLastRow() + 1, 1, hist.length, hist[0].length).setValues(hist);
  log_(user, inv.name, 'Sent to office', month, 'To ' + to + (cc ? ' (copy ' + cc + ')' : '') + ' · ' + round2_(bottles) + ' bottles · ' + round2_(value).toFixed(2) + ' €' + (missing ? ' · ' + missing + ' not counted' : ''));

  return { to: to, cc: cc, bottles: round2_(bottles), value: round2_(value) };
}

/** Run once from the editor after pasting, to grant permissions (this spreadsheet + send email). */
function authorize() {
  readUsers_();
  MailApp.getRemainingDailyQuota();
}
