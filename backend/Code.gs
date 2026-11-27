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

// Restaurants and inventories are read from the "Restaurants" and "Inventories" tabs,
// so a new restaurant or inventory can be added in the Sheet without changing code.
// These defaults are used only if those tabs do not exist yet.
const DEFAULT_RESTAURANTS = [
  { name: 'Zoutra', colour: '#1e4d2b', logo: 'zoutra' },
  { name: 'Adraba', colour: '#6b1f2e', logo: 'adraba' }
];
const DEFAULT_INVENTORIES = [
  { key: 'zoutra',         name: 'Zoutra',         restaurant: 'Zoutra', type: 'Wine & Alcohol', prefix: 'Z',  active: true  },
  { key: 'adraba-wine',    name: 'Adraba Wine',    restaurant: 'Adraba', type: 'Wine',           prefix: 'AW', active: true  },
  { key: 'adraba-alcohol', name: 'Adraba Alcohol', restaurant: 'Adraba', type: 'Alcohol',        prefix: 'AA', active: true  },
  { key: 'zoutra-food',    name: 'Zoutra Food',    restaurant: 'Zoutra', type: 'Food',           prefix: 'ZF', active: false },
  { key: 'adraba-food',    name: 'Adraba Food',    restaurant: 'Adraba', type: 'Food',           prefix: 'AF', active: false }
];
const UNITS = ['kg', 'g', 'L', 'piece', 'box', 'bottle'];
const RESTAURANTS = 'Restaurants', INVENTORIES_TAB = 'Inventories';
const USERS = 'Users', SESSIONS = 'Sessions', SETTINGS = 'Settings', HISTORY = 'History', ACTIVITY = 'Activity';
const ROLES = { '': 0, 'count': 1, 'manager': 2 };
const APP_URL_DEFAULT = 'https://arbahospitality.github.io/inventory/';
const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
const LOGIN_FAILS = 5, LOGIN_LOCK_SECONDS = 15 * 60;   // per account
const HASH_ROUNDS = 2000;
const MIN_PASSWORD = 10;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Users tab: columns are found by their header, so their order does not matter.
// There is one access column per inventory (named like the inventory); missing ones are added.
const UH = { name: 'Name', email: 'Email', status: 'Status', owner: 'Owner', hash: 'Password (hashed)',
             resetHash: 'Reset (hashed)', resetExp: 'Reset expires', created: 'Created', approvedBy: 'Approved by' };

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
    case 'login':         return login_(r.email, r.password, r.device, r.inv);
    case 'forgot':        return forgot_(r.email);
    case 'resetPassword': return resetPassword_(r.email, r.token, r.password);
  }
  const s = session_(r.token);
  const user = s.user;
  switch (r.action) {
    case 'me':             return me_(user);
    case 'start':          return start_(user, r.inv);
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
let INV_ = null, REST_ = null;
/* Short-lived copies kept in Google's script cache, so most requests do not read the Sheet. */
const CACHE_ = CacheService.getScriptCache();
function cget_(k) { const v = CACHE_.get(k); return v ? JSON.parse(v) : null; }
function cput_(k, v, seconds) { try { CACHE_.put(k, JSON.stringify(v), seconds); } catch (e) { /* too big: skip */ } }
function cdel_(k) { CACHE_.remove(k); }
function yes_(v) { return /^(yes|y|true|1|oui|on)$/i.test(String(v).trim()); }
function slug_(s) { return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
/** All inventories (also switched-off ones). */
function allInventories_() {
  if (INV_) return INV_;
  if ((INV_ = cget_('inventories'))) return INV_;
  const sh = ss_().getSheetByName(INVENTORIES_TAB);
  if (!sh || sh.getLastRow() < 2) return (INV_ = DEFAULT_INVENTORIES.map(i => Object.assign({ tab: i.name }, i)));
  INV_ = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues().filter(r => String(r[1]).trim()).map(r => {
    const name = String(r[1]).trim();
    return { key: String(r[0]).trim() || slug_(name), name: name, tab: name, restaurant: String(r[2]).trim(),
             type: String(r[3]).trim() || 'Wine', prefix: String(r[4]).trim() || name.slice(0, 2).toUpperCase(), active: yes_(r[5]) };
  });
  cput_('inventories', INV_, 300);   // edits in the Inventories tab show within 5 minutes
  return INV_;
}
function inventories_() { return allInventories_().filter(i => i.active); }
function restaurants_() {
  if (REST_) return REST_;
  if ((REST_ = cget_('restaurants'))) return REST_;
  const sh = ss_().getSheetByName(RESTAURANTS);
  REST_ = (!sh || sh.getLastRow() < 2) ? DEFAULT_RESTAURANTS
    : sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().filter(r => String(r[0]).trim())
        .map(r => ({ name: String(r[0]).trim(), colour: String(r[1]).trim() || '#1e4d2b', logo: String(r[2]).trim() }));
  cput_('restaurants', REST_, 300);
  return REST_;
}
function isFood_(inv) { return /food|cuisine|nourriture/i.test(inv.type); }
function inv_(key) {
  const inv = inventories_().find(i => i.key === key);
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
/**
 * New passwords: at least 10 characters, and not a common / easily guessed one.
 * The check strips "leet" spelling and digits or symbols at the ends, so
 * "P@ssword2026!" counts as "password". Names of the user and the business
 * do not count as letters ("Zoutra2026!!" is refused).
 */
function checkNewPassword_(pw, name, email) {
  pw = String(pw || '');
  if (pw.length < MIN_PASSWORD) throw new Error('The password needs at least ' + MIN_PASSWORD + ' characters.');
  if (pw.length > 200) throw new Error('The password is too long.');
  const why = weakPassword_(pw, name, email);
  if (why) throw new Error(why + ' Tip: use 3 or 4 words, e.g. "blue cellar tuesday".');
  return pw;
}

function normPw_(s) {
  const leet = { '@': 'a', '4': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't' };
  const ends = x => x.replace(/^[^a-zà-ÿ]+|[^a-zà-ÿ]+$/g, '');
  // first drop digits/symbols at the ends ("monkey123456"), then undo leet inside ("p@ssw0rd")
  return ends(ends(s.toLowerCase()).replace(/[@431!0$57]/g, ch => leet[ch]));
}
let BLOCKED_SET_ = null;
function weakPassword_(pw, name, email) {
  const low = pw.toLowerCase();
  if (/^\d+$/.test(pw)) return 'Use letters too, not only numbers.';
  if (/^(.{1,4})\1+$/.test(low)) return 'This password is too simple.';
  const rows = ['abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', 'azertyuiopqsdfghjklmwxcvbn', '01234567890'];
  const compact = low.replace(/[^a-z0-9]/g, '');
  if (compact.length >= 6 && rows.some(r => r.includes(compact) || r.split('').reverse().join('').includes(compact))) return 'This password is too easy to guess.';
  if (!BLOCKED_SET_) BLOCKED_SET_ = new Set(BLOCKED_PASSWORDS.split(' '));
  const n = normPw_(pw);
  if (BLOCKED_SET_.has(n) || BLOCKED_SET_.has(n.replace(/[^a-z]/g, ''))) return 'This password is too common.';
  // remove the person's name / email and the business names: what is left must still be a real password
  const words = ['zoutra', 'adraba', 'amfora', 'inventory', 'inventaire', 'password', 'motdepasse', 'paris']
    .concat(String(name || '').toLowerCase().split(/[^a-zà-ÿ]+/))
    .concat(String(email || '').toLowerCase().split('@')[0].split(/[^a-zà-ÿ]+/))
    .filter(w => w.length >= 3);
  let rest = n.replace(/[^a-zà-ÿ]/g, '');
  words.forEach(w => { rest = rest.split(w).join(''); });
  if (rest.length < 4 || BLOCKED_SET_.has(rest)) return 'This password is too easy to guess (it is mostly your name or the business name).';
  return '';
}

/* ---------------- users ---------------- */

function userCols_() {
  const sh = sheet_(USERS);
  const head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0].map(x => String(x).trim());
  const map = {};
  head.forEach((h, i) => { if (h && !map[h]) map[h] = i + 1; });
  return { map: map, width: head.length };
}
/** Adds any missing column (an access column for a new inventory, for example). */
function ensureUserCols_() {
  const sh = sheet_(USERS);
  const need = Object.keys(UH).map(k => UH[k]).concat(allInventories_().map(i => i.name));
  let cols = userCols_();
  need.filter(h => !cols.map[h]).forEach(h => {
    sh.getRange(1, cols.width + 1).setValue(h).setFontWeight('bold');
    cols = userCols_();
  });
  return cols;
}
/** All users. Reads the Sheet at most every 2 minutes unless fresh is true (always fresh before a change). */
function readUsers_(fresh) {
  if (!fresh) { const c = cget_('users'); if (c) return c; }
  const list = readUsersFromSheet_();
  cput_('users', list, 120);
  return list;
}
function usersChanged_() { cdel_('users'); }
function readUsersFromSheet_() {
  const sh = sheet_(USERS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = userCols_(), m = cols.map;
  const get = (r, h) => m[h] ? r[m[h] - 1] : '';
  return sh.getRange(2, 1, last - 1, cols.width).getValues().map((r, i) => {
    const roles = {};
    allInventories_().forEach(inv => { roles[inv.key] = normRole_(get(r, inv.name)); });
    return {
      row: i + 2, name: String(get(r, UH.name)).trim(), email: cleanEmail_(get(r, UH.email)),
      status: String(get(r, UH.status)).trim() || 'Pending',
      owner: /^(yes|y|true|1|owner)$/i.test(String(get(r, UH.owner)).trim()), roles: roles,
      hash: String(get(r, UH.hash) || ''), resetHash: String(get(r, UH.resetHash) || ''),
      resetExp: Number(get(r, UH.resetExp)) || 0, created: String(get(r, UH.created) || ''),
      approvedBy: String(get(r, UH.approvedBy) || '')
    };
  }).filter(u => u.email);
}
function findUser_(email, fresh) { email = cleanEmail_(email); return readUsers_(fresh).find(u => u.email === email) || null; }
function normRole_(v) {
  v = String(v || '').trim().toLowerCase();
  if (v.startsWith('man')) return 'manager';
  if (v.startsWith('count')) return 'count';
  return '';
}
function roleOf_(user, key) { return user.owner ? 'manager' : (user.roles[key] || ''); }
function roleLabel_(r) { return r === 'manager' ? 'Manager' : r === 'count' ? 'Count' : ''; }
/** Row of a user in the Sheet right now (never from the cache). */
function userRow_(email) {
  const sh = sheet_(USERS), cols = userCols_(), last = sh.getLastRow();
  if (last < 2) return 0;
  const emails = sh.getRange(2, cols.map[UH.email], last - 1, 1).getValues();
  for (let i = 0; i < emails.length; i++) if (cleanEmail_(emails[i][0]) === cleanEmail_(email)) return i + 2;
  return 0;
}
/** Writes cells of one user by header name: setUser_('a@b.com', { 'Status': 'Active' }). */
function setUser_(email, values) {
  const cols = ensureUserCols_(), sh = sheet_(USERS), row = userRow_(email);
  if (!row) throw new Error('Team member not found.');
  Object.keys(values).forEach(h => sh.getRange(row, cols.map[h]).setValue(values[h]));
  usersChanged_();
}
function rolesCells_(roles) {
  const o = {};
  allInventories_().forEach(i => { o[i.name] = roleLabel_(normRole_((roles || {})[i.key])); });
  return o;
}

function need_(user, key, min) {
  inv_(key);
  if (ROLES[roleOf_(user, key)] < ROLES[min]) throw new Error('You do not have access to this.');
}
function owner_(user) { if (!user.owner) throw new Error('Only an owner can do this.'); }

function me_(user) {
  const invs = inventories_().filter(i => roleOf_(user, i.key));
  return {
    name: user.name, email: user.email, owner: user.owner,
    inventories: invs.map(i => ({ key: i.key, name: i.name, restaurant: i.restaurant, type: i.type, role: roleOf_(user, i.key) })),
    restaurants: restaurants_().filter(r => invs.some(i => i.restaurant === r.name))
  };
}

/* ---------------- register / login / sessions ---------------- */

function register_(name, email, password) {
  name = String(name || '').trim().slice(0, 60);
  email = cleanEmail_(email);
  if (!name) throw new Error('Please enter your name.');
  if (!validEmail_(email)) throw new Error('Please enter a valid email address.');
  checkNewPassword_(password, name, email);
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('registrations') || 0);
  if (n >= 20) throw new Error('Too many sign-up requests right now. Try again in an hour.');
  cache.put('registrations', String(n + 1), 3600);
  return withLock_(() => {
    if (findUser_(email, true)) throw new Error('An account with this email already exists. Log in, or use "Forgot password".');
    const cols = ensureUserCols_();
    const row = new Array(cols.width).fill('');
    const put = (h, v) => { row[cols.map[h] - 1] = v; };
    put(UH.name, safe_(name)); put(UH.email, email); put(UH.status, 'Pending'); put(UH.owner, 'No');
    put(UH.hash, hashPassword_(password)); put(UH.created, now_());
    sheet_(USERS).appendRow(row);
    usersChanged_();
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

function login_(email, password, device, invKey) {
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
  return Object.assign({ token: token, expires: expires }, start_(u, invKey));
}

/** What the app needs when it opens: who you are + the inventory you last used (one request instead of two). */
function start_(user, invKey) {
  const me = me_(user);
  if (!me.inventories.length) return { me: me, inventory: null };
  const key = me.inventories.some(i => i.key === invKey) ? invKey : me.inventories[0].key;
  return { me: me, inventory: getInventory_(key) };
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
  readSessions_().filter(s => s.email === email && s.hash !== exceptHash).reverse().forEach(s => { sh.deleteRow(s.row); cdel_('s:' + s.hash); });
}

function session_(token) {
  token = String(token || '');
  if (token.length < 40) throw authError_('Please log in.');
  const h = sha256Hex_(token);
  let s = cget_('s:' + h);
  if (!s) {
    s = readSessions_().find(x => x.hash === h);
    if (s) cput_('s:' + h, { email: s.email, expires: s.expires }, 6 * 3600);
  }
  if (!s || s.expires < Date.now()) throw authError_('Your login has expired. Please log in again.');
  const user = findUser_(s.email);
  if (!user || user.status !== 'Active') throw authError_('This account is no longer active.');
  return { hash: h, user: user };
}

function logout_(s) {
  withLock_(() => {
    const row = readSessions_().find(x => x.hash === s.hash);
    if (row) sheet_(SESSIONS).deleteRow(row.row);
    cdel_('s:' + s.hash);
  });
  return true;
}

function changePassword_(user, s, current, password) {
  if (!checkPassword_(String(current || ''), user.hash)) throw new Error('Your current password is not correct.');
  checkNewPassword_(password, user.name, user.email);
  return withLock_(() => {
    setUser_(user.email, { [UH.hash]: hashPassword_(password) });
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
  setUser_(u.email, { [UH.resetHash]: sha256Hex_(token), [UH.resetExp]: Date.now() + minutes * 60000 });
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
  return withLock_(() => {
    const u = findUser_(email, true);
    if (!u || !u.resetHash || u.resetHash !== sha256Hex_(String(token || '')) || u.resetExp < Date.now()) {
      throw new Error('This link is not valid any more. Ask for a new one with "Forgot password".');
    }
    checkNewPassword_(password, u.name, u.email);
    setUser_(u.email, { [UH.hash]: hashPassword_(password), [UH.resetHash]: '', [UH.resetExp]: '' });
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
function accessText_(owner, roles) {
  return owner ? 'Owner' : allInventories_().map(i => roles[i.key] ? i.name + ': ' + roleLabel_(roles[i.key]) : '').filter(Boolean).join(', ') || 'No access';
}
function activeOwners_(users) { return users.filter(x => x.owner && x.status === 'Active'); }

function approveUser_(me, email, roles, owner) {
  return withLock_(() => {
    const u = findUser_(email, true);
    if (!u) throw new Error('Team member not found.');
    if (u.status !== 'Pending') throw new Error('This account is not waiting for approval.');
    const rc = rolesCells_(roles);
    if (!owner && !Object.keys(rc).some(k => rc[k])) throw new Error('Choose at least one inventory before approving.');
    setUser_(u.email, Object.assign({ [UH.status]: 'Active', [UH.owner]: owner ? 'Yes' : 'No', [UH.approvedBy]: safe_(me.name) }, rc));
    const r = {}; allInventories_().forEach(i => { r[i.key] = normRole_((roles || {})[i.key]); });
    log_(me, '', 'Approved team member', u.name, accessText_(!!owner, r));
    MailApp.sendEmail(u.email, 'Inventory app: your account is approved',
      'Hello ' + u.name + ',\n\nYour account has been approved. You can now log in:\n' + appUrl_(), { name: 'Inventory app' });
    return listUsers_();
  });
}

/** Edit an active or blocked member: name, owner flag, roles. */
function saveUser_(me, x) {
  return withLock_(() => {
    const users = readUsers_(true);
    const u = users.find(y => y.email === cleanEmail_(x.email));
    if (!u) throw new Error('Team member not found.');
    const name = String(x.name || '').trim().slice(0, 60);
    if (!name) throw new Error('Please enter a name.');
    const owner = !!x.owner;
    if (u.owner && !owner && activeOwners_(users).length === 1 && u.status === 'Active') throw new Error('There must always be at least one owner.');
    setUser_(u.email, Object.assign({ [UH.name]: safe_(name), [UH.owner]: owner ? 'Yes' : 'No' }, rolesCells_(x.roles)));
    const r = {}; allInventories_().forEach(i => { r[i.key] = normRole_((x.roles || {})[i.key]); });
    log_(me, '', 'Edited team member', name, accessText_(owner, r) + (u.name !== name ? ' (was ' + u.name + ')' : ''));
    return listUsers_();
  });
}

function setBlocked_(me, email, blocked) {
  return withLock_(() => {
    const users = readUsers_(true);
    const u = users.find(y => y.email === cleanEmail_(email));
    if (!u) throw new Error('Team member not found.');
    if (u.email === me.email) throw new Error('You cannot block yourself.');
    if (blocked && u.owner && activeOwners_(users).length === 1) throw new Error('There must always be at least one owner.');
    setUser_(u.email, { [UH.status]: blocked ? 'Blocked' : 'Active' });
    if (blocked) revokeSessions_(u.email, null);
    log_(me, '', blocked ? 'Blocked team member' : 'Unblocked team member', u.name, blocked ? 'Logged out everywhere' : '');
    return listUsers_();
  });
}

function removeUser_(me, email) {
  return withLock_(() => {
    const users = readUsers_(true);
    const u = users.find(y => y.email === cleanEmail_(email));
    if (!u) throw new Error('Team member not found.');
    if (u.email === me.email) throw new Error('You cannot remove yourself.');
    if (u.owner && activeOwners_(users).length === 1) throw new Error('There must always be at least one owner.');
    revokeSessions_(u.email, null);
    sheet_(USERS).deleteRow(userRow_(u.email));
    usersChanged_();
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

// Product tabs: ID | Category | Supplier | Product Name | Q | H.T | Value | Counted by | Counted at | Unit
function readProducts_(inv) {
  const sh = sheet_(inv.tab);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const food = isFood_(inv);
  return sh.getRange(2, 1, last - 1, 10).getValues()
    .filter(r => r[0] !== '' && r[3] !== '')
    .map(r => ({
      id: String(r[0]), category: String(r[1]), supplier: String(r[2]), name: String(r[3]),
      q: r[4] === '' ? null : Number(r[4]), price: Number(r[5]) || 0,
      by: String(r[7] || ''), at: r[8] instanceof Date ? Utilities.formatDate(r[8], 'Europe/Paris', 'yyyy-MM-dd HH:mm') : String(r[8] || ''),
      unit: food ? (String(r[9] || '').trim() || 'piece') : 'bottle'
    }));
}

function getInventory_(key) {
  const inv = inv_(key);
  const products = readProducts_(inv);
  const cats = categories_(inv);
  products.forEach(p => { if (p.category && cats.indexOf(p.category) < 0) cats.push(p.category); });
  return { key: inv.key, name: inv.name, restaurant: inv.restaurant, type: inv.type, food: isFood_(inv),
           units: isFood_(inv) ? UNITS : [], categories: cats, products: products };
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

function cleanProduct_(p, inv) {
  const name = String(p.name || '').trim().slice(0, 120);
  const category = String(p.category || '').trim().slice(0, 40);
  if (!name || !category) throw new Error('Name and category are required.');
  const price = Number(p.price) || 0;
  if (price < 0 || price > 100000) throw new Error('Not a valid price.');
  let unit = '';
  if (isFood_(inv)) {
    unit = String(p.unit || '').trim();
    if (UNITS.indexOf(unit) < 0) throw new Error('Choose a unit.');
  }
  return { name: name, category: category, supplier: String(p.supplier || '').trim().slice(0, 60), price: price, unit: unit };
}

function addProduct_(user, key, p) {
  const inv = inv_(key);
  const c = cleanProduct_(p, inv);
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
    sh.getRange(after + 1, 8, 1, 3).setValues([['', '', c.unit]]);
    log_(user, inv.name, 'Added product', c.name, [c.category, c.supplier, c.price.toFixed(2) + ' €' + (c.unit ? ' / ' + c.unit : '')].filter(Boolean).join(' · '));
    return getInventory_(key);
  });
}

function updateProduct_(user, key, p) {
  const inv = inv_(key);
  const c = cleanProduct_(p, inv);
  return withLock_(() => {
    const row = findRow_(inv, p.id);
    const sh = sheet_(inv.tab);
    const old = sh.getRange(row, 1, 1, 10).getValues()[0];
    sh.getRange(row, 2, 1, 3).setValues([[safe_(c.category), safe_(c.supplier), safe_(c.name)]]);
    sh.getRange(row, 6).setValue(c.price);
    if (c.unit) sh.getRange(row, 10).setValue(c.unit);
    const changes = [];
    if (String(old[3]) !== c.name) changes.push('name: ' + old[3] + ' → ' + c.name);
    if (String(old[1]) !== c.category) changes.push('category: ' + old[1] + ' → ' + c.category);
    if (String(old[2]) !== c.supplier) changes.push('supplier: ' + old[2] + ' → ' + c.supplier);
    if (Number(old[5]) !== c.price) changes.push('price: ' + Number(old[5]).toFixed(2) + ' → ' + c.price.toFixed(2) + ' €');
    if (c.unit && String(old[9]) !== c.unit) changes.push('unit: ' + (old[9] || '–') + ' → ' + c.unit);
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
  const food = isFood_(inv);
  const missing = products.filter(p => p.q === null).length;
  const bottles = products.reduce((s, p) => s + (p.q || 0), 0);
  const value = products.reduce((s, p) => s + (p.q || 0) * p.price, 0);
  const body =
    'Hello,\n\nPlease find attached the ' + inv.name + ' inventory for ' + month + '.\n\n' +
    (food ? 'Products counted: ' + (products.length - missing) + ' / ' + products.length + '\n' : 'Total bottles: ' + round2_(bottles) + '\n') +
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
    p.q === null ? 0 : p.q, p.price, round2_((p.q || 0) * p.price), p.unit]);
  const hs = sheet_(HISTORY);
  if (hist.length) hs.getRange(hs.getLastRow() + 1, 1, hist.length, hist[0].length).setValues(hist);
  log_(user, inv.name, 'Sent to office', month, 'To ' + to + (cc ? ' (copy ' + cc + ')' : '') + ' · ' + (food ? '' : round2_(bottles) + ' bottles · ') + '' + round2_(value).toFixed(2) + ' €' + (missing ? ' · ' + missing + ' not counted' : ''));

  return { to: to, cc: cc, bottles: round2_(bottles), value: round2_(value) };
}

/* ---------------- one-time setup (run from the editor) ---------------- */

/** Run once from the editor to grant permissions (this spreadsheet + send email). */
function authorize() {
  readUsers_();
  MailApp.getRemainingDailyQuota();
}

/**
 * Run once from the editor (already done on 27 Nov 2026): resets the Users tab to the two
 * owners, creates the Sessions tab, and emails them a link to set their password.
 */
function setupAccounts() {
  const owners = [['David', 'david@adraba-paris.com'], ['Eden', 'eden@adraba-paris.com']];
  const ss = ss_();
  const users = ss.getSheetByName(USERS);
  users.clear();
  const head = Object.keys(UH).map(k => UH[k]).concat(allInventories_().map(i => i.name));
  users.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
  users.setFrozenRows(1);
  owners.forEach(([name, email]) => {
    const row = head.map(h => h === UH.name ? name : h === UH.email ? email : h === UH.status ? 'Active' : h === UH.owner ? 'Yes'
      : h === UH.created ? now_() : h === UH.approvedBy ? 'Setup' : allInventories_().some(i => i.name === h) ? 'Manager' : '');
    users.appendRow(row);
  });
  usersChanged_();
  let sessions = ss.getSheetByName(SESSIONS);
  if (!sessions) sessions = ss.insertSheet(SESSIONS);
  sessions.clear();
  sessions.getRange(1, 1, 1, 5).setValues([['Token (hashed)', 'Email', 'Created', 'Expires (ms)', 'Device']]).setFontWeight('bold');
  sessions.setFrozenRows(1);
  readUsers_(true).forEach(u => sendResetEmail_(u, true));
}

/**
 * Run once from the editor: adds the Restaurants and Inventories tabs (edit them to add a
 * restaurant or switch an inventory on), the food tabs (switched off), the Unit columns,
 * and the access columns in Users. Safe to run again: it never deletes anything.
 */
function setupRestaurants() {
  const ss = ss_();
  const bold = (sh, row) => sh.getRange(1, 1, 1, row.length).setValues([row]).setFontWeight('bold');
  let r = ss.getSheetByName(RESTAURANTS);
  if (!r) {
    r = ss.insertSheet(RESTAURANTS);
    bold(r, ['Restaurant', 'Colour', 'Logo']);
    DEFAULT_RESTAURANTS.forEach(x => r.appendRow([x.name, x.colour, x.logo]));
    r.setFrozenRows(1);
  }
  let t = ss.getSheetByName(INVENTORIES_TAB);
  if (!t) {
    t = ss.insertSheet(INVENTORIES_TAB);
    bold(t, ['Key', 'Inventory (tab name)', 'Restaurant', 'Type', 'ID prefix', 'Active']);
    DEFAULT_INVENTORIES.forEach(x => t.appendRow([x.key, x.name, x.restaurant, x.type, x.prefix, x.active ? 'Yes' : 'No']));
    t.setFrozenRows(1);
  }
  INV_ = null; REST_ = null; cdel_('inventories'); cdel_('restaurants'); usersChanged_();
  allInventories_().forEach(inv => {
    let sh = ss.getSheetByName(inv.tab);
    if (!sh) {
      sh = ss.insertSheet(inv.tab);
      bold(sh, ['ID', 'Category', 'Supplier', 'Product Name', 'Q', 'H.T', 'Value', 'Counted by', 'Counted at', 'Unit']);
      sh.getRange('G1').setFormula('={"Value";ARRAYFORMULA(IF(E2:E="";"";E2:E*F2:F))}');
      sh.setFrozenRows(1);
    } else if (!String(sh.getRange(1, 10).getValue())) {
      sh.getRange(1, 10).setValue('Unit').setFontWeight('bold');
    }
    if (!getSetting_('Categories: ' + inv.name) && isFood_(inv)) {
      sheet_(SETTINGS).appendRow(['Categories: ' + inv.name, 'Viande, Poisson, Légumes et fruits, Crèmerie, Épicerie, Surgelés, Boulangerie, Boissons', '']);
    }
  });
  const h = sheet_(HISTORY);
  if (!String(h.getRange(1, 12).getValue())) h.getRange(1, 12).setValue('Unit').setFontWeight('bold');
  ensureUserCols_();
}

/* ---------------- common passwords ---------------- */
// About 7,600 base words of the most used passwords (UK NCSC "100k most used" list via SecLists,
// top 10,000, lower-cased, leet and end digits removed) plus some French and wine-trade words.
const BLOCKED_PASSWORDS = 'aaaa aaaaa aaaaaa aaaaaaa aaaaaaaa aaaaaaaaa aaaaaaaaaa aaaaaaai aaaaaai aaaaai aaaaiiii aaaiii aaasss aaliyah aaliyahi aardvark aaron aaronaei aaroni aass abby abcabc abcd abcde abcdef abcdefg abcdefgh abcdefghi abcdefghij abcdefgi abcdefi abcdei abcdi abdullah aberdeen abhishek abigail abigaili abiodun abracadabra abraham abrakadabra access accord account accounti achildren achilles acmilan action acuario adam adami addison addisoni adebayo adekunle adelaide adelina adeline adeola adewale adgjm adgjmp adgjmptw adidas adidasi aditya admin admini administrator adonis adrian adriana adrianai adriani adriano adrien adrienne adventure aeaeae aerosmith aezakmi africa africai againi agentoot agnieszka agosto agustin ahmed aiaiai aiaiaiai aideni aiiiii aiiiiii aikido aileen airborne airforce airforcei airplane aishiteru akatsuki alabama alabamai alaska alaskai albatros albert alberti alberto albertoi albina alegria alejandra alejandrai alejandro alejandroi aleksandr aleksandra aleksey alenka alessandra alessandro alessia alessio alex alexa alexai alexalex alexander alexanderi alexandr alexandra alexandrai alexandre alexandria alexandru alexey alexi alexia alexie alexii alexio alexis alexisi alexiso alexoi alfaromeo alfonso alfred alfredo alfredoi algerie aliali alibaba alice alicei alicia aliciai aliens alina alinka alisha alishai alison alisoni alissa alladint allah allahi allaht allahu allan allaone allen alleni alliance alliei allison allisoni allstar allstari almighty almond alondra alonso alpha alphai alpine alucard alvarez alvaro alvin always alwaysi alyssa alyssai amadeus amalia amanda amandai amandine amarillo amazing amazingi amazon amber amberi amelia ameliai amelie america americai americaio american americani amerika amethyst amigas amigos amistad amor amorcito amore amoremio amores amormio amour amoure amours amsterdam amsterdami amyspace anaconda anakin anamaria ananas anarchy anarchyi anastasia anastasiya anderson andersoni andre andrea andreai andreas andreasi andreea andrei andrej andres andresi andrew andrewi andrewii andrewoi andrey andromeda andy anfield angel angela angelai angelbaby angelbabyi angele angeles angeleyes angeli angelia angelica angelicai angelie angelii angelika angelina angelinai angeline angelio angelioi angelique angelis angelit angelito angelo angeloi angelot angels angelsi angelt angelus angie angiei anhyeuem animal animali animals animalsi anime animei anita anitai anjali anjing ankara anna annabelle annalisa annamaria anne annette annettei annie anniei annika answer antares anthony anthonye anthonyi anthonyt antoine anton antonella antonia antonio antonioi antony anubis anuradha anything anythingi aoaoao aooooo aoooooo aooose apache apero apollo apolloi apolloie apple applei applepie applepiei apples applesi april aprili aprilia aprilie aprilii aprilio aprilis aprilit aptxa aquarius aqwzsx aragorn archana archer archie archiei architect areasi argentina argentinai ariana arianai ariane arianna ariannai ariel arieli aries arizona arizonai arlene armagedon armando armandoi armani armstrong arnaud arnold arnoldi arschloch arsenal arsenali arsenalia artemis artemka arthur arthuri artist arturo arunner asasas asasasas asdas asdasd asdasdasd asdasdi asdasds asddsa asdf asdfasdf asdfasdfi asdffdsa asdfg asdfgh asdfghi asdfghj asdfghji asdfghjk asdfghjkl asdfghjkli asdfgi asdfi asdfjkl asdfzxcv asdqwe asdzxc ashish ashlee ashleei ashleigh ashleighi ashley ashleyi ashleyie ashleyii ashleyoi ashleyt ashton ashtoni aspire aspirine asroma assasin assass assassi assassin asshole assholei assman asterix astonvilla astrid atatat athena athenai atlanta atlantai atlantis attila attitude aubrey auburn auburni audiaa audiae audrey audreyi august augusti augustie augustii aurelie aurora aurore aussie austin austinei austini australia australiai autumn autumni avalon avatar awesome awesomei awful awsome axio ayesha ayomide azamat azazaz azerty azertyi azertyui azertyuiop azsxdc azsxdcfv aztnm baba babatunde babe babies baby babybaby babybear babyblue babybluei babyboo babybooi babyboy babyboyi babycakes babycakesi babydoll babydolli babyface babyfacei babygirl babygirla babygirle babygirli babygirlia babygirlie babygirlii babygirlio babygirlis babygirlo babygirloi babygirls babygirlt babygurl babygurli babyi babyia babyie babyii babyio babyioi babyis babyko babylon babylons babylove babylovei babyo babyoi babyot babyphati bacardi bacchus backend backspace backspacei badass badassi badbitchi badboy badboyi badboys badger badgeri badgirl badgirli badman badminton badoo bagira bailey baileyi baileyoi bajingan baker bakere bakeri balaji balance baller balleri ballet ballin ballini balls ballsi bambam bambami bambino bamboo banana bananai bananaii bananas bananasi banane bandit banditi bandung bangalore bangbang bangladesh banshee barbados barbara barbarai barbie barbiei barcelona barcelonai barcelone barkley barman barney barneyi barselona barsik bartek baseball baseballa baseballe baseballi baseballia baseballie baseballii baseballio baseballis baseballs baseballt basket basketbali basketball basketballi basketi bass bassman bastard bastardi batista batistai batman batmani battle battlefield bautista baxter baxteri bayern bball bballi bbbbbb beach beaches beachi beagle beaner beaneri beanie bear bearbear bearshare bearsi beast beasti beatles beatlesi beatrice beatriz beautiful beautifuli beauty beautyi beaver beaveri beavis bebe beccai beckham beckhamt becky beckyi beer beethoven beetle behappy believe believei belinda bella bellai belle bellei bellissima beloved benben bender benedict benfica bengalsi benito benjamin benjamini benji benjii bennett benny bennyi benoit benson bentley bentleyi berlin bernadette bernard bernardi bernardo bernie bertha bertie besiktas bessie best bestfriend bestfriends bethany bethanyi better betty bettyboop bettyboopi bettyi beverly beverlyi beyonce beyoncei bharat bhbirf bhebhe bianca biancai bigbang bigben bigbird bigboss bigboy bigboyi bigcock bigdaddy bigdaddyi bigdick bigdicki bigdog bigdogi bigfoot bigfooti biggie biggiei bigheadi bigmac bigman bigmani bigmoney bigmoneyi bigpimpini bigred bigredi bigtits bill billabong billabongi billie billiei billy billybob billybobi billyboy billyi bingo bingoi bintang biology bionicle birdie birdman birdmani birthday birthdayi biscuit biscuiti bishop bishopi bismillah bisous bitch bitchassi bitche bitches bitchesi bitchi bitchie bitchii bitchioi bitchoi bitchs bitcht bitchyi biteme bitemei blabla blablabla blablai black blackberry blackbird blackcat blackdog blackhawk blacki blackie blackiei blackjack blackjacki blackman blackops blackrose blacky blackyi blade bladei blades blah blahblah blahblahi blake blakei blanca blank blastedi blaster blazei blazer blazeri bleach bleachi blessed blessedi blessing blessingi blessings blingbling blink blinki blizzard blizzardi blonde blondei blondie blondiei blood bloodi bloods bloodsi bloody bloodyi blossom blossomi blowjob blowme blowmei blue bluea bluebell blueberry blueberryi bluebird bluebirdi blueblue bluee blueeyes blueeyesi bluefish bluei blueie blueii blueio bluemoon bluesky bobbie bobbob bobbobi bobby bobbyi bobcat bobmarley bobmarleyi bobo bobobo bogart bogdan bollocks bollox bologna bomber bonbon bondoot bonehead bonesi bonheur bonita bonitai bonjour bonjovi bonnie bonniei bonsai boobear boobeari boobies boobiesi booboo boobooi boobs boobsi booger boogeri boogie boogiei bookmark bookworm boomboom boomer boomeri bootsi booty bootyi bordeaux boricua boricuai boris borussia boss bossman bossmani bossyi boston bostoni boubou bounty bourgogne bowling bowlingi bowwow bowwowi boxcar boxing bozo bradford bradley bradleyi bradyi brandi brandii brandon brandoni brandy brandyi brasil bratzi braveheart braves bravesi brayden braydeni brazil brazili breanna breannai breeze brenda brendai brendan brendani bretagne brian briana brianai briani brianna briannai briciola bridge bridget bridgeti bright brighton brigitte bristol britney britneyi brittany brittanyi britti brittney brittneyi broadway brodie broken brokeni bronco broncos broncosi brooke brookei brooklyn brooklyni brooks brother brotheri brothers brown browni brownie browniei browns bruce brucei brucelee bruins bruno brunoi brutus brutusi bryan bryani bryant bscirc bubba bubbai bubble bubblegum bubblegumi bubblei bubbles bubblesi buckeye buckeyei buckeyes buckeyesi budapest buddha buddhai buddie buddy buddyboy buddyi budlight budlighti budweiser budweiseri buffalo buffaloi buffy buffyi bugger bugsbunny bugsbunnyi bulldog bulldogi bulldogs bulldogsi bullet bulleti bullshit bullshiti bumblebee bumbum bunnies bunny bunnyi burger burrito burton burtoni bushido bushidoi business businessi busted bustedi buster busteri busterii busteroi butchi butler butt butter buttercup buttercupi butterfly butterflye butterflyi butterflyt butteri butthead buttheadi butthole buttholei button buttons buttonsi byebye caballo cabbage caca cactus cadillac cadillaci caeqpulsrz caesar cafemom caitlin caitlini caitlyn calebi caliente california calimero caline callie calliei callofduty callum calvin calvini camaro camaroi camaroz cambiami cambridge camelot camera camerai cameroi cameron cameroni camila camilla camille camillei camilo campbell canada canadai cancel cancer canceri cancun candice candicei candle candy candycanei candyi candyman canela cannabis cannon cantik cantona cantonat canyon capone caprice capricorn capricorni capslock captain captaini caramel carameli caramelo caravan carbon cardinal cardinals cardinalsi carebear carebeari career carina carla carlitos carlo carlos carlosi carlotta carlton carmel carmela carmelo carmelois carmen carmeni carol carola carole caroli carolina carolinai caroline carolinei carolyn carolyni carpediem carrie carriei carrot carson carsoni carter carteri cartman cartmani cartoon casablanca casanova casey caseyi cashmoney cashmoneyi casino casper casperi cassandra cassandrai cassidy cassidyi cassie cassiei castillo castle castro catalin catalina catania catarina catcat catch catdog catdogi caterina catfish catfishi catherine catherinei cathy cats catwoman cavalier cavallo cazzo cazzone cccccc cdtnkfyf cecile cecilia ceciliai cedric celeron celeste celestei celica celina celine cellphone cellphonei celtic celtici celtics center central centrali cepetsugih cerise cesar cessna cevthrb cfitymrf cgfhnfr chacha chachai champagne champi champion championi chance chancei chandler chandleri chandra chanel chaneli change changei changeme changemei chantal chaos chaosi charger chargeri chargers chargersi charity charlene charles charlesi charley charlie charliee charliei charlotte charlottei charly charmed charmedi charming chase chasei chaton cheater cheateri cheche cheer cheeri cheese cheesecake cheesei cheeset cheetah cheetahi chelsea chelseafc chelseai chemical chemistry chennai cherie cherokee cherokeei cherries cherry cherryi cheryl chester chesteri cheval chevelle chevrolet chevroleti chevy chevyi chevysio chewyi cheyenne cheyennei chiara chicago chicagoi chicca chicco chichi chichii chicken chickeni chickens chico chicoi chiefs chihuahua children childrene childreni chillin china chinai chinese chinnu chipie chipper chipperi chippy chiquita chivas chivasi chivasie chivasii chivasio chivasioo chloe chloei chobits chocolat chocolate chocolatei chopper chopperi chosen choseni chouchou choupette chris chrisbi chrisbrown chrise chrisi chrisia chrisie chrisii chrisio chrisoi chrissy chrissyi christ christelle christi christian christiani christie christina christinai christine christinei christmas christmasi christophe christopher christy christyi chronic chronici chubby chubbyi chuchu chuck chucki chuckie chucky chuckyi church churchi ciao ciaociao ciarai ciccio cimbom cinder cinderella cindy cindyi cinema cinnamon cinnamoni cinta cintaku citroen cjkysirj cjkywt cjmasterinf claire clairei clara clarence clarinet clarissa classic classici classo classofo classofot claude claudia claudiai claudio clayton claytoni clement clemson clemsoni cleopatra cleveland clevelandi clifford cliffordi clinton cloud clover cloveri clowns cobra cobrai cocacola cocacolai cock cocktail coco cocoai cocoi coconut coconuti cody coffee coffeei coldplay coleman colleen colleeni college collegei collin collins colombia colombiai colorado coloradoi coltas colton coltoni coltsi columbia columbus comcasti comeonii comfort coming command commander commando company compaq compaqi comptoni computer computeri computers concrete condor confused confusedi connect conner conneri connie conniei connor connori conrad contact control controli converse conversei cookie cookiee cookiei cookiemons cookies cookiesi cooking cool coolau coolboy coolcat coolcati coolcool cooldude cooldudei cooler coolgirl coolguy coolguyi cooli coolii coolio coolioi coolkidi coolman coolmani cooper cooperi copper copperi corazon corazoni corey coreyi corinne cornelia corolla corona coronai corrado corvette corvettei cosmoi cosmos cotton cottoni coucou cougar cougari cougars counter country countryi coupon coupons couponscio courage courtney courtneyi cowboy cowboyi cowboys cowboysi cowgirl cowgirli coyote cracker crackeri crackers craigi crazy crazyau crazyi create creation creative creativei cricket cricketi cricri crimson cripalife cristal cristi cristian cristiani cristiano cristina cristinai cristo crjhgbjy crossfire cruise crusader cruzazul crystal crystali cthtuf cthutq cubs cucciola cucciolo cuddles cuddlesi cuisine cupcake cupcakei cupcakes curtis curtisi cute cuteako cuteau cutegirl cuteme cutie cutiei cutieioi cutiepie cutiepiei cxfcnmt cynthia cynthiai czzooo dadada daddy daddyi daddysgirl daewoo dagger daisy daisyi dakota dakotai dalejr dalila dallas dallasi dalton daltoni damian damiani damien damieni damilola dana dance dancei dancer danceri dancing dancingi dandan danger dangeri dangerous danica daniel daniela danielai daniele danieli danielie danielii daniella danielle daniellei danieloi daniels daniil danila danilo danny dannyboy dannyi dantei daphne daredevil darius dariusi dark darkangel darkangeli darklord darkness darknessi darkside darkstar darkstari darlene darlenei darling darlingi darrell darren darreni darwin dating daughter dauphin dave david davide davidi davids davidson davinci dawson dayana daydayi daytona dbrnjh dbrnjhbz dddd dddddd deadman deadmani deanna deannai dearbook death deathi deathnote debbie debbiei debora deborah deborahi december decemberi deedee deedeei deejay deepak deerhunter default defender deftones deftonesi delacruz delete deletei delfin delfino dell delphine delpiero delta deltai demo demon demoni demons denden denis denisa denise denisei deniska dennis dennisi denver denveri derek dereki derrick derricki desert design designer designi desire desiree desireei desmond desmondi desperado destiny destinyi destroy destroyer detroit detroiti deutschland devil devildog devili devilmaycry devils devini devoni dexter dexteri dfcbkbq dfkthbz dfkthf dfktynbyf dfvgbh dharma diablo diabloi diamante diamond diamondi diamonds diamondsi diana dianai diane dianne dick dickhead dickheadi didier diego diegoi diesel dieseli dietcoke dietcokei digger diggeri digimon digital digitali dilakiss dilbert dillon dilloni dima dimadima dimitri dimple dimples dinamo dinesh dingdong dinosaur diosesamor diosesfiel dipset dipseti director dirtbike dirtbikei dirtyi discover discovery disney disneyi disturbed disturbedi divine dixie dixiei dkflbckfd dkflbr dkflbvbh dmitriy doberman doctor doctori dodge dodgei dodger dodgeram dodgers dodgersi dogdog dogdogi doggie doggiei doggy doggyi dogs dollar dollari dollars dolly dollyi dolores dolphin dolphini dolphins dolphinsi domenico domingo dominic dominicani dominici dominik dominika dominique dominiquei domino dominoi donald donaldi dondon donkey donkeyi donna donnai donnie donniei donovan donovani dontaget dontforget doodle doodlei doodoo doodooi dookie dookiei doraemon doreen dorian dorothy dorothyi dortmund dottie doudou douglas douglasi download dracula dragon dragonball dragonballz dragonfly dragonflyi dragoni dragonie dragonii dragonoi dragons dragonsi dragont dragoon drakei dream dreamer dreameri dreami dreams dreamsi drew driver drjynfrnt drogba drowssap drowssapi drpepper drpepperi drummer drummeri dthjybrf dublin ducati duchess duckie duckyi dude dudei dudley duke dumbass dumbassi duncan duncani dupont durango durangoi dustin dustini dusty dustyi dutchess dwadee dwayne dylan dylani dynasty dynastyi eaeaea eagle eaglei eagles eaglesi eagless easter eastside eastsidei eatme eatshit eatshiti ebonyi echildren eclipse eclipsei ecuador eddie eddiei edison eduard eduardo eduardoi education edward edwardi edwards eeaa eeaass eeeaaa eeee eeeee eeeeee eeeeeee eeeeeeee eeeeeeeee eeeeeeeeee eeettt eeyore eeyorei egirls eiais eieiei eight eileen einstein ejordan ekaterina elaine elainei eldorado eleanor electra electric electro elefant elefante element elementi elena eleonora elephant elephanti eleven elevenii elijah elijahi elisa elisabeth elizabeth elizabethi elizaveta ellie elliei elliot elliott elliotti elodie elvira elvis elvisi emachines emachinesi email emanuel emanuele emerald emeraldi emerson emilia emiliano emilie emilio emily emilyi eminem eminemi emma emmanuel emmanueli emotional empire energy engineer england englandi english englishi enigma enrico enrique enriquei enter enteri enterprise entropy eodiisngxb eoeoeo eragon eric erica ericai ericka ericsson erika erikai erjsilatqe ernest ernesto escape escorpion escort eseses esmeralda esperanza esteban estelle esther estheri estis estrela estrella estrellai estrellita eternal eternity etetet ethan ethani etoile eugene eugenei eunice eureka europa europe evanescence evangelion evelyn evelyni everest evergreen everton evertoni everything evgeniy evildick evolution evonyi excalibur exigent exodus explorer exploreri express extreme extremei ezekiel fabian fabio fabiola fabregas fabrice fabrizio fabulous facebook facebooki faggot faggoti faisal faith faithful faithfuli faithi falcon falconi falcons falconsi fallen falleni fallout falloute familia familiai famille family familya familye familyguy familyguyi familyi familys familyt famous famousi fanfan fantasia fantastic fantasy fantasyi farfalla farida farmer fart fashion fashioni fastau faster fatass fatassi fatboy fatboyi fatcat fatcati father fatheri fatima fatimai fatman fatmani fattyi favour fearless feather february federica federico felicia feliciai felicidad felicidade felicity felipe felix felixi fellow female fender fenderi fenerbahce ferari ferdinand fergie fernanda fernandez fernando fernandoi ferrari ferrarii ferret ffffff fghtkm fgtkmcby ficken fiesta figaro fighter fighteri filippo finalfantasy finance finger fire fireball fireballi firebird firebirdi fireblade firefighter firefly fireflyi firefox fireman firemani fish fisher fisheri fisherman fishes fishing fishingi fitness fktrcfylh fktrcfylhf fktrctq fktyrf flamengo flames flamingo flash flashi flatron fletcher flipper flipperi floppy florence florencia flores florian florida floridai flower floweri flowers flowersi fluffy fluffyi flyboyi flyers flying fondoom food football footballa footballe footballi footballia footballie footballii footballio footballo footballs footballt ford fordfiso forest foresti forever foreveri forget forgeti forgot formulai forrest fortuna fortune forzainter forzamilan forzaroma fossil foster fountain foxpass foxtrot france frances francesca francesco francesi francine francis francisco franciscoi francisi franck franco francois francy frank franki frankie frankiei franklin franklini franky freak freaki freaky freakyi freckles frecklesi fred freddie freddiei freddy freddyi frederic frederick fredfred free freebird freedom freedomi freeman freemani freestyle freeway freezeii french freshi friday fridayi fridayie friend friendi friendly friendofemily friends friendsa friendship friendsi friendst friendster frog frogger froggeri froggy froggyi frosty frostyi fuck fucker fuckeri fuckers fuckface fuckfacei fuckfuck fucki fuckii fucking fuckingi fuckit fuckiti fucklove fucklovei fuckme fuckmei fuckoff fuckoffi fuckofft fuckthis fuckthisi fucku fuckui fuckyou fuckyoua fuckyoue fuckyoui fuckyouie fuckyouii fuckyous fuckyout fukuooi fullaccess fullmoon funkyi funny funnyi fusion fussball futbol futurama future futurei fuzzyi fxzzts fxzztsyer fyfcnfcbz fylhtq fytxrf fyutkbyf gabby gabbyi gabriel gabriela gabrielai gabriele gabrieli gabriella gabrielle gabriellei gagged galatasaray galaxy galina gambit gameboy gameboyi gamecube gameover games gamesi ganda gandako gandalf gandalfi ganesh ganesha gangsta gangstai gangster gangsteri ganteng garbage garcia garciai garden garfield garfieldi garrett garretti gaston gateway gatewayi gatita gatito gatori gators gatorsi gaurav gavini gbpltw gegcbr geheim gemini geminii general generali genesis genesisi genius geoffrey george georgei georgia georgiai georgie georgina gerald geraldine gerard gerardi gerardo german germany germanyi geronimo gerrard gertrude gether getmoney getmoneyi gfhjkm gfhjkmi gggg gggggg ghbdtn ghbdtnbr ghblehjr ghetto ghettoi ghjcnj ghjcnjnfr ghost ghosti ghostrider giacomo gianluca gianna gianni giants giantsi gibson gibsoni gidget giggles gigglesi gilbert gilberti gilles gillian ginger gingeri giorgia giorgio giovanna giovanni giovannii giraffe girasole girl girlfriend girls girlsi giulia giuseppe gizmo gizmoi gjkbyf gladiator gladys glamour glasgow glitter glitteri global gloria gloriai goblin goblue godbless goddess goddessi godfather godfatheri godhelpme godisgood godisgoodi godisgreat godisi godislove godislovei godofwar godsmack godzilla godzillai goforit gogogo gold goldberg golden goldeneye goldeni goldfish goldfishi goldie goldiei golf golfcourse golfer golferi golfing gonzales gonzalez gonzalo goober gooberi good goodau goodboy goodbye goodbyei goodgirl goodlife goodluck goodman goodness goofyi google googlei goosei gordoi gordon gordoni gorgeous gorgeousi gorilla gorillai gotcha gotchai gothic gothici gotmilk gotohell grace gracei gracie graciei graham granada grandkids grandma grandmai grandpa grandpai granny grannyi grapes gratis great greati greece green greenbay greenday greendayi greene greeneyes greeni greenie greenii greens greent greg gregor gregory gregoryi gremlin grenouille gretchen griffin griffini gringo grizzly grizzlyi groovy grover grumpy gsxriooo gsxrtso guadalupe guadalupei guardian guatemala guccii guerrero guess guest guigui guilherme guillaume guillermo guinness guinnessi guitar guitari guitarra gundam gunit guniti gunner gunneri gunners gustavo gwapo gwerty gymnastics habibi hacker hackeri haha hahaha hahahaha hahahai hahai hailey haileyi hakr haleyi halflife hallo halloi halloween halloweeni halo hamburg hamburger hamilton hamiltoni hamish hamlet hammer hammeri hammers hamster hamsteri handball handsome handsomei hanna hannah hannahi hannahii hannahoi hannibal hanson hanuman happiness happinessi happy happyday happydays happyi hardcore hardcorei hardrock hariom harley harleyi harleyoi harmony harmonyi harold haroldi harper harriet harris harrison harrisoni harry harryi harrypotte harrypotter harvey harveyi hassan hateri hatersi hawaii hawaiii hawaiiso hawkeye hayabusa hayden haydeni hayley hayleyi health heart heartbreak hearti hearts heartsi heather heatheri heaven heaveni heavent heckfy hector hectori hedgehog hehehe heidi heidii heineken hejhej hejsan helen helena helene heleni hell hellboy hellfire hello helloe hellohello helloi helloii hellokitty helloo hellos hellot hellothere helloworld hellsing help helpme helpmei hendrix hendrixi henry henryi henryia hentai herbert herbie hercules herculesi heritage herman hermes hermione hermosa hernandez hernandezi heroes hershey hersheyi heslo hesoyam heyhey heyheyi hfytnrb hhhhhh hidden higgins highheel highland highlander hihihi hihihii hilary hilaryi hillary hilton hiphop hiphopi history historyi hithere hitler hitman hitmani hjccbz hjvfirf hobbes hobbit hockey hockeyi hockeyii hogwarts hohoho hola holahola holden holdeni holiday holidayi holla hollai holland hollandi hollie hollister hollisteri holly hollyi hollywood hollywoodi holmes holyshit home homeboy homelesspa homeoaoi homer homeri homework honda hondacivic hondai honduras hondurasi honest honesty honey honeybee honeyi honeyko hongkong hookem hooker hooligan hooters hootersi hoover hope horizon hornet horny hornyi horse horsei horses horsesi hospital hotau hotboy hotboyi hotdog hotdogi hotgirl hotgirli hotmail hotmaili hotmama hotmamai hotpinki hotrod hotrodi hotshot hotstuff hotstuffi hottie hottiee hottiei hottieie hottieioi hotties hottiet hottyi house housei houses houston houstoni houstontie howard howardi http hubert hudson hughes huhbbhzut hummer hummeri humtum hunter hunteri hunterii hunteroi hunting huntingi hurley hurricane hurricanei husband huskers huskersi hussain hustler hustleri hyderabad hyundai iaeaa iaeiae iaia iaiaia iaiaiaia iaisi iamcool iamcooli iamnumberi iamthebest iandonly iangel ianthony iaseiase iasshole iate iatiat iatse iattai ibabygirl ibanez ibanezi ibitch iblood ibrahim ibutterfly icarus icecream icecreami icehouse iceman icemani ichance ichigo ichliebedich icookie idaddy idiamond idontknow idontknowi ieiais ieie ieieie ieieieie iest ifamily ifootball iforgot iforgoti ifuckyou igaaboxa ignacio igor iguana ihatethisgame ihateu ihateui ihateyou ihateyoui ihotmama ihottie iiaatt iieess iieiie iiiaaa iiieee iiii iiiii iiiiia iiiiii iiiiiia iiiiiii iiiiiiii iiiiiiiii iiiiiiiiii iiiiiiiiiii iiiiiiiiiiii iiiiiiq iiiiiq iiiiqqqq iiiooo iiiqqq iiisss iiloveyou iioiio iioo iiooi iiooii iiooit iioooi iioots iiss ijesus ijrjkfl ilaria ilikepie ilikepiei illinois illusion ilove ilovechris ilovegod ilovegodi iloveher iloveheri ilovehim ilovehimi ilovehimt ilovei ilovejesus ilovejusti iloveme ilovemei ilovemet ilovemom ilovemomi ilovemusic ilovemymom ilovemyself ilovepussy ilover ilovesex iloveu iloveui iloveut iloveyou iloveyoua iloveyoue iloveyoui iloveyouia iloveyouie iloveyouii iloveyouio iloveyouis iloveyouo iloveyous iloveyout iluvmei iluvu iluvui imagine imcool imcooli imgayi imichael imillion imissyou immortal imnumberi imoney imonkey imother impala imperial impossible imyspace incorrect incubus incubusi india indiai indian indiana indianai indiani indians indigo indira indonesia inferno infiniti infinity info information ingrid inigga inlove inlovei innocent insane insanei insanity insert inside inspiron integra inter interests international internet interneti inuyasha inuyashai ioiii ioiioi ioio ioioio ioioioio iooa iooi iooioo iooo iooooo ioooooo iostt ipassword iphone iplayer iprincess iqaz iqaziqaz iqaztqaz iqazwsx iqazxc iqazxsw iqazzaqi iqiqiq iqiqiqiq iqwert iqwerty ireland irelandi irene irina irinka irish irishi irishka irocki ironmaiden ironman ironmani isaac isaaci isabel isabela isabeli isabella isabellai isabelle isabellei isaiah isaiahi isis isisis isisisis island ismael ismail israel israeli istanbul isunshine isuperman itachi italia italiai italian italiani italiano italien ititit itruelove iubire ivan ivanov ivanova iverson iversone iversoni ivtupjwent izxcvbnm jack jackass jackassi jacki jackie jackiei jackjack jackpot jackson jacksoni jacksons jacob jacobi jacobs jacqueline jacques jade jadeni jaguar jaguari jaihanuman jaimatadi jajaja jakarta jake jakei jakjak jamaica jamaicai jamali james jamesbond jamesbondoot jamesi jamesoot jamie jamiei jamila jamjam jane janelle janet janeti janette janice janicei janina janine janjan january januaryi japan jared jaredi jasmin jasmine jasminei jasmini jason jasoni jasper jasperi javier javieri jayden jaydeni jayjay jayjayi jayson jazmin jazmine jazminei jazmini jazz jazzyi jean jeanette jeanne jeff jefferson jeffery jefferyi jeffhardy jeffhardyi jeffrey jeffreyi jehovah jellybean jellybeani jellyi jenifer jenjen jenna jennai jennie jennifer jenniferi jenny jennyi jensen jeremiah jeremiahi jeremy jeremyi jericho jermaine jermainei jerome jeromei jerry jerryi jersey jerseyi jerusalem jess jesse jessei jessica jessicae jessicai jessicaie jessicat jessie jessiei jester jesucristo jesus jesusame jesusc jesuschris jesuschrist jesuse jesusee jesusfreak jesusi jesusii jesusisi jesusislord jesusoi jesuss jesussaves jesust jesustt jesusttt jetaime jeter jewels jgehahfn jillian jilliani jimbob jimenez jimmy jimmyi jingjing jjjjjj jktxrf jktymrf joanna joannai joanne joannei joaquin jobs jobsearch jocelyn jocelyni joejoe joejoei joejonasi joel joey johann johanna johannes john johncena johncenai johndeere johndeerei johnei johni johnjohn johnlock johnny johnnyi johnnys johnpaul johnson johnsoni jojo jojoi jojojo joker jokeri jokerie jokers jonas jonasi jonathan jonathani jones jonesi jonjon jonnyi jordan jordane jordani jordanie jordanii jordanio jordanoi jordans jordant jorge jorgei jose josefina josei joseie joseluis joseph josephi josephine josh joshi joshua joshuai joshuaii joshuaoi josiah josiei journey joyce joyjoy jrcfyf juan juancarlos juanita juanitai juanito jubjub judith juggalo juggaloi juicyi julia juliai julian juliana juliani julie juliei julien juliet julieta juliette julius july julyi julyia jumper june junebug junebugi junei juneia juneie juneii juneio juneis juneit jungle junior juniori junjun jupiter jupiteri justafun justame justdoit justice justicei justin justinbieb justinbieber justine justinei justini justinii justinoi justme justmei juventus juventusi kacper kagome kaiser kaitlyn kaitlyni kaka kakaka kakashi kakashii kakashka kaktus kalina kalpana kamasutra kamikaze kamila kangaroo kannan kansas karachi karate karatei karen kareni karina karinai karine karolina kashmir kasia kasper katana katarina kate katelyn katelyni katerina katherine katherinei kathleen kathleeni kathmandu kathryn kathryni kathy kathyi katie katiei katkat katrin katrina katrinai kavita kawaii kawasaki kawasakii kaykay kaykayi kayla kaylai kaylee kayleei kayleigh kayode keegan keeper keisha keith keithi kelley kellie kelly kellyi kelsey kelseyi kelvin kendall kendalli kendra kendrai kenken kennedy kennedyi kenneth kennethi kenny kennyi kenshin kent kentucky kentuckyi kenwood kenworth kenzie kenziei kermit kevin kevini keyboard keyboardi kfhbcf khalid khushi kickass kickassi kicker kieran kikeunyw kiki kikiki kill killa killai killbill killer killeri killerie killerii killers killert killian killme kimberley kimberly kimberlyi kimbum kimkim kimmie kinder king kingdom kingdomi kingi kingking kingkong kingkongi kingsi kingsley kingston kipper kirbyi kirill kirsten kirsteni kirsty kiss kisses kissesi kisskiss kissme kissmei kissmyass kissmyassi kitkat kitkati kitten kitteni kittens kittensi kittie kitty kittycat kittycati kittyi kittykat kittykati kjkszpj kkkkkk kkkkkkk kkkkkkkk klapaucius klaster kleopatra knicks knight knighti knights knightsi knopka kobebryant kochanie kodiak kokoko kolawole kolobok komputer konstantin kontakt kontol kool koolaid koolaidi koroleva kosama koshka kosmos kosova kostya kotenok kramer krasotka krishna krista kristen kristeni kristi kristian kristin kristina kristinai kristine kristini kristy krokodil kronos krystal krystali ktyjxrf kucing kumar kungfu kurt kyle labrador labtec laceyi lacoste lacrosse lacrossei ladies lady ladybug ladybugi ladygaga laetitia laguna lagunai lahore lakers lakersi lakshmi lala lalai lalala lalalai lalalala lalaland lamborghini lamont lamonti lampard lance lancei lancelot lancer landon landoni landrover lane laptop laptopi larisa larissa larry larryi lassie lastfm lasvegas lasvegasi latina latinai latino laura laurai lauren laurence laureni laurent laurie laurita lavender lavoro lawrence lawrencei lawyer layouti layoutsi leader leandro leanne leather leavemealone lebron leelee leeleei leftadead legacy legend legenda legendi legion legolas legolasi lemon lemonade lemoni lemons lena lennon lenochka lenovo leoleo leon leonard leonardi leonardo leonardoi leonid leonie leopard lesbian lesbiani lesley leslie lesliei lespaul lestat lester leticia letmein letmeini letter lewis lewisi lexmark lexmarki libero libertad liberte liberty libertyi library lickme licorne life lifeisgood lifesucks lifesucksi light lighthouse lighti lightning lightningi lights lilian liliana lillian lilliani lillie lilly lillyi lilmama lilmamai lilman lilmani lilwayne lilwaynei lily lincoln lincolni linda lindai lindsay lindsayi lindsey lindseyi lineage linked linkedin linkedini linkin linkini linkinpark lionel lionheart lionking lipgloss lipglossi lisa little littlebit littlebiti littlei littleman littlemani livelife liverpool liverpoolfc liverpooli livestrong lizard lizardi lizottes lizzie lizziei lizzyi lkjhgf lkjhgfdsa llllll lobster lobsteri logan logani login logitech logitechi lokomotiv lola lolipop lolipopi lolita lolitai lollipop lollipopi lollol lolloli lollypop lollypopi lolo lololo london londoni lonely lonelyi lonestar lonewolf longhorn longhorns longhornsi looking looser lopez lopezi lord loredana lorena lorenai lorenzo lorenzoi loretta lorraine lorrainei losangeles loser loseri losers losersi lottie louie louiei louis louise louisei louisi loulou louloui louloute lourdes love loveaa loveaever lovealife loveame loveas loveau loveayou lovebird lovebug lovebugi lovedi loveea loveee lovegod lovehate lovehurts lovehurtsi lovei loveia loveiae loveie loveii loveio loveioi loveis loveislife loveit loveless lovelessi lovelife lovelifei lovelove lovelovei lovely lovelyi loveme lovemee lovemei loveo loveoi loveoo loveot lover loverboy loverboyi lovergirl lovergirli loveri loverie lovers loversi loves lovesi lovess lovestory lovesucks lovesucksi lovett lovettt loveu loveui loveya loveyai loveyou loveyoui loving lovingi lovingyou lowrider lowrideri ltybcrf lucas lucasi lucia luciana luciano lucifer lucille lucky luckydog luckydogi luckyi luckyie luckyt luckyttt lucy ludacris ludmila ludovic ludwig luis lukas luke lulu luna lupita lupitai luther lvbnhbq lynn lyon machine maciek mackenzie mackenziei macmac madagascar madalina madden maddeni maddie maddiei maddison maddog maddogi maddyi madeleine madeline madelinei madina madison madisoni madman madmax madness madonna madonnai madrid maestro mafalda mafiai magali maganda magandaako magdalena maggie maggiei maggieoi magic magici magnet magnolia magnum magnus mahal mahalkita mahalko mahesh maiden maison makaveli makavelii makayla makaylai makemoney maksim maksimka malachi malachii malaga malaysia malcolm malcolmi maldita malibu malibui malika maliki malina mallorca mallory malloryi mama mamai mamama mamamama mamamia maman mamapapa mamita mamma mammamia mamochka mamour management manager manageri manchester mancity mandarin mandy mandyi mango mangoi maniac manila manish manisha mankind manman manmani manningi mannyi manolo manowar manson mansoni manu manuel manuela manueli manunited manutd manutdi maradona maradonaio marathon marcel marcela marcella marcello marcelo march marchi marchie marchii marchis marchit marcia marcin marco marcoi marcopolo marcos marcosi marcus marcusi margaret margareti margarita margaritai margherita margie margot maria mariah mariahi mariai mariajose mariam marian mariana marianai marianna marianne mariano maribel maricel marie mariei mariel marihuana marijuana marijuanai marika marilyn marilyni marina marinai marine marinei marines marinesi marino marinoie mario marioi marion mariposa mariposai marisa marisol marissa marissai marius mariya marjorie mark market marketing markus marlboro marlboroi marlene marley marleyi marlin marlon maroons marriage married marriedi marseille marshall marshalli marta martha marthai martin martina martinai martine martinez martinezi martini martins marvel marvin marvini mary maryam maryann maryjane maryjanea maryjanei maryland mashaott mason masoni massage massimo master masteri mastermind masters matador matahari matei matematica mateusz matheus mathew mathewi mathias mathieu mathilde mathis matias matilda matildai matilde matrix matrixi matt matteo matthew matthewe matthewi matthias matti mattia mattie mattiei maureen maurice mauricei mauricio maurizio maverick mavericki maxima maxime maximilian maximo maximum maximus maximusi maxine maxmax maxwell maxwelli mayday maymay maynard mazafaka mazda mazdae mazdarxt mckenzie mclaren meagan meandyou meatball mechanical medical medicina medicine medina medion medved megadeth megaman megamani megan megane megani megaparol megasecret meghan meghani mehmet melanie melaniei melina melinda melindai melisa melissa melissai mellon melody melodyi melvin melvini member meme mememe mememei memory memphis memphisi mendoza meowmeow mercedes mercedesi mercury mercuryi meredith merlin merlini mermaid mermaidi mersedes messenger messiah messiio metal metali metallica metallicai mexican mexicani mexico mexicoi mexicoie mexicoio mhine miamieos miamii miamor miamori micaela michael michaela michaele michaeli michaelie michaelii michaeloi michaels michaelt michal micheal micheali michel michela michele michelei michelle michellei michigan michigani mickey mickeyi mickeymouse microlab microsoft microsofti midget midnight midnighti mierda mighty miguel migueli mihaela mihail mikaela mikayla mike mikei mikeii mikejonesi mikemike mikey mikeyi milagros milan milana milano mildred milena mileycyrus mileyi milkshake milkshakei millenium miller milleri millie milliei million millwall milton mimi mimimi mimosa mine minecraft minerva minette minime minnie minniei miracle miraclei mirage miranda mirandai miriam mirror mishka misiek mission missioni mississipp mississippi missy missyi missyou mister misty mistyi mitch mitchell mitchelli mitsubishi mittens mittensi mmmmm mmmmmm mmmmmmmm mmmmmmmmmm mnbvcx mnbvcxz mnbvcxzi mobile mobsteri mochai mohamed mohammad mohammed moimoi moises mollie molliei molly mollydog mollyi moloko molson momanddad momdad momdadi mommai mommy mommye mommyi mommyii momo momof momofe momomo momoney monaco monalisa monamour monday mondayi mondeo money moneya moneyame moneye moneyi moneyii moneyioo moneymaker moneyman moneymani moneymoney moneys moneyt mongoose monica monicai monika monikai monique moniquei monitor monkey monkeya monkeyboy monkeybutt monkeye monkeyi monkeyia monkeyie monkeyii monkeyio monkeyioi monkeyman monkeyoi monkeys monkeysi monkeyt monopoly monroe monster monsteri monsters montana montanai montecarlo montreal monty montyi moocow mookie mookiei moomoo moomooi moon moonlight moonlighti moonshine moose moosei morales moremoney morena moreno morgan morgana morgane morgani moritz morning morpheus morris morrisi morrison moscow mostwanted motdepasse mother motherfuck motherfucker motheri motherlode motocross motocrossi motorola motorolai mountain mountaini mouse mousei movies mozart muffin muffini muhammad muhammed mulder multiplelog mumbai mummy mummyi munchkin munchkini muppet murcielago murder murderi murphy murphyi murray mushroom music musica musicai musicalife musici musicioi musicman musique muskan muslim mustafa mustang mustangi mustangs myakids myangel mybaby mybabyi myboys myeboys myegirls myekids myesons myfamily mygirl mygirls myheart myilove mykids mykidse mylene mylife mylifei mylinkedin mylord mylove mylovei mymother mymusic myname mynamei mynameis mynoob mypass mypassword myself myselfi myspace myspacea myspacee myspacei myspaceie myspaceii myspaceio myspaceioi myspaceo myspaceoi myspaceot myspaces myspacet mystery mysteryi mystic nabila nacional nadia nadine namaste nana nanai nanana nancy nancyi nantes napoleon napoli narayana naruto narutoi narutoii nascar nascari nastia nastya nastyi natacha natali natalia nataliai natalie nataliei nataly natalya natasha natashai nathalie nathan nathani nathaniel nathanieli national natural nature naughty naughtyi naveen navigator naynayi nccitoi nccitoia nccitoid nccitoie negrita nellie nelly nellyi nelson nelsoni nemesis neptune nestor netlog network networki networking nevada nevaeh nevaehi never neveragain neveri nevermind nevermore newcastle newcastlei newjob newlife newlifei newman newmoon newpass newpassword newport newporti newstart newton newyork newyorki nfnmzyf nguyen nicholas nicholasi nichole nicholei nick nicki nickjonas nickjonasi nicky nickyi nicola nicolas nicolasi nicole nicolee nicolei nicoleie nicoleii nicoleoi nicolet nifrdz nigeria nigga niggai nigger niggeri nightmare nightmarei nightwish nike nikhil nikita nikitai nikitos nikki nikkii nikola nikolai nikolas nikolay nimrod nina ninja ninjai nintendo nintendoi nipper nirvana nirvanai nissan nissanesoz nissani nnnnnn nobody nodefinido noelle nofear noisette nokia nokiaeeio nokiai nokiante nokianto nolimit nolove noname none nonmember nonono noodle noodlei noodles noodlesi nopass nopassword norman normani norteia northsidei norton notebook nothing nothingi notthat nounou nounours november novemberi novemberii novo noway nssadmin ntktajy nugget nuggeti null numbai number numbere numberi numberii numbers numbert nursei nursing nursingi nutella nutmeg nuttertools oakland oaklandi oakley oaoaoa oblivion oceane october octoberei octoberi octoberio odessa oeoao oeoeoe office offspring ohiostatei oiat oieia oieoi oioio oioioi oioioioi oklahoma oklahomai okokok oksana olamide olawale olayinka oldman oleg olenka olesya olga oliveira oliver oliveri olivia oliviai olivier oluwaseun olympique omarion omarioni omega omegai omgi omni omsairam onedirection onelove onelovei onepiece onetwoe online onlinei onlyme ontario ooii oooiii oooo ooooiiii ooooo oooooi oooooo ooooooa ooooooi ooooooo oooooooo ooooooooo oooooooooo ooooot ooowebhost ootoot opelastra open opensesame openup operator opeyemi optimus oracle orange orangei oranges orchid ordinateur oregon original orion orlando orlandoi oscar oscari osiris ososos ototot outlaw outlawi overlord oxford pablito pablo pabloi pacific packard packers packersa packersi pacman pacmani paddle paige paigei paintball paintballi painter pakistan pakistani palace paladin palermo pallina pallmall palmer palmtree paloma pamela pamelai panama panasonic panasonici pancake pancakes pancho panchoi panda pandai pandas pandora pandorai panget pangit pankaj pantera panterai panther pantheri panthers panthersi panties panzer paola paolo papa papamama papapa paperi paperino papillon papito paradise paradisei paradox paramore paramorei paris parisi parker parkeri parkour parola parolai parrot partizan partyi pasaway pascal pasquale pass passat passi passion passioni passiword passpass passport passporti passwd password passworda passworde passwordee passwordi passwordia passwordie passwordii passwordio passwordis passwordit passwordo passwordoi passwordoo passwordot passwords passwordt passwordtt passwort passworti pastor pasword paswordi patata patate patches patchesi patience patito patrice patricia patriciai patrick patricki patrik patriot patriots patriotsi patrizia patton patty pattyi paul paula paulai paulina pauline paulinei pavel pavilion pavilioni payton paytoni pdtplf peace peacei peaceout peaches peachesi peachy peacock peanut peanuti peanuts peanutsi pearl pearli pearljam pebbles pebblesi pedro pedroi peekaboo peewee peeweei pegasus peluche pelusa pencil pencili penelope penguin penguini penguins penis penisi penny pennyi pentium people peoplei pepette pepito pepper pepperi pepsi pepsii perfect perfecti persik personal peter peteri peterpan peterpani peters peterson petunia peugeot peyton peytoni phantom phantomi pharmacy philip philippe philips philipsi phillip phillipi phillips philly phillyi phoebe phoebei phoenix phoenixi phone phonei photoi photos piazza picard picasso piccolo pickle picklei pickles picklesi picture pictures pierre pierrei pietro piggy piggyi piglet pigleti pikachu pikachui pillow pimp pimpdaddyi pimpi pimpie pimpii pimpin pimpingi pimpini pimpioi pineapple pineapplei pingpong pink pinkfloyd pinkfloydi pinki pinkie pinkii pinkioi pinky pinkyi piolin pioneer pioneeri piperi pippin pippo piramida pirata pirate piratei pirates piratesi pisces pistonsi pitbull pitbulli pizza pizzai pizzas placebo planet plastic platinum platinumi playai playboy playboyi player playeri playstation playstatione please pleasei pleasure pluto plymouth pobeda poetry pogiako point poipoi poison poisson poiuyt poiuytrewq pokemon pokemoni pokemonii pokerface pokeri poland polarbear polaris polarisi police policei polina pollito polly polniypizdeciio polo polopolo polska polskai pompier pompom poncho pontiac pontiaci poochie poochiei poodle pooh poohbear poohbeari poohi pookie pookiei poonam poop pooper pooperi poopi poopie poopiei poopii poopoo poopooi pooppoop poopy poopyi popcorn popcorni popeye popeyei popo popopo poppop poppy poppyi poptarti porcodio porkchop porkchopi porn porno pornstar pornstari porsche porschei porter portland portugal portugali poseidon positive possum postal potato pothead potheadi potpot potter potteri poussin powder power poweri powers ppppp pppppp pradeep praise prakash prasad prashant praveen prayer preciosa precious preciousi predator prelude presario president preston prestoni pretty prettyboyi prettygirl prettyi primavera prince princei princesa princesai princesita princess princessa princesse princessi princessia princessie princessii princessio princessis princesso princessoi princesss princesst principe principessa pringles printer printeri priscilla prissy prissyi private privatei privet priyanka prodigy professional professor progress project projecti projectsadminx promise promisei psg psycho psychoi pudding puddingi puertorico pulsar pumpkin pumpkini punisher punk punkin punkini punkrock punkrocki puppies puppiesi puppy puppyi puppylove puppylovei pupsik pupuce purple purplee purplei purpleie purpleii purplet pussy pussycat pussycati pussyi pyon pyramid qawsed qawsedrf qazqaz qazqazqaz qazwsx qazwsxedc qazwsxedci qazwsxedcrfv qazwsxi qazxsw qazxswedc qazxswi qazzaq qazzaqi qdujvygssxa qiiiii qiqiqi qqqiii qqqq qqqqiiii qqqqq qqqqqi qqqqqq qqqqqqi qqqqqqq qqqqqqqq qqqqqqqqqq qqqwww qqwwee qqwwii quality queen queeni queenie queens quentin question quincy qwaszx qwaszxi qweasd qweasdi qweasdzxc qweasdzxci qwedsa qweewq qweiasd qweqwe qweqwei qweqweqwe qwer qwerasdf qwerasdfzxcv qweri qwerqwer qwert qwertasdfg qwerti qwerty qwertyi qwertyie qwertyii qwertyoi qwertyqwerty qwertys qwertyt qwertytt qwertyttt qwertyu qwertyui qwertyuii qwertyuio qwertyuioi qwertyuiop qwertyuiopi qwertz qwertzuiop qwet qwqwqw rabbit rabbiti rabota racecar racecari rachael rachaeli rachel racheli rachelle racing racingi radhika radio radiohead radioi rafael rafaeli ragnarok rahasia raider raideri raiders raidersi raidersie raiderzi rainbow rainbowi rainbows rajesh rajkumar rakesh ralph rambler rambo ramboi ramesh ramirez rammstein rammsteini ramona ramones ramram ramses rancid randall random randomi randy randyi ranger rangeri rangers rangersi raphael raptor raquel rascal rascali rasengan rashmi rasmus rastafari rastaman raven raveni ravens ravensi raymond raymondi rayray rayrayi razvan rbhbkk rctybz rdfhnbhf reading reagan reality realmadrid reaper reaperi rebeca rebecca rebeccai rebel rebelde rebeldei rebeli rebels reboundi recovery redalert redbull redbulli reddog reddogi redhead redheadi redhot redman redmani redneck rednecki redred redredi redrose redrum redrumi redskins redskinsi redsox redsoxi redsoxoa redwings redwingsi reebok reggae reggie reggiei regina reginai register remember rememberi remington renata renato renault renee reneei renegade rental rereirf research resident respect respecti restart restaurant retard retardi retired revelation revenge revengei revolution rfhbyf rfnthbyf rfrfirf rfrnec rhbcnbyf rhfcjnrf rhiannon rhjrjlbk rhonda ricardo ricardoi riccardo richard richardi richie richiei richmond ricky rickyi rihanna riley rileyi ripper rivera riverside rjhjktdf rjntyjr rjycnfynby rjynfrn roadrunner robbie robbiei robert roberta roberti roberto robertoi roberts robin robinhood robini robinson robinsoni rochelle rock rocker rockeri rocket rocketi rocketsi rocknroll rocknrolli rockon rockoni rockstar rockstari rocky rockyi rockyou rodney rodneyi rodolfo rodrigo rodriguez rodriguezi roger rogeri rogers roland rolando roller rolltide rolltidei roma romain roman romance romani romania romano romashka romeo romeoi romero romina rommel ronald ronaldi ronaldinho ronaldo ronaldoi ronaldot ronnie ronniei rooney rooneyio rooster roosteri rootbeer rootbeeri rosalie rosario roscoe roscoei rose rosebud rosebudi rosei rosemarie rosemary roses rosie rosiei rosita rossella rossia rough route rovers rowena roxana roxane roxanne roxannei roxy rrrrrr rsavoy rtyuehe ruby rufusi runescape runescapei runner runneri running rupert ruslan russel russell russelli russia rustam rusty rustyi ryan ryani sabbath sabina sabine sabrina sabrinai sachin sacred sadie sadiei safari safety sagitario sagitarius sahara saibaba sailboat sailing sailor sailormoon saints saintsi sairam sakura sakurai sally sallyi salman salmon salome salomon salope salvador salvadori salvation salvatore samanta samantha samanthai samara sameer samiam samira sammie sammiei sammy sammyi sampson sampsoni samsam samson samsoni samsung samsungi samtron samuel samueli samueloi samurai sanane sanchez sanchezi sandeep sandhya sandiego sandiegoi sandman sandmani sandra sandrai sandrine sandro sandy sandyi sangeeta sanjay santai santana santanai sante santiago santiagoi santino santos santosh santosi santé sapphire sara sarah sarahi sarajevo sarita sasasa sascha sasha sashai saskia sassy sassyi sasuke sasukei satan satana satellite saturday saturn saturni sausage savage savagei savanna savannah savannahi sayang sayangi sayangku scania scarface scarfacei scarlet scarleti scarlett scarletti schalke schalkeoa schatz schatzi school schooli science scooby scoobydoo scoobydooi scoobyi scooter scooteri scorpio scorpioi scorpion scorpioni scotland scotlandi scott scotti scottie scotty scottyi scouti scrappy scrappyi scream scruffy scruffyi scully scvmofast seagull seamus sean search season seattle seattlei sebastian sebastiani sebastien secret secreti secrets secure security securityi select selena selenai selina semperfi semperfii senegal senior senioro seniorot seniseviyorum sentnece sephiroth september septemberi septiembre serega serena serenai serenity serenityi sergei sergey sergio sergioi server serveur service sesame sesese seven sevent seventeen seventt seventtt sevilla sexsex sexsexi sexsexsex sextrimei sexxxy sexy sexyau sexybabe sexybabyi sexybacki sexybeasti sexybitch sexybitchi sexyboy sexyboyi sexygirl sexygirli sexygurli sexyi sexyia sexyie sexyii sexyio sexyioi sexyis sexyit sexylady sexyladyi sexylovei sexymama sexymamai sexyman sexymani sexyme sexymei sexyo sexyoi sexyot sexysexy shadow shadowi shadowie shadowii shadowoi shadows shadowt shadyi shaggy shaggyi shakira shakirai shalom shaman shamrock shamrocki shane shanei shanghai shania shanna shannon shannoni shanti shaolin sharingan shark sharks sharma sharon sharoni sharp shasha shasta shawn shawni shawtyi shebai sheeba sheena sheila sheilai shelby shelbyi sheldon shelley shelly shellyi sherlock sherman shermani sherry sherryi sherwood shex shibby shiloh shinigami shirley shirleyi shit shitface shitfacei shithead shitheadi shittyi shmily shogun shooter shooteri shopping shoppingi shorty shortyi shortyie shotgun shotguni showtime shsutskpot shutup shutupi sidekicke sidney sidneyi siemens sierra sierrai siest sigma silence silent sillyi silvana silver silverado silveri silvia simba simbai simon simona simone simonei simoni simple simplei simpleplan simpson simpsoni simpsons simpsonsi simran simsim singapore singer singeri single singlei sinner sirius sisisi siso sisosiso sissyi sister sisteri sisters sitse sixteen skate skatealife skateboard skatei skater skateri skeeter skeeteri skiffy skiing skinhead skinny skinnyi skipper skipperi skippy skippyi skittles skittlesi skolko skorpion skyblue skyhawk skylar skylari skyler skyleri skyline skylinei skywalker skywalkeri slamdunk slavik slayer slayeri sleepy sleepyi slicki slimshady slipknot slipknoti smackdown smackdowni smallville smart smarti smarty smelly smellyi smile smileame smilei smiles smilesi smiley smileyi smith smithi smitty smoke smokei smokey smokeyi smokie smoking smooth smoothi smudge snake snakei snakes snapper snapple sneakers snickers snickersi sniper sniperi snooker snoopdog snoopdogg snoopi snoopy snoopyi snowball snowballi snowboard snowboardi snowflake snowflakei snowman snowmani snowwhite snuggles snugglesi sobaka soccer soccera soccere socceri socceria soccerie soccerii soccerio soccerioi socceris soccerit soccero socceroi soccerot soccers soccert socent socrates sofia softball softballe softballi softballie softballii softballio softballt software solange soldier soldieri soledad soleil solnce solomon solomoni solrac solution someone something somethingi sommelier sommer sonali sonia soniai sonic sonici sonnyi sony sonyericsson sooners soonersi sophia sophiai sophie sophiei soprano sososo souljaboyi soulmate sousou southern southi southie southpark southparki southside southsidei space spacei spam spanish spanishi spanky spankyi sparkle sparklei sparkles sparky sparkyi sparrow sparta spartak spartan spartani spartaniit spartans speaker special speciali spectrum speed speedy speedyi spencer spenceri spider spideri spiderman spidermane spidermani spike spikei spirit spiriti spitfire spitfirei splash splinter sponge spongebob spongebobi spongei spooky spookyi spoppin sporting sports sportsi spring springer springi sprint sprite spritei spunky spunkyi spursi sputnik spyder squall squirrel squirt srinivas sriram ssss sssss sssssa ssssss sssssss ssssssss ssssssssss sssttt ssyuieia stacey staceyi stalker stalkeri stallion standard stanislav stanley stanleyi star starbucks starbucksi starcraft starcrafti stardust starfish starfishi stargate stargatei stari starie starii starlight starlighti stars starsi starstar start startfinding starti startrek startreki starwars starwarsi status stchevy stealth steaua steelers steelersi steelerst stefan stefania stefanie stefano steffi stella stellai stellina stepan steph stephane stephanie stephaniei stephen stepheni stephi sterling sterlingi sterva steve stevei steven steveni stevie steviei stewart stewarti stinger stingray stinky stinkyi stitch stonecold stonecoldi stoner stoneri stones storm stormi stormy stormyi stranger stratfor stratus strawberry street streeti strength strike striker strong strongi stryker ststst stuart student studenti studio stuntioi stupid stupidi subaru sublime sublimei subway subzero success successi sucesso sucker suckeri suckit suckiti suckme suckmydick sugar sugari sullivan sultan summer summeri summerii summerio summero summeroi summeros summerot summertime sundance sunday sundayi sunderland sunflower sunfloweri sunita sunny sunnyi sunrise sunset sunseti sunshine sunshinee sunshinei sunshinet super superfly supergirl supergirli superi superman supermane supermani supermant supernova supersonic superstar superstari support surenoie suresh surfer surferi surfing surfingi sursideie survivor susan susana susani susanne suzanne suzannei suzuki suzukii svetik svetlana svoboda sweden sweet sweetgirl sweetheart sweeti sweetie sweetiei sweetness sweetnessi sweetpea sweetpeai sweets sweetsi sweety sweetyi swimmer swimmeri swimming swimmingi swordfish swordfishi sydney sydneyi sylvester sylvia sylvie syncmaster system systemi tabitha tabithai taco tacobell tacobelli taekwondo taitai tamara tamarai tammy tammyi tangkai tango tangoi tanner tanneri tanya tara target tarheels tarheelsi tarzan tasha tashai tatata tatiana tatianai tattoo tattooi tatyana taurus taylor taylori taylorii tayloroi taytay taytayi tazmania tchin tdutybq tdutybz teacher teacheri team teamo teamoi technics techno technology teddy teddybear teddybeari teddyi teiubesc tekiero tekken telechargement telefon telefono telephants telephone television temitope temp temple temppass temppassword tenerife tennis tennisi tequiero tequila tequilai teresa teresai terminator terrelli terror terry terryi tesoisos tesoro test tester testeri testi testing testingi testpass testtest tetete texas texasi thailand thankgod thanks thankyou theatre thebest thebesti theboss thebossi thedoors theend thegame thegamei thegreati theking thekingi thelma theman themani theodore theone theonei theonlyi theresa theresai therese therock therocki thesims theused theusedi thierry thirteen thirteenie thomas thomasi thomasoi thompson threee thugalife thuglife thuglifei thumper thumperi thunder thunderi thursday thxiie ticket tiesto tiffany tiffanyi tiger tigeri tigers tigersi tigger tiggeri tiggeroi tigrou timber time timmy timmyi timothy timothyi tina tinker tinkerbell tinkeri tinkle tintin titanic titanici titans titansi tititi titties tkbpfdtnf tkfkdgo tobias toby toffee together tokiohotel toledo tomas tomate tomato tomcat tommaso tommy tommyi tomorrow tomtom tomtomi tonton tony tonyi toot tootie tootsie tootsiei topcat topgun topolino topper topsecret torino tornado toronto torres tortuga toshiba toshibai toto tototo tottenham tottenhami toulouse toyota toyotai trabajo tracey tractor tracy tracyi training traktor trance transam travel traveli travis travisi treasure trebor trentoni tresds trevor trevori trfnthbyf trial tricia tricolor trigger triggeri trinidad trinity trinitye trinityi tripper trisha triskelion tristan tristani triton triumph trixie trixiei trojan trojansi trololo trombone trooper trooperi tropical trouble troublei trucker truckeri trucks truelove truelovei trumpet trumpeti trunks trust trustnoi tseis tseo tststs tsunami tttsss tttt ttttt tttttt ttttttt ttttttta tttttttt tttttttttt tucker tuckeri tudelft tuesday tulips tuning tupaci turbo turboi turkey turkeyi turner turtle turtlei tweety tweetybird tweetyi twilight twilighti twinkle twinklei twins twisted twistedi twister twisteri tyler tyleri tyrone tyronei tyson tysoni ufkbyf uganda uhfybn ultima ultimate umbrella underground undertaker underworld unicorn unicorni unique uniquei united unitedi universal universe university unknown unknowni unreal urmomi ursula usdopaa user usheri utopia uttt vacances vacation vacationi vaffanculo vagina vaginai valencia valentin valentina valentinai valentine valentinei valentino valera valeria valeriai valerie valeriei vampire vampirei vampires vancouver vanesa vanessa vanessai vanhalen vanilla vanillai vanille varvara vbkfirf vectra vegeta vegetai velvet vendetta venera venezuela venice venkat venus verbatim veritas verizoni vermont vernon verona veronica veronicai veronika veronique versace vertigo vfczyz vfhbyf vfhecz vfhufhbnf vfibyf vfitymrf vfksirf vfrcbv vfrcbvrf vfvekz vfvfgfgf vfvjxrf vicente vicky vickyi victoire victor victori victoria victoriai victory victoryi vietnam viewsonic vijaya viking vikingi vikings vikingsi viktor viktoria viktoriya village vincent vincenti vincenzo vinho vinnie vino violet violeta violeti violetta violin viper viperi viphvsjte virgin virginia virginiai virginie vishal vishnu vision vitalik vitoria vittoria vivian viviana vjcrdf vkontakte vlad vladik vladimir vladislav vodafone voiture volcom volcomi volkswagen volley volleyball volume volvo voodoo voyager voyageri vqsablpzla vvvvvv wachtwoord wagner waheguru walker walkeri wallace wallacei walmart walmarti walnut walter walteri wangyut wanker wanted warcraft warcrafte warcrafti warhammer warlock warlord warning warren warreni warrior warriori warriors warriorsi warszawa washington wasser wassup water waterfall wateri waterloo watermelon waters watson wayne waynei weasel weather webhompass webster websteri wedding weddingi wednesday weed weezer weezyi welcome welcomei welkom wellington wendy wendyi wenoob werder werewolf werner werty wertyu wesley wesleyi western westham westhami westlife westside westsidei westwood what whatever whateveri whatevert whatsup whatsupi whatthezor whiskers whiskey whiskeyi whisky whisper white whiteboyi whitei whitney whitneyi whocares whorei whynot wicked wickedi widget wifeyi wilbur wildcat wildcati wildcats wildcatsi wildfire will william williame williami williams williamsi willie williei willis willow willowi willy willyi wilson wilsoni winchester window windowi windows windowsi windowst windsor wine winmxi winner winneri winnie winniei winston winstoni winter winteri wisdom wisdomi wishbone wizard wizardi woaini woainiieia wolf wolfgang wolfman wolfpack wolverine wolverinei wolves wolvesi wombat wonder wonderful wonderfuli wonderi wonderland woodstock woody woodyi wookie wordpass wordpassi work working wrangler wrestling wrestlingi wright writer wutang wwwwww wxcvbn xaivygasif xander xavier xavieri xbox xboxlive xfiles xxxx xxxxx xxxxxx xxxxxxi xxxxxxx xxxxxxxx xxxxxxxxxx yagjecc yahoo yahooi yahoomail yahooo yamaha yamahai yamahar yamahari yandex yankee yankeei yankees yankeesi yankeesie yannick yanyan yasmin yasmine ybccfy ybrbnf ybrjkfq yeah yellow yellowi yellowii yesyes yfcntymrf yfdbufnjhioeosoto yfnfif yfnfkb yfnfkmz yolanda yolandai yomama yomamai yomommai youandme young youngi youngmoney yourmom yourmomi youssef yousuck yousucki youtube youtubei youyou yoyo yoyoyo yoyoyoi ytrewq yugioh yugiohi yuliya yummy yummyi yumyum yvette yvonne yvonnei yxcvbnm yyyyyy zacefron zacefroni zachary zacharyi zainab zander zanzibar zaqixsw zaqwsx zaqwsxcde zaqxsw zaqxswcde zaraza zarina zasada zazaza zebrai zeldai zenith zeppelin zeppelini zhjckfd zidane ziggy ziggyi zigzag zipper zoeyioi zombie zombiei zooooo zoosk zorro zouzou zvezda zxasqwi zxcasd zxcasdqwe zxccxz zxcv zxcvb zxcvbi zxcvbn zxcvbni zxcvbnm zxcvbnmi zxczxc zxzxzx zyjxrf zzzzzz zzzzzzz zzzzzzzz zzzzzzzzzz';
