// 簡易 CSV 解析與產生（支援引號、逗號、換行、UTF-8 BOM）

export function parseCSV(text) {
  if (!text) return [];
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ''));
}

// 把第一列當標題，回傳物件陣列；標題經 aliases 轉成統一欄位名
export function parseCSVObjects(text, aliases) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map(h => normalizeHeader(h, aliases));
  return rows.slice(1).map(r => {
    const o = {};
    header.forEach((h, i) => { if (h) o[h] = (r[i] ?? '').trim(); });
    return o;
  });
}

function normalizeHeader(h, aliases) {
  const key = h.trim().toLowerCase();
  for (const [canon, names] of Object.entries(aliases)) {
    if (canon === key || names.some(n => n.toLowerCase() === key)) return canon;
  }
  return key;
}

export function toCSV(rows, header) {
  const esc = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [];
  if (header) lines.push(header.map(esc).join(','));
  for (const r of rows) lines.push((Array.isArray(r) ? r : header.map(h => r[h])).map(esc).join(','));
  // 加 BOM 讓 Excel 直接以 UTF-8 開啟中文
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export const STUDENT_ALIASES = {
  student_id: ['學號', 'id', 'sid'],
  name:       ['姓名', '名字'],
  class_name: ['班級', 'class'],
  grade:      ['年級', 'year'],
  password:   ['密碼', 'password', 'pwd'],
  seat_no:    ['座號', 'seat'],
};

export const CLUB_ALIASES = {
  club_id:     ['社團代碼', '代碼', 'id', 'code'],
  name:        ['社團名稱', '名稱', '社團'],
  category:    ['類別', '分類', 'type'],
  capacity:    ['名額', '人數上限', '上限', 'cap'],
  grades:      ['限制年級', '開放年級', '年級'],
  teacher:     ['指導老師', '老師'],
  location:    ['地點', '上課地點', '教室'],
  description: ['簡介', '說明', 'desc'],
};

export const PREF_ALIASES = {
  student_id: ['學號', 'id'],
  prefs: ['志願序', '志願', 'preferences'],
};
