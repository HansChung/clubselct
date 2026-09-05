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
    if (state.school) { $('#title').innerHTML = esc(state.school) + '<span>社團志願選填</span>'; document.title = state.school + ' 社團志願選填'; $('#loginSchool').textContent = state.school; }
    if (state.announce) { $('#announceLogin').textContent = state.announce; $('#announceLogin').classList.remove('hidden'); }
    if (localStorage.getItem(TOKEN_KEY)) {
      try { await loadMe(); } catch { logout(); }
    }
  }

  async function loadMe() {
    me = await api('/me');
    $('#whoName').textContent = `${me.student.class_name} ${me.student.name} · ${me.student.student_id}`;
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
      b.className = 'status ok';
      b.textContent = state.close_at ? `開放填寫中，${fmtTime(state.close_at)} 截止。` : '開放填寫中。';
    } else if (state.status === 'auto' && state.open_at && new Date() < new Date(state.open_at)) {
      b.className = 'status warn'; b.textContent = `尚未開放，${fmtTime(state.open_at)} 開放填寫。`;
    } else {
      b.className = 'status bad'; b.textContent = '目前不在開放填寫時間。';
    }
    if (state.announce) { $('#announce').textContent = state.announce; $('#announce').classList.remove('hidden'); }

    if (me.receipt) {
      $('#submittedCard').classList.remove('hidden');
      $('#submittedMeta').textContent = fmtTime(me.updated_at);
      $('#submittedReceipt').textContent = me.receipt;
    } else $('#submittedCard').classList.add('hidden');
    $('#submitBtn').textContent = me.receipt ? '重新送出志願' : '送出志願';

    if (me.result) {
      $('#resultCard').classList.remove('hidden');
      $('#resultBody').innerHTML = me.result.club_id
        ? `<div class="result-name">${esc(me.result.club_name)}</div><div class="muted">錄取第 ${me.result.rank} 志願</div>`
        : `<div class="banner warn" style="margin:0">尚未分發到社團，請洽學務處。</div>`;
    } else $('#resultCard').classList.add('hidden');
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
      const meta = [c.category, c.teacher, c.location, `名額 ${c.capacity}`, c.grades ? `限 ${c.grades} 年級` : ''].filter(Boolean).join(' · ');
      const div = document.createElement('div');
      div.className = 'club';
      div.innerHTML = `
        <div class="info">
          <div class="name">${esc(c.name)}</div>
          <div class="meta">${esc(meta)}</div>
          ${c.description ? `<div class="desc">${esc(c.description)}</div>` : ''}
        </div>
        <div>${idx >= 0
          ? `<button class="btn quiet" type="button" data-rm="${esc(c.club_id)}" title="移除">第 ${idx + 1} 志願 ${ICON.x}</button>`
          : ok
            ? `<button class="btn sm tint" type="button" data-add="${esc(c.club_id)}" ${prefs.length >= state.max_prefs ? 'disabled' : ''}>加入</button>`
            : `<span class="ineligible">年級不符</span>`}</div>`;
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
    $('#prefHint').textContent = `依喜好排序，至少 ${min} 個、最多 ${state.max_prefs} 個。`;
    $('#progressBar').style.width = Math.round(prefs.length / state.max_prefs * 100) + '%';
    $('#tabCount').textContent = prefs.length;
    $('#prefCount').textContent = prefs.length; $('#prefMax').textContent = state.max_prefs;
    $('#barCount').textContent = prefs.length; $('#barMax').textContent = state.max_prefs;
    $('#barHint').textContent = prefs.length < min ? `再選 ${min - prefs.length} 個即可送出`
      : me.receipt ? `已送出 · 確認碼 ${me.receipt}` : '已達最低數量，可以送出';
    for (let i = 0; i < state.max_prefs; i++) {
      const id = prefs[i];
      const li = document.createElement('li');
      li.className = 'slot';
      if (id) {
        const c = clubById(id);
        li.innerHTML = `<span class="num">${i + 1}</span><span class="label">${esc(c ? c.name : id)}</span>
          <span class="ops">
            <button class="btn icon" type="button" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上移">${ICON.up}</button>
            <button class="btn icon" type="button" data-down="${i}" ${i === prefs.length - 1 ? 'disabled' : ''} aria-label="下移">${ICON.down}</button>
            <button class="btn icon" type="button" data-del="${i}" aria-label="移除">${ICON.x}</button>
          </span>`;
      } else {
        li.innerHTML = `<span class="num empty">${i + 1}</span><span class="label ${i < min ? 'required' : 'empty'}">${i < min ? '尚未選擇（必填）' : '尚未選擇'}</span>`;
      }
      ul.appendChild(li);
    }
    $('#submitBtn').disabled = !state.open || prefs.length < min;
    $('#barBtn').disabled = false;
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

  // 手機分頁與底部列
  function showTab(name) {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x.dataset.tab === name));
    const showPrefs = name === 'prefs';
    $('#clubsPane').classList.toggle('mobile-hidden', showPrefs);
    $('#prefsPane').classList.toggle('mobile-hidden', !showPrefs);
    $('#mobileBar').classList.toggle('hidden', showPrefs);
    window.scrollTo({ top: 0 });
  }
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#barBtn').addEventListener('click', () => showTab('prefs'));

  const ICON = {
    up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"></path></svg>',
    down: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>',
    x: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>',
  };

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

  init().catch(err => { $('#loginErr').textContent = '無法連線：' + err.message; });
})();
