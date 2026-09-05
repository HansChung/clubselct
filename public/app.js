(() => {
  const $ = s => document.querySelector(s);
  const TOKEN_KEY = 'club_token';
  const DRAFT_KEY = 'club_draft_';
  let state = null;        // /api/state
  let me = null;           // /api/me
  let prefs = [];          // 志願序 club_id[]
  let filter = { q: '', cat: '' };

  const api = async (path, opts = {}) => {
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.authorization = 'Bearer ' + token;
    const res = await fetch('/api' + path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && token && path !== '/login') { logout(); }
      throw new Error(data.error || '發生錯誤');
    }
    return data;
  };

  const fmtTime = iso => iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '';
  const clubById = id => state.clubs.find(c => c.club_id === id);
  const eligible = c => {
    if (!me) return true;
    const g = String(c.grades || '').trim();
    return !g || g.split(',').map(Number).includes(Number(me.student.grade));
  };

  // ---------- 初始化 ----------
  async function init() {
    state = await api('/state');
    if (state.school) { $('#title').textContent = state.school + ' 社團志願選填'; document.title = $('#title').textContent; }
    if (state.announce) { $('#announceLogin').textContent = state.announce; $('#announceLogin').classList.remove('hidden'); }
    if (localStorage.getItem(TOKEN_KEY)) {
      try { await loadMe(); } catch { logout(); }
    }
  }

  async function loadMe() {
    me = await api('/me');
    $('#whoName').textContent = `${me.student.class_name} ${me.student.name}（${me.student.student_id}）`;
    $('#who').classList.remove('hidden');
    $('#loginView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY + me.student.student_id) || 'null');
    prefs = (me.prefs.length ? me.prefs : (draft || [])).filter(id => clubById(id) && eligible(clubById(id)));
    renderAll();
  }

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    me = null; prefs = [];
    $('#who').classList.add('hidden');
    $('#appView').classList.add('hidden');
    $('#loginView').classList.remove('hidden');
  }

  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    $('#loginErr').textContent = '';
    try {
      const r = await api('/login', { method: 'POST', body: JSON.stringify({ student_id: $('#sid').value.trim(), password: $('#pw').value.trim() }) });
      localStorage.setItem(TOKEN_KEY, r.token);
      state = await api('/state');
      await loadMe();
    } catch (err) { $('#loginErr').textContent = err.message; }
  });
  $('#logoutBtn').addEventListener('click', logout);

  // ---------- 畫面 ----------
  function renderAll() { renderStatus(); renderChips(); renderClubs(); renderSlots(); }

  function renderStatus() {
    const b = $('#statusBanner');
    if (state.open) {
      b.className = 'banner ok';
      b.textContent = state.close_at ? `開放填寫中，截止時間：${fmtTime(state.close_at)}` : '開放填寫中';
    } else if (state.status === 'auto' && state.open_at && new Date() < new Date(state.open_at)) {
      b.className = 'banner warn'; b.textContent = `尚未開放，開放時間：${fmtTime(state.open_at)}`;
    } else {
      b.className = 'banner bad'; b.textContent = '目前不在開放填寫時間';
    }
    if (state.announce) { $('#announce').textContent = state.announce; $('#announce').classList.remove('hidden'); }

    if (me.receipt) {
      $('#submittedCard').classList.remove('hidden');
      $('#submittedMeta').textContent = '最後送出時間：' + fmtTime(me.updated_at);
      $('#submittedReceipt').textContent = me.receipt;
    } else $('#submittedCard').classList.add('hidden');

    if (me.result) {
      $('#resultCard').classList.remove('hidden');
      $('#resultBody').innerHTML = me.result.club_id
        ? `<div style="font-size:22px;font-weight:800;color:var(--brand)">${esc(me.result.club_name)}</div><div class="muted">錄取第 ${me.result.rank} 志願</div>`
        : `<div class="banner warn" style="margin:0">尚未分發到社團，請洽學務處。</div>`;
    } else $('#resultCard').classList.add('hidden');

    $('#submitBtn').disabled = !state.open;
  }

  function renderChips() {
    const cats = [...new Set(state.clubs.map(c => c.category).filter(Boolean))];
    const el = $('#chips');
    el.innerHTML = '';
    if (!cats.length) return;
    const mk = (label, val) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chip' + (filter.cat === val ? ' active' : ''); b.textContent = label;
      b.onclick = () => { filter.cat = val; renderChips(); renderClubs(); };
      return b;
    };
    el.appendChild(mk('全部', ''));
    cats.forEach(c => el.appendChild(mk(c, c)));
  }

  $('#search').addEventListener('input', e => { filter.q = e.target.value.trim().toLowerCase(); renderClubs(); });

  function renderClubs() {
    const list = $('#clubList');
    list.innerHTML = '';
    const rows = state.clubs.filter(c => {
      if (filter.cat && c.category !== filter.cat) return false;
      if (!filter.q) return true;
      return [c.name, c.teacher, c.category, c.description, c.club_id].join(' ').toLowerCase().includes(filter.q);
    });
    if (!rows.length) { list.innerHTML = '<p class="muted">沒有符合的社團</p>'; return; }
    for (const c of rows) {
      const idx = prefs.indexOf(c.club_id);
      const ok = eligible(c);
      const div = document.createElement('div');
      div.className = 'club';
      div.innerHTML = `
        <div class="info">
          <div class="name">${esc(c.name)}${c.category ? `<span class="tag">${esc(c.category)}</span>` : ''}</div>
          <div class="meta">名額 ${c.capacity}${c.teacher ? ' · ' + esc(c.teacher) : ''}${c.location ? ' · ' + esc(c.location) : ''}${c.grades ? ' · 限 ' + esc(c.grades) + ' 年級' : ''}</div>
          ${c.description ? `<div class="desc">${esc(c.description)}</div>` : ''}
          ${idx >= 0 ? `<div class="picked">已列為第 ${idx + 1} 志願</div>` : ''}
        </div>
        <div>${idx >= 0
          ? `<button class="btn sm" type="button" data-rm="${esc(c.club_id)}">移除</button>`
          : `<button class="btn sm primary" type="button" data-add="${esc(c.club_id)}" ${!ok || prefs.length >= state.max_prefs ? 'disabled' : ''}>${ok ? '加入' : '年級不符'}</button>`}</div>`;
      list.appendChild(div);
    }
  }

  $('#clubList').addEventListener('click', e => {
    const add = e.target.closest('[data-add]'), rm = e.target.closest('[data-rm]');
    if (add) { if (prefs.length < state.max_prefs) prefs.push(add.dataset.add); }
    else if (rm) prefs = prefs.filter(id => id !== rm.dataset.rm);
    else return;
    saveDraft(); renderClubs(); renderSlots();
  });

  function renderSlots() {
    const ul = $('#slots');
    ul.innerHTML = '';
    const eligibleCount = state.clubs.filter(eligible).length;
    const min = Math.min(state.min_prefs, eligibleCount);
    $('#prefHint').textContent = `請依喜好排序，至少 ${min} 個、最多 ${state.max_prefs} 個志願。`;
    $('#progressBar').style.width = Math.round(prefs.length / state.max_prefs * 100) + '%';
    $('#tabCount').textContent = prefs.length;
    for (let i = 0; i < state.max_prefs; i++) {
      const id = prefs[i];
      const li = document.createElement('li');
      li.className = 'slot';
      if (id) {
        const c = clubById(id);
        li.innerHTML = `<span class="num">${i + 1}</span><span class="label">${esc(c ? c.name : id)}</span>
          <span class="ops">
            <button class="btn icon" type="button" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上移">▲</button>
            <button class="btn icon" type="button" data-down="${i}" ${i === prefs.length - 1 ? 'disabled' : ''} aria-label="下移">▼</button>
            <button class="btn icon" type="button" data-del="${i}" aria-label="移除">✕</button>
          </span>`;
      } else {
        li.innerHTML = `<span class="num empty">${i + 1}</span><span class="label empty">${i < min ? '尚未選擇（必填）' : '尚未選擇'}</span>`;
      }
      ul.appendChild(li);
    }
    $('#submitBtn').disabled = !state.open || prefs.length < min;
  }

  $('#slots').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.up !== undefined) { const i = +b.dataset.up; [prefs[i - 1], prefs[i]] = [prefs[i], prefs[i - 1]]; }
    else if (b.dataset.down !== undefined) { const i = +b.dataset.down; [prefs[i + 1], prefs[i]] = [prefs[i], prefs[i + 1]]; }
    else if (b.dataset.del !== undefined) prefs.splice(+b.dataset.del, 1);
    saveDraft(); renderClubs(); renderSlots();
  });

  function saveDraft() { if (me) localStorage.setItem(DRAFT_KEY + me.student.student_id, JSON.stringify(prefs)); }

  $('#submitBtn').addEventListener('click', async () => {
    $('#submitErr').textContent = '';
    const btn = $('#submitBtn'); btn.disabled = true; btn.textContent = '送出中…';
    try {
      const r = await api('/prefs', { method: 'POST', body: JSON.stringify({ prefs }) });
      me.receipt = r.receipt; me.updated_at = r.updated_at; me.prefs = r.prefs;
      renderStatus();
      $('#modalReceipt').textContent = r.receipt;
      $('#modalList').innerHTML = r.prefs.map(id => `<li>${esc(clubById(id)?.name || id)}</li>`).join('');
      $('#modal').classList.remove('hidden');
    } catch (err) {
      $('#submitErr').textContent = err.message;
      if (/不在開放/.test(err.message)) { try { state = await api('/state'); renderStatus(); } catch {} }
    } finally { btn.textContent = '送出志願'; renderSlots(); }
  });
  $('#modalClose').addEventListener('click', () => $('#modal').classList.add('hidden'));

  // 手機分頁
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    const showPrefs = b.dataset.tab === 'prefs';
    $('#clubsPane').classList.toggle('mobile-hidden', showPrefs);
    $('#prefsPane').classList.toggle('mobile-hidden', !showPrefs);
  }));

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

  init().catch(err => { $('#loginErr').textContent = '無法連線：' + err.message; });
})();
