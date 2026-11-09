// 스카이스크래퍼 퍼즐 로직 (렌더링과 무관한 순수 함수 모음)
//
// 규칙
//  - N×N 격자의 각 칸에 높이 1..N 인 빌딩을 하나씩 세운다.
//  - 각 행과 각 열에는 같은 높이의 빌딩이 두 번 나올 수 없다.
//  - 바깥쪽 숫자(단서)는 그 방향에서 바라봤을 때 보이는 빌딩의 수다.
//    더 높은 빌딩이 앞에 있으면 뒤쪽의 낮은 빌딩은 가려진다.
//
// 단서 배열 형식: { top: [], bottom: [], left: [], right: [] }  (0 = 단서 없음)
//  - top[c]    : c열을 위쪽(0행)에서 바라봄
//  - bottom[c] : c열을 아래쪽(N-1행)에서 바라봄
//  - left[r]   : r행을 왼쪽(0열)에서 바라봄
//  - right[r]  : r행을 오른쪽(N-1열)에서 바라봄

export const SIDES = ['top', 'bottom', 'left', 'right'];

/** 앞에서부터 바라봤을 때 보이는 빌딩 수 (0 은 빈 칸으로 보고 무시) */
export function visibleCount(line) {
  let max = 0;
  let count = 0;
  for (const h of line) {
    if (h > max) {
      max = h;
      count++;
    }
  }
  return count;
}

/** 단서 하나가 가리키는 칸 좌표 목록을 바라보는 순서대로 반환 */
export function lineCells(n, side, index) {
  const cells = [];
  for (let k = 0; k < n; k++) {
    switch (side) {
      case 'top': cells.push([k, index]); break;
      case 'bottom': cells.push([n - 1 - k, index]); break;
      case 'left': cells.push([index, k]); break;
      case 'right': cells.push([index, n - 1 - k]); break;
      default: throw new Error(`unknown side: ${side}`);
    }
  }
  return cells;
}

export function lineValues(grid, side, index) {
  return lineCells(grid.length, side, index).map(([r, c]) => grid[r][c]);
}

/** 완성된 격자에서 모든 단서를 계산 */
export function computeClues(grid) {
  const n = grid.length;
  const clues = {};
  for (const side of SIDES) {
    clues[side] = [];
    for (let i = 0; i < n; i++) clues[side].push(visibleCount(lineValues(grid, side, i)));
  }
  return clues;
}

// ---------------------------------------------------------------------------
// 난수

/** 시드 기반 난수 (mulberry32) — 같은 시드면 같은 퍼즐을 만든다 */
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
// 순열 캐시

const permCache = new Map();

/** 1..n 의 모든 순열 (n ≤ 7 정도까지 현실적) */
export function permutations(n) {
  if (permCache.has(n)) return permCache.get(n);
  const out = [];
  const cur = [];
  const used = new Array(n + 1).fill(false);
  (function rec() {
    if (cur.length === n) {
      out.push(Int8Array.from(cur));
      return;
    }
    for (let v = 1; v <= n; v++) {
      if (used[v]) continue;
      used[v] = true;
      cur.push(v);
      rec();
      cur.pop();
      used[v] = false;
    }
  })();
  permCache.set(n, out);
  return out;
}

// ---------------------------------------------------------------------------
// 무작위 라틴 방진

export function randomLatinSquare(n, rng = Math.random) {
  const perms = permutations(n);
  const grid = [];
  const colUsed = new Array(n).fill(0); // 비트마스크

  // 행 단위로 무작위 순열을 골라 쌓는다. 막히면 되돌아간다.
  function fillRow(r) {
    if (r === n) return true;
    // 매번 전체를 섞으면 느리므로 무작위 시작점에서 순회
    const start = Math.floor(rng() * perms.length);
    const step = 1 + 2 * Math.floor(rng() * 7); // 홀수 보폭으로 다양하게
    for (let k = 0; k < perms.length; k++) {
      const p = perms[(start + k * step) % perms.length];
      let ok = true;
      for (let c = 0; c < n; c++) {
        if (colUsed[c] & (1 << p[c])) { ok = false; break; }
      }
      if (!ok) continue;
      for (let c = 0; c < n; c++) colUsed[c] |= 1 << p[c];
      grid.push(Array.from(p));
      if (fillRow(r + 1)) return true;
      grid.pop();
      for (let c = 0; c < n; c++) colUsed[c] &= ~(1 << p[c]);
    }
    return false;
  }

  fillRow(0);
  // 순회 순서가 완전히 균일하지 않으므로 행/열/기호를 한 번 더 섞어 준다
  const rowOrder = shuffle([...Array(n).keys()], rng);
  const colOrder = shuffle([...Array(n).keys()], rng);
  const symbols = [0, ...shuffle([...Array(n)].map((_, i) => i + 1), rng)];
  return rowOrder.map((r) => colOrder.map((c) => symbols[grid[r][c]]));
}

// ---------------------------------------------------------------------------
// 풀이기 (해의 개수를 limit 까지 센다)
//
// 각 행/열마다 "가능한 순열 목록"을 들고, 칸별 후보(비트마스크)와 서로 걸러 내며
// 더 이상 줄어들지 않을 때까지 전파한다. 그래도 안 풀리면 순열이 가장 적은 줄을
// 골라 분기한다. 7×7 까지 충분히 빠르다.

function lineFilter(perms, n, front, back, given) {
  const out = [];
  for (const p of perms) {
    if (given) {
      let ok = true;
      for (let k = 0; k < n; k++) {
        if (given[k] && given[k] !== p[k]) { ok = false; break; }
      }
      if (!ok) continue;
    }
    if (front && visibleCountTyped(p, false) !== front) continue;
    if (back && visibleCountTyped(p, true) !== back) continue;
    out.push(p);
  }
  return out;
}

/**
 * @param {number} n
 * @param {{top:number[],bottom:number[],left:number[],right:number[]}} clues 0 = 없음
 * @param {number[][]|null} givens 0 = 빈 칸
 * @param {number} limit 이 개수에 도달하면 중단
 * @returns {{count:number, solution:number[][]|null, solutions:number[][][]}}
 */
export function countSolutions(n, clues, givens, limit = 2) {
  const perms = permutations(n);
  // lines[0..n-1] = 행, lines[n..2n-1] = 열
  const lines = [];
  for (let r = 0; r < n; r++) {
    lines.push(lineFilter(perms, n, clues.left[r], clues.right[r], givens ? givens[r] : null));
  }
  for (let c = 0; c < n; c++) {
    const g = givens ? givens.map((row) => row[c]) : null;
    lines.push(lineFilter(perms, n, clues.top[c], clues.bottom[c], g));
  }
  const full = (1 << (n + 1)) - 2;
  const cand = new Int32Array(n * n).fill(full);

  let count = 0;
  const solutions = [];

  // 전파: 실패하면 false
  function propagate(ls, cd) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let li = 0; li < 2 * n; li++) {
        const isRow = li < n;
        const idx = isRow ? li : li - n;
        const list = ls[li];
        // 이 줄의 칸 후보
        const masks = new Int32Array(n);
        for (let k = 0; k < n; k++) masks[k] = cd[isRow ? idx * n + k : k * n + idx];
        let kept = list;
        let filtered = false;
        const next = [];
        for (const p of list) {
          let ok = true;
          for (let k = 0; k < n; k++) {
            if (!(masks[k] & (1 << p[k]))) { ok = false; break; }
          }
          if (ok) next.push(p);
          else filtered = true;
        }
        if (filtered) { kept = next; ls[li] = kept; }
        if (kept.length === 0) return false;
        // 남은 순열들의 합집합으로 칸 후보를 좁힌다
        const union = new Int32Array(n);
        for (const p of kept) for (let k = 0; k < n; k++) union[k] |= 1 << p[k];
        for (let k = 0; k < n; k++) {
          const ci = isRow ? idx * n + k : k * n + idx;
          const m = cd[ci] & union[k];
          if (m === 0) return false;
          if (m !== cd[ci]) { cd[ci] = m; changed = true; }
        }
      }
    }
    return true;
  }

  function rec(ls, cd) {
    if (!propagate(ls, cd)) return false;
    let best = -1;
    for (let li = 0; li < 2 * n; li++) {
      const len = ls[li].length;
      if (len > 1 && (best < 0 || len < ls[best].length)) best = li;
    }
    if (best < 0) {
      // 모든 줄이 확정 → 행 순열이 곧 해
      count++;
      solutions.push(ls.slice(0, n).map((l) => Array.from(l[0])));
      return count >= limit;
    }
    for (const p of ls[best]) {
      const ls2 = ls.slice();
      ls2[best] = [p];
      const cd2 = cd.slice();
      if (rec(ls2, cd2)) return true;
    }
    return false;
  }

  if (lines.some((l) => l.length === 0)) return { count: 0, solution: null, solutions };
  rec(lines, cand);
  return { count, solution: solutions[0] || null, solutions };
}

function visibleCountTyped(p, reverse) {
  let max = 0;
  let count = 0;
  const n = p.length;
  for (let k = 0; k < n; k++) {
    const h = reverse ? p[n - 1 - k] : p[k];
    if (h > max) { max = h; count++; }
  }
  return count;
}

// ---------------------------------------------------------------------------
// 퍼즐 생성

export const DIFFICULTIES = {
  easy: { label: '쉬움', removeRatio: 0.3, extraGivens: 0.2 },
  normal: { label: '보통', removeRatio: 0.6, extraGivens: 0 },
  hard: { label: '어려움', removeRatio: 1, extraGivens: 0 },
};

/**
 * 해가 유일한 퍼즐을 만든다.
 * @param {number} n 크기 (4~7)
 * @param {'easy'|'normal'|'hard'} difficulty
 * @param {number} seed
 */
export function generatePuzzle(n, difficulty = 'normal', seed = Date.now()) {
  const rng = makeRng(seed);
  const cfg = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  const solution = randomLatinSquare(n, rng);
  const full = computeClues(solution);
  const clues = {};
  for (const s of SIDES) clues[s] = full[s].slice();
  const givens = solution.map((row) => row.map(() => 0));

  const unique = () => countSolutions(n, clues, givens, 2).count === 1;

  // 1) 단서를 모두 줘도 해가 여러 개라면, 다른 해와 갈리는 칸을 하나씩 채워 준다
  const cellOrder = shuffle(
    [...Array(n * n).keys()].map((i) => [Math.floor(i / n), i % n]),
    rng,
  );
  const added = [];
  for (;;) {
    const res = countSolutions(n, clues, givens, 2);
    if (res.count <= 1) break;
    const other = res.solutions.find((g) => g.some((row, r) => row.some((v, c) => v !== solution[r][c])));
    const diff = cellOrder.filter(([r, c]) => other[r][c] !== solution[r][c]);
    const [r, c] = diff[Math.floor(rng() * diff.length)];
    givens[r][c] = solution[r][c];
    added.push([r, c]);
  }

  // 2) 유일해를 유지하는 한도 안에서 단서를 지운다
  const clueOrder = shuffle(
    SIDES.flatMap((s) => [...Array(n).keys()].map((i) => [s, i])),
    rng,
  );
  const maxRemove = Math.round(clueOrder.length * cfg.removeRatio);
  let removed = 0;
  for (const [s, i] of clueOrder) {
    if (removed >= maxRemove) break;
    const keep = clues[s][i];
    clues[s][i] = 0;
    if (unique()) removed++;
    else clues[s][i] = keep;
  }

  // 3) 어려움: 처음에 채워 준 칸도 지울 수 있으면 지운다
  if (difficulty === 'hard') {
    for (const [r, c] of added) {
      givens[r][c] = 0;
      if (!unique()) givens[r][c] = solution[r][c];
    }
  }

  // 4) 쉬움: 힌트 칸을 조금 더 준다
  const extra = Math.round(n * n * cfg.extraGivens);
  for (let k = 0, added = 0; k < cellOrder.length && added < extra; k++) {
    const [r, c] = cellOrder[k];
    if (!givens[r][c]) {
      givens[r][c] = solution[r][c];
      added++;
    }
  }

  return { n, difficulty, seed, solution, clues, givens };
}

// ---------------------------------------------------------------------------
// 판정 (플레이 중)

/** 같은 행/열에 중복된 칸 목록 → Set("r,c") */
export function findConflicts(grid) {
  const n = grid.length;
  const bad = new Set();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = grid[r][c];
      if (!v) continue;
      for (let k = 0; k < n; k++) {
        if (k !== c && grid[r][k] === v) bad.add(`${r},${c}`);
        if (k !== r && grid[k][c] === v) bad.add(`${r},${c}`);
      }
    }
  }
  return bad;
}

/**
 * 단서 하나의 상태
 *  - 'none'  : 단서 없음
 *  - 'open'  : 아직 판단 불가
 *  - 'ok'    : 줄이 모두 찼고 단서와 일치
 *  - 'error' : 단서와 어긋남 (가득 찼는데 다름, 또는 이미 초과)
 */
export function clueStatus(grid, clues, side, index) {
  const want = clues[side][index];
  if (!want) return 'none';
  const n = grid.length;
  const line = lineValues(grid, side, index);
  const full = line.every((v) => v);
  if (full) return visibleCount(line) === want ? 'ok' : 'error';
  // 앞쪽부터 연속으로 채워진 구간만으로도 이미 초과했는지 확인
  let max = 0;
  let vis = 0;
  for (const h of line) {
    if (!h) break;
    if (h > max) { max = h; vis++; }
    if (max === n) break;
  }
  if (vis > want) return 'error';
  if (max === n && line.slice(0, line.indexOf(n) + 1).every((v) => v) && vis !== want) return 'error';
  return 'open';
}

/** 모든 칸이 채워졌고 규칙을 모두 지키는지 */
export function isSolved(grid, clues) {
  const n = grid.length;
  for (const row of grid) for (const v of row) if (!v) return false;
  if (findConflicts(grid).size) return false;
  for (const s of SIDES) {
    for (let i = 0; i < n; i++) {
      if (clues[s][i] && visibleCount(lineValues(grid, s, i)) !== clues[s][i]) return false;
    }
  }
  return true;
}
