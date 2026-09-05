import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, gradeAllowed } from '../lib/allocate.js';
import { parseCSV, parseCSVObjects, toCSV, STUDENT_ALIASES } from '../lib/csv.js';
import { signToken, verifyToken, hashPassword, randomPassword } from '../lib/auth.js';

const clubs = [
  { club_id: 'A', name: 'A社', capacity: 2, grades: '' },
  { club_id: 'B', name: 'B社', capacity: 1, grades: '' },
  { club_id: 'C', name: 'C社', capacity: 5, grades: '10,11' },
];
const students = [
  { student_id: 's1', name: '甲', class_name: '701', grade: 7 },
  { student_id: 's2', name: '乙', class_name: '701', grade: 7 },
  { student_id: 's3', name: '丙', class_name: '101', grade: 10 },
  { student_id: 's4', name: '丁', class_name: '101', grade: 10 },
  { student_id: 's5', name: '戊', class_name: '101', grade: 10 },
];

test('gradeAllowed', () => {
  assert.equal(gradeAllowed(clubs[2], 10), true);
  assert.equal(gradeAllowed(clubs[2], 7), false);
  assert.equal(gradeAllowed(clubs[0], 7), true);
});

test('同一 seed 結果可重現，且尊重名額與年級', () => {
  const prefs = new Map([
    ['s1', ['B', 'A', 'C']], ['s2', ['B', 'A']], ['s3', ['B', 'C']], ['s4', ['A', 'B', 'C']],
  ]);
  const r1 = allocate({ students, clubs, prefs, seed: 'x', mode: 'random' });
  const r2 = allocate({ students, clubs, prefs, seed: 'x', mode: 'random' });
  assert.deepEqual(r1.results, r2.results);
  const byId = Object.fromEntries(r1.results.map(r => [r.student_id, r]));
  // 名額不超額
  const count = {};
  for (const r of r1.results) if (r.club_id) count[r.club_id] = (count[r.club_id] || 0) + 1;
  assert.ok((count.A || 0) <= 2 && (count.B || 0) <= 1);
  // s1 是 7 年級，不能進 C
  assert.notEqual(byId.s1.club_id, 'C');
  // 未填志願者
  assert.equal(byId.s5.club_id, null);
  assert.equal(byId.s5.lottery, null);
  assert.equal(r1.summary.not_submitted, 1);
  assert.equal(r1.summary.submitted, 4);
  assert.equal(r1.summary.assigned + r1.summary.unassigned, 4);
});

test('grade_desc 模式高年級先抽', () => {
  const prefs = new Map([['s1', ['B']], ['s3', ['B']]]);
  const r = allocate({ students, clubs, prefs, seed: 'any', mode: 'grade_desc' });
  const byId = Object.fromEntries(r.results.map(x => [x.student_id, x]));
  assert.equal(byId.s3.club_id, 'B');
  assert.equal(byId.s1.club_id, null);
});

test('不同 seed 會產生不同順位（高機率）', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ student_id: 'k' + i, name: '', class_name: '', grade: 7 }));
  const prefs = new Map(many.map(s => [s.student_id, ['A']]));
  const a = allocate({ students: many, clubs, prefs, seed: '1' }).results.map(r => r.student_id).join();
  const b = allocate({ students: many, clubs, prefs, seed: '2' }).results.map(r => r.student_id).join();
  assert.notEqual(a, b);
});

test('CSV 解析：BOM、引號、中英標題', () => {
  const text = '﻿學號,姓名,班級,年級,座號,密碼\r\n1,"王,小明",701,7,1,\n2,李四,"702",7,2,abcd\n';
  const rows = parseCSVObjects(text, STUDENT_ALIASES);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].student_id, '1');
  assert.equal(rows[0].name, '王,小明');
  assert.equal(rows[1].password, 'abcd');
  assert.deepEqual(parseCSV('a,b\n"c""d",e')[1], ['c"d', 'e']);
  const out = toCSV([['x', 'y,z']], ['h1', 'h2']);
  assert.ok(out.startsWith('﻿h1,h2'));
  assert.ok(out.includes('"y,z"'));
});

test('token 簽發與驗證', async () => {
  const t = await signToken({ sub: 'u1', role: 'student' }, 'secret', 60);
  const p = await verifyToken(t, 'secret');
  assert.equal(p.sub, 'u1');
  assert.equal(await verifyToken(t, 'wrong'), null);
  assert.equal(await verifyToken(t + 'x', 'secret'), null);
  const expired = await signToken({ sub: 'u1' }, 'secret', -10);
  assert.equal(await verifyToken(expired, 'secret'), null);
});

test('密碼雜湊與產生', async () => {
  const pw = randomPassword();
  assert.equal(pw.length, 8);
  const h1 = await hashPassword('s', '1', pw), h2 = await hashPassword('s', '1', pw);
  assert.equal(h1, h2);
  assert.notEqual(h1, await hashPassword('s', '2', pw));
});
