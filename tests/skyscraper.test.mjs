import test from 'node:test';
import assert from 'node:assert/strict';
import {
  visibleCount, computeClues, randomLatinSquare, countSolutions, generatePuzzle,
  isSolved, findConflicts, clueStatus, makeRng, SIDES,
} from '../games/skyscraper/puzzle.js';

test('visibleCount', () => {
  assert.equal(visibleCount([1, 2, 3, 4]), 4);
  assert.equal(visibleCount([4, 3, 2, 1]), 1);
  assert.equal(visibleCount([2, 1, 4, 3]), 2);
  assert.equal(visibleCount([0, 2, 0, 4]), 2);
});

test('randomLatinSquare is a Latin square', () => {
  for (const n of [4, 5, 6, 7]) {
    const g = randomLatinSquare(n, makeRng(n * 31));
    for (let i = 0; i < n; i++) {
      assert.equal(new Set(g[i]).size, n);
      assert.equal(new Set(g.map((row) => row[i])).size, n);
    }
  }
});

test('solver finds the known solution with full clues', () => {
  const g = randomLatinSquare(5, makeRng(7));
  const clues = computeClues(g);
  const { count, solution } = countSolutions(5, clues, null, 10);
  assert.ok(count >= 1);
  assert.ok(isSolved(solution, clues));
});

for (const n of [4, 5, 6, 7]) {
  for (const d of ['easy', 'normal', 'hard']) {
    test(`generatePuzzle ${n}x${n} ${d} is unique and consistent`, () => {
      for (let s = 1; s <= 3; s++) {
        const p = generatePuzzle(n, d, s * 1000 + n);
        const { count, solution } = countSolutions(n, p.clues, p.givens, 2);
        assert.equal(count, 1);
        assert.deepEqual(solution, p.solution);
        assert.ok(isSolved(p.solution, p.clues));
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
          if (p.givens[r][c]) assert.equal(p.givens[r][c], p.solution[r][c]);
        }
      }
    });
  }
}

test('generatePuzzle is deterministic per seed', () => {
  assert.deepEqual(generatePuzzle(5, 'normal', 42), generatePuzzle(5, 'normal', 42));
});

test('conflicts and clue status', () => {
  const grid = [[1, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  assert.deepEqual([...findConflicts(grid)].sort(), ['0,0', '0,1']);
  const clues = { top: [0, 0, 0, 0], bottom: [0, 0, 0, 0], left: [1, 0, 0, 0], right: [0, 0, 0, 0] };
  assert.equal(clueStatus([[3, 4, 0, 0], ...grid.slice(1)], clues, 'left', 0), 'error');
  assert.equal(clueStatus([[4, 0, 0, 0], ...grid.slice(1)], clues, 'left', 0), 'open');
  assert.equal(clueStatus([[4, 1, 2, 3], ...grid.slice(1)], clues, 'left', 0), 'ok');
  assert.equal(clueStatus(grid, clues, 'top', 0), 'none');
  assert.ok(SIDES.length === 4);
});
