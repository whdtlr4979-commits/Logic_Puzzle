import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePuzzle, countSolutions, isValidSolution, isSolved, touchingTents, lonelyTents,
  starvedTrees, lineStatus, hasMatching, candidateCells, TENT, GRASS, UNKNOWN, SIZES,
} from '../games/tents/puzzle.js';

// 손으로 만든 4×4 예제
//  . T . .      T = 나무, A = 텐트
//  . A . T
//  . . . A
//  A T . .
const small = {
  n: 4,
  trees: [[0, 1, 0, 0], [0, 0, 0, 1], [0, 0, 0, 0], [0, 1, 0, 0]],
  solution: [[0, 0, 0, 0], [0, 1, 0, 0], [0, 0, 0, 1], [1, 0, 0, 0]],
  rows: [0, 1, 1, 1],
  cols: [1, 1, 0, 1],
};

test('validator accepts a correct layout and rejects broken ones', () => {
  assert.ok(isValidSolution(small.solution, small));
  const touching = [[0, 0, 0, 0], [0, 1, 0, 0], [1, 0, 0, 1], [0, 0, 0, 0]];
  assert.ok(!isValidSolution(touching, { ...small, rows: [0, 1, 2, 0], cols: [1, 1, 0, 1] }));
  assert.ok(!hasMatching([[1, 0, 1, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], small.trees));
});

test('solver finds the hand-made solution', () => {
  const res = countSolutions(small, 5);
  assert.ok(res.count >= 1);
  assert.ok(res.solutions.some((s) => JSON.stringify(s) === JSON.stringify(small.solution)));
  for (const s of res.solutions) assert.ok(isValidSolution(s, small));
});

test('candidate cells are orthogonal neighbours of trees', () => {
  const cand = candidateCells(small.trees);
  assert.equal(cand[0][0], 1);
  assert.equal(cand[2][0], 0);
  assert.equal(cand[0][1], 0); // 나무 칸 자체는 후보가 아님
});

for (const n of SIZES) {
  for (const d of ['easy', 'normal', 'hard']) {
    test(`generatePuzzle ${n}x${n} ${d} is unique and consistent`, () => {
      for (let s = 1; s <= 3; s++) {
        const p = generatePuzzle(n, d, s * 101 + n);
        assert.ok(isValidSolution(p.solution, p), 'solution valid');
        const res = countSolutions(p, 2);
        assert.equal(res.count, 1);
        assert.deepEqual(res.solutions[0], p.solution);
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
          if (p.hints[r][c] === TENT) assert.equal(p.solution[r][c], 1);
          if (p.hints[r][c] === GRASS) assert.equal(p.solution[r][c], 0);
          if (p.hints[r][c]) assert.equal(p.trees[r][c], 0);
        }
      }
    });
  }
}

test('generatePuzzle is deterministic per seed', () => {
  assert.deepEqual(generatePuzzle(8, 'normal', 7), generatePuzzle(8, 'normal', 7));
});

test('play-time checks', () => {
  const st = [
    [UNKNOWN, 0, UNKNOWN, UNKNOWN],
    [TENT, TENT, UNKNOWN, 0],
    [GRASS, GRASS, GRASS, UNKNOWN],
    [UNKNOWN, 0, UNKNOWN, UNKNOWN],
  ];
  assert.deepEqual([...touchingTents(st)].sort(), ['1,0', '1,1']);
  assert.deepEqual([...lonelyTents(st, small.trees)], ['1,0']);
  assert.equal(lineStatus(st, small, 'row', 1), 'error'); // 텐트 2개 > 1
  assert.equal(lineStatus(st, small, 'row', 2), 'open');
  assert.equal(lineStatus(st, small, 'col', 2), 'ok');
  const blocked = [[GRASS, 0, GRASS, 0], [0, GRASS, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  assert.deepEqual([...starvedTrees(blocked, small.trees)], ['0,1']);
  const solved = small.solution.map((row) => row.map((v) => (v ? TENT : UNKNOWN)));
  assert.ok(isSolved(solved, small));
});
