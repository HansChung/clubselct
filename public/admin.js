(() => {
  const $ = s => document.querySelector(s);
  const TOKEN_KEY = 'club_admin_token';
  let overview = null;
  let students = [];

  const api = async (path, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (!(opts.body instanceof Blob) && !opts.raw) headers['content-type'] = 'application/json';
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.authorization = 'Bearer ' + token;
    const res = await fetch('/api' + path, { ...opts, headers });
    if (opts.blob) { if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '下載失敗'); return res.blob(); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && token) logout();
      const err = new Error(data.error || '發生錯誤'); err.details = data.details; throw err;
    }
    return data;
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmtTime = iso => iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '';
  const msg = (el, text, ok = true) => { $(el).innerHTML = `<div class="${ok ? 'success' : 'error'}">${esc(text)}</div>`; };

  // ---------- 登入 ----------
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('#loginErr').textContent = '';
    try {
      const r = await api('/admin/login', { method: 'POST', body: JSON.stringify({ username: $('#un').value.trim(), password: $('#pw').value }) });
      localStorage.setItem(TOKEN_KEY, r.token); localStorage.setItem(TOKEN_KEY + '_name', r.display_name || r.username); $('#pw').value = '';
      await enter();
    } catch (err) { $('#loginErr').textContent = err.message; }
  });
  $('#logoutBtn').addEventListener('click', logout);
  function logout() { localStorage.removeItem(TOKEN_KEY); $('#appView').classList.add('hidden'); $('#who').classList.add('hidden'); $('#loginView').classList.remove('hidden'); }
  let SCHOOL = '';
  async function enter() {
    $('#loginView').classList.add('hidden'); $('#appView').classList.remove('hidden'); $('#who').classList.remove('hidden');
    $('#whoName').textContent = localStorage.getItem(TOKEN_KEY + '_name') || '';
    fetch('/api/state').then(r => r.json()).then(s => { SCHOOL = s.school || ''; }).catch(() => {});
    await loadOverview();
  }

  // ---------- 分頁 ----------
  document.querySelectorAll('nav.admin button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('nav.admin button').forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach(t => t.classList.add('hidden'));
    $('#tab-' + b.dataset.tab).classList.remove('hidden');
    if (b.dataset.tab === 'overview') loadOverview();
    if (b.dataset.tab === 'students') loadStudents();
    if (b.dataset.tab === 'clubs') loadClubs();
    if (b.dataset.tab === 'settings') loadSettings();
    if (b.dataset.tab === 'accounts') loadAccounts();
  }));

  // ---------- 總覽 ----------
  async function loadOverview() {
    overview = await api('/admin/overview');
    const o = overview, s = o.settings;
    const b = $('#ovBanner');
    b.className = 'banner ' + (o.open ? 'ok' : 'bad');
    b.textContent = (o.open ? '目前開放填寫中' : '目前關閉填寫') + `（模式：${{ auto: '依時間', open: '強制開放', closed: '強制關閉' }[s.status]}${s.status === 'auto' ? `，${fmtTime(s.open_at) || '未設'} ～ ${fmtTime(s.close_at) || '未設'}` : ''}）`;
    const pct = o.students ? Math.round(o.submitted / o.students * 100) : 0;
    $('#ovStats').innerHTML = [
      ['學生人數', o.students], ['已送出', o.submitted], ['填寫率', pct + '%'], ['未填', o.students - o.submitted], ['社團數', o.clubs], ['總名額', o.capacity],
    ].map(([k, v]) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`).join('');
    $('#ovClass').innerHTML = o.by_class.map(r => `<tr><td>${esc(r.class_name) || '（未填班級）'}</td><td>${r.total}</td><td>${r.submitted}</td><td>${r.total - r.submitted}</td><td>${Math.round(r.submitted / r.total * 100)}%</td></tr>`).join('') || '<tr><td colspan="5" class="muted">尚未匯入學生</td></tr>';
    if (o.last_run) $('#ovRun').innerHTML = summaryHtml(o.last_run.summary, o.last_run.run_at);
    const sel = $('#aMode'); if (!sel.options.length) for (const [k, v] of Object.entries(o.modes)) sel.add(new Option(v, k));
  }

  function summaryHtml(s, runAt) {
    const hist = Object.entries(s.rank_histogram).sort((a, b) => a[0] - b[0]).map(([r, n]) => `第 ${r} 志願：${n} 人`).join('、');
    const full = s.club_fill.filter(c => c.filled >= c.capacity && c.capacity > 0).length;
    return `
      <div class="muted small">${runAt ? '執行時間 ' + fmtTime(runAt) + ' · ' : ''}種子「${esc(s.seed)}」· 模式 ${esc(s.mode)}</div>
      <div class="stats" style="margin:12px 0">
        <div class="stat"><div class="v">${s.submitted}</div><div class="k">參與分發</div></div>
        <div class="stat"><div class="v">${s.assigned}</div><div class="k">已分發</div></div>
        <div class="stat"><div class="v" style="color:${s.unassigned ? 'var(--bad)' : 'inherit'}">${s.unassigned}</div><div class="k">志願皆額滿</div></div>
        <div class="stat"><div class="v">${s.not_submitted}</div><div class="k">未填志願</div></div>
        <div class="stat"><div class="v">${full}/${s.club_fill.length}</div><div class="k">額滿社團</div></div>
      </div>
      <div class="small">${hist || '—'}</div>
      <details style="margin-top:10px"><summary class="small" style="cursor:pointer">各社團錄取人數</summary>
        <div class="table-wrap"><table><thead><tr><th>代碼</th><th>社團</th><th>名額</th><th>錄取</th><th>餘額</th></tr></thead><tbody>
        ${s.club_fill.map(c => `<tr><td>${esc(c.club_id)}</td><td>${esc(c.name)}</td><td>${c.capacity}</td><td>${c.filled}</td><td>${c.capacity - c.filled}</td></tr>`).join('')}
        </tbody></table></div></details>`;
  }

  // ---------- 學生 ----------
  async function fileToCSV(f) {
    if (/\.xlsx?$/i.test(f.name)) {
      if (!window.XLSX) throw new Error('Excel 解析元件載入失敗，請改存成 CSV 上傳');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    }
    return f.text();
  }
  let lastPasswords = [];
  async function uploadCSV(fileInput, replaceInput, path, msgEl) {
    const f = fileInput.files[0];
    if (!f) return msg(msgEl, '請先選擇 Excel 或 CSV 檔', false);
    try {
      const text = await fileToCSV(f);
      const r = await api(path + (replaceInput.checked ? '?replace=1' : ''), { method: 'POST', body: text, raw: true, headers: { 'content-type': 'text/csv' } });
      msg(msgEl, `匯入完成，共 ${r.imported} 筆` + (r.generated !== undefined ? `（新產生密碼 ${r.generated} 筆，保留原密碼 ${r.kept} 筆）` : ''));
      fileInput.value = '';
      if (r.passwords) showPasswords(r.passwords);
      return true;
    } catch (err) {
      $(msgEl).innerHTML = `<div class="error">${esc(err.message)}</div>` + (err.details ? `<ul class="small error">${err.details.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : '');
      return false;
    }
  }
  function showPasswords(list) {
    lastPasswords = list;
    $('#pwBox').classList.toggle('hidden', !list.length);
    $('#pwCount').textContent = list.length;
  }
  function downloadCSV(name, header, rows) {
    const esc = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const text = '\ufeff' + [header, ...rows].map(r => r.map(esc).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  function openPrint(payload) {
    sessionStorage.setItem('print_payload', JSON.stringify(payload));
    window.open('/print.html', '_blank');
  }
  $('#pwCsv').addEventListener('click', () => downloadCSV('學生密碼名單.csv', ['班級', '座號', '學號', '姓名', '密碼'], lastPasswords.map(p => [p.class_name, p.seat_no, p.student_id, p.name, p.password])));
  $('#pwPrint').addEventListener('click', () => openPrint({ type: 'passwords', school: schoolName(), items: lastPasswords }));
  function schoolName() { return SCHOOL; }
  $('#rpRun').addEventListener('click', async () => {
    const scope = $('#rpScope').value, v = $('#rpValue').value.trim();
    const body = { scope };
    if (scope === 'class') { if (!v) return msg('#rpMsg', '請輸入班級', false); body.class_name = v; }
    if (scope === 'students') { body.student_ids = v.split(/[,，\s]+/).filter(Boolean); if (!body.student_ids.length) return msg('#rpMsg', '請輸入學號', false); }
    if (scope === 'all' && !confirm('確定要重設全校所有學生的密碼？舊密碼將立即失效。')) return;
    try {
      const r = await api('/admin/students/reset-password', { method: 'POST', body: JSON.stringify(body) });
      msg('#rpMsg', `已重設 ${r.count} 位學生的密碼，請於上方下載或列印。`);
      showPasswords(r.passwords);
      $('#pwBox').scrollIntoView({ behavior: 'smooth' });
    } catch (err) { msg('#rpMsg', err.message, false); }
  });
  $('#prRun').addEventListener('click', async () => {
    try {
      const { results } = await api('/admin/results');
      const cls = $('#prClass').value.trim();
      const rows = results.filter(r => !cls || r.class_name === cls);
      if (!rows.length) return msg('#prMsg', '沒有分發結果，請先執行分發', false);
      openPrint({ type: 'results', school: schoolName(), items: rows });
      msg('#prMsg', `已開啟 ${rows.length} 張通知單，請在新分頁列印或存成 PDF`);
    } catch (err) { msg('#prMsg', err.message, false); }
  });

  $('#stuUpload').addEventListener('click', async () => { if (await uploadCSV($('#stuFile'), $('#stuReplace'), '/admin/students', '#stuMsg')) loadStudents(); });
  $('#stuRefresh').addEventListener('click', loadStudents);
  $('#stuSearch').addEventListener('input', renderStudents);
  $('#stuMissing').addEventListener('change', renderStudents);
  async function loadStudents() { students = (await api('/admin/students')).students; renderStudents(); }
  function renderStudents() {
    const q = $('#stuSearch').value.trim().toLowerCase(), missing = $('#stuMissing').checked;
    const rows = students.filter(s => (!missing || !s.updated_at) && (!q || [s.student_id, s.name, s.class_name].join(' ').toLowerCase().includes(q)));
    $('#stuCount').textContent = `顯示 ${rows.length} / ${students.length} 人`;
    $('#stuTable').innerHTML = rows.slice(0, 500).map(s => `<tr><td>${esc(s.student_id)}</td><td>${esc(s.name)}</td><td>${esc(s.class_name)}</td><td>${s.grade}</td><td>${esc(s.seat_no)}</td><td>${s.updated_at ? fmtTime(s.updated_at) : '<span class="muted">未填</span>'}</td><td>${esc(s.receipt || '')}</td></tr>`).join('') + (rows.length > 500 ? `<tr><td colspan="7" class="muted">僅顯示前 500 筆，請用搜尋或匯出 CSV</td></tr>` : '');
  }

  // ---------- 社團 ----------
  $('#clubUpload').addEventListener('click', async () => { if (await uploadCSV($('#clubFile'), $('#clubReplace'), '/admin/clubs', '#clubMsg')) loadClubs(); });
  $('#clubRefresh').addEventListener('click', loadClubs);
  async function loadClubs() {
    const { clubs } = await api('/admin/clubs');
    $('#clubTable').innerHTML = clubs.map(c => `<tr><td>${esc(c.club_id)}</td><td>${esc(c.name)}</td><td>${esc(c.category)}</td><td>${c.capacity}</td><td>${esc(c.grades)}</td><td>${esc(c.teacher)}</td><td>${c.first_choice}</td><td>${c.any_choice}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">尚未匯入社團</td></tr>';
  }

  // ---------- 設定 ----------
  const toLocal = iso => { if (!iso) return ''; const d = new Date(iso); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  async function loadSettings() {
    const s = await api('/admin/settings');
    $('#sStatus').value = s.status; $('#sOpen').value = toLocal(s.open_at); $('#sClose').value = toLocal(s.close_at);
    $('#sMax').value = s.max_prefs; $('#sMin').value = s.min_prefs; $('#sAnnounce').value = s.announce; $('#sPublic').checked = s.results_public;
  }
  $('#settingsForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/admin/settings', { method: 'PUT', body: JSON.stringify({
        status: $('#sStatus').value,
        open_at: $('#sOpen').value ? new Date($('#sOpen').value).toISOString() : '',
        close_at: $('#sClose').value ? new Date($('#sClose').value).toISOString() : '',
        max_prefs: +$('#sMax').value, min_prefs: +$('#sMin').value,
        announce: $('#sAnnounce').value, results_public: $('#sPublic').checked,
      }) });
      msg('#settingsMsg', '已儲存'); loadSettings();
    } catch (err) { msg('#settingsMsg', err.message, false); }
  });

  // ---------- 分發 ----------
  async function runAlloc(dry) {
    const seed = $('#aSeed').value.trim();
    if (!seed) return msg('#aMsg', '請輸入抽籤種子', false);
    if (!dry && !confirm('正式分發會覆寫先前結果，確定執行？')) return;
    $('#aMsg').innerHTML = '<div class="muted">計算中…</div>';
    try {
      const r = await api('/admin/allocate', { method: 'POST', body: JSON.stringify({ seed, mode: $('#aMode').value, dry_run: dry }) });
      msg('#aMsg', dry ? '試算完成（未寫入）' : '分發完成，已寫入結果。可至「匯出」下載名單。');
      $('#aSummary').classList.remove('hidden'); $('#aSummary').innerHTML = summaryHtml(r.summary);
    } catch (err) { msg('#aMsg', err.message, false); }
  }
  $('#aDry').addEventListener('click', () => runAlloc(true));
  $('#aRun').addEventListener('click', () => runAlloc(false));

  // ---------- 匯出／清除 ----------
  document.querySelectorAll('[data-dl]').forEach(a => a.addEventListener('click', async e => {
    e.preventDefault();
    try {
      const res = await fetch('/api' + a.dataset.dl, { headers: { authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '下載失敗');
      const cd = res.headers.get('content-disposition') || '';
      const m = cd.match(/filename\*=UTF-8''([^;]+)/);
      const name = m ? decodeURIComponent(m[1]) : 'export.csv';
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) { alert(err.message); }
  }));
  $('#rRun').addEventListener('click', async () => {
    try {
      const r = await api('/admin/reset', { method: 'POST', body: JSON.stringify({ what: $('#rWhat').value, confirm: $('#rConfirm').value.trim() }) });
      msg('#rMsg', '已清除：' + r.cleared); $('#rConfirm').value = '';
    } catch (err) { msg('#rMsg', err.message, false); }
  });

  // ---------- 管理帳號 ----------
  async function loadAccounts() {
    const r = await api('/admin/accounts');
    const rows = [];
    if (r.builtin_admin) rows.push(`<tr><td>admin</td><td>系統管理員（初始備援）</td><td class="muted">環境變數</td><td></td></tr>`);
    for (const a of r.accounts) rows.push(`<tr><td>${esc(a.username)}${a.username === r.me ? ' <span class="muted small">（你）</span>' : ''}</td><td>${esc(a.display_name)}</td><td>${fmtTime(a.created_at)}</td><td style="white-space:nowrap">
      <button class="btn sm" type="button" data-acc-reset="${esc(a.username)}">重設密碼</button>
      ${a.username !== r.me ? `<button class="btn sm danger" type="button" data-acc-del="${esc(a.username)}">刪除</button>` : ''}</td></tr>`);
    $('#accTable').innerHTML = rows.join('') || '<tr><td colspan="4" class="muted">尚無帳號</td></tr>';
  }
  $('#accTable').addEventListener('click', async e => {
    const del = e.target.closest('[data-acc-del]'), rst = e.target.closest('[data-acc-reset]');
    try {
      if (del) {
        if (!confirm(`確定刪除帳號 ${del.dataset.accDel}？`)) return;
        await api('/admin/accounts', { method: 'DELETE', body: JSON.stringify({ username: del.dataset.accDel }) });
      } else if (rst) {
        const pw = prompt(`為 ${rst.dataset.accReset} 設定新密碼（至少 8 碼）：`);
        if (!pw) return;
        await api('/admin/accounts/password', { method: 'PUT', body: JSON.stringify({ username: rst.dataset.accReset, password: pw }) });
        alert('已更新密碼');
      } else return;
      loadAccounts();
    } catch (err) { alert(err.message); }
  });
  $('#accForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/admin/accounts', { method: 'POST', body: JSON.stringify({ username: $('#accUser').value.trim(), display_name: $('#accName').value.trim(), password: $('#accPw').value }) });
      msg('#accMsg', '已新增'); $('#accUser').value = ''; $('#accName').value = ''; $('#accPw').value = '';
      loadAccounts();
    } catch (err) { msg('#accMsg', err.message, false); }
  });
  $('#pwForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      await api('/admin/accounts/password', { method: 'PUT', body: JSON.stringify({ old_password: $('#pwOld').value, password: $('#pwNew').value }) });
      msg('#pwMsg', '密碼已更改'); $('#pwOld').value = ''; $('#pwNew').value = '';
    } catch (err) { msg('#pwMsg', err.message, false); }
  });

  if (localStorage.getItem(TOKEN_KEY)) enter().catch(logout);
})();
