// 나무와 텐트 퍼즐 로직 (렌더링과 무관한 순수 함수 모음)
//
// 규칙
//  1. 나무마다 텐트를 정확히 하나씩, 나무와 상하좌우로 맞닿게 친다 (나무와 텐트는 1:1 짝).
//  2. 텐트끼리는 대각선을 포함해 서로 닿을 수 없다.
//  3. 각 행/열 바깥의 숫자는 그 줄에 있는 텐트의 수다.
//
// 퍼즐 형식
//  { n, difficulty, seed,
//    trees:    n×n (1 = 나무)
//    solution: n×n (1 = 텐트)
//    rows: [n], cols: [n]      줄마다 텐트 수
//    hints:    n×n (0 없음, 1 텐트, 2 빈 땅) — 처음부터 알려 주는 칸 }
//
// 플레이 상태 grid: 0 = 모름, 1 = 텐트, 2 = 빈 땅(텐트 없음 표시)

export const UNKNOWN = 0;
export const TENT = 1;
export const GRASS = 2;

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const AROUND = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

const inside = (n, r, c) => r >= 0 && c >= 0 && r < n && c < n;
const grid = (n, v = 0) => Array.from({ length: n }, () => new Array(n).fill(v));

// ---------------------------------------------------------------------------
// 난수

export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// 기본 판정

/** 나무와 상하좌우로 맞닿은 빈 칸 = 텐트를 칠 수 있는 칸 */
export function candidateCells(trees) {
  const n = trees.length;
  const out = grid(n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (trees[r][c]) continue;
      out[r][c] = ORTHO.some(([dr, dc]) => inside(n, r + dr, c + dc) && trees[r + dr][c + dc]) ? 1 : 0;
    }
  }
  return out;
}

/** 텐트 칸과 나무 칸을 1:1 로 짝지을 수 있는지 (이분 매칭) */
export function hasMatching(tents, trees) {
  const n = trees.length;
  const tentList = [];
  const treeIndex = new Map();
  let treeCount = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (tents[r][c]) tentList.push([r, c]);
      if (trees[r][c]) treeIndex.set(r * n + c, treeCount++);
    }
  }
  if (tentList.length !== treeCount) return false;
  const adj = tentList.map(([r, c]) => ORTHO
    .map(([dr, dc]) => [r + dr, c + dc])
    .filter(([rr, cc]) => inside(n, rr, cc) && trees[rr][cc])
    .map(([rr, cc]) => treeIndex.get(rr * n + cc)));
  const matchTree = new Array(treeCount).fill(-1);
  function augment(t, seen) {
    for (const tr of adj[t]) {
      if (seen[tr]) continue;
      seen[tr] = true;
      if (matchTree[tr] < 0 || augment(matchTree[tr], seen)) {
        matchTree[tr] = t;
        return true;
      }
    }
    return false;
  }
  for (let t = 0; t < tentList.length; t++) {
    if (!augment(t, new Array(treeCount).fill(false))) return false;
  }
  return true;
}

/** 완성된 텐트 배치가 규칙을 모두 지키는지 */
export function isValidSolution(tents, p) {
  const n = p.n;
  for (let r = 0; r < n; r++) {
    let rowCount = 0;
    for (let c = 0; c < n; c++) {
      if (!tents[r][c]) continue;
      if (p.trees[r][c]) return false;
      rowCount++;
      for (const [dr, dc] of AROUND) {
        if (inside(n, r + dr, c + dc) && tents[r + dr][c + dc]) return false;
      }
    }
    if (rowCount !== p.rows[r]) return false;
  }
  for (let c = 0; c < n; c++) {
    let colCount = 0;
    for (let r = 0; r < n; r++) if (tents[r][c]) colCount++;
    if (colCount !== p.cols[c]) return false;
  }
  return hasMatching(tents, p.trees);
}

// ---------------------------------------------------------------------------
// 풀이기 (해의 개수를 limit 까지 센다)
//
// 행마다 "그 줄 텐트 수를 만족하고, 옆으로 붙지 않는 텐트 배치"를 비트마스크로 미리 만든 뒤
// 위에서부터 한 줄씩 고른다. 위아래/대각선 접촉, 열 텐트 수, 나무마다 텐트가 붙을
// 자리가 남았는지를 확인하며 가지를 친다. 마지막에 나무-텐트 1:1 매칭을 확인한다.

export function countSolutions(p, limit = 2) {
  const { n, trees, rows, cols } = p;
  const hints = p.hints || grid(n);
  const cand = candidateCells(trees);
  let treeTotal = 0;
  for (const row of trees) for (const v of row) treeTotal += v;
  const tentTotal = rows.reduce((a, b) => a + b, 0);
  if (tentTotal !== treeTotal || cols.reduce((a, b) => a + b, 0) !== treeTotal) {
    return { count: 0, solutions: [] };
  }

  // 행별 후보/강제 비트
  const candMask = new Array(n).fill(0);
  const forced = new Array(n).fill(0);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const bit = 1 << c;
      if (hints[r][c] === TENT) {
        if (!cand[r][c]) return { count: 0, solutions: [] };
        forced[r] |= bit;
      }
      if (cand[r][c] && hints[r][c] !== GRASS) candMask[r] |= bit;
    }
  }

  // 행 패턴 생성
  const patterns = [];
  for (let r = 0; r < n; r++) {
    const list = [];
    const k = rows[r];
    (function rec(c, mask, used) {
      if (used === k) {
        if ((mask & forced[r]) === forced[r]) list.push(mask);
        return;
      }
      if (c >= n) return;
      // 남은 칸으로 k 개를 채울 수 없으면 중단
      if (used + Math.ceil((n - c) / 2) < k) return;
      if ((candMask[r] >> c) & 1) rec(c + 2, mask | (1 << c), used + 1);
      if (!((forced[r] >> c) & 1)) rec(c + 1, mask, used);
    })(0, 0, 0);
    if (!list.length) return { count: 0, solutions: [] };
    patterns.push(list);
  }

  // cap[r][c] = r 행부터 끝까지 c 열에 더 칠 수 있는 텐트의 최대 수 (세로로 붙지 않게)
  const cap = Array.from({ length: n + 1 }, () => new Int8Array(n));
  for (let c = 0; c < n; c++) {
    for (let r = n - 1; r >= 0; r--) {
      // 아래에서부터 탐욕적으로: r 에 칠 수 있으면 r+2 부터, 아니면 r+1 부터
      const take = (candMask[r] >> c) & 1 ? 1 + (r + 2 <= n ? cap[r + 2][c] : 0) : 0;
      cap[r][c] = Math.max(take, cap[r + 1][c]);
    }
  }

  const treeCols = trees.map((row) => row.map((v, c) => (v ? c : -1)).filter((c) => c >= 0));
  const colCount = new Int8Array(n);
  const chosen = new Array(n).fill(0);
  const solutions = [];
  let count = 0;

  /** r 행의 나무들이 모두 텐트 자리를 가졌는지 (r-1, r, r+1 행이 정해진 뒤에 호출) */
  function treesOk(r) {
    if (r < 0) return true;
    const up = r > 0 ? chosen[r - 1] : 0;
    const mid = chosen[r];
    const down = r + 1 < n ? chosen[r + 1] : 0;
    for (const c of treeCols[r]) {
      const bit = 1 << c;
      if (!((up | down) & bit) && !(mid & ((bit << 1) | (bit >> 1)))) return false;
    }
    return true;
  }

  function rec(r) {
    if (r === n) {
      if (!treesOk(n - 1)) return false;
      const tents = chosen.map((m) => Array.from({ length: n }, (_, c) => (m >> c) & 1));
      if (!hasMatching(tents, trees)) return false;
      count++;
      solutions.push(tents);
      return count >= limit;
    }
    const prev = r > 0 ? chosen[r - 1] : 0;
    const block = prev | (prev << 1) | (prev >> 1);
    for (const m of patterns[r]) {
      if (m & block) continue;
      let ok = true;
      for (let c = 0; c < n; c++) {
        const has = (m >> c) & 1;
        const cnt = colCount[c] + has;
        if (cnt > cols[c]) { ok = false; break; }
        // 이 행에 텐트가 있으면 다음 행은 같은 열에 칠 수 없다
        const rest = has ? (r + 2 <= n ? cap[r + 2][c] : 0) : cap[r + 1][c];
        if (cnt + rest < cols[c]) { ok = false; break; }
      }
      if (!ok) continue;
      chosen[r] = m;
      if (!treesOk(r - 1)) continue;
      for (let c = 0; c < n; c++) colCount[c] += (m >> c) & 1;
      const stop = rec(r + 1);
      for (let c = 0; c < n; c++) colCount[c] -= (m >> c) & 1;
      if (stop) return true;
    }
    chosen[r] = 0;
    return false;
  }

  rec(0);
  return { count, solutions };
}

// ---------------------------------------------------------------------------
// 퍼즐 생성

export const DIFFICULTIES = {
  easy: { label: '쉬움', density: 0.17, hintFreeTries: 4, extraGrass: 0.35, markFarGrass: true },
  normal: { label: '보통', density: 0.19, hintFreeTries: 25, extraGrass: 0, markFarGrass: false },
  hard: { label: '어려움', density: 0.21, hintFreeTries: 120, extraGrass: 0, markFarGrass: false },
};

export const SIZES = [6, 8, 10, 12];

/** 서로 닿지 않는 텐트를 흩뿌리고, 텐트마다 옆에 나무를 하나씩 심는다 */
function layout(n, density, rng) {
  const trees = grid(n);
  const tents = grid(n);
  const target = Math.max(2, Math.round(n * n * density));
  let placed = 0;
  const order = shuffle([...Array(n * n).keys()], rng);
  for (const idx of order) {
    if (placed >= target) break;
    const r = Math.floor(idx / n);
    const c = idx % n;
    if (trees[r][c] || tents[r][c]) continue;
    if (AROUND.some(([dr, dc]) => inside(n, r + dr, c + dc) && tents[r + dr][c + dc])) continue;
    const free = ORTHO
      .map(([dr, dc]) => [r + dr, c + dc])
      .filter(([rr, cc]) => inside(n, rr, cc) && !trees[rr][cc] && !tents[rr][cc]);
    if (!free.length) continue;
    const [tr, tc] = free[Math.floor(rng() * free.length)];
    trees[tr][tc] = 1;
    tents[r][c] = 1;
    placed++;
  }
  return { trees, tents };
}

function lineCounts(tents) {
  const n = tents.length;
  const rows = tents.map((row) => row.reduce((a, b) => a + b, 0));
  const cols = Array.from({ length: n }, (_, c) => tents.reduce((a, row) => a + row[c], 0));
  return { rows, cols };
}

/**
 * 해가 하나뿐인 퍼즐을 만든다.
 * @param {number} n 크기
 * @param {'easy'|'normal'|'hard'} difficulty
 * @param {number} seed
 */
export function generatePuzzle(n, difficulty = 'normal', seed = Date.now()) {
  const rng = makeRng(seed);
  const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  let p = null;
  for (let attempt = 0; ; attempt++) {
    const { trees, tents } = layout(n, cfg.density, rng);
    const { rows, cols } = lineCounts(tents);
    p = { n, difficulty, seed, trees, solution: tents, rows, cols, hints: grid(n) };
    let res = countSolutions(p, 2);
    if (res.count === 1) break;
    if (attempt + 1 < cfg.hintFreeTries) continue;
    // 힌트 없이 유일한 배치를 못 찾았으면, 다른 해와 갈리는 칸을 하나씩 알려 준다
    while (res.count > 1) {
      const other = res.solutions.find((s) => s.some((row, r) => row.some((v, c) => v !== tents[r][c])));
      const diff = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (other[r][c] !== tents[r][c]) diff.push([r, c]);
      // 빈 땅 힌트를 우선한다 (텐트를 알려 주는 것보다 덜 결정적)
      const grassy = diff.filter(([r, c]) => !tents[r][c]);
      const pool = grassy.length ? grassy : diff;
      const [r, c] = pool[Math.floor(rng() * pool.length)];
      p.hints[r][c] = tents[r][c] ? TENT : GRASS;
      res = countSolutions(p, 2);
    }
    break;
  }

  if (cfg.markFarGrass || cfg.extraGrass) {
    const cand = candidateCells(p.trees);
    const extra = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (p.trees[r][c] || p.hints[r][c] || p.solution[r][c]) continue;
        // 나무와 닿지 않는 칸은 텐트를 칠 수 없는 칸 → 쉬움에서는 미리 표시
        if (!cand[r][c]) {
          if (cfg.markFarGrass) p.hints[r][c] = GRASS;
        } else {
          extra.push([r, c]);
        }
      }
    }
    shuffle(extra, rng);
    const k = Math.round(extra.length * cfg.extraGrass);
    for (let i = 0; i < k; i++) p.hints[extra[i][0]][extra[i][1]] = GRASS;
  }
  return p;
}

// ---------------------------------------------------------------------------
// 플레이 중 판정

/** 다른 텐트와 (대각선 포함) 닿아 있는 텐트 → Set("r,c") */
export function touchingTents(state) {
  const n = state.length;
  const out = new Set();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (state[r][c] !== TENT) continue;
      for (const [dr, dc] of AROUND) {
        if (inside(n, r + dr, c + dc) && state[r + dr][c + dc] === TENT) out.add(`${r},${c}`);
      }
    }
  }
  return out;
}

/** 옆에 나무가 하나도 없는 텐트 → Set("r,c") */
export function lonelyTents(state, trees) {
  const n = state.length;
  const out = new Set();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (state[r][c] !== TENT) continue;
      if (!ORTHO.some(([dr, dc]) => inside(n, r + dr, c + dc) && trees[r + dr][c + dc])) out.add(`${r},${c}`);
    }
  }
  return out;
}

/** 주변이 모두 막혀 텐트를 둘 곳이 없는 나무 → Set("r,c") */
export function starvedTrees(state, trees) {
  const n = state.length;
  const out = new Set();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!trees[r][c]) continue;
      const open = ORTHO.some(([dr, dc]) => {
        const rr = r + dr;
        const cc = c + dc;
        return inside(n, rr, cc) && !trees[rr][cc] && state[rr][cc] !== GRASS;
      });
      if (!open) out.add(`${r},${c}`);
    }
  }
  return out;
}

/**
 * 줄 하나의 텐트 수 상태
 *  'ok'    : 텐트 수가 딱 맞음
 *  'error' : 넘쳤거나, 남은 칸을 다 텐트로 채워도 모자람
 *  'open'  : 아직 진행 중
 */
export function lineStatus(state, p, kind, i) {
  const n = p.n;
  const want = kind === 'row' ? p.rows[i] : p.cols[i];
  let tents = 0;
  let open = 0;
  for (let k = 0; k < n; k++) {
    const r = kind === 'row' ? i : k;
    const c = kind === 'row' ? k : i;
    if (p.trees[r][c]) continue;
    if (state[r][c] === TENT) tents++;
    else if (state[r][c] === UNKNOWN) open++;
  }
  if (tents > want || tents + open < want) return 'error';
  if (tents === want) return 'ok';
  return 'open';
}

export function lineCells(n, kind, i) {
  return Array.from({ length: n }, (_, k) => (kind === 'row' ? [i, k] : [k, i]));
}

/** 퍼즐을 다 풀었는지 (텐트만 보고 판단; 빈 땅 표시는 선택 사항) */
export function isSolved(state, p) {
  const tents = state.map((row) => row.map((v) => (v === TENT ? 1 : 0)));
  return isValidSolution(tents, p);
}

/** 텐트가 바라볼 나무 방향 (짝지어진 나무가 있으면 그쪽) */
export function facingTree(r, c, trees) {
  const n = trees.length;
  for (const [dr, dc] of ORTHO) {
    if (inside(n, r + dr, c + dc) && trees[r + dr][c + dc]) return [dr, dc];
  }
  return [1, 0];
}
