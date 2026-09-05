// 序列分發（serial dictatorship）
// 依抽籤順位逐一處理學生，分到志願序中第一個尚有名額且年級允許的社團。
// 同一個 seed 一定產生同一個結果，供事後驗證公平性。

export const MODES = {
  random:     '純隨機抽籤',
  grade_desc: '高年級優先，同年級內隨機',
  grade_asc:  '低年級優先，同年級內隨機',
};

// cyrb128 + sfc32：以字串產生可重現的亂數
function seedRng(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  let a = (h1 ^ h2 ^ h3 ^ h4) >>> 0, b = (h2 ^ h1) >>> 0, c = (h3 ^ h1) >>> 0, d = (h4 ^ h1) >>> 0;
  return function () {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function gradeAllowed(club, grade) {
  const g = String(club.grades ?? '').trim();
  if (!g) return true;
  const allowed = g.split(/[,，、\s]+/).filter(Boolean).map(Number);
  return allowed.includes(Number(grade));
}

/**
 * @param {object} p
 * @param {Array<{student_id,name,class_name,grade}>} p.students  全部學生
 * @param {Array<{club_id,name,capacity,grades}>} p.clubs
 * @param {Map<string,string[]>|Object} p.prefs  student_id -> club_id[]（依志願序）
 * @param {string} p.seed
 * @param {string} p.mode  random | grade_desc | grade_asc
 */
export function allocate({ students, clubs, prefs, seed, mode = 'random' }) {
  const prefMap = prefs instanceof Map ? prefs : new Map(Object.entries(prefs));
  const clubMap = new Map(clubs.map(c => [c.club_id, c]));
  const remaining = new Map(clubs.map(c => [c.club_id, Number(c.capacity) || 0]));
  const rng = seedRng(String(seed));

  // 先以學號排序確保輸入順序不影響結果，再洗牌
  const submitted = students
    .filter(s => prefMap.has(s.student_id))
    .sort((a, b) => a.student_id.localeCompare(b.student_id));
  let order = shuffle(submitted, rng);
  if (mode === 'grade_desc') order.sort((a, b) => Number(b.grade) - Number(a.grade));
  if (mode === 'grade_asc') order.sort((a, b) => Number(a.grade) - Number(b.grade));

  const results = [];
  const rankHist = {};
  let assigned = 0;
  order.forEach((s, idx) => {
    const list = prefMap.get(s.student_id) || [];
    let picked = null, rank = null;
    for (let i = 0; i < list.length; i++) {
      const club = clubMap.get(list[i]);
      if (!club) continue;
      if (!gradeAllowed(club, s.grade)) continue;
      if ((remaining.get(club.club_id) || 0) <= 0) continue;
      picked = club.club_id; rank = i + 1;
      remaining.set(club.club_id, remaining.get(club.club_id) - 1);
      break;
    }
    if (picked) { assigned++; rankHist[rank] = (rankHist[rank] || 0) + 1; }
    results.push({ student_id: s.student_id, club_id: picked, rank, lottery: idx + 1 });
  });

  const submittedIds = new Set(order.map(s => s.student_id));
  const notSubmitted = students.filter(s => !submittedIds.has(s.student_id));
  for (const s of notSubmitted) results.push({ student_id: s.student_id, club_id: null, rank: null, lottery: null });

  const clubFill = clubs.map(c => ({
    club_id: c.club_id, name: c.name,
    capacity: Number(c.capacity) || 0,
    filled: (Number(c.capacity) || 0) - (remaining.get(c.club_id) || 0),
  }));

  return {
    results,
    summary: {
      seed: String(seed), mode,
      total_students: students.length,
      submitted: order.length,
      assigned,
      unassigned: order.length - assigned,
      not_submitted: notSubmitted.length,
      rank_histogram: rankHist,
      club_fill: clubFill,
    },
  };
}
