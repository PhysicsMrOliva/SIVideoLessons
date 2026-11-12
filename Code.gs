/**
 * Video Quiz backend (Google Apps Script, bound to your Google Sheet).
 * Paste into Extensions > Apps Script, edit the three settings below, then
 * Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 */

// ---- SETTINGS: edit these three ----------------------------------------
const CLIENT_ID = '727203278087-9p1ohsnmiplc3b8m4t28m45bcmko51li.apps.googleusercontent.com';
const TEACHER_EMAIL = 'moliva@siprep.org';
const ALLOWED_DOMAINS = ['siprep.org', 'gmail.com']; // e.g. ['siprep.org']. Empty = any Google account, but the roster is still required.
// ------------------------------------------------------------------------

const AH = ['id', 'title', 'updated', 'published', 'json (chunks, do not edit)'];
const RoH = ['name', 'email', 'canvas_id', 'section'];
const ReH = ['assignment_id', 'email', 'name', 'answers_json', 'submitted', 'updated', 'max_time', 'watch_json'];
const GH = ['assignment_id', 'email', 'item_id', 'score', 'comment', 'auto'];

function doGet() {
  return ContentService.createTextOutput('Video Quiz backend is running.');
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents);
    const user = verify_(req.token);
    out = route_(req, user);
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: String(err.message || err), code: err.code || 'ERR' };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function authErr_(msg) { const e = new Error(msg); e.code = 'AUTH'; return e; }

// Verifies the Google ID token and returns {email, name}.
function verify_(token) {
  if (!token) throw authErr_('Please sign in.');
  const cache = CacheService.getScriptCache();
  const key = 't' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw authErr_('Your sign-in expired. Please sign in again.');
  const p = JSON.parse(r.getContentText());
  if (p.aud !== CLIENT_ID) throw authErr_('This sign-in was issued for a different app.');
  if (String(p.email_verified) !== 'true') throw authErr_('Your Google email is not verified.');
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = Number(p.exp);
  if (exp <= nowSec) throw authErr_('Your sign-in expired. Please sign in again.');
  const email = String(p.email).toLowerCase();
  if (ALLOWED_DOMAINS.length && ALLOWED_DOMAINS.indexOf(email.split('@')[1]) < 0) {
    throw new Error('Please sign in with your school Google account.');
  }
  const user = { email: email, name: p.name || '' };
  cache.put(key, JSON.stringify(user), Math.max(1, Math.min(3000, exp - nowSec - 30)));
  return user;
}

function route_(req, user) {
  const isTeacher = user.email === TEACHER_EMAIL.toLowerCase();
  switch (req.action) {
    case 'whoami': return { email: user.email, name: user.name, isTeacher: isTeacher };
    case 'getAssignment': return studentGet_(req, user, isTeacher);
    case 'saveProgress': return studentSave_(req, user, isTeacher, false);
    case 'submit': return studentSave_(req, user, isTeacher, true);
  }
  if (!isTeacher) throw new Error('This action is for the teacher account only.');
  switch (req.action) {
    case 'listAssignments': return { assignments: listAssignments_() };
    case 'getAssignmentFull': return { assignment: JSON.parse(mustFind_(req.id).json) };
    case 'saveAssignment': return withLock_(() => saveAssignment_(req.assignment));
    case 'deleteAssignment': return withLock_(() => { deleteRowsWhere_('Assignments', AH, r => r[0] === req.id); return {}; });
    case 'getRoster': return { roster: readRoster_() };
    case 'saveRoster': return withLock_(() => saveRoster_(req.roster));
    case 'getResponses': return getResponses_(req.id);
    case 'saveGrade': return withLock_(() => {
      writeGrades_(req.id, String(req.email).toLowerCase(), [{ itemId: req.itemId, score: req.score, comment: req.comment, auto: false }]);
      return {};
    });
    case 'resetResponse': return withLock_(() => {
      const em = String(req.email).toLowerCase();
      deleteRowsWhere_('Responses', ReH, r => r[0] === req.id && r[1] === em);
      deleteRowsWhere_('Grades', GH, r => r[0] === req.id && r[1] === em);
      return {};
    });
  }
  throw new Error('Unknown action: ' + req.action);
}

// ---------- helpers ----------
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function sheet_(name, headers) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
function safe_(s) { s = String(s == null ? '' : s); return /^[=+\-@]/.test(s) ? ' ' + s : s; }
function chunk_(s, n) { const a = []; for (let i = 0; i < s.length; i += n) a.push(s.slice(i, i + n)); return a.length ? a : ['']; }
function isTrue_(v) { return v === true || v === 'TRUE' || v === 'true'; }

function deleteRowsWhere_(name, headers, pred) {
  const sh = sheet_(name, headers);
  const v = sh.getDataRange().getValues();
  for (let r = v.length - 1; r >= 1; r--) if (pred(v[r])) sh.deleteRow(r + 1);
}

// ---------- assignments ----------
function readAssignments_() {
  const v = sheet_('Assignments', AH).getDataRange().getValues();
  return v.slice(1).filter(r => r[0]).map(r => ({
    id: String(r[0]), title: String(r[1]), updated: String(r[2]), published: isTrue_(r[3]),
    json: r.slice(4).join('')
  }));
}
function mustFind_(id) {
  const a = readAssignments_().find(x => x.id === id);
  if (!a) throw new Error('Assignment not found.');
  return a;
}
// An assignment with no sections is open to everyone on the roster. Otherwise the student's roster section must match.
function inSections_(studentSection, sections) {
  if (!sections || !sections.length) return true;
  const want = sections.map(x => String(x).trim().toLowerCase());
  const whole = String(studentSection || '').trim().toLowerCase();
  if (want.indexOf(whole) >= 0) return true;
  return whole.split(',').map(x => x.trim()).filter(Boolean).some(m => want.indexOf(m) >= 0);
}

function listAssignments_() {
  return readAssignments_().map(a => {
    let videoId = '', sections = [];
    try { const j = JSON.parse(a.json); videoId = j.videoId || ''; sections = j.sections || []; } catch (e) {}
    return { id: a.id, title: a.title, updated: a.updated, published: a.published, videoId: videoId, sections: sections };
  });
}
function saveAssignment_(a) {
  if (!a || !a.videoId) throw new Error('Add a YouTube video first.');
  if (!a.id) a.id = 'a' + Utilities.getUuid().replace(/-/g, '').slice(0, 9);
  const sh = sheet_('Assignments', AH);
  const v = sh.getDataRange().getValues();
  let row = 0;
  for (let r = 1; r < v.length; r++) if (v[r][0] === a.id) { row = r + 1; break; }
  const vals = [a.id, a.title || 'Untitled', new Date().toISOString(), !!a.published].concat(chunk_(JSON.stringify(a), 40000));
  if (!row) row = sh.getLastRow() + 1;
  if (sh.getMaxColumns() < vals.length) sh.insertColumnsAfter(sh.getMaxColumns(), vals.length - sh.getMaxColumns());
  sh.getRange(row, 1, 1, sh.getMaxColumns()).clearContent();
  sh.getRange(row, 1, 1, vals.length).setValues([vals]);
  return { id: a.id };
}
function stripKeys_(a) {
  const c = JSON.parse(JSON.stringify(a));
  c.items.forEach(it => { delete it.correct; delete it.sample; });
  return c;
}

// ---------- roster ----------
function readRoster_() {
  const v = sheet_('Roster', RoH).getDataRange().getValues();
  return v.slice(1).filter(r => r[1]).map(r => ({ name: String(r[0]), email: String(r[1]).toLowerCase(), canvasId: String(r[2] || ''), section: String(r[3] || '') }));
}
function saveRoster_(list) {
  const sh = sheet_('Roster', RoH);
  if (!sh.getRange(1, 4).getValue()) sh.getRange(1, 4).setValue('section');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 4).clearContent();
  const rows = (list || []).filter(s => s.email).map(s => [safe_(s.name), String(s.email).trim().toLowerCase(), safe_(s.canvasId || ''), safe_(s.section || '')]);
  if (rows.length) sh.getRange(2, 1, rows.length, 4).setValues(rows);
  return { count: rows.length };
}

// ---------- students ----------
// The teacher account only previews (nothing saved) unless it is also on the roster, so it can be tested as a student.
function previewOnly_(isTeacher, user) {
  return isTeacher && !readRoster_().some(s => s.email === user.email);
}

function studentGet_(req, user, isTeacher) {
  const a = mustFind_(req.id);
  if (previewOnly_(isTeacher, user)) return { assignment: stripKeys_(JSON.parse(a.json)), preview: true };
  const me = readRoster_().find(s => s.email === user.email);
  if (!me) throw new Error('Your email (' + user.email + ') is not on the class roster. Ask your teacher.');
  if (!inSections_(me.section, JSON.parse(a.json).sections)) throw new Error('This assignment is not assigned to your section. Ask your teacher if you think that is a mistake.');
  if (!a.published) throw new Error('This assignment is not open yet.');
  const v = sheet_('Responses', ReH).getDataRange().getValues();
  const mine = v.slice(1).find(r => r[0] === req.id && r[1] === user.email);
  const out = { assignment: stripKeys_(JSON.parse(a.json)) };
  if (mine) out.response = { answers: JSON.parse(mine[3] || '{}'), submitted: isTrue_(mine[4]), maxTime: Number(mine[6]) || 0, watch: JSON.parse(mine[7] || '{}') };
  return out;
}

function sanitize_(answers, a) {
  const out = {};
  (a.items || []).forEach(it => {
    const v = (answers || {})[it.id];
    if (v === undefined || v === null) return;
    if (it.type === 'note') out[it.id] = true;
    else if (it.type === 'mc') out[it.id] = [].concat(v).map(Number).filter(n => isFinite(n) && n >= 0 && n < it.options.length);
    else out[it.id] = String(v).slice(0, 4000);
  });
  return out;
}

function sanitizeWatch_(w) {
  w = w || {};
  const aways = (Array.isArray(w.aways) ? w.aways : []).slice(-200).map(a => [Math.max(0, Math.round(Number(a[0]) || 0)), Math.max(0, Math.round(Number(a[1]) || 0))]);
  const rates = {};
  Object.keys(w.rates || {}).slice(0, 20).forEach(k => {
    const r = Number(k), v = Number(w.rates[k]);
    if (r > 0 && r <= 16 && v >= 0) rates[String(r)] = Math.round(v);
  });
  return { watched: Math.max(0, Math.round(Number(w.watched) || 0)), playable: Math.max(0, Math.round(Number(w.playable) || 0)), aways: aways, rates: rates };
}

function studentSave_(req, user, isTeacher, final) {
  if (previewOnly_(isTeacher, user)) return { preview: true };
  const me = readRoster_().find(s => s.email === user.email);
  if (!me) throw new Error('Your email is not on the class roster.');
  const a = JSON.parse(mustFind_(req.id).json);
  if (!inSections_(me.section, a.sections)) throw new Error('This assignment is not assigned to your section.');
  return withLock_(() => {
    const sh = sheet_('Responses', ReH);
    const v = sh.getDataRange().getValues();
    let row = 0;
    for (let r = 1; r < v.length; r++) if (v[r][0] === req.id && v[r][1] === user.email) { row = r + 1; break; }
    if (row && isTrue_(v[row - 1][4])) throw new Error('You already submitted this assignment.');
    const answers = sanitize_(req.answers, a);
    const vals = [req.id, user.email, safe_(me.name), JSON.stringify(answers), !!final, new Date().toISOString(), Number(req.maxTime) || 0, JSON.stringify(sanitizeWatch_(req.watch))];
    if (!row) row = sh.getLastRow() + 1;
    if (!sh.getRange(1, 8).getValue()) sh.getRange(1, 8).setValue('watch_json');
    sh.getRange(row, 1, 1, 8).setValues([vals]);
    if (final) {
      const grades = [];
      a.items.filter(it => it.type === 'mc').forEach(it => {
        const sel = (answers[it.id] || []).slice().sort().join(',');
        const key = (it.correct || []).slice().sort().join(',');
        grades.push({ itemId: it.id, score: sel === key && key !== '' ? Number(it.points) || 0 : 0, auto: true });
      });
      if (grades.length) writeGrades_(req.id, user.email, grades);
    }
    return { saved: true };
  });
}

// ---------- grades ----------
function writeGrades_(aid, email, list) {
  const sh = sheet_('Grades', GH);
  const v = sh.getDataRange().getValues();
  const idx = {};
  for (let r = 1; r < v.length; r++) idx[v[r][0] + '|' + v[r][1] + '|' + v[r][2]] = r + 1;
  const add = [];
  list.forEach(g => {
    const score = (g.score === '' || g.score === null || g.score === undefined) ? '' : Number(g.score);
    const row = [aid, email, g.itemId, score, safe_(g.comment || ''), !!g.auto];
    const k = aid + '|' + email + '|' + g.itemId;
    if (idx[k]) sh.getRange(idx[k], 1, 1, 6).setValues([row]); else add.push(row);
  });
  if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, 6).setValues(add);
}

function getResponses_(id) {
  const a = JSON.parse(mustFind_(id).json);
  const responses = sheet_('Responses', ReH).getDataRange().getValues().slice(1)
    .filter(r => r[0] === id)
    .map(r => ({ email: String(r[1]), name: String(r[2]), answers: JSON.parse(r[3] || '{}'), submitted: isTrue_(r[4]), updated: String(r[5]), watch: JSON.parse(r[7] || '{}') }));
  const grades = {};
  sheet_('Grades', GH).getDataRange().getValues().slice(1).filter(r => r[0] === id).forEach(r => {
    grades[r[1] + '|' + r[2]] = { score: r[3] === '' ? null : Number(r[3]), comment: String(r[4] || ''), auto: isTrue_(r[5]) };
  });
  return { assignment: a, roster: readRoster_(), responses: responses, grades: grades };
}
