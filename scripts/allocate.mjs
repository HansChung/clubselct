// 離線分發：不需要雲端，直接用匯出的 CSV 在本機跑分發並輸出結果
// 用法：node scripts/allocate.mjs <學生名單.csv> <社團.csv> <志願序原始資料.csv> <seed> [mode] [輸出.csv]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCSVObjects, toCSV, STUDENT_ALIASES, CLUB_ALIASES } from '../lib/csv.js';
import { allocate, MODES } from '../lib/allocate.js';

const [stuPath, clubPath, prefPath, seed, mode = 'random', outPath = 'results.csv'] = process.argv.slice(2);
if (!stuPath || !clubPath || !prefPath || !seed) {
  console.error('用法：node scripts/allocate.mjs 學生.csv 社團.csv 志願序.csv <seed> [random|grade_desc|grade_asc] [輸出.csv]');
  process.exit(1);
}
if (!MODES[mode]) { console.error('模式需為 ' + Object.keys(MODES).join('/')); process.exit(1); }

const students = parseCSVObjects(readFileSync(stuPath, 'utf8'), STUDENT_ALIASES).map(s => ({ ...s, grade: Number(s.grade) || 0 }));
const clubs = parseCSVObjects(readFileSync(clubPath, 'utf8'), CLUB_ALIASES).map(c => ({ ...c, capacity: Number(c.capacity) || 0 }));
const prefRows = parseCSVObjects(readFileSync(prefPath, 'utf8'), { student_id: ['學號'] });
const prefs = new Map();
for (const r of prefRows) {
  const list = Object.keys(r).filter(k => /^志願\d+$/.test(k)).sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2))).map(k => r[k]).filter(Boolean);
  if (r.student_id && list.length) prefs.set(r.student_id, list);
}

const { results, summary } = allocate({ students, clubs, prefs, seed, mode });
const stuMap = new Map(students.map(s => [s.student_id, s]));
const clubMap = new Map(clubs.map(c => [c.club_id, c]));
const header = ['學號', '姓名', '班級', '座號', '年級', '錄取社團代碼', '錄取社團', '錄取志願序', '抽籤順位', '備註'];
const rows = results.map(r => {
  const s = stuMap.get(r.student_id) || {};
  return [r.student_id, s.name, s.class_name, s.seat_no, s.grade, r.club_id || '', clubMap.get(r.club_id)?.name || '', r.rank ?? '', r.lottery ?? '', r.lottery == null ? '未填志願' : (r.club_id ? '' : '志願皆額滿')];
});
writeFileSync(outPath, toCSV(rows, header));
console.log(JSON.stringify({ ...summary, club_fill: undefined }, null, 2));
console.table(summary.club_fill.map(c => ({ 代碼: c.club_id, 社團: c.name, 名額: c.capacity, 錄取: c.filled })));
console.log('已輸出：' + outPath);
