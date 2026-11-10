// 스카이스크래퍼 — 게임 진행 / UI
import { generatePuzzle, findConflicts, clueStatus, isSolved, DIFFICULTIES, SIDES } from './puzzle.js';
import { CityScene, heightColorCss } from './scene.js';
import { $, storage, formatTime, bindSeg, toast, setupSettings } from '../common/ui.js';

const SAVE_KEY = 'logicpuzzle.skyscraper.save.v1';
const BEST_KEY = 'logicpuzzle.skyscraper.best.v1';
const PREF_KEY = 'logicpuzzle.skyscraper.prefs.v1';
const SIDE_NAMES = { top: '위', bottom: '아래', left: '왼쪽', right: '오른쪽' };

const prefs = Object.assign({ size: 5, difficulty: 'normal', autoCheck: true, helpSeen: false }, storage.get(PREF_KEY, {}));

const state = {
  puzzle: null,
  grid: [],
  notes: [], // 칸별 비트마스크
  history: [],
  selected: [0, 0],
  notesMode: false,
  elapsed: 0,
  startedAt: 0,
  solved: false,
  round: 0, // 새 퍼즐/처음부터마다 늘어남 — 완성 연출 중에 판이 바뀌면 연출을 멈추는 데 쓴다
};

const city = new CityScene($('stage'), {
  onCellClick: (r, c) => {
    if (city.view === 'clue') exitClueView();
    select(r, c);
  },
  onClueClick: (side, index) => enterClueView(side, index),
  // 드래그로 위에서 보기/단서 시점을 벗어났을 때
  onViewChange: (view) => {
    if (view !== 'clue') setClueBanner(null);
    setViewButtons(view);
  },
});

// ---------------------------------------------------------------------------
// 게임 시작 / 저장

function newGame(n = prefs.size, difficulty = prefs.difficulty) {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const puzzle = generatePuzzle(n, difficulty, seed);
  startPuzzle(puzzle, {
    grid: puzzle.givens.map((row) => row.slice()),
    notes: puzzle.givens.map((row) => row.map(() => 0)),
    elapsed: 0,
    solved: false,
  });
}

function startPuzzle(puzzle, saved) {
  city.stopCelebrate();
  state.puzzle = puzzle;
  state.grid = saved.grid;
  state.notes = saved.notes;
  state.history = [];
  state.elapsed = saved.elapsed || 0;
  state.startedAt = performance.now();
  state.solved = !!saved.solved;
  state.round++;
  state.selected = firstEmpty() || [0, 0];
  city.build(puzzle);
  const n = puzzle.n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!puzzle.givens[r][c]) {
        city.setCell(r, c, state.grid[r][c], false);
        city.setNotes(r, c, state.notes[r][c]);
      }
    }
  }
  city.setSelection(state.selected);
  buildPad();
  $('info-badge').textContent = `${n}×${n} · ${DIFFICULTIES[puzzle.difficulty].label}`;
  setClueBanner(null);
  refresh(false);
  showBest();
  save();
}

function firstEmpty() {
  const g = state.grid;
  for (let r = 0; r < g.length; r++) for (let c = 0; c < g.length; c++) if (!g[r][c]) return [r, c];
  return null;
}

function currentElapsed() {
  if (state.solved || document.hidden) return state.elapsed;
  return state.elapsed + (performance.now() - state.startedAt);
}

function save() {
  if (!state.puzzle) return;
  storage.set(SAVE_KEY, {
    puzzle: state.puzzle,
    grid: state.grid,
    notes: state.notes,
    elapsed: currentElapsed(),
    solved: state.solved,
  });
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
  state.history.push({
    grid: state.grid.map((r) => r.slice()),
    notes: state.notes.map((r) => r.slice()),
  });
  if (state.history.length > 200) state.history.shift();
}

function isGiven(r, c) {
  return !!state.puzzle.givens[r][c];
}

function select(r, c) {
  state.selected = [r, c];
  city.setSelection(state.selected);
}

function moveSelection(dr, dc) {
  const n = state.puzzle.n;
  const [r, c] = state.selected;
  select((r + dr + n) % n, (c + dc + n) % n);
}

function input(v, asNote = state.notesMode) {
  if (state.solved) return;
  const [r, c] = state.selected;
  if (isGiven(r, c)) {
    toast('처음부터 주어진 빌딩은 바꿀 수 없어요');
    return;
  }
  snapshot();
  if (asNote) {
    if (state.grid[r][c]) {
      state.history.pop();
      return;
    }
    state.notes[r][c] ^= 1 << v;
    city.setNotes(r, c, state.notes[r][c]);
  } else {
    const next = state.grid[r][c] === v ? 0 : v;
    setValue(r, c, next);
    if (next) clearNotesFor(r, c, next);
  }
  refresh();
}

function erase() {
  if (state.solved) return;
  const [r, c] = state.selected;
  if (isGiven(r, c)) return;
  if (!state.grid[r][c] && !state.notes[r][c]) return;
  snapshot();
  if (state.grid[r][c]) setValue(r, c, 0);
  else {
    state.notes[r][c] = 0;
    city.setNotes(r, c, 0);
  }
  refresh();
}

function setValue(r, c, v) {
  state.grid[r][c] = v;
  city.setCell(r, c, v, true);
}

/** 빌딩을 세우면 같은 행/열 메모에서 그 높이를 지운다 */
function clearNotesFor(r, c, v) {
  const n = state.puzzle.n;
  const bit = 1 << v;
  for (let k = 0; k < n; k++) {
    for (const [rr, cc] of [[r, k], [k, c]]) {
      if (state.notes[rr][cc] & bit) {
        state.notes[rr][cc] &= ~bit;
        city.setNotes(rr, cc, state.notes[rr][cc]);
      }
    }
  }
}

function undo() {
  const prev = state.history.pop();
  if (!prev || state.solved) return;
  const n = state.puzzle.n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (prev.grid[r][c] !== state.grid[r][c]) city.setCell(r, c, prev.grid[r][c], true);
      if (prev.notes[r][c] !== state.notes[r][c]) city.setNotes(r, c, prev.notes[r][c]);
    }
  }
  state.grid = prev.grid;
  state.notes = prev.notes;
  refresh();
}

function resetPuzzle() {
  if (!confirm('지금까지 세운 빌딩을 모두 지우고 처음부터 할까요?')) return;
  const p = state.puzzle;
  startPuzzle(p, {
    grid: p.givens.map((row) => row.slice()),
    notes: p.givens.map((row) => row.map(() => 0)),
    elapsed: 0,
    solved: false,
  });
}

function setNotesMode(on) {
  state.notesMode = on;
  $('notes-btn').setAttribute('aria-pressed', String(on));
  $('pad').classList.toggle('notes', on);
}

// ---------------------------------------------------------------------------
// 화면 갱신

function refresh(persist = true) {
  const { puzzle, grid } = state;
  const n = puzzle.n;
  const showErrors = prefs.autoCheck;
  city.setConflicts(showErrors ? findConflicts(grid) : new Set());
  const states = {};
  for (const s of SIDES) {
    states[s] = [];
    for (let i = 0; i < n; i++) {
      const st = clueStatus(grid, puzzle.clues, s, i);
      states[s].push(!showErrors && st === 'error' ? 'open' : st);
    }
  }
  city.setClueStates(states);
  updatePad();
  if (!state.solved && isSolved(grid, puzzle.clues)) win();
  if (persist) save();
}

function buildPad() {
  const n = state.puzzle.n;
  const pad = $('pad');
  pad.innerHTML = '';
  pad.style.setProperty('--cols', n);
  for (let v = 1; v <= n; v++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = v;
    b.style.setProperty('--h', v / n);
    b.style.setProperty('--col', heightColorCss(v, n));
    b.innerHTML = `<span>${v}</span>`;
    b.setAttribute('aria-label', `높이 ${v}`);
    b.addEventListener('click', () => input(v));
    pad.appendChild(b);
  }
}

function updatePad() {
  const n = state.puzzle.n;
  const counts = new Array(n + 1).fill(0);
  for (const row of state.grid) for (const v of row) counts[v]++;
  for (const b of $('pad').children) {
    b.classList.toggle('done', counts[+b.dataset.v] >= n);
  }
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

  // 완성 연출: 마지막 빌딩이 다 솟아오른 걸 보여 준 뒤 → 축하 → 엔딩 창
  const round = state.round;
  const still = () => state.round === round;
  const BUILDING_RISE = 900;
  setTimeout(() => {
    if (!still()) return;
    city.setSelection(null);
    setClueBanner(null);
    city.celebrate();
    setViewButtons('3d');
    setTimeout(() => { if (still()) $('win-modal').showModal(); }, 1500);
  }, BUILDING_RISE);
}

function check() {
  const { grid, puzzle } = state;
  const n = puzzle.n;
  let wrong = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] && grid[r][c] !== puzzle.solution[r][c]) wrong++;
    }
  }
  const empty = grid.flat().filter((v) => !v).length;
  if (wrong) toast(`정답과 다른 빌딩이 ${wrong}개 있어요`);
  else if (empty) toast(`지금까지는 모두 맞아요! (빈 칸 ${empty}개)`);
  else toast('완벽해요!');
}

// ---------------------------------------------------------------------------
// 시점

function setViewButtons(view) {
  for (const b of document.querySelectorAll('[data-view]')) b.classList.toggle('active', b.dataset.view === view);
}

function setView(view) {
  setClueBanner(null);
  city.setView(view);
  setViewButtons(view);
}

function enterClueView(side, index) {
  const value = state.puzzle.clues[side][index];
  city.viewFromClue(side, index);
  setViewButtons(null);
  const lineLabel = side === 'top' || side === 'bottom' ? `${index + 1}열` : `${index + 1}행`;
  setClueBanner(`${lineLabel}을 ${SIDE_NAMES[side]}에서 본 모습 — 빌딩 ${value}개가 보여야 해요`);
}

/** 단서 시점에서 돌아갈 때는 바라보던 방향을 유지한 채 위로 올라온다 */
function exitClueView() {
  setView('3d');
}

function setClueBanner(text) {
  const el = $('clue-banner');
  el.hidden = !text;
  if (text) $('clue-banner-text').textContent = text;
}

// ---------------------------------------------------------------------------
// 이벤트 연결

bindSeg('size-seg', 'size', prefs.size, (v) => {
  prefs.size = Number(v);
  storage.set(PREF_KEY, prefs);
});
bindSeg('diff-seg', 'diff', prefs.difficulty, (v) => {
  prefs.difficulty = v;
  storage.set(PREF_KEY, prefs);
});
$('new-btn').addEventListener('click', () => {
  const unfinished = !state.solved && state.grid.flat().some((v, i) => v && !state.puzzle.givens.flat()[i]);
  if (unfinished && !confirm('진행 중인 퍼즐이 있어요. 새 퍼즐을 시작할까요?')) return;
  newGame();
});
$('reset-btn').addEventListener('click', resetPuzzle);
$('check-btn').addEventListener('click', check);
$('notes-btn').addEventListener('click', () => setNotesMode(!state.notesMode));
$('erase-btn').addEventListener('click', erase);
$('undo-btn').addEventListener('click', undo);
$('auto-check').checked = prefs.autoCheck;
$('auto-check').addEventListener('change', (e) => {
  prefs.autoCheck = e.target.checked;
  storage.set(PREF_KEY, prefs);
  refresh(false);
});

for (const b of document.querySelectorAll('[data-view]')) {
  b.addEventListener('click', () => setView(b.dataset.view));
}
$('rot-left').addEventListener('click', () => { setClueBanner(null); city.rotate(-1); setViewButtons(city.view); });
$('rot-right').addEventListener('click', () => { setClueBanner(null); city.rotate(1); setViewButtons(city.view); });
$('clue-exit').addEventListener('click', exitClueView);

$('help-btn').addEventListener('click', () => $('help-modal').showModal());
$('help-modal').addEventListener('close', () => {
  prefs.helpSeen = true;
  storage.set(PREF_KEY, prefs);
});
$('win-modal').addEventListener('close', () => {
  if ($('win-modal').returnValue === 'new') newGame();
});

document.addEventListener('keydown', (e) => {
  if (!state.puzzle || document.querySelector('dialog[open]')) return;
  if (e.target.closest?.('input, select, textarea')) return;
  const key = e.key;
  const digit = /^Digit([0-9])$/.exec(e.code)?.[1] ?? (/^[0-9]$/.test(key) ? key : null);
  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (digit !== null) {
    const v = Number(digit);
    if (v === 0) erase();
    else if (v <= state.puzzle.n) input(v, e.shiftKey ? !state.notesMode : state.notesMode);
    e.preventDefault();
    return;
  }
  const map = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
  if (map[key]) {
    e.preventDefault();
    moveSelection(...map[key]);
    return;
  }
  switch (key.toLowerCase()) {
    case 'backspace':
    case 'delete':
      e.preventDefault();
      erase();
      break;
    case 'n':
      setNotesMode(!state.notesMode);
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
      setView(city.view === 'top' ? '3d' : 'top');
      break;
    case 'escape':
      if (city.view === 'clue') exitClueView();
      break;
    default:
  }
});

// ---------------------------------------------------------------------------
// 시작

setupSettings(city);
if (!loadSaved()) newGame();
if (!prefs.helpSeen) $('help-modal').showModal();
