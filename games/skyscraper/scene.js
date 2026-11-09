// 스카이스크래퍼 퍼즐의 3D 장면 (three.js)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { lineCells, SIDES } from './puzzle.js';

const SP = 1; // 칸 간격
const TILE = 0.9; // 바닥 타일 크기
const TILE_H = 0.12;
const BW = 0.64; // 빌딩 폭
const UNIT = 0.5; // 높이 1당 길이
const RIM = 1.1; // 단서가 놓이는 테두리 폭
const FOV = 40;
const TOP_FOV = 1; // 위에서 보기: 사실상 평면(정사영)에 가까운 시야각

const THEMES = {
  light: {
    base: '#cfd5ea',
    baseSide: '#aab2d0',
    tile: '#f6f7fc',
    tileGiven: '#dfe3f3',
    tilePeer: '#e3e9ff',
    tileSelect: '#8fb0ff',
    tileHover: '#ecf0ff',
    tileLine: '#ffe7a3',
    tileError: '#ffc2c2',
    ground: '#dfe5f5',
    hemiSky: '#ffffff',
    hemiGround: '#b7bdd6',
    hemi: 2.1,
    sun: 1.9,
    windowGlow: 0.0,
    clue: { open: ['#ffffff', '#2c3566'], ok: ['#2fbf71', '#ffffff'], error: ['#ef4b5a', '#ffffff'] },
    noteInk: '#4a5488',
  },
  dark: {
    base: '#1b2142',
    baseSide: '#11152c',
    tile: '#2c3463',
    tileGiven: '#252b52',
    tilePeer: '#36407a',
    tileSelect: '#5b7cff',
    tileHover: '#3a4585',
    tileLine: '#7a6a2c',
    tileError: '#7a2f3e',
    ground: '#0f1330',
    hemiSky: '#9fb2ff',
    hemiGround: '#20203a',
    hemi: 1.5,
    sun: 1.6,
    windowGlow: 0.55,
    clue: { open: ['#e9ecff', '#1c2350'], ok: ['#2fbf71', '#ffffff'], error: ['#ef4b5a', '#ffffff'] },
    noteInk: '#c9d0ff',
  },
};

/** 높이 → 빌딩 색 (낮을수록 청록, 높을수록 주황) */
export function heightColor(h, n) {
  const t = n > 1 ? (h - 1) / (n - 1) : 0;
  const hue = 195 - t * 175;
  return new THREE.Color().setHSL(((hue % 360) + 360) % 360 / 360, 0.68, 0.6);
}
export function heightColorCss(h, n) {
  return `#${heightColor(h, n).getHexString()}`;
}

const easeOutBack = (t) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class CityScene {
  constructor(container, { onCellClick, onClueClick, onViewChange } = {}) {
    this.container = container;
    this.onCellClick = onCellClick || (() => {});
    this.onClueClick = onClueClick || (() => {});
    this.onViewChange = onViewChange || (() => {});
    this.dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    this.theme = this.dark ? THEMES.dark : THEMES.light;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1200);
    this.camera.position.set(0, 8, 8);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(84);
    this.controls.autoRotateSpeed = 1.2;

    this.hemi = new THREE.HemisphereLight();
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff');
    this.sun.position.set(-4, 14, 6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(300, 96),
      new THREE.MeshStandardMaterial({ roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.3;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.board = new THREE.Group();
    this.scene.add(this.board);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.tweens = [];
    this.cameraTween = null;
    this.view = '3d';
    this.azimuth = 0; // 3D 보기 기준 방위각 (90° 단위로 회전)
    this.selected = null;
    this.hoverCell = null;
    this.hoverClue = null;
    this.focusClue = null; // 단서 시점 보기 중인 단서
    this.conflicts = new Set();
    this.texCache = new Map();

    this.applyTheme();
    this.bindEvents();
    this.resize();
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // -------------------------------------------------------------------------
  // 테마

  applyTheme() {
    const th = this.theme;
    this.hemi.color.set(th.hemiSky);
    this.hemi.groundColor.set(th.hemiGround);
    this.hemi.intensity = th.hemi;
    this.sun.intensity = th.sun;
    this.ground.material.color.set(th.ground);
    if (this.baseMesh) {
      this.baseMesh.material.color.set(th.base);
    }
    if (this.cells) {
      for (const row of this.cells) {
        for (const cell of row) {
          if (cell.building) this.styleBuilding(cell);
          if (cell.notes) this.drawNotes(cell, cell.noteMask);
        }
      }
      this.refreshTiles();
      this.refreshClues();
    }
  }

  setDark(dark) {
    if (dark === this.dark) return;
    this.dark = dark;
    this.theme = dark ? THEMES.dark : THEMES.light;
    this.applyTheme();
  }

  // -------------------------------------------------------------------------
  // 보드 구성

  build(puzzle) {
    this.clearBoard();
    const n = puzzle.n;
    this.n = n;
    this.puzzle = puzzle;
    this.half = ((n - 1) * SP) / 2;
    this.clueState = {};
    for (const s of SIDES) this.clueState[s] = new Array(n).fill('none');

    const size = n * SP + RIM * 2;
    this.baseMesh = new THREE.Mesh(
      new RoundedBoxGeometry(size, 0.3, size, 3, 0.12),
      new THREE.MeshStandardMaterial({ color: this.theme.base, roughness: 0.85 }),
    );
    this.baseMesh.position.y = -0.15;
    this.baseMesh.receiveShadow = true;
    this.board.add(this.baseMesh);

    const tileGeo = new RoundedBoxGeometry(TILE, TILE_H, TILE, 2, 0.035);
    const noteGeo = new THREE.PlaneGeometry(TILE * 0.94, TILE * 0.94);
    this.cells = [];
    this.pickables = [];
    for (let r = 0; r < n; r++) {
      const row = [];
      for (let c = 0; c < n; c++) {
        const { x, z } = this.cellPos(r, c);
        const tile = new THREE.Mesh(
          tileGeo,
          new THREE.MeshStandardMaterial({ color: this.theme.tile, roughness: 0.6 }),
        );
        tile.position.set(x, TILE_H / 2, z);
        tile.receiveShadow = true;
        tile.userData = { type: 'cell', r, c };
        this.board.add(tile);
        this.pickables.push(tile);

        const cell = {
          r, c, x, z, tile,
          value: 0,
          given: !!puzzle.givens[r][c],
          building: null,
          notes: null,
          noteMask: 0,
          noteGeo,
        };
        row.push(cell);
      }
      this.cells.push(row);
    }

    // 단서 스프라이트
    this.clueSprites = {};
    for (const side of SIDES) {
      this.clueSprites[side] = [];
      for (let i = 0; i < n; i++) {
        const value = puzzle.clues[side][i];
        if (!value) {
          this.clueSprites[side].push(null);
          continue;
        }
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false }));
        const p = this.cluePos(side, i);
        sprite.position.set(p.x, 0.42, p.z);
        sprite.scale.set(0.62, 0.62, 1);
        sprite.userData = { type: 'clue', side, index: i, value };
        sprite.renderOrder = 2;
        this.board.add(sprite);
        this.pickables.push(sprite);

        // 바닥에 방향 표시 (작은 삼각형)
        const arrow = new THREE.Mesh(
          new THREE.CircleGeometry(0.12, 3),
          new THREE.MeshBasicMaterial({ color: this.theme.tileSelect, transparent: true, opacity: 0.55 }),
        );
        arrow.rotation.x = -Math.PI / 2;
        const dir = this.sideDir(side);
        arrow.rotation.z = Math.atan2(-dir.z, dir.x);
        arrow.position.set(p.x + dir.x * 0.42, 0.005, p.z + dir.z * 0.42);
        this.board.add(arrow);

        this.clueSprites[side].push({ sprite, arrow, value });
      }
    }
    this.refreshClues();

    // 그림자 범위를 보드 크기에 맞춘다
    const sh = this.sun.shadow.camera;
    const ext = size * 0.85;
    sh.left = -ext; sh.right = ext; sh.top = ext; sh.bottom = -ext;
    sh.near = 1; sh.far = 60;
    sh.updateProjectionMatrix();

    // 주어진 칸
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (puzzle.givens[r][c]) this.setCell(r, c, puzzle.givens[r][c], false);
      }
    }
    this.refreshTiles();
    this.focusClue = null;
    this.setView('3d', { instant: true });
  }

  clearBoard() {
    this.tweens = [];
    for (const obj of [...this.board.children]) {
      this.board.remove(obj);
      obj.traverse?.((o) => {
        if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (m.map && !m.map.userData?.cached) m.map.dispose();
          m.dispose();
        }
      });
    }
    this.cells = null;
    this.controls.autoRotate = false;
  }

  cellPos(r, c) {
    return { x: c * SP - this.half, z: r * SP - this.half };
  }

  /** 단서가 바라보는 방향 (보드 안쪽으로) */
  sideDir(side) {
    return {
      top: { x: 0, z: 1 },
      bottom: { x: 0, z: -1 },
      left: { x: 1, z: 0 },
      right: { x: -1, z: 0 },
    }[side];
  }

  cluePos(side, i) {
    const off = this.half + SP * 0.5 + RIM * 0.55;
    const t = i * SP - this.half;
    switch (side) {
      case 'top': return { x: t, z: -off };
      case 'bottom': return { x: t, z: off };
      case 'left': return { x: -off, z: t };
      default: return { x: off, z: t };
    }
  }

  // -------------------------------------------------------------------------
  // 텍스처

  windowTextures(h) {
    const key = `win-${h}`;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const W = 128;
    const FH = 64;
    const H = FH * h;
    const make = (lit) => {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = lit ? '#000000' : '#f4f5fa';
      g.fillRect(0, 0, W, H);
      if (!lit) {
        // 층 구분선
        g.fillStyle = '#d9dcea';
        for (let f = 1; f < h; f++) g.fillRect(0, f * FH - 2, W, 4);
      }
      // 같은 높이면 같은 창문 패턴이 나오도록 고정 난수
      let seed = h * 9301 + 49297;
      const rnd = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let f = 0; f < h; f++) {
        for (let k = 0; k < 3; k++) {
          const x = 14 + k * 38;
          const y = f * FH + 16;
          const on = rnd() < 0.55;
          if (lit) {
            g.fillStyle = on ? '#ffd98a' : '#000000';
          } else {
            g.fillStyle = on ? '#fff1c7' : '#5d6a8f';
          }
          g.fillRect(x, y, 24, 32);
        }
      }
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.userData.cached = true;
      return tex;
    };
    const val = { map: make(false), emissive: make(true) };
    this.texCache.set(key, val);
    return val;
  }

  roofTexture(h, n, given) {
    const key = `roof-${h}-${n}-${given ? 1 : 0}`;
    if (this.texCache.has(key)) return this.texCache.get(key);
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const g = cv.getContext('2d');
    const col = heightColor(h, n);
    const light = col.clone().lerp(new THREE.Color('#ffffff'), 0.45);
    g.fillStyle = `#${light.getHexString()}`;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = `#${col.getHexString()}`;
    g.lineWidth = 10;
    g.strokeRect(5, 5, S - 10, S - 10);
    g.fillStyle = given ? '#11163a' : '#1f2a5c';
    g.font = `${given ? 900 : 700} 78px "Noto Sans KR", system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(String(h), S / 2, S / 2 + 4);
    if (given) {
      // 고정 칸 표시 (모서리 점)
      g.fillStyle = '#11163a';
      for (const [x, y] of [[20, 20], [S - 20, 20], [20, S - 20], [S - 20, S - 20]]) {
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.userData.cached = true;
    this.texCache.set(key, tex);
    return tex;
  }

  clueTexture(value, status) {
    const key = `clue-${value}-${status}-${this.dark ? 'd' : 'l'}`;
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

  // -------------------------------------------------------------------------
  // 칸 / 빌딩

  setCell(r, c, value, animate = true) {
    const cell = this.cells[r][c];
    if (cell.value === value) return;
    if (cell.building) this.removeBuilding(cell, animate);
    cell.value = value;
    if (value) {
      this.addBuilding(cell, value, animate);
      if (cell.notes) cell.notes.visible = false;
    } else if (cell.notes) {
      cell.notes.visible = cell.noteMask !== 0;
    }
  }

  addBuilding(cell, h, animate) {
    const n = this.n;
    const height = h * UNIT;
    const group = new THREE.Group();
    group.position.set(cell.x, TILE_H, cell.z);

    const win = this.windowTextures(h);
    const side = new THREE.MeshStandardMaterial({
      map: win.map,
      emissiveMap: win.emissive,
      emissive: new THREE.Color('#ffcf73'),
      emissiveIntensity: this.theme.windowGlow,
      roughness: 0.55,
      metalness: 0.05,
    });
    const roof = new THREE.MeshStandardMaterial({
      map: this.roofTexture(h, n, cell.given),
      roughness: 0.7,
    });
    const geo = new THREE.BoxGeometry(BW, height, BW);
    geo.translate(0, height / 2, 0);
    const body = new THREE.Mesh(geo, [side, side, roof, side, side, side]);
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData = { type: 'cell', r: cell.r, c: cell.c };
    group.add(body);

    // 지붕 아래 띠 (코니스)
    const capGeo = new THREE.BoxGeometry(BW + 0.05, 0.05, BW + 0.05);
    const cap = new THREE.Mesh(capGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }));
    cap.position.y = height - 0.05;
    cap.castShadow = true;
    group.add(cap);

    // 고정(주어진) 빌딩 받침대
    if (cell.given) {
      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(BW + 0.12, 0.06, BW + 0.12),
        new THREE.MeshStandardMaterial({ color: '#2a2f55', roughness: 0.4, metalness: 0.3 }),
      );
      plinth.position.y = 0.03;
      plinth.receiveShadow = true;
      group.add(plinth);
    }

    cell.building = { group, body, side, roof, cap, h };
    this.styleBuilding(cell);
    this.board.add(group);
    this.pickables.push(body);

    if (animate) {
      group.scale.set(1, 0.001, 1);
      this.tween(380, (t) => group.scale.set(1, Math.max(0.001, easeOutBack(t)), 1));
    }
  }

  styleBuilding(cell) {
    const b = cell.building;
    const col = heightColor(b.h, this.n);
    const bad = this.conflicts.has(`${cell.r},${cell.c}`);
    b.side.color.copy(bad ? new THREE.Color('#ff6b78') : col);
    b.side.emissiveIntensity = this.celebrating ? 1.2 : this.theme.windowGlow;
    b.cap.material.color.copy(col.clone().multiplyScalar(0.7));
    const sel = this.selected && this.selected[0] === cell.r && this.selected[1] === cell.c;
    b.roof.emissive = new THREE.Color(sel ? '#3355ff' : '#000000');
    b.roof.emissiveIntensity = sel ? 0.35 : 0;
  }

  removeBuilding(cell, animate) {
    const b = cell.building;
    cell.building = null;
    this.pickables = this.pickables.filter((p) => p !== b.body);
    const dispose = () => {
      this.board.remove(b.group);
      b.body.geometry.dispose();
      b.side.dispose();
      b.roof.dispose();
      b.cap.geometry.dispose();
      b.cap.material.dispose();
    };
    if (!animate) return dispose();
    const s0 = b.group.scale.y;
    this.tween(180, (t) => b.group.scale.set(1, Math.max(0.001, s0 * (1 - t)), 1), dispose);
  }

  setNotes(r, c, mask) {
    const cell = this.cells[r][c];
    cell.noteMask = mask;
    if (!mask && !cell.notes) return;
    if (!cell.notes) {
      const cv = document.createElement('canvas');
      cv.width = 192;
      cv.height = 192;
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const plane = new THREE.Mesh(
        cell.noteGeo,
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
      );
      plane.geometry.userData.shared = true;
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(cell.x, TILE_H + 0.004, cell.z);
      plane.userData = { canvas: cv };
      plane.raycast = () => {};
      this.board.add(plane);
      cell.notes = plane;
    }
    this.drawNotes(cell, mask);
    cell.notes.visible = mask !== 0 && !cell.value;
  }

  drawNotes(cell, mask) {
    const cv = cell.notes.userData.canvas;
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = this.theme.noteInk;
    g.font = '700 48px "Noto Sans KR", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let v = 1; v <= 9; v++) {
      if (!(mask & (1 << v))) continue;
      const k = v - 1;
      g.fillText(String(v), 32 + (k % 3) * 64, 34 + Math.floor(k / 3) * 64);
    }
    cell.notes.material.map.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // 강조 표시

  setSelection(sel) {
    this.selected = sel;
    this.refreshTiles();
  }

  setConflicts(set) {
    this.conflicts = set;
    this.refreshTiles();
  }

  setClueStates(states) {
    this.clueState = states;
    this.refreshClues();
  }

  refreshClues() {
    if (!this.clueSprites) return;
    for (const side of SIDES) {
      this.clueSprites[side].forEach((entry, i) => {
        if (!entry) return;
        const st = this.clueState[side][i];
        entry.sprite.material.map = this.clueTexture(entry.value, st === 'none' ? 'open' : st);
        entry.sprite.material.needsUpdate = true;
        const active = (this.hoverClue && this.hoverClue.side === side && this.hoverClue.index === i)
          || (this.focusClue && this.focusClue.side === side && this.focusClue.index === i);
        const s = active ? 0.74 : 0.62;
        entry.sprite.scale.set(s, s, 1);
        // 단서 시점에서는 그 단서만 남긴다
        const hidden = !!this.focusClue && !(this.focusClue.side === side && this.focusClue.index === i);
        entry.sprite.visible = !hidden;
        entry.arrow.visible = !hidden;
        entry.arrow.material.color.set(active ? '#ffb020' : this.theme.tileSelect);
      });
    }
  }

  refreshTiles() {
    if (!this.cells) return;
    const th = this.theme;
    const line = new Set();
    const clue = this.focusClue || this.hoverClue;
    if (clue) for (const [r, c] of lineCells(this.n, clue.side, clue.index)) line.add(`${r},${c}`);
    const [sr, sc] = this.selected || [-1, -1];
    for (const row of this.cells) {
      for (const cell of row) {
        const key = `${cell.r},${cell.c}`;
        let color = cell.given ? th.tileGiven : th.tile;
        if (cell.r === sr || cell.c === sc) color = th.tilePeer;
        if (line.has(key)) color = th.tileLine;
        if (this.hoverCell && this.hoverCell[0] === cell.r && this.hoverCell[1] === cell.c) color = th.tileHover;
        if (this.conflicts.has(key)) color = th.tileError;
        if (cell.r === sr && cell.c === sc) color = th.tileSelect;
        cell.tile.material.color.set(color);
        if (cell.building) this.styleBuilding(cell);
      }
    }
    this.applyFocusFade();
  }

  /** 단서 시점 보기에서는 해당 줄을 제외한 빌딩을 흐리게 */
  applyFocusFade() {
    const line = new Set();
    if (this.focusClue) {
      for (const [r, c] of lineCells(this.n, this.focusClue.side, this.focusClue.index)) line.add(`${r},${c}`);
    }
    for (const row of this.cells) {
      for (const cell of row) {
        if (!cell.building) continue;
        const fade = this.focusClue && !line.has(`${cell.r},${cell.c}`);
        const mats = [cell.building.side, cell.building.roof, cell.building.cap.material];
        for (const m of mats) {
          if (m.transparent !== !!fade) m.needsUpdate = true;
          m.transparent = !!fade;
          m.opacity = fade ? 0.12 : 1;
          m.depthWrite = !fade;
        }
        cell.building.body.castShadow = !fade;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 카메라

  /** 반지름 extent 인 영역이 화면에 들어오는 카메라 거리 */
  fitDistance(extent, fov = FOV) {
    const vHalf = THREE.MathUtils.degToRad(fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * this.camera.aspect);
    return extent / Math.tan(Math.min(vHalf, hHalf));
  }

  /** 지금 카메라가 보드를 바라보는 방위각 */
  currentAzimuth() {
    const offset = this.camera.position.clone().sub(this.controls.target);
    if (Math.hypot(offset.x, offset.z) < 1e-9) return this.azimuth;
    return Math.atan2(offset.x, offset.z);
  }

  /**
   * @param {'3d'|'top'} view
   * @param {{instant?: boolean, azimuth?: number}} opts
   *   azimuth 를 주지 않으면 지금 바라보는 방향을 그대로 유지한다
   *   (위에서 보기는 격자가 반듯하도록 가장 가까운 90° 로 맞춘다).
   */
  setView(view, { instant = false, azimuth } = {}) {
    let az = azimuth ?? this.currentAzimuth();
    if (view === 'top') az = Math.round(az / (Math.PI / 2)) * (Math.PI / 2);
    this.azimuth = az;
    this.view = view;
    this.focusClue = null;
    this.controls.autoRotate = false;
    const size = this.n * SP + RIM * 2;
    let target;
    let polar;
    let dist;
    let fov;
    if (view === 'top') {
      // 아주 먼 곳에서 아주 좁은 시야각으로 내려다보면 원근감이 사라져 평면처럼 보인다
      fov = TOP_FOV;
      target = new THREE.Vector3(0, 0, 0);
      polar = 1e-4; // 정확히 0 이면 OrbitControls 가 방향을 잃는다
      dist = this.fitDistance(size * 0.54, fov);
    } else {
      fov = FOV;
      target = new THREE.Vector3(0, 0.5, 0);
      polar = THREE.MathUtils.degToRad(46);
      dist = this.fitDistance(size * 0.6 + this.n * UNIT * 0.12, fov);
    }
    const pos = target.clone().add(new THREE.Vector3().setFromSphericalCoords(dist, polar, az));
    this.flyTo(pos, target, fov, instant);
    this.refreshTiles();
    this.refreshClues();
  }

  rotate(dir) {
    // 현재 방위각을 90° 단위로 맞춘 뒤 회전
    const snapped = Math.round(this.currentAzimuth() / (Math.PI / 2)) * (Math.PI / 2);
    this.setView(this.view === 'top' ? 'top' : '3d', { azimuth: snapped + dir * (Math.PI / 2) });
  }

  /** 단서 위치에서 줄을 따라 바라보는 시점 (망원 렌즈로 원근 왜곡을 줄임) */
  viewFromClue(side, index) {
    this.focusClue = { side, index };
    this.view = 'clue';
    this.controls.autoRotate = false;
    const dir = this.sideDir(side);
    const p = this.cluePos(side, index);
    const fov = 9;
    const back = 30;
    const eye = UNIT * 0.6;
    const pos = new THREE.Vector3(p.x - dir.x * back, eye + 1.1, p.z - dir.z * back);
    const off = this.half + SP * 0.5 + RIM * 0.55;
    const target = new THREE.Vector3(p.x + dir.x * off, eye + this.n * UNIT * 0.45, p.z + dir.z * off);
    this.flyTo(pos, target, fov);
    this.refreshTiles();
    this.refreshClues();
  }

  /**
   * 카메라 이동. 위치를 직선으로 옮기지 않고 목표점 기준 구면 좌표(방위각/고도각)로
   * 보간하므로, 바라보는 방향을 유지한 채 위로 올라가거나 내려온다.
   * 시야각이 바뀌는 동안에는 화면에 보이는 크기가 자연스럽게 이어지도록 거리를 맞춘다.
   */
  flyTo(pos, target, fov, instant = false) {
    this.fovGoal = fov;
    this.sizeGoal = null;
    if (instant) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.camera.fov = fov;
      this.updateClipping();
      this.controls.update();
      this.cameraTween = null;
      return;
    }
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const to = new THREE.Spherical().setFromVector3(pos.clone().sub(target));
    // 방위각은 짧은 쪽으로 돈다
    let dTheta = to.theta - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    const halfTan = (f) => Math.tan(THREE.MathUtils.degToRad(f / 2));
    this.cameraTween = {
      t0: performance.now(),
      dur: 800,
      from,
      to,
      dTheta,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      fromFov: this.camera.fov,
      toFov: fov,
      fromSize: from.radius * halfTan(this.camera.fov),
      toSize: to.radius * halfTan(fov),
    };
  }

  stepCameraTween(now) {
    const ct = this.cameraTween;
    const t = Math.min(1, (now - ct.t0) / ct.dur);
    const e = easeInOut(t);
    const fov = ct.fromFov + (ct.toFov - ct.fromFov) * e;
    const size = ct.fromSize + (ct.toSize - ct.fromSize) * e;
    const radius = size / Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const phi = ct.from.phi + (ct.to.phi - ct.from.phi) * e;
    const theta = ct.from.theta + ct.dTheta * e;
    this.controls.target.lerpVectors(ct.fromTarget, ct.toTarget, e);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSphericalCoords(radius, phi, theta));
    this.camera.fov = fov;
    if (t >= 1) this.cameraTween = null;
  }

  /**
   * 사용자가 위에서 보기/단서 시점에서 직접 돌리기 시작하면 시야각을 기본값으로
   * 천천히 되돌린다. 보이는 크기는 유지한 채 거리만 바꾸므로 화면이 튀지 않는다.
   */
  stepFovNormalize() {
    const goal = this.fovGoal ?? FOV;
    if (this.sizeGoal == null && Math.abs(this.camera.fov - goal) < 0.01) return;
    const halfTan = (f) => Math.tan(THREE.MathUtils.degToRad(f / 2));
    const cur = this.camera.fov;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const size = offset.length() * halfTan(cur);
    const sizeGoal = this.sizeGoal ?? size;
    const k = 0.12;
    const done = Math.abs(goal - cur) < 0.05 && Math.abs(sizeGoal - size) < 0.005;
    const nextFov = done ? goal : cur + (goal - cur) * k;
    const nextSize = done ? sizeGoal : size + (sizeGoal - size) * k;
    offset.setLength(nextSize / halfTan(nextFov));
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.fov = nextFov;
    if (done) this.sizeGoal = null;
  }

  /** 기본 3D 보기에서 화면에 보이는 크기 (거리 × tan(시야각/2)) */
  defaultViewSize() {
    const size = this.n * SP + RIM * 2;
    const d = this.fitDistance(size * 0.6 + this.n * UNIT * 0.12, FOV);
    return d * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  }

  /** 카메라가 아주 멀리 있을 때도 깊이 정밀도가 유지되도록 near/far 를 거리에 맞춘다 */
  updateClipping() {
    const r = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.1, r - 30);
    this.camera.far = r + 600;
    this.camera.updateProjectionMatrix();
  }

  celebrate() {
    this.celebrating = true;
    let k = 0;
    for (const row of this.cells) {
      for (const cell of row) {
        if (!cell.building) continue;
        const g = cell.building.group;
        const delay = (cell.r + cell.c) * 70;
        k++;
        this.tween(
          520,
          (t) => {
            const s = 1 + Math.sin(t * Math.PI) * 0.25;
            g.scale.set(1, s, 1);
          },
          () => g.scale.set(1, 1, 1),
          delay,
        );
        this.styleBuilding(cell);
      }
    }
    this.focusClue = null;
    this.setView('3d');
    setTimeout(() => {
      if (this.celebrating) this.controls.autoRotate = true;
    }, 900);
  }

  stopCelebrate() {
    this.celebrating = false;
    this.controls.autoRotate = false;
    if (this.cells) for (const row of this.cells) for (const cell of row) if (cell.building) this.styleBuilding(cell);
  }

  // -------------------------------------------------------------------------
  // 입력

  /** 드래그/휠로 직접 카메라를 움직이기 시작함 */
  onUserCamera() {
    this.controls.autoRotate = false;
    const wasTweening = !!this.cameraTween;
    this.cameraTween = null;
    if (this.view === 'top' || this.view === 'clue') {
      // 평면/단서 시점을 벗어나 자유 시점으로 (시야각은 stepFovNormalize 가 천천히 복귀)
      this.view = 'free';
      this.fovGoal = FOV;
      this.sizeGoal = this.defaultViewSize();
      if (this.focusClue) {
        this.focusClue = null;
        this.refreshTiles();
        this.refreshClues();
      }
      this.onViewChange(this.view);
    } else if (wasTweening) {
      this.fovGoal = FOV;
      this.sizeGoal = this.defaultViewSize();
    }
  }

  bindEvents() {
    const el = this.renderer.domElement;
    let down = null;
    const pointers = new Set();
    el.addEventListener('pointerdown', (e) => {
      pointers.add(e.pointerId);
      down = pointers.size === 1 ? { x: e.clientX, y: e.clientY, dragged: false } : null;
    });
    const release = (e) => pointers.delete(e.pointerId);
    el.addEventListener('pointercancel', (e) => { release(e); down = null; });
    el.addEventListener('pointerup', (e) => {
      release(e);
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const wasDrag = down.dragged;
      down = null;
      if (wasDrag || moved > 6) return;
      const hit = this.pick(e);
      if (!hit) return;
      if (hit.type === 'cell') this.onCellClick(hit.r, hit.c);
      else if (hit.type === 'clue') this.onClueClick(hit.side, hit.index);
    });
    el.addEventListener('pointermove', (e) => {
      // 한 손가락/마우스로 끌기 시작하면 = 회전 → 자유 시점으로
      // (두 손가락 핀치와 휠은 확대/축소일 뿐이라 지금 시점을 유지한다)
      if (down && !down.dragged && pointers.size === 1
        && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
        down.dragged = true;
        this.onUserCamera();
      }
      if (e.pointerType !== 'mouse' || down) return;
      const hit = this.pick(e);
      const hc = hit && hit.type === 'cell' ? [hit.r, hit.c] : null;
      const hq = hit && hit.type === 'clue' ? { side: hit.side, index: hit.index } : null;
      const changed = JSON.stringify(hc) !== JSON.stringify(this.hoverCell)
        || JSON.stringify(hq) !== JSON.stringify(this.hoverClue);
      el.style.cursor = hit ? 'pointer' : 'grab';
      if (!changed) return;
      this.hoverCell = hc;
      this.hoverClue = hq;
      this.refreshTiles();
      this.refreshClues();
    });
    el.addEventListener('pointerleave', () => {
      this.hoverCell = null;
      this.hoverClue = null;
      if (this.cells) {
        this.refreshTiles();
        this.refreshClues();
      }
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => this.setDark(e.matches));
  }

  pick(e) {
    if (!this.cells) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      const ud = h.object.userData;
      if (!h.object.visible) continue;
      // 흐려진 빌딩은 클릭 대상에서 제외
      if (h.object.material?.[0]?.transparent && h.object.material[0].opacity < 0.5) continue;
      if (ud.type) return ud;
    }
    return null;
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // 애니메이션

  tween(dur, update, done, delay = 0) {
    this.tweens.push({ t0: performance.now() + delay, dur, update, done });
  }

  frame() {
    const now = performance.now();
    if (this.tweens.length) {
      const keep = [];
      for (const tw of this.tweens) {
        const t = (now - tw.t0) / tw.dur;
        if (t < 0) { keep.push(tw); continue; }
        if (t >= 1) {
          tw.update(1);
          tw.done?.();
        } else {
          tw.update(t);
          keep.push(tw);
        }
      }
      this.tweens = keep;
    }
    if (this.cameraTween) this.stepCameraTween(now);
    else this.stepFovNormalize();
    this.updateClipping();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
