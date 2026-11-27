/**
 * @OnlyCurrentDoc
 * Inventory app - backend API (Google Apps Script attached to the Sheet
 * "Zoutra Inventory App - Data"). It can only open that one spreadsheet
 * and send email. The phone app talks to it with JSON over POST.
 *
 * Accounts: email + password, approved by an owner. Passwords are stored as
 * salted, iterated SHA-256 hashes. Phones hold a 30-day login token (only its
 * hash is stored). Forgotten passwords are reset by an emailed link.
 *
 * Tabs: Zoutra, Adraba Wine, Adraba Alcohol (products), Users, Sessions,
 *       Settings, History, Activity.
 */

const INVENTORIES = [
  { key: 'zoutra',         name: 'Zoutra',         tab: 'Zoutra',         prefix: 'Z'  },
  { key: 'adraba-wine',    name: 'Adraba Wine',    tab: 'Adraba Wine',    prefix: 'AW' },
  { key: 'adraba-alcohol', name: 'Adraba Alcohol', tab: 'Adraba Alcohol', prefix: 'AA' }
];
const USERS = 'Users', SESSIONS = 'Sessions', SETTINGS = 'Settings', HISTORY = 'History', ACTIVITY = 'Activity';
const ROLES = { '': 0, 'count': 1, 'manager': 2 };
const APP_URL_DEFAULT = 'https://arbahospitality.github.io/inventory/';
const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
const LOGIN_FAILS = 5, LOGIN_LOCK_SECONDS = 15 * 60;   // per account
const HASH_ROUNDS = 2000;
const MIN_PASSWORD = 8;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Users tab columns (1-based)
const U = { name: 1, email: 2, status: 3, owner: 4, roles: 5 /* 5..7, one per inventory */,
            hash: 5 + INVENTORIES.length, resetHash: 6 + INVENTORIES.length, resetExp: 7 + INVENTORIES.length,
            created: 8 + INVENTORIES.length, approvedBy: 9 + INVENTORIES.length };
const U_WIDTH = 9 + INVENTORIES.length;
const USERS_HEADER = ['Name', 'Email', 'Status', 'Owner'].concat(INVENTORIES.map(i => i.name))
  .concat(['Password (hashed)', 'Reset (hashed)', 'Reset expires', 'Created', 'Approved by']);

/* ---------------- entry points ---------------- */

function doGet() { return json_({ ok: true, app: 'Inventory API' }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return json_({ ok: false, error: 'Bad request.' }); }
  try { return json_({ ok: true, data: route_(req) }); }
  catch (err) {
    const msg = String(err && err.message || err);
    return json_({ ok: false, error: msg, auth: /^AUTH:/.test(msg) || undefined });
  }
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function authError_(msg) { return new Error('AUTH: ' + msg); }

function route_(r) {
  // actions that do not need a login
  switch (r.action) {
    case 'register':      return register_(r.name, r.email, r.password);
    case 'login':         return login_(r.email, r.password, r.device);
    case 'forgot':        return forgot_(r.email);
    case 'resetPassword': return resetPassword_(r.email, r.token, r.password);
  }
  const s = session_(r.token);
  const user = s.user;
  switch (r.action) {
    case 'me':             return me_(user);
    case 'logout':         return logout_(s);
    case 'changePassword': return changePassword_(user, s, r.current, r.password);
    case 'getInventory':   need_(user, r.inv, 'count');   return getInventory_(r.inv);
    case 'saveCount':      need_(user, r.inv, 'count');   return saveCount_(user, r.inv, r.id, r.q);
    case 'send':           need_(user, r.inv, 'count');   return send_(user, r.inv, r.month, r.xlsx);
    case 'addProduct':     need_(user, r.inv, 'manager'); return addProduct_(user, r.inv, r.product);
    case 'updateProduct':  need_(user, r.inv, 'manager'); return updateProduct_(user, r.inv, r.product);
    case 'removeProduct':  need_(user, r.inv, 'manager'); return removeProduct_(user, r.inv, r.id);
    case 'resetCounts':    need_(user, r.inv, 'manager'); return resetCounts_(user, r.inv);
    case 'listUsers':      owner_(user); return listUsers_();
    case 'saveUser':       owner_(user); return saveUser_(user, r.user);
    case 'approveUser':    owner_(user); return approveUser_(user, r.email, r.roles, r.owner);
    case 'setBlocked':     owner_(user); return setBlocked_(user, r.email, !!r.blocked);
    case 'removeUser':     owner_(user); return removeUser_(user, r.email);
    case 'sendReset':      owner_(user); return sendReset_(user, r.email);
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
function appUrl_() { return getSetting_('App link') || APP_URL_DEFAULT; }
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function round2_(n) { return Math.round(n * 100) / 100; }
function now_() { return Utilities.formatDate(new Date(), 'Europe/Paris', 'yyyy-MM-dd HH:mm'); }
function cleanEmail_(e) { return String(e || '').trim().toLowerCase(); }
function validEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120; }

/** Text typed by people must never become a Sheet formula (formula injection). */
function safe_(v) {
  const s = String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim();
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

/* ---------------- passwords & tokens ---------------- */

function bytesToHex_(b) { return b.map(x => ((x < 0 ? x + 256 : x).toString(16).padStart(2, '0'))).join(''); }
function sha256Hex_(s) {
  return bytesToHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8));
}
function randomToken_() {
  return (Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}
function hashPassword_(password, salt, rounds) {
  salt = salt || randomToken_().slice(0, 32);
  rounds = rounds || HASH_ROUNDS;
  let h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + password, Utilities.Charset.UTF_8);
  for (let i = 1; i < rounds; i++) h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h);
  return 'sha256$' + rounds + '$' + salt + '$' + bytesToHex_(h);
}
function checkPassword_(password, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 4 || p[0] !== 'sha256') return false;
  return hashPassword_(password, p[2], Number(p[1])) === stored;
}
function checkNewPassword_(pw) {
  pw = String(pw || '');
  if (pw.length < MIN_PASSWORD) throw new Error('The password needs at least ' + MIN_PASSWORD + ' characters.');
  if (pw.length > 200) throw new Error('The password is too long.');
  return pw;
}

/* ---------------- users ---------------- */

function readUsers_() {
  const sh = sheet_(USERS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, U_WIDTH).getValues().map((r, i) => {
    const roles = {};
    INVENTORIES.forEach((inv, j) => { roles[inv.key] = normRole_(r[U.roles - 1 + j]); });
    return {
      row: i + 2, name: String(r[U.name - 1]).trim(), email: cleanEmail_(r[U.email - 1]),
      status: String(r[U.status - 1]).trim() || 'Pending',
      owner: /^(yes|y|true|1|owner)$/i.test(String(r[U.owner - 1]).trim()), roles: roles,
      hash: String(r[U.hash - 1] || ''), resetHash: String(r[U.resetHash - 1] || ''),
      resetExp: Number(r[U.resetExp - 1]) || 0, created: String(r[U.created - 1] || ''),
      approvedBy: String(r[U.approvedBy - 1] || '')
    };
  }).filter(u => u.email);
}
function findUser_(email) { email = cleanEmail_(email); return readUsers_().find(u => u.email === email) || null; }
function normRole_(v) {
  v = String(v || '').trim().toLowerCase();
  if (v.startsWith('man')) return 'manager';
  if (v.startsWith('count')) return 'count';
  return '';
}
function roleOf_(user, key) { return user.owner ? 'manager' : (user.roles[key] || ''); }
function roleLabel_(r) { return r === 'manager' ? 'Manager' : r === 'count' ? 'Count' : ''; }
function setCells_(row, col, values) { sheet_(USERS).getRange(row, col, 1, values.length).setValues([values]); }

function need_(user, key, min) {
  inv_(key);
  if (ROLES[roleOf_(user, key)] < ROLES[min]) throw new Error('You do not have access to this.');
}
function owner_(user) { if (!user.owner) throw new Error('Only an owner can do this.'); }

function me_(user) {
  return {
    name: user.name, email: user.email, owner: user.owner,
    inventories: INVENTORIES.filter(i => roleOf_(user, i.key))
      .map(i => ({ key: i.key, name: i.name, role: roleOf_(user, i.key) }))
  };
}

/* ---------------- register / login / sessions ---------------- */

function register_(name, email, password) {
  name = String(name || '').trim().slice(0, 60);
  email = cleanEmail_(email);
  if (!name) throw new Error('Please enter your name.');
  if (!validEmail_(email)) throw new Error('Please enter a valid email address.');
  checkNewPassword_(password);
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('registrations') || 0);
  if (n >= 20) throw new Error('Too many sign-up requests right now. Try again in an hour.');
  cache.put('registrations', String(n + 1), 3600);
  return withLock_(() => {
    if (findUser_(email)) throw new Error('An account with this email already exists. Log in, or use "Forgot password".');
    const row = new Array(U_WIDTH).fill('');
    row[U.name - 1] = safe_(name); row[U.email - 1] = email; row[U.status - 1] = 'Pending'; row[U.owner - 1] = 'No';
    row[U.hash - 1] = hashPassword_(password); row[U.created - 1] = now_();
    sheet_(USERS).appendRow(row);
    log_({ name: name }, '', 'Account requested', name, email);
    const owners = readUsers_().filter(u => u.owner && u.status === 'Active').map(u => u.email);
    if (owners.length) {
      MailApp.sendEmail(owners.join(','), 'Inventory app: new account request from ' + name,
        name + ' (' + email + ') asked for access to the inventory app.\n\n' +
        'To approve or reject: open the app, then ☰ → Team members.\n' + appUrl_(),
        { name: 'Inventory app' });
    }
    return { status: 'Pending' };
  });
}

function login_(email, password, device) {
  email = cleanEmail_(email);
  const cache = CacheService.getScriptCache(), key = 'fail:' + sha256Hex_(email);
  const fails = Number(cache.get(key) || 0);
  if (fails >= LOGIN_FAILS) throw new Error('Too many wrong passwords for this account. Try again in 15 minutes, or use "Forgot password".');
  const u = findUser_(email);
  if (!u || !u.hash || !checkPassword_(String(password || ''), u.hash)) {
    cache.put(key, String(fails + 1), LOGIN_LOCK_SECONDS);
    Utilities.sleep(500);
    throw new Error('Wrong email or password.');
  }
  cache.remove(key);
  if (u.status === 'Pending') throw new Error('Your account is waiting for approval by an owner.');
  if (u.status !== 'Active') throw new Error('This account is blocked. Ask an owner.');
  const token = randomToken_();
  const expires = Date.now() + SESSION_DAYS * 864e5;
  withLock_(() => {
    pruneSessions_();
    sheet_(SESSIONS).appendRow([sha256Hex_(token), u.email, now_(), expires, safe_(String(device || '').slice(0, 80))]);
  });
  return { token: token, expires: expires, me: me_(u) };
}

function readSessions_() {
  const sh = sheet_(SESSIONS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 4).getValues().map((r, i) => ({ row: i + 2, hash: String(r[0]), email: cleanEmail_(r[1]), expires: Number(r[3]) || 0 }));
}
function pruneSessions_() {
  const sh = sheet_(SESSIONS), now = Date.now();
  readSessions_().filter(s => s.expires < now).reverse().forEach(s => sh.deleteRow(s.row));
}
function revokeSessions_(email, exceptHash) {
  const sh = sheet_(SESSIONS);
  readSessions_().filter(s => s.email === email && s.hash !== exceptHash).reverse().forEach(s => sh.deleteRow(s.row));
}

function session_(token) {
  token = String(token || '');
  if (token.length < 40) throw authError_('Please log in.');
  const h = sha256Hex_(token);
  const s = readSessions_().find(x => x.hash === h);
  if (!s || s.expires < Date.now()) throw authError_('Your login has expired. Please log in again.');
  const user = findUser_(s.email);
  if (!user || user.status !== 'Active') throw authError_('This account is no longer active.');
  return { hash: h, row: s.row, user: user };
}

function logout_(s) {
  withLock_(() => { sheet_(SESSIONS).deleteRow(s.row); });
  return true;
}

function changePassword_(user, s, current, password) {
  if (!checkPassword_(String(current || ''), user.hash)) throw new Error('Your current password is not correct.');
  checkNewPassword_(password);
  return withLock_(() => {
    setCells_(user.row, U.hash, [hashPassword_(password)]);
    revokeSessions_(user.email, s.hash);   // other phones are logged out
    log_(user, '', 'Changed own password', '', 'Other phones logged out');
    return true;
  });
}

/* ---------------- forgotten password ---------------- */

function forgot_(email) {
  email = cleanEmail_(email);
  const answer = { sent: true };   // same answer whether or not the account exists
  if (!validEmail_(email)) return answer;
  const cache = CacheService.getScriptCache(), key = 'reset:' + sha256Hex_(email);
  if (cache.get(key)) return answer;   // at most one email every 5 minutes per address
  cache.put(key, '1', 300);
  const u = findUser_(email);
  if (u && u.status !== 'Blocked') withLock_(() => sendResetEmail_(u, false));
  return answer;
}

function sendResetEmail_(u, welcome) {
  const token = randomToken_();
  const minutes = welcome ? 7 * 24 * 60 : RESET_MINUTES;
  setCells_(u.row, U.resetHash, [sha256Hex_(token), Date.now() + minutes * 60000]);
  const link = appUrl_() + '?reset=' + encodeURIComponent(token) + '&e=' + encodeURIComponent(u.email);
  const subject = welcome ? 'Inventory app: set your password' : 'Inventory app: reset your password';
  const body = (welcome
      ? 'Hello ' + u.name + ',\n\nYour account for the inventory app is ready. Choose your password here (link valid 7 days):\n\n'
      : 'Hello ' + u.name + ',\n\nTo choose a new password for the inventory app, open this link (valid ' + RESET_MINUTES + ' minutes):\n\n') +
    link + '\n\nIf you did not ask for this, ignore this email.';
  MailApp.sendEmail(u.email, subject, body, { name: 'Inventory app' });
}

function resetPassword_(email, token, password) {
  email = cleanEmail_(email);
  checkNewPassword_(password);
  return withLock_(() => {
    const u = findUser_(email);
    if (!u || !u.resetHash || u.resetHash !== sha256Hex_(String(token || '')) || u.resetExp < Date.now()) {
      throw new Error('This link is not valid any more. Ask for a new one with "Forgot password".');
    }
    setCells_(u.row, U.hash, [hashPassword_(password), '', '']);
    revokeSessions_(u.email, null);
    log_(u, '', 'Reset password', '', 'By email link');
    return { status: u.status };
  });
}

/* ---------------- team (owners) ---------------- */

function listUsers_() {
  return readUsers_().map(u => ({ name: u.name, email: u.email, status: u.status, owner: u.owner, roles: u.roles,
    created: u.created, approvedBy: u.approvedBy, hasPassword: !!u.hash }));
}
function rolesRow_(roles) { return INVENTORIES.map(i => roleLabel_(normRole_((roles || {})[i.key]))); }
function accessText_(owner, roles) {
  return owner ? 'Owner' : INVENTORIES.map(i => roles[i.key] ? i.name + ': ' + roleLabel_(roles[i.key]) : '').filter(Boolean).join(', ') || 'No access';
}
function activeOwners_(users) { return users.filter(x => x.owner && x.status === 'Active'); }

function approveUser_(me, email, roles, owner) {
  return withLock_(() => {
    const u = findUser_(email);
    if (!u) throw new Error('Team member not found.');
    if (u.status !== 'Pending') throw new Error('This account is not waiting for approval.');
    const rr = rolesRow_(roles);
    if (!owner && !rr.some(Boolean)) throw new Error('Choose at least one inventory before approving.');
    setCells_(u.row, U.status, ['Active', owner ? 'Yes' : 'No'].concat(rr));
    setCells_(u.row, U.approvedBy, [safe_(me.name)]);
    const r = {}; INVENTORIES.forEach((i, j) => { r[i.key] = normRole_(rr[j]); });
    log_(me, '', 'Approved team member', u.name, accessText_(!!owner, r));
    MailApp.sendEmail(u.email, 'Inventory app: your account is approved',
      'Hello ' + u.name + ',\n\nYour account has been approved. You can now log in:\n' + appUrl_(), { name: 'Inventory app' });
    return listUsers_();
  });
}

/** Edit an active or blocked member: name, owner flag, roles. */
function saveUser_(me, x) {
  return withLock_(() => {
    const users = readUsers_();
    const u = users.find(y => y.email === cleanEmail_(x.email));
    if (!u) throw new Error('Team member not found.');
    const name = String(x.name || '').trim().slice(0, 60);
    if (!name) throw new Error('Please enter a name.');
    const owner = !!x.owner;
    if (u.owner && !owner && activeOwners_(users).length === 1 && u.status === 'Active') throw new Error('There must always be at least one owner.');
    setCells_(u.row, U.name, [safe_(name)]);
    setCells_(u.row, U.owner, [owner ? 'Yes' : 'No'].concat(rolesRow_(x.roles)));
    const r = {}; INVENTORIES.forEach(i => { r[i.key] = normRole_((x.roles || {})[i.key]); });
    log_(me, '', 'Edited team member', name, accessText_(owner, r) + (u.name !== name ? ' (was ' + u.name + ')' : ''));
    return listUsers_();
  });
}

function setBlocked_(me, email, blocked) {
  return withLock_(() => {
    const users = readUsers_();
    const u = users.find(y => y.email === cleanEmail_(email));
    if (!u) throw new Error('Team member not found.');
    if (u.email === me.email) throw new Error('You cannot block yourself.');
    if (blocked && u.owner && activeOwners_(users).length === 1) throw new Error('There must always be at least one owner.');
    setCells_(u.row, U.status, [blocked ? 'Blocked' : 'Active']);
    if (blocked) revokeSessions_(u.email, null);
    log_(me, '', blocked ? 'Blocked team member' : 'Unblocked team member', u.name, blocked ? 'Logged out everywhere' : '');
    return listUsers_();
  });
}

function removeUser_(me, email) {
  return withLock_(() => {
    const users = readUsers_();
    const u = users.find(y => y.email === cleanEmail_(email));
    if (!u) throw new Error('Team member not found.');
    if (u.email === me.email) throw new Error('You cannot remove yourself.');
    if (u.owner && activeOwners_(users).length === 1) throw new Error('There must always be at least one owner.');
    revokeSessions_(u.email, null);
    sheet_(USERS).deleteRow(u.row);
    log_(me, '', u.status === 'Pending' ? 'Rejected account request' : 'Removed team member', u.name, '');
    return listUsers_();
  });
}

function sendReset_(me, email) {
  return withLock_(() => {
    const u = findUser_(email);
    if (!u) throw new Error('Team member not found.');
    if (u.status === 'Blocked') throw new Error('Unblock this person first.');
    sendResetEmail_(u, !u.hash);
    log_(me, '', 'Sent password link', u.name, u.email);
    return true;
  });
}

/* ---------------- activity log ---------------- */

// Activity tab: Date | Time | Person | Inventory | Action | Product | Details
function log_(user, invName, action, product, details) {
  const t = now_().split(' ');
  sheet_(ACTIVITY).appendRow([t[0], t[1], safe_(user.name), invName || '', action, safe_(product), safe_(details)]);
}

/* ---------------- products & counts ---------------- */

function categories_(inv) {
  return getSetting_('Categories: ' + inv.name).split(',').map(s => s.trim()).filter(Boolean);
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
  throw new Error('Product not found. Refresh the app.');
}

function saveCount_(user, key, id, q) {
  const inv = inv_(key);
  return withLock_(() => {
    const row = findRow_(inv, id);
    const v = (q === null || q === '' || q === undefined) ? '' : Number(q);
    if (v !== '' && (isNaN(v) || v < 0 || v > 100000)) throw new Error('Not a valid number.');
    const sh = sheet_(inv.tab);
    const cur = sh.getRange(row, 1, 1, 5).getValues()[0];
    const at = now_();
    sh.getRange(row, 5).setValue(v);
    sh.getRange(row, 8, 1, 2).setValues([v === '' ? ['', ''] : [safe_(user.name), at]]);
    const before = cur[4] === '' ? '–' : String(cur[4]);
    log_(user, inv.name, v === '' ? 'Cleared count' : 'Counted', String(cur[3]), before + ' → ' + (v === '' ? '–' : String(v)));
    return { by: v === '' ? '' : user.name, at: v === '' ? '' : at };
  });
}

function cleanProduct_(p) {
  const name = String(p.name || '').trim().slice(0, 120);
  const category = String(p.category || '').trim().slice(0, 40);
  if (!name || !category) throw new Error('Name and category are required.');
  const price = Number(p.price) || 0;
  if (price < 0 || price > 100000) throw new Error('Not a valid price.');
  return { name: name, category: category, supplier: String(p.supplier || '').trim().slice(0, 60), price: price };
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
    const last = sh.getLastRow();
    let after = last;
    if (last >= 2) {
      const cats = sh.getRange(2, 2, last - 1, 1).getValues();
      let found = -1;
      for (let i = cats.length - 1; i >= 0; i--) if (String(cats[i][0]) === c.category) { found = i + 2; break; }
      if (found > 0) after = found;
    }
    sh.insertRowAfter(Math.max(after, 1));
    sh.getRange(after + 1, 1, 1, 6).setValues([[id, safe_(c.category), safe_(c.supplier), safe_(c.name), '', c.price]]);
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
    sh.getRange(row, 2, 1, 3).setValues([[safe_(c.category), safe_(c.supplier), safe_(c.name)]]);
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

function send_(user, key, month, xlsxBase64) {
  const inv = inv_(key);
  const to = getSetting_('Office email');
  if (!to) throw new Error('No office email set in the Settings tab.');
  month = String(month || '').trim();
  const m = /^([A-Za-z]+) (\d{4})$/.exec(month);
  if (!m || MONTHS.indexOf(m[1]) < 0 || Number(m[2]) < 2024 || Number(m[2]) > 2100) throw new Error('Not a valid month.');

  // the attachment must be a real Excel file of a sensible size
  let bytes;
  try { bytes = Utilities.base64Decode(String(xlsxBase64 || '')); } catch (e) { bytes = []; }
  if (bytes.length < 200 || bytes.length > 2 * 1024 * 1024 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
    throw new Error('The Excel file is not valid.');
  }
  const fileName = inv.name + ' Inventory - ' + month + '.xlsx';   // built here, never taken from the phone
  const blob = Utilities.newBlob(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName);

  const products = readProducts_(inv);
  const missing = products.filter(p => p.q === null).length;
  const bottles = products.reduce((s, p) => s + (p.q || 0), 0);
  const value = products.reduce((s, p) => s + (p.q || 0) * p.price, 0);
  const body =
    'Hello,\n\nPlease find attached the ' + inv.name + ' inventory for ' + month + '.\n\n' +
    'Total bottles: ' + round2_(bottles) + '\n' +
    'Total value (H.T): ' + round2_(value).toFixed(2) + ' EUR\n' +
    'Sent by: ' + user.name + '\n' +
    (missing ? 'Not counted: ' + missing + ' products (sent as 0)\n' : '') +
    '\nSent from the inventory app.';

  const opts = { attachments: [blob], name: inv.name + ' Inventory' };
  const cc = getSetting_('Copy to');
  if (cc) opts.cc = cc;
  MailApp.sendEmail(to, inv.name + ' Inventory - ' + month, body, opts);

  const now = now_();
  const hist = products.map(p => [inv.name, month, now, safe_(user.name), p.id, safe_(p.category), safe_(p.supplier), safe_(p.name),
    p.q === null ? 0 : p.q, p.price, round2_((p.q || 0) * p.price)]);
  const hs = sheet_(HISTORY);
  if (hist.length) hs.getRange(hs.getLastRow() + 1, 1, hist.length, hist[0].length).setValues(hist);
  log_(user, inv.name, 'Sent to office', month, 'To ' + to + (cc ? ' (copy ' + cc + ')' : '') + ' · ' + round2_(bottles) + ' bottles · ' + round2_(value).toFixed(2) + ' €' + (missing ? ' · ' + missing + ' not counted' : ''));

  return { to: to, cc: cc, bottles: round2_(bottles), value: round2_(value) };
}

/* ---------------- one-time setup (run from the editor) ---------------- */

/** Run once from the editor to grant permissions (this spreadsheet + send email). */
function authorize() {
  readUsers_();
  MailApp.getRemainingDailyQuota();
}

/**
 * Run once from the editor: switches the Users tab to accounts, creates the
 * Sessions tab, and emails the owners listed below a link to set their password.
 */
function setupAccounts() {
  const owners = [['David', 'david@adraba-paris.com'], ['Eden', 'eden@adraba-paris.com']];
  const ss = ss_();
  const users = ss.getSheetByName(USERS);
  users.clear();
  users.getRange(1, 1, 1, USERS_HEADER.length).setValues([USERS_HEADER]).setFontWeight('bold');
  users.setFrozenRows(1);
  owners.forEach(([name, email]) => {
    const row = new Array(U_WIDTH).fill('');
    row[U.name - 1] = name; row[U.email - 1] = email; row[U.status - 1] = 'Active'; row[U.owner - 1] = 'Yes';
    INVENTORIES.forEach((_, j) => { row[U.roles - 1 + j] = 'Manager'; });
    row[U.created - 1] = now_(); row[U.approvedBy - 1] = 'Setup';
    users.appendRow(row);
  });
  let sessions = ss.getSheetByName(SESSIONS);
  if (!sessions) sessions = ss.insertSheet(SESSIONS);
  sessions.clear();
  sessions.getRange(1, 1, 1, 5).setValues([['Token (hashed)', 'Email', 'Created', 'Expires (ms)', 'Device']]).setFontWeight('bold');
  sessions.setFrozenRows(1);
  readUsers_().forEach(u => sendResetEmail_(u, true));
}
