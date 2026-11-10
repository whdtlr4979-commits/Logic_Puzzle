// 나무와 텐트 — 게임 진행 / UI
import {
  generatePuzzle, touchingTents, lonelyTents, starvedTrees, lineStatus, lineCells, isSolved,
  DIFFICULTIES, SIZES, UNKNOWN, TENT, GRASS,
} from './puzzle.js';
import { TentScene } from './scene.js';
import { $, storage, formatTime, bindSeg, toast, setupSettings } from '../common/ui.js';

const SAVE_KEY = 'logicpuzzle.tents.save.v1';
const BEST_KEY = 'logicpuzzle.tents.best.v1';
const PREF_KEY = 'logicpuzzle.tents.prefs.v1';
const MODES = ['cycle', 'tent', 'grass', 'erase'];
const MODE_NOTES = {
  cycle: '칸을 누를 때마다 빈칸 → 텐트 → 빈 땅 → 빈칸',
  tent: '칸을 누르면 텐트를 치거나 걷어요',
  grass: '텐트가 없는 칸을 빈 땅(✕)으로 표시해요',
  erase: '칸을 누르면 표시를 지워요',
};

const prefs = Object.assign({ size: 8, difficulty: 'normal', autoCheck: true, helpSeen: false, mode: 'cycle' }, storage.get(PREF_KEY, {}));
if (!SIZES.includes(prefs.size)) prefs.size = 8;
if (!MODES.includes(prefs.mode)) prefs.mode = 'cycle';
const savePrefs = () => storage.set(PREF_KEY, prefs);

const state = {
  puzzle: null,
  grid: [],
  history: [],
  selected: [0, 0],
  elapsed: 0,
  startedAt: 0,
  solved: false,
  round: 0, // 새 퍼즐/처음부터마다 늘어남 — 완성 연출 중에 판이 바뀌면 연출을 멈추는 데 쓴다
};

const camp = new TentScene($('stage'), {
  onCellClick: (r, c) => {
    select(r, c);
    applyAt(r, c, prefs.mode);
  },
  onClueClick: (kind, i) => fillLine(kind, i),
  onViewChange: (view) => setViewButtons(view),
});

// ---------------------------------------------------------------------------
// 게임 시작 / 저장

function initialGrid(p) {
  return p.hints.map((row) => row.map((h) => (h === TENT ? TENT : h === GRASS ? GRASS : UNKNOWN)));
}

function newGame(n = prefs.size, difficulty = prefs.difficulty) {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const puzzle = generatePuzzle(n, difficulty, seed);
  startPuzzle(puzzle, { grid: initialGrid(puzzle), elapsed: 0, solved: false });
}

function startPuzzle(puzzle, saved) {
  camp.stopCelebrate();
  state.puzzle = puzzle;
  state.grid = saved.grid;
  state.history = [];
  state.elapsed = saved.elapsed || 0;
  state.startedAt = performance.now();
  state.solved = !!saved.solved;
  state.round++;
  state.selected = firstOpenCell() || [0, 0];
  camp.build(puzzle);
  const n = puzzle.n;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) camp.setCell(r, c, state.grid[r][c], false);
  camp.setSelection(state.selected);
  $('info-badge').textContent = `${n}×${n} · ${DIFFICULTIES[puzzle.difficulty].label}`;
  $('tent-total').textContent = puzzle.rows.reduce((a, b) => a + b, 0);
  refresh(false);
  showBest();
  save();
}

function firstOpenCell() {
  const { grid, puzzle } = state;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) if (!puzzle.trees[r][c] && grid[r][c] === UNKNOWN) return [r, c];
  }
  return null;
}

function currentElapsed() {
  if (state.solved || document.hidden) return state.elapsed;
  return state.elapsed + (performance.now() - state.startedAt);
}

function save() {
  if (!state.puzzle) return;
  storage.set(SAVE_KEY, { puzzle: state.puzzle, grid: state.grid, elapsed: currentElapsed(), solved: state.solved });
}

function loadSaved() {
  const s = storage.get(SAVE_KEY, null);
  if (!s || !s.puzzle || !Array.isArray(s.grid) || s.grid.length !== s.puzzle.n) return false;
  startPuzzle(s.puzzle, s);
  return true;
}

// ---------------------------------------------------------------------------
// 조작

function snapshot() {
  state.history.push(state.grid.map((r) => r.slice()));
  if (state.history.length > 300) state.history.shift();
}

function select(r, c) {
  state.selected = [r, c];
  camp.setSelection(state.selected);
}

function moveSelection(dr, dc) {
  const n = state.puzzle.n;
  const [r, c] = state.selected;
  select((r + dr + n) % n, (c + dc + n) % n);
}

/** 한 칸에 동작 적용: cycle / tent / grass / erase */
function applyAt(r, c, action) {
  if (state.solved) return;
  const { puzzle, grid } = state;
  if (puzzle.trees[r][c]) return;
  if (puzzle.hints[r][c]) {
    toast('처음부터 알려 준 칸은 바꿀 수 없어요');
    return;
  }
  const cur = grid[r][c];
  let next = cur;
  if (action === 'cycle') next = cur === UNKNOWN ? TENT : cur === TENT ? GRASS : UNKNOWN;
  else if (action === 'tent') next = cur === TENT ? UNKNOWN : TENT;
  else if (action === 'grass') next = cur === GRASS ? UNKNOWN : GRASS;
  else if (action === 'erase') next = UNKNOWN;
  if (next === cur) return;
  snapshot();
  grid[r][c] = next;
  camp.setCell(r, c, next, true);
  refresh();
}

/** 텐트 수가 다 찬 줄의 남은 칸을 빈 땅으로 채운다 */
function fillLine(kind, i) {
  if (state.solved) return;
  const { puzzle, grid } = state;
  const want = kind === 'row' ? puzzle.rows[i] : puzzle.cols[i];
  const cells = lineCells(puzzle.n, kind, i).filter(([r, c]) => !puzzle.trees[r][c]);
  const tents = cells.filter(([r, c]) => grid[r][c] === TENT).length;
  const open = cells.filter(([r, c]) => grid[r][c] === UNKNOWN);
  const label = kind === 'row' ? `${i + 1}행` : `${i + 1}열`;
  if (!open.length) return;
  if (tents !== want) {
    toast(`${label}에 텐트 ${want}개를 먼저 다 세워 주세요 (지금 ${tents}개)`);
    return;
  }
  snapshot();
  for (const [r, c] of open) {
    grid[r][c] = GRASS;
    camp.setCell(r, c, GRASS, true);
  }
  refresh();
}

function undo() {
  const prev = state.history.pop();
  if (!prev || state.solved) return;
  const n = state.puzzle.n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (prev[r][c] !== state.grid[r][c]) camp.setCell(r, c, prev[r][c], true);
  }
  state.grid = prev;
  refresh();
}

function resetPuzzle() {
  if (!confirm('지금까지 친 텐트와 표시를 모두 지우고 처음부터 할까요?')) return;
  const p = state.puzzle;
  startPuzzle(p, { grid: initialGrid(p), elapsed: 0, solved: false });
}

function setMode(mode) {
  prefs.mode = mode;
  savePrefs();
  $('mode-note').textContent = MODE_NOTES[mode];
}

// ---------------------------------------------------------------------------
// 화면 갱신

function refresh(persist = true) {
  const { puzzle, grid } = state;
  const n = puzzle.n;
  const showErrors = prefs.autoCheck;
  const errors = new Set();
  if (showErrors) {
    for (const k of touchingTents(grid)) errors.add(k);
    for (const k of lonelyTents(grid, puzzle.trees)) errors.add(k);
    for (const k of starvedTrees(grid, puzzle.trees)) errors.add(k);
  }
  camp.setErrors(errors);
  const states = { row: [], col: [] };
  for (const kind of ['row', 'col']) {
    for (let i = 0; i < n; i++) {
      const st = lineStatus(grid, puzzle, kind, i);
      states[kind].push(!showErrors && st === 'error' ? 'open' : st);
    }
  }
  camp.setClueStates(states);
  const tents = grid.flat().filter((v) => v === TENT).length;
  const total = puzzle.rows.reduce((a, b) => a + b, 0);
  $('tent-count').textContent = tents;
  $('tent-count').closest('.progress').classList.toggle('full', tents === total);
  if (!state.solved && isSolved(grid, puzzle)) win();
  if (persist) save();
}

function tick() {
  if (state.puzzle) $('timer').textContent = formatTime(currentElapsed());
}
setInterval(tick, 500);

document.addEventListener('visibilitychange', () => {
  // 탭이 가려져 있는 동안은 시간을 멈춘다
  if (document.hidden) {
    state.elapsed += performance.now() - state.startedAt;
    save();
  } else {
    state.startedAt = performance.now();
  }
});
window.addEventListener('pagehide', save);

function bestKey() {
  return `${state.puzzle.n}-${state.puzzle.difficulty}`;
}

function showBest() {
  const best = storage.get(BEST_KEY, {})[bestKey()];
  $('best').textContent = best ? `이 설정의 최고 기록: ${formatTime(best)}` : '';
}

function win() {
  state.elapsed = currentElapsed();
  state.solved = true; // 이 순간부터 입력을 막고 시간을 멈춘다
  const all = storage.get(BEST_KEY, {});
  const key = bestKey();
  const prev = all[key];
  const isBest = !prev || state.elapsed < prev;
  if (isBest) {
    all[key] = state.elapsed;
    storage.set(BEST_KEY, all);
  }
  tick();
  showBest();
  $('win-time').textContent = formatTime(state.elapsed);
  $('win-best').textContent = isBest
    ? (prev ? `최고 기록 갱신! (이전 ${formatTime(prev)})` : '첫 완성 기록이에요!')
    : `최고 기록 ${formatTime(prev)}`;

  // 완성 연출: 마지막 텐트가 세워지는 걸 보여 준 뒤 → 남은 칸을 빈 땅으로 채우고 → 축하
  const round = state.round;
  const still = () => state.round === round;
  const { puzzle, grid } = state;
  const [sr, sc] = state.selected;
  const open = [];
  for (let r = 0; r < puzzle.n; r++) {
    for (let c = 0; c < puzzle.n; c++) if (!puzzle.trees[r][c] && grid[r][c] === UNKNOWN) open.push([r, c]);
  }
  // 마지막으로 놓은 칸에서 가까운 순서로 퍼져 나가게
  open.sort((a, b) => Math.hypot(a[0] - sr, a[1] - sc) - Math.hypot(b[0] - sr, b[1] - sc));
  const TENT_POP = 600;
  const STEP = Math.min(45, 900 / Math.max(1, open.length));
  setTimeout(() => {
    if (!still()) return;
    open.forEach(([r, c], i) => setTimeout(() => {
      if (!still()) return;
      grid[r][c] = GRASS;
      camp.setCell(r, c, GRASS, true);
    }, i * STEP));
    setTimeout(() => {
      if (!still()) return;
      save();
      camp.celebrate();
      setViewButtons('3d');
      setTimeout(() => { if (still()) $('win-modal').showModal(); }, 1500);
    }, open.length * STEP + 700);
  }, TENT_POP);
  save();
}

function check() {
  const { grid, puzzle } = state;
  let wrongTents = 0;
  let wrongMarks = 0;
  for (let r = 0; r < puzzle.n; r++) {
    for (let c = 0; c < puzzle.n; c++) {
      if (grid[r][c] === TENT && !puzzle.solution[r][c]) wrongTents++;
      if (grid[r][c] === GRASS && puzzle.solution[r][c]) wrongMarks++;
    }
  }
  const left = puzzle.rows.reduce((a, b) => a + b, 0) - grid.flat().filter((v) => v === TENT).length;
  if (wrongTents || wrongMarks) {
    const parts = [];
    if (wrongTents) parts.push(`잘못 친 텐트 ${wrongTents}개`);
    if (wrongMarks) parts.push(`텐트 자리에 빈 땅 표시 ${wrongMarks}개`);
    toast(`${parts.join(', ')}가 있어요`);
  } else if (left > 0) {
    toast(`지금까지는 모두 맞아요! (남은 텐트 ${left}개)`);
  } else {
    toast('완벽해요!');
  }
}

// ---------------------------------------------------------------------------
// 시점

function setViewButtons(view) {
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('active', b.dataset.view === view);
}

function setView(view) {
  camp.setView(view);
  setViewButtons(view);
}

// ---------------------------------------------------------------------------
// 이벤트 연결

bindSeg('size-seg', 'size', prefs.size, (v) => {
  prefs.size = Number(v);
  savePrefs();
});
bindSeg('diff-seg', 'diff', prefs.difficulty, (v) => {
  prefs.difficulty = v;
  savePrefs();
});
bindSeg('mode-seg', 'mode', prefs.mode, setMode);
setMode(prefs.mode);

$('new-btn').addEventListener('click', () => {
  const hints = state.puzzle.hints;
  const touched = !state.solved && state.grid.some((row, r) => row.some((v, c) => v && !hints[r][c]));
  if (touched && !confirm('진행 중인 퍼즐이 있어요. 새 퍼즐을 시작할까요?')) return;
  newGame();
});
$('reset-btn').addEventListener('click', resetPuzzle);
$('check-btn').addEventListener('click', check);
$('undo-btn').addEventListener('click', undo);
$('auto-check').checked = prefs.autoCheck;
$('auto-check').addEventListener('change', (e) => {
  prefs.autoCheck = e.target.checked;
  savePrefs();
  refresh(false);
});

for (const b of document.querySelectorAll('[data-view]')) {
  b.addEventListener('click', () => setView(b.dataset.view));
}
$('rot-left').addEventListener('click', () => { camp.rotate(-1); setViewButtons(camp.view); });
$('rot-right').addEventListener('click', () => { camp.rotate(1); setViewButtons(camp.view); });

$('help-btn').addEventListener('click', () => $('help-modal').showModal());
$('help-modal').addEventListener('close', () => {
  prefs.helpSeen = true;
  savePrefs();
});
$('win-modal').addEventListener('close', () => {
  if ($('win-modal').returnValue === 'new') newGame();
});

document.addEventListener('keydown', (e) => {
  if (!state.puzzle || document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, select, textarea')) return;
  const key = e.key;
  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const map = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (map[key]) {
    e.preventDefault();
    moveSelection(...map[key]);
    return;
  }
  const [r, c] = state.selected;
  const digit = /^Digit([0-9])$/.exec(e.code)?.[1] ?? (/^[0-9]$/.test(key) ? key : null);
  if (digit === '1') return applyAt(r, c, 'tent');
  if (digit === '2') return applyAt(r, c, 'grass');
  if (digit === '0') return applyAt(r, c, 'erase');
  switch (key.toLowerCase()) {
    case ' ':
    case 'enter':
      e.preventDefault();
      applyAt(r, c, 'cycle');
      break;
    case 'backspace':
    case 'delete':
      e.preventDefault();
      applyAt(r, c, 'erase');
      break;
    case 'u':
      undo();
      break;
    case 'q':
      $('rot-left').click();
      break;
    case 'e':
      $('rot-right').click();
      break;
    case 't':
      setView(camp.view === 'top' ? '3d' : 'top');
      break;
    default:
  }
});

// ---------------------------------------------------------------------------
// 시작

setupSettings(camp);
if (!loadSaved()) newGame();
if (!prefs.helpSeen) $('help-modal').showModal();
