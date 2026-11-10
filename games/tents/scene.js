// 나무와 텐트 퍼즐의 3D 장면 (three.js)
// 카메라·조명·입력은 공용 Stage3D 가 맡고, 여기서는 잔디밭과 나무/텐트만 만든다.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Stage3D, blendPalette, easeOutBack } from '../common/stage3d.js';
import { mixHex } from '../common/sky.js';
import { TENT, GRASS, lineCells, facingTree } from './puzzle.js';

const SP = 1; // 칸 간격
const TILE = 0.92;
const TILE_H = 0.1;
const RIM = 1.0; // 숫자가 놓이는 흙 테두리

const LIGHTS = {
  day: { hemiSky: '#ffffff', hemiGround: '#a9c49a', hemi: 2.0, sun: 2.0, ground: '#cfe6bf' },
  night: { hemiSky: '#9fb2ff', hemiGround: '#1d2a2a', hemi: 1.4, sun: 1.6, ground: '#0d1a1f' },
};

const THEMES = {
  day: {
    base: '#a5805a',
    tile: '#7cc46a',
    tileAlt: '#73bb62',
    tileMarked: '#ddd29a',
    tileGiven: '#cfc38a',
    mark: '#b5a468',
    markGlow: 0,
    tilePeer: '#93d483',
    tileSelect: '#8fb0ff',
    tileHover: '#9ad98b',
    tileLine: '#ffe7a3',
    tileError: '#ff9b9b',
    tentGlow: 0,
    clue: { open: ['#ffffff', '#2c3566'], ok: ['#2fbf71', '#ffffff'], error: ['#ef4b5a', '#ffffff'] },
    key: 'l',
  },
  night: {
    base: '#3b3550',
    tile: '#2e5a46',
    tileAlt: '#2a5341',
    tileMarked: '#4a4736',
    tileGiven: '#423f30',
    mark: '#f3e7b2',
    markGlow: 0.55, // 밤에는 ✕ 가 어둠 속에서도 보이도록 살짝 빛나게
    tilePeer: '#3b6d56',
    tileSelect: '#5b7cff',
    tileHover: '#3f7560',
    tileLine: '#7a6a2c',
    tileError: '#7a2f3e',
    tentGlow: 0.85,
    clue: { open: ['#e9ecff', '#1c2350'], ok: ['#2fbf71', '#ffffff'], error: ['#ef4b5a', '#ffffff'] },
    key: 'd',
  },
};

const TENT_COLORS = ['#ff7a3d', '#ffb627', '#ff5a5f', '#3fa7d6', '#8e6cf0'];
const LEAF_COLORS = ['#3f9a4a', '#2f8a58', '#5aa845', '#348f3d'];

/** 칸마다 고정된 작은 난수 (같은 칸은 항상 같은 모양) */
function hash(r, c, k = 0) {
  let h = Math.imul(r + 31, 73856093) ^ Math.imul(c + 17, 19349663) ^ Math.imul(k + 7, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 공유 지오메트리 (보드를 새로 만들어도 다시 쓰고 지우지 않는다)
const shared = (g) => {
  g.userData.shared = true;
  return g;
};
const GEO = {
  tile: shared(new RoundedBoxGeometry(TILE, TILE_H, TILE, 2, 0.03)),
  trunk: shared(new THREE.CylinderGeometry(0.06, 0.08, 0.32, 7).translate(0, 0.16, 0)),
  cone: shared(new THREE.ConeGeometry(0.34, 0.42, 8)),
  ball: shared(new THREE.IcosahedronGeometry(0.3, 0)),
  tent: shared(makeTentGeometry(0.64, 0.58, 0.7)),
  door: shared(makeTriangle(0.26, 0.38)),
  pole: shared(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5).translate(0, 0.08, 0)),
  flag: shared(makeTriangle(0.1, 0.07).rotateZ(-Math.PI / 2)),
  markBar: shared(new THREE.BoxGeometry(0.36, 0.014, 0.065)),
};

/** 바닥이 xz 평면에 놓인 삼각 기둥 (앞면이 +z) */
function makeTentGeometry(w, h, d) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  return g;
}

function makeTriangle(w, h) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, 0);
  shape.lineTo(w / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export class TentScene extends Stage3D {
  constructor(container, opts = {}) {
    super(container, { ...opts, lights: LIGHTS });
    this.selected = null;
    this.errors = new Set(); // 문제가 있는 칸 "r,c"
    this.texCache = new Map();
    this.onLighting();
  }

  boardSpan() {
    return (this.n || 8) * SP + RIM * 2;
  }

  viewExtra() {
    return 0.3;
  }

  // -------------------------------------------------------------------------
  // 조명이 바뀔 때

  onLighting() {
    this.theme = blendPalette(THEMES.day, THEMES.night, this.night);
    if (!this.texCache) return; // 부모 생성자에서 불린 경우
    if (this.baseMesh) this.baseMesh.material.color.set(mixHex(this.theme.base, this.atm.skyBottom, this.atm.golden * 0.25));
    if (this.cells) {
      this.refreshTiles();
      this.refreshClues();
    }
  }

  onViewSet() {
    this.refreshTiles();
  }

  onHoverChange() {
    this.refreshTiles();
    this.refreshClues();
  }

  // -------------------------------------------------------------------------
  // 보드 구성

  build(puzzle) {
    this.clearBoard();
    const n = puzzle.n;
    this.n = n;
    this.puzzle = puzzle;
    this.half = ((n - 1) * SP) / 2;
    this.clueState = { row: new Array(n).fill('open'), col: new Array(n).fill('open') };

    const span = this.boardSpan();
    this.baseMesh = new THREE.Mesh(
      new RoundedBoxGeometry(span, 0.3, span, 3, 0.14),
      new THREE.MeshStandardMaterial({ color: this.theme.base, roughness: 0.95 }),
    );
    this.baseMesh.position.y = -0.15;
    this.baseMesh.receiveShadow = true;
    this.board.add(this.baseMesh);

    this.cells = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) {
        const { x, z } = this.cellPos(r, c);
        const tile = new THREE.Mesh(GEO.tile, new THREE.MeshStandardMaterial({ roughness: 0.9 }));
        tile.position.set(x, TILE_H / 2, z);
        tile.receiveShadow = true;
        tile.userData = { type: 'cell', r, c };
        this.board.add(tile);
        this.pickables.push(tile);
        const cell = { r, c, x, z, tile, state: 0, tree: !!puzzle.trees[r][c], given: !!puzzle.hints[r][c], tent: null, mark: null };
        if (cell.tree) this.addTree(cell);
        row.push(cell);
      }
      this.cells.push(row);
    }

    // 줄마다 텐트 수 (행은 왼쪽, 열은 위쪽)
    this.clueSprites = { row: [], col: [] };
    for (const kind of ['row', 'col']) {
      for (let i = 0; i < n; i++) {
        const value = kind === 'row' ? puzzle.rows[i] : puzzle.cols[i];
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false }));
        const p = this.cluePos(kind, i);
        sprite.position.set(p.x, 0.36, p.z);
        sprite.scale.set(0.56, 0.56, 1);
        sprite.userData = { type: 'clue', side: kind, index: i, value };
        sprite.renderOrder = 2;
        this.board.add(sprite);
        this.pickables.push(sprite);
        this.clueSprites[kind].push({ sprite, value });
      }
    }

    this.fitShadows(span);
    this.ready = true;
    this.refreshClues();
    this.refreshTiles();
    this.setView('3d', { instant: true });
  }

  clearBoard() {
    super.clearBoard();
    this.cells = null;
  }

  cellPos(r, c) {
    return { x: c * SP - this.half, z: r * SP - this.half };
  }

  cluePos(kind, i) {
    const off = this.half + SP * 0.5 + RIM * 0.5;
    const t = i * SP - this.half;
    return kind === 'row' ? { x: -off, z: t } : { x: t, z: -off };
  }

  // -------------------------------------------------------------------------
  // 나무

  addTree(cell) {
    const g = new THREE.Group();
    g.position.set(cell.x, TILE_H, cell.z);
    const trunk = new THREE.Mesh(GEO.trunk, new THREE.MeshStandardMaterial({ color: '#8a5a36', roughness: 0.9 }));
    trunk.castShadow = true;
    g.add(trunk);
    const leafMat = new THREE.MeshStandardMaterial({
      color: LEAF_COLORS[Math.floor(hash(cell.r, cell.c, 1) * LEAF_COLORS.length)],
      roughness: 0.8,
      flatShading: true,
    });
    if (hash(cell.r, cell.c, 2) < 0.55) {
      // 뾰족한 침엽수 (원뿔 세 층)
      for (let k = 0; k < 3; k++) {
        const cone = new THREE.Mesh(GEO.cone, leafMat);
        const s = 1 - k * 0.22;
        cone.scale.set(s, s, s);
        cone.position.y = 0.38 + k * 0.2;
        cone.castShadow = true;
        g.add(cone);
      }
    } else {
      // 둥근 활엽수
      const ball = new THREE.Mesh(GEO.ball, leafMat);
      ball.position.y = 0.52;
      ball.scale.set(1.05, 0.95, 1.05);
      ball.castShadow = true;
      g.add(ball);
      const ball2 = new THREE.Mesh(GEO.ball, leafMat);
      ball2.position.set(0.12, 0.66, -0.06);
      ball2.scale.setScalar(0.62);
      ball2.castShadow = true;
      g.add(ball2);
    }
    const s = 0.9 + hash(cell.r, cell.c, 3) * 0.2;
    g.scale.setScalar(s);
    g.rotation.y = hash(cell.r, cell.c, 4) * Math.PI * 2;
    g.traverse((o) => { if (o.isMesh) o.userData = { type: 'cell', r: cell.r, c: cell.c }; });
    this.board.add(g);
    g.children.forEach((m) => this.pickables.push(m));
    cell.treeGroup = g;
  }

  // -------------------------------------------------------------------------
  // 칸 상태 (텐트 / 빈 땅 표시)

  setCell(r, c, state, animate = true) {
    const cell = this.cells[r][c];
    if (cell.state === state) return;
    cell.state = state;
    if (state === TENT) this.addTent(cell, animate);
    else if (cell.tent) this.removeTent(cell, animate);
    if (state === GRASS) this.addMark(cell, animate);
    else if (cell.mark) this.removeMark(cell);
    this.styleCell(cell);
  }

  addTent(cell, animate) {
    if (cell.tent) return;
    const g = new THREE.Group();
    g.position.set(cell.x, TILE_H, cell.z);
    const color = TENT_COLORS[Math.floor(hash(cell.r, cell.c, 5) * TENT_COLORS.length)];
    const fabric = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      flatShading: true,
      emissive: new THREE.Color('#ffb45a'),
      emissiveIntensity: 0,
    });
    const body = new THREE.Mesh(GEO.tent, fabric);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    const doorMat = new THREE.MeshStandardMaterial({
      color: '#4a2412',
      emissive: new THREE.Color('#ffcf7a'),
      emissiveIntensity: 0,
      side: THREE.DoubleSide,
    });
    const door = new THREE.Mesh(GEO.door, doorMat);
    door.position.set(0, 0.001, 0.351);
    g.add(door);
    const pole = new THREE.Mesh(GEO.pole, new THREE.MeshStandardMaterial({ color: '#6b6b6b' }));
    pole.position.set(0, 0.57, 0.2);
    g.add(pole);
    const flag = new THREE.Mesh(GEO.flag, new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide }));
    flag.position.set(0, 0.73, 0.2);
    g.add(flag);

    // 문이 짝이 될 만한 나무 쪽을 바라보게
    const [dr, dc] = facingTree(cell.r, cell.c, this.puzzle.trees);
    g.rotation.y = Math.atan2(dc, dr);
    g.traverse((o) => { if (o.isMesh) o.userData = { type: 'cell', r: cell.r, c: cell.c }; });
    this.board.add(g);
    g.children.forEach((m) => this.pickables.push(m));
    cell.tent = { group: g, fabric, doorMat, color };
    if (animate) {
      g.scale.set(0.001, 0.001, 0.001);
      this.tween(360, (t) => {
        const s = Math.max(0.001, easeOutBack(t));
        g.scale.set(s, s, s);
      });
    }
  }

  removeTent(cell, animate) {
    const t = cell.tent;
    cell.tent = null;
    const meshes = new Set(t.group.children);
    this.pickables = this.pickables.filter((p) => !meshes.has(p));
    const dispose = () => {
      this.board.remove(t.group);
      t.group.traverse((o) => {
        if (o.isMesh) o.material.dispose();
      });
    };
    if (!animate) return dispose();
    const s0 = t.group.scale.x;
    this.tween(160, (k) => {
      const s = Math.max(0.001, s0 * (1 - k));
      t.group.scale.set(s, s, s);
    }, dispose);
  }

  addMark(cell, animate = false) {
    if (cell.mark) return;
    // 텐트 없음 표시: 흙빛 타일 위에 작은 × 자국
    const mat = new THREE.MeshStandardMaterial({ color: this.theme.mark, roughness: 1, emissive: new THREE.Color(this.theme.mark) });
    const g = new THREE.Group();
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new THREE.Mesh(GEO.markBar, mat);
      bar.rotation.y = a;
      g.add(bar);
    }
    g.position.set(cell.x, TILE_H + 0.006, cell.z);
    this.board.add(g);
    cell.mark = { group: g, mat };
    if (animate) {
      g.scale.setScalar(0.001);
      this.tween(240, (t) => g.scale.setScalar(Math.max(0.001, easeOutBack(t))));
    }
  }

  removeMark(cell) {
    const m = cell.mark;
    cell.mark = null;
    this.board.remove(m.group);
    m.mat.dispose();
  }

  // -------------------------------------------------------------------------
  // 강조 표시

  setSelection(sel) {
    this.selected = sel;
    this.refreshTiles();
  }

  setErrors(set) {
    this.errors = set;
    this.refreshTiles();
  }

  setClueStates(states) {
    this.clueState = states;
    this.refreshClues();
  }

  clueTexture(value, status) {
    const key = `clue-${value}-${status}-${this.theme.key}`;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const g = cv.getContext('2d');
    const [bg, fg] = this.theme.clue[status] || this.theme.clue.open;
    g.shadowColor = 'rgba(0,0,0,0.35)';
    g.shadowBlur = 10;
    g.shadowOffsetY = 4;
    g.fillStyle = bg;
    g.beginPath();
    g.arc(S / 2, S / 2 - 2, S / 2 - 12, 0, Math.PI * 2);
    g.fill();
    g.shadowColor = 'transparent';
    g.fillStyle = fg;
    g.font = '800 66px "Noto Sans KR", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(value), S / 2, S / 2 + 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.cached = true;
    this.texCache.set(key, tex);
    return tex;
  }

  refreshClues() {
    if (!this.clueSprites) return;
    for (const kind of ['row', 'col']) {
      this.clueSprites[kind].forEach((entry, i) => {
        const tex = this.clueTexture(entry.value, this.clueState[kind][i]);
        if (entry.sprite.material.map !== tex) {
          entry.sprite.material.map = tex;
          entry.sprite.material.needsUpdate = true;
        }
        const active = this.hoverClue && this.hoverClue.side === kind && this.hoverClue.index === i;
        const s = active ? 0.68 : 0.56;
        entry.sprite.scale.set(s, s, 1);
      });
    }
  }

  styleCell(cell) {
    const th = this.theme;
    const key = `${cell.r},${cell.c}`;
    const [sr, sc] = this.selected || [-1, -1];
    const line = this.hoverLine;
    let color = (cell.r + cell.c) % 2 ? th.tileAlt : th.tile;
    if (cell.state === GRASS) color = cell.given ? th.tileGiven : th.tileMarked;
    if (cell.r === sr || cell.c === sc) color = mixHex(color, th.tilePeer, 0.45);
    if (line && line.has(key)) color = th.tileLine;
    if (this.hoverCell && this.hoverCell[0] === cell.r && this.hoverCell[1] === cell.c) color = mixHex(color, th.tileHover, 0.6);
    if (this.errors.has(key)) color = th.tileError;
    if (cell.r === sr && cell.c === sc) color = th.tileSelect;
    cell.tile.material.color.set(color);
    if (cell.mark) {
      // 처음부터 주어진 칸의 ✕ 는 조금 흐리게 (낮에는 어둡게, 밤에는 덜 밝게)
      const markColor = cell.given ? mixHex(th.mark, th.tileGiven, 0.35) : th.mark;
      cell.mark.mat.color.set(markColor);
      cell.mark.mat.emissive.set(markColor);
      cell.mark.mat.emissiveIntensity = th.markGlow;
    }
    if (cell.tent) {
      const bad = this.errors.has(key);
      cell.tent.fabric.color.set(bad ? '#ff4d5e' : cell.tent.color);
      const glow = this.celebrating ? Math.max(0.35, th.tentGlow) : th.tentGlow;
      cell.tent.fabric.emissiveIntensity = glow * 0.35;
      cell.tent.doorMat.emissiveIntensity = glow * 1.2;
    }
  }

  refreshTiles() {
    if (!this.cells) return;
    this.hoverLine = null;
    if (this.hoverClue) {
      this.hoverLine = new Set(lineCells(this.n, this.hoverClue.side, this.hoverClue.index).map(([r, c]) => `${r},${c}`));
    }
    for (const row of this.cells) for (const cell of row) this.styleCell(cell);
  }

  // -------------------------------------------------------------------------
  // 완성 축하

  celebrate() {
    this.celebrating = true;
    for (const row of this.cells) {
      for (const cell of row) {
        const delay = (cell.r + cell.c) * 60;
        const target = cell.tent ? cell.tent.group : cell.treeGroup;
        if (!target) continue;
        const base = target.scale.x;
        this.tween(
          560,
          (t) => {
            const k = Math.sin(t * Math.PI);
            target.scale.set(base * (1 - k * 0.08), base * (1 + k * 0.3), base * (1 - k * 0.08));
          },
          () => target.scale.setScalar(base),
          delay,
        );
        this.styleCell(cell);
      }
    }
    this.selected = null;
    this.celebrateCamera();
  }

  stopCelebrate() {
    this.stopCelebrateCamera();
    if (this.cells) this.refreshTiles();
  }
}
