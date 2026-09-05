// 社團志願序系統 API（Cloudflare Workers + D1）
import { parseCSVObjects, toCSV, STUDENT_ALIASES, CLUB_ALIASES } from '../lib/csv.js';
import { allocate, gradeAllowed, MODES } from '../lib/allocate.js';
import { signToken, verifyToken, safeEqual, randomReceipt, randomPassword, hashPassword } from '../lib/auth.js';

const STUDENT_TTL = 60 * 60 * 6;   // 學生登入 6 小時
const ADMIN_TTL = 60 * 60 * 8;     // 後台登入 8 小時
const BATCH = 80;                  // D1 批次寫入大小

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const csvResponse = (text, filename) =>
  new Response(text, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
    }
    try {
      if (!env.SESSION_SECRET) throw new HttpError(500, '尚未設定 SESSION_SECRET');
      return await route(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: '伺服器發生錯誤：' + (e.message || e) }, 500);
    }
  },
};

async function route(request, env, url) {
  const path = url.pathname.replace(/^\/api/, '');
  const m = request.method;

  // ---------- 公開 ----------
  if (path === '/state' && m === 'GET') return json(await publicState(env));
  if (path === '/login' && m === 'POST') return studentLogin(request, env);
  if (path === '/admin/login' && m === 'POST') return adminLogin(request, env);

  // ---------- 學生 ----------
  if (path === '/me' && m === 'GET') return me(request, env);
  if (path === '/prefs' && m === 'POST') return savePrefs(request, env);

  // ---------- 後台 ----------
  if (path.startsWith('/admin/')) {
    await requireAdmin(request, env);
    const sub = path.slice('/admin'.length);
    if (sub === '/overview' && m === 'GET') return json(await overview(env));
    if (sub === '/settings' && m === 'GET') return json(await getSettings(env));
    if (sub === '/settings' && m === 'PUT') return putSettings(request, env);
    if (sub === '/students' && m === 'POST') return importStudents(request, env, url);
    if (sub === '/students' && m === 'GET') return listStudents(env, url);
    if (sub === '/students/reset-password' && m === 'POST') return resetPasswords(request, env);
    if (sub === '/clubs' && m === 'POST') return importClubs(request, env, url);
    if (sub === '/clubs' && m === 'GET') return listClubs(env, url);
    if (sub === '/preferences' && m === 'GET') return exportPreferences(env, url);
    if (sub === '/allocate' && m === 'POST') return runAllocation(request, env);
    if (sub === '/results' && m === 'GET') return exportResults(env, url);
    if (sub === '/reset' && m === 'POST') return reset(request, env);
  }
  throw new HttpError(404, '找不到此 API');
}

// ================= 設定 =================
async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const s = Object.fromEntries(results.map(r => [r.key, r.value]));
  return {
    status: s.status || 'auto',
    open_at: s.open_at || '',
    close_at: s.close_at || '',
    max_prefs: clampInt(s.max_prefs, 1, 50, 15),
    min_prefs: clampInt(s.min_prefs, 1, 50, 15),
    announce: s.announce || '',
    results_public: s.results_public === '1',
  };
}

function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function isOpen(s, now = new Date()) {
  if (s.status === 'open') return true;
  if (s.status === 'closed') return false;
  if (!s.open_at || !s.close_at) return false;
  const o = new Date(s.open_at), c = new Date(s.close_at);
  if (Number.isNaN(o.getTime()) || Number.isNaN(c.getTime())) return false;
  return now >= o && now <= c;
}

async function putSettings(request, env) {
  const body = await request.json().catch(() => ({}));
  const allowed = ['status', 'open_at', 'close_at', 'max_prefs', 'min_prefs', 'announce', 'results_public'];
  const stmts = [];
  for (const k of allowed) {
    if (!(k in body)) continue;
    let v = body[k];
    if (k === 'status' && !['auto', 'open', 'closed'].includes(v)) throw new HttpError(400, 'status 不合法');
    if (k === 'results_public') v = v ? '1' : '0';
    if (k === 'max_prefs' || k === 'min_prefs') v = String(clampInt(v, 1, 50, 15));
    if ((k === 'open_at' || k === 'close_at') && v && Number.isNaN(new Date(v).getTime())) throw new HttpError(400, `${k} 時間格式錯誤`);
    stmts.push(env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, String(v ?? '')));
  }
  if (stmts.length) await env.DB.batch(stmts);
  const s = await getSettings(env);
  if (s.min_prefs > s.max_prefs) {
    await env.DB.prepare("UPDATE settings SET value = ? WHERE key = 'min_prefs'").bind(String(s.max_prefs)).run();
    s.min_prefs = s.max_prefs;
  }
  return json(s);
}

async function publicState(env) {
  const s = await getSettings(env);
  const { results: clubs } = await env.DB.prepare('SELECT club_id, name, category, capacity, grades, teacher, location, description FROM clubs ORDER BY sort_order, club_id').all();
  return {
    school: env.SCHOOL_NAME || '',
    open: isOpen(s),
    status: s.status, open_at: s.open_at, close_at: s.close_at,
    max_prefs: s.max_prefs, min_prefs: s.min_prefs,
    announce: s.announce, results_public: s.results_public,
    server_time: new Date().toISOString(),
    clubs,
  };
}

// ================= 學生 =================
async function studentLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const sid = String(body.student_id || '').trim();
  const pw = String(body.password || '').trim();
  if (!sid || !pw) throw new HttpError(400, '請輸入學號與密碼');
  const stu = await env.DB.prepare('SELECT student_id, name, class_name, grade, password_hash FROM students WHERE student_id = ?').bind(sid).first();
  const hash = await hashPassword(env.SESSION_SECRET, sid, pw);
  if (!stu || !safeEqual(stu.password_hash, hash)) throw new HttpError(401, '學號或密碼不正確，請確認後再試');
  const token = await signToken({ sub: stu.student_id, role: 'student' }, env.SESSION_SECRET, STUDENT_TTL);
  return json({ token, student: { student_id: stu.student_id, name: stu.name, class_name: stu.class_name, grade: stu.grade } });
}

async function requireStudent(request, env) {
  const auth = request.headers.get('authorization') || '';
  const p = await verifyToken(auth.replace(/^Bearer\s+/i, ''), env.SESSION_SECRET);
  if (!p || p.role !== 'student') throw new HttpError(401, '登入已過期，請重新登入');
  const stu = await env.DB.prepare('SELECT student_id, name, class_name, grade, seat_no FROM students WHERE student_id = ?').bind(p.sub).first();
  if (!stu) throw new HttpError(401, '查無此學生');
  return stu;
}

async function me(request, env) {
  const stu = await requireStudent(request, env);
  const s = await getSettings(env);
  const pref = await env.DB.prepare('SELECT prefs, receipt, updated_at FROM preferences WHERE student_id = ?').bind(stu.student_id).first();
  let result = null;
  if (s.results_public) {
    const r = await env.DB.prepare('SELECT r.club_id, r.rank, c.name AS club_name FROM results r LEFT JOIN clubs c ON c.club_id = r.club_id WHERE r.student_id = ?').bind(stu.student_id).first();
    if (r) result = r;
  }
  return json({
    student: stu,
    prefs: pref ? JSON.parse(pref.prefs) : [],
    receipt: pref?.receipt || null,
    updated_at: pref?.updated_at || null,
    result,
  });
}

async function savePrefs(request, env) {
  const stu = await requireStudent(request, env);
  const s = await getSettings(env);
  if (!isOpen(s)) throw new HttpError(403, '目前不在開放填寫時間');
  const body = await request.json().catch(() => ({}));
  const prefs = Array.isArray(body.prefs) ? body.prefs.map(String) : null;
  if (!prefs) throw new HttpError(400, '志願格式錯誤');

  const { results: clubs } = await env.DB.prepare('SELECT club_id, grades FROM clubs').all();
  const clubMap = new Map(clubs.map(c => [c.club_id, c]));
  const eligibleCount = clubs.filter(c => gradeAllowed(c, stu.grade)).length;
  const min = Math.min(s.min_prefs, eligibleCount);

  if (prefs.length > s.max_prefs) throw new HttpError(400, `最多只能填 ${s.max_prefs} 個志願`);
  if (prefs.length < min) throw new HttpError(400, `至少要填 ${min} 個志願`);
  if (new Set(prefs).size !== prefs.length) throw new HttpError(400, '志願不可重複');
  for (const id of prefs) {
    const c = clubMap.get(id);
    if (!c) throw new HttpError(400, `社團代碼 ${id} 不存在`);
    if (!gradeAllowed(c, stu.grade)) throw new HttpError(400, `社團 ${id} 不開放你的年級`);
  }

  const existing = await env.DB.prepare('SELECT receipt FROM preferences WHERE student_id = ?').bind(stu.student_id).first();
  const receipt = existing?.receipt || randomReceipt();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO preferences (student_id, prefs, receipt, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(student_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at'
  ).bind(stu.student_id, JSON.stringify(prefs), receipt, now).run();
  return json({ ok: true, receipt, updated_at: now, prefs });
}

// ================= 後台 =================
async function adminLogin(request, env) {
  if (!env.ADMIN_PASSWORD) throw new HttpError(500, '尚未設定 ADMIN_PASSWORD');
  const body = await request.json().catch(() => ({}));
  if (!safeEqual(body.password || '', env.ADMIN_PASSWORD)) throw new HttpError(401, '密碼錯誤');
  const token = await signToken({ sub: 'admin', role: 'admin' }, env.SESSION_SECRET, ADMIN_TTL);
  return json({ token });
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('authorization') || '';
  const p = await verifyToken(auth.replace(/^Bearer\s+/i, ''), env.SESSION_SECRET);
  if (!p || p.role !== 'admin') throw new HttpError(401, '請先登入後台');
}

async function overview(env) {
  const s = await getSettings(env);
  const [students, submitted, clubs, capacity, lastRun, byGrade] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM students').first('n'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM preferences').first('n'),
    env.DB.prepare('SELECT COUNT(*) AS n FROM clubs').first('n'),
    env.DB.prepare('SELECT COALESCE(SUM(capacity),0) AS n FROM clubs').first('n'),
    env.DB.prepare('SELECT seed, mode, run_at, summary FROM allocation_runs ORDER BY id DESC LIMIT 1').first(),
    env.DB.prepare('SELECT s.class_name, COUNT(*) AS total, SUM(CASE WHEN p.student_id IS NULL THEN 0 ELSE 1 END) AS submitted FROM students s LEFT JOIN preferences p ON p.student_id = s.student_id GROUP BY s.class_name ORDER BY s.class_name').all(),
  ]);
  return {
    settings: s, open: isOpen(s), server_time: new Date().toISOString(),
    students, submitted, clubs, capacity,
    last_run: lastRun ? { ...lastRun, summary: JSON.parse(lastRun.summary) } : null,
    by_class: byGrade.results,
    modes: MODES,
  };
}

async function importStudents(request, env, url) {
  const text = await request.text();
  const rows = parseCSVObjects(text, STUDENT_ALIASES);
  if (!rows.length) throw new HttpError(400, 'CSV 沒有資料列');
  const errors = [];
  const seen = new Set();
  const items = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const sid = (r.student_id || '').trim();
    if (!sid) return errors.push(`第 ${line} 列缺學號`);
    if (seen.has(sid)) return errors.push(`第 ${line} 列學號 ${sid} 重複`);
    if (!r.name) return errors.push(`第 ${line} 列缺姓名`);
    const pw = (r.password || '').trim();
    if (pw && pw.length < 4) return errors.push(`第 ${line} 列密碼至少 4 碼`);
    seen.add(sid);
    items.push({ sid, name: r.name, class_name: r.class_name || '', grade: parseInt(r.grade, 10) || 0, seat_no: r.seat_no || '', password: pw, generated: !pw });
  });
  if (errors.length) return json({ error: '匯入失敗，請修正後重新上傳', details: errors.slice(0, 50) }, 400);

  const replace = url.searchParams.get('replace') === '1';
  // 未提供密碼且學生已存在時，保留原密碼（避免重複匯入把密碼洗掉）
  const existing = new Set();
  if (!replace) {
    const { results } = await env.DB.prepare('SELECT student_id FROM students').all();
    for (const r of results) existing.add(r.student_id);
  }
  const passwords = [];
  const stmts = [];
  let kept = 0;
  for (const it of items) {
    if (it.generated && existing.has(it.sid)) {
      kept++;
      stmts.push(env.DB.prepare('UPDATE students SET name=?, class_name=?, grade=?, seat_no=? WHERE student_id=?').bind(it.name, it.class_name, it.grade, it.seat_no, it.sid));
      continue;
    }
    const pw = it.generated ? randomPassword() : it.password;
    if (it.generated) passwords.push({ student_id: it.sid, name: it.name, class_name: it.class_name, seat_no: it.seat_no, password: pw });
    const hash = await hashPassword(env.SESSION_SECRET, it.sid, pw);
    stmts.push(env.DB.prepare(
      'INSERT INTO students (student_id, name, class_name, grade, password_hash, seat_no) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(student_id) DO UPDATE SET name=excluded.name, class_name=excluded.class_name, grade=excluded.grade, password_hash=excluded.password_hash, seat_no=excluded.seat_no'
    ).bind(it.sid, it.name, it.class_name, it.grade, hash, it.seat_no));
  }
  if (replace) await env.DB.prepare('DELETE FROM students').run();
  await runBatches(env, stmts);
  return json({ ok: true, imported: items.length, generated: passwords.length, kept, passwords });
}

// 重設密碼：body { scope: 'all' | 'class' | 'students', class_name?, student_ids? }
async function resetPasswords(request, env) {
  const body = await request.json().catch(() => ({}));
  let rows;
  if (body.scope === 'all') {
    rows = (await env.DB.prepare('SELECT student_id, name, class_name, seat_no FROM students ORDER BY class_name, seat_no, student_id').all()).results;
  } else if (body.scope === 'class' && body.class_name) {
    rows = (await env.DB.prepare('SELECT student_id, name, class_name, seat_no FROM students WHERE class_name = ? ORDER BY seat_no, student_id').bind(String(body.class_name)).all()).results;
  } else if (body.scope === 'students' && Array.isArray(body.student_ids) && body.student_ids.length) {
    rows = [];
    for (const id of body.student_ids.slice(0, 200)) {
      const r = await env.DB.prepare('SELECT student_id, name, class_name, seat_no FROM students WHERE student_id = ?').bind(String(id)).first();
      if (r) rows.push(r);
    }
  } else throw new HttpError(400, '請指定重設範圍');
  if (!rows.length) throw new HttpError(404, '找不到符合的學生');
  const passwords = [];
  const stmts = [];
  for (const r of rows) {
    const pw = randomPassword();
    passwords.push({ ...r, password: pw });
    stmts.push(env.DB.prepare('UPDATE students SET password_hash = ? WHERE student_id = ?').bind(await hashPassword(env.SESSION_SECRET, r.student_id, pw), r.student_id));
  }
  await runBatches(env, stmts);
  return json({ ok: true, count: passwords.length, passwords });
}

async function importClubs(request, env, url) {
  const text = await request.text();
  const rows = parseCSVObjects(text, CLUB_ALIASES);
  if (!rows.length) throw new HttpError(400, 'CSV 沒有資料列');
  const errors = [];
  const stmts = [];
  const seen = new Set();
  rows.forEach((r, i) => {
    const line = i + 2;
    const id = (r.club_id || '').trim();
    if (!id) return errors.push(`第 ${line} 列缺社團代碼`);
    if (seen.has(id)) return errors.push(`第 ${line} 列社團代碼 ${id} 重複`);
    if (!r.name) return errors.push(`第 ${line} 列缺社團名稱`);
    const cap = parseInt(r.capacity, 10);
    if (Number.isNaN(cap) || cap < 0) return errors.push(`第 ${line} 列名額需為整數`);
    seen.add(id);
    stmts.push(env.DB.prepare(
      'INSERT INTO clubs (club_id, name, category, capacity, grades, teacher, location, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(club_id) DO UPDATE SET name=excluded.name, category=excluded.category, capacity=excluded.capacity, grades=excluded.grades, teacher=excluded.teacher, location=excluded.location, description=excluded.description, sort_order=excluded.sort_order'
    ).bind(id, r.name, r.category || '', cap, (r.grades || '').replace(/[，、\s]+/g, ','), r.teacher || '', r.location || '', r.description || '', i));
  });
  if (errors.length) return json({ error: '匯入失敗，請修正後重新上傳', details: errors.slice(0, 50) }, 400);
  if (url.searchParams.get('replace') === '1') await env.DB.prepare('DELETE FROM clubs').run();
  await runBatches(env, stmts);
  return json({ ok: true, imported: stmts.length });
}

async function runBatches(env, stmts) {
  for (let i = 0; i < stmts.length; i += BATCH) await env.DB.batch(stmts.slice(i, i + BATCH));
}

async function listStudents(env, url) {
  const { results } = await env.DB.prepare(
    'SELECT s.student_id, s.name, s.class_name, s.grade, s.seat_no, p.updated_at, p.receipt FROM students s LEFT JOIN preferences p ON p.student_id = s.student_id ORDER BY s.class_name, s.seat_no, s.student_id'
  ).all();
  const onlyMissing = url.searchParams.get('missing') === '1';
  const rows = onlyMissing ? results.filter(r => !r.updated_at) : results;
  if (url.searchParams.get('format') === 'csv') {
    const header = ['學號', '姓名', '班級', '年級', '座號', '已送出', '送出時間', '確認碼'];
    return csvResponse(toCSV(rows.map(r => [r.student_id, r.name, r.class_name, r.grade, r.seat_no, r.updated_at ? '是' : '否', r.updated_at || '', r.receipt || '']), header), onlyMissing ? '未填寫名單.csv' : '學生名單.csv');
  }
  return json({ students: rows });
}

async function listClubs(env, url) {
  const { results: clubs } = await env.DB.prepare('SELECT * FROM clubs ORDER BY sort_order, club_id').all();
  const { results: prefRows } = await env.DB.prepare('SELECT prefs FROM preferences').all();
  const first = {}, any = {};
  for (const r of prefRows) {
    const p = JSON.parse(r.prefs);
    if (p[0]) first[p[0]] = (first[p[0]] || 0) + 1;
    for (const id of p) any[id] = (any[id] || 0) + 1;
  }
  const rows = clubs.map(c => ({ ...c, first_choice: first[c.club_id] || 0, any_choice: any[c.club_id] || 0 }));
  if (url.searchParams.get('format') === 'csv') {
    const header = ['社團代碼', '社團名稱', '類別', '名額', '限制年級', '指導老師', '地點', '第一志願人數', '被填選人次'];
    return csvResponse(toCSV(rows.map(c => [c.club_id, c.name, c.category, c.capacity, c.grades, c.teacher, c.location, c.first_choice, c.any_choice]), header), '社團填選統計.csv');
  }
  return json({ clubs: rows });
}

async function exportPreferences(env, url) {
  const { results } = await env.DB.prepare(
    'SELECT s.student_id, s.name, s.class_name, s.grade, p.prefs, p.updated_at, p.receipt FROM preferences p JOIN students s ON s.student_id = p.student_id ORDER BY s.class_name, s.student_id'
  ).all();
  const max = (await getSettings(env)).max_prefs;
  if (url.searchParams.get('format') === 'csv') {
    const header = ['學號', '姓名', '班級', '年級', ...Array.from({ length: max }, (_, i) => `志願${i + 1}`), '送出時間', '確認碼'];
    const rows = results.map(r => {
      const p = JSON.parse(r.prefs);
      return [r.student_id, r.name, r.class_name, r.grade, ...Array.from({ length: max }, (_, i) => p[i] || ''), r.updated_at, r.receipt];
    });
    return csvResponse(toCSV(rows, header), '志願序原始資料.csv');
  }
  return json({ preferences: results.map(r => ({ ...r, prefs: JSON.parse(r.prefs) })) });
}

async function runAllocation(request, env) {
  const body = await request.json().catch(() => ({}));
  const seed = String(body.seed || '').trim();
  const mode = body.mode || 'random';
  const dryRun = !!body.dry_run;
  if (!seed) throw new HttpError(400, '請輸入抽籤種子（seed）');
  if (!MODES[mode]) throw new HttpError(400, '分發模式不合法');

  const [{ results: students }, { results: clubs }, { results: prefRows }] = await Promise.all([
    env.DB.prepare('SELECT student_id, name, class_name, grade FROM students').all(),
    env.DB.prepare('SELECT club_id, name, capacity, grades FROM clubs').all(),
    env.DB.prepare('SELECT student_id, prefs FROM preferences').all(),
  ]);
  const prefs = new Map(prefRows.map(r => [r.student_id, JSON.parse(r.prefs)]));
  const out = allocate({ students, clubs, prefs, seed, mode });

  if (!dryRun) {
    await env.DB.prepare('DELETE FROM results').run();
    const stmts = out.results.map(r => env.DB.prepare('INSERT INTO results (student_id, club_id, rank, lottery) VALUES (?, ?, ?, ?)').bind(r.student_id, r.club_id, r.rank, r.lottery));
    await runBatches(env, stmts);
    await env.DB.prepare('INSERT INTO allocation_runs (seed, mode, run_at, summary) VALUES (?, ?, ?, ?)').bind(seed, mode, new Date().toISOString(), JSON.stringify(out.summary)).run();
  }
  return json({ ok: true, dry_run: dryRun, summary: out.summary });
}

async function exportResults(env, url) {
  const { results } = await env.DB.prepare(
    'SELECT r.student_id, s.name, s.class_name, s.grade, s.seat_no, r.club_id, c.name AS club_name, c.teacher, c.location, r.rank, r.lottery FROM results r JOIN students s ON s.student_id = r.student_id LEFT JOIN clubs c ON c.club_id = r.club_id ORDER BY s.class_name, s.seat_no, s.student_id'
  ).all();
  const fmt = url.searchParams.get('format');
  const view = url.searchParams.get('view') || 'student';
  if (fmt === 'csv' && view === 'club') {
    const sorted = results.slice().sort((a, b) => String(a.club_id ?? '～').localeCompare(String(b.club_id ?? '～')) || a.class_name.localeCompare(b.class_name) || a.student_id.localeCompare(b.student_id));
    const header = ['社團代碼', '社團名稱', '指導老師', '地點', '學號', '姓名', '班級', '座號', '錄取志願序'];
    return csvResponse(toCSV(sorted.map(r => [r.club_id || '未分發', r.club_name || '未分發', r.teacher || '', r.location || '', r.student_id, r.name, r.class_name, r.seat_no, r.rank ?? '']), header), '分發結果_依社團.csv');
  }
  if (fmt === 'csv') {
    const header = ['學號', '姓名', '班級', '座號', '年級', '錄取社團代碼', '錄取社團', '錄取志願序', '抽籤順位', '備註'];
    return csvResponse(toCSV(results.map(r => [r.student_id, r.name, r.class_name, r.seat_no, r.grade, r.club_id || '', r.club_name || '', r.rank ?? '', r.lottery ?? '', r.lottery == null ? '未填志願' : (r.club_id ? '' : '志願皆額滿')]), header), '分發結果_依班級.csv');
  }
  return json({ results });
}

async function reset(request, env) {
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== 'DELETE') throw new HttpError(400, '請輸入 DELETE 以確認');
  const what = body.what;
  const map = {
    results: ['DELETE FROM results', 'DELETE FROM allocation_runs'],
    preferences: ['DELETE FROM preferences', 'DELETE FROM results', 'DELETE FROM allocation_runs'],
    all: ['DELETE FROM preferences', 'DELETE FROM results', 'DELETE FROM allocation_runs', 'DELETE FROM students', 'DELETE FROM clubs'],
  };
  if (!map[what]) throw new HttpError(400, '不合法的清除項目');
  await env.DB.batch(map[what].map(q => env.DB.prepare(q)));
  return json({ ok: true, cleared: what });
}
