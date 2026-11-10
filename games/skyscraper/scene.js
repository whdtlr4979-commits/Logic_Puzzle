// 스카이스크래퍼 퍼즐의 3D 장면 (three.js)
// 카메라·조명·입력은 공용 Stage3D 가 맡고, 여기서는 보드와 빌딩만 만든다.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { lineCells, SIDES } from './puzzle.js';
import { Stage3D, blendPalette, easeOutBack } from '../common/stage3d.js';
import { mixHex } from '../common/sky.js';

const SP = 1; // 칸 간격
const TILE = 0.9; // 바닥 타일 크기
const TILE_H = 0.12;
const BW = 0.64; // 빌딩 폭
const UNIT = 0.5; // 높이 1당 길이
const RIM = 1.1; // 단서가 놓이는 테두리 폭

/** 보드/타일 색 (조명 색은 Stage3D 기본값 사용) */
const THEMES = {
  light: {
    base: '#cfd5ea',
    tile: '#f6f7fc',
    tileGiven: '#dfe3f3',
    tilePeer: '#e3e9ff',
    tileSelect: '#8fb0ff',
    tileHover: '#ecf0ff',
    tileLine: '#ffe7a3',
    tileError: '#ffc2c2',
    windowGlow: 0.0,
    clue: { open: ['#ffffff', '#2c3566'], ok: ['#2fbf71', '#ffffff'], error: ['#ef4b5a', '#ffffff'] },
    noteInk: '#4a5488',
    key: 'l',
  },
  dark: {
    base: '#1b2142',
    tile: '#2c3463',
    tileGiven: '#252b52',
    tilePeer: '#36407a',
    tileSelect: '#5b7cff',
    tileHover: '#3a4585',
    tileLine: '#7a6a2c',
    tileError: '#7a2f3e',
    windowGlow: 0.75,
    clue: { open: ['#e9ecff', '#1c2350'], ok: ['#2fbf71', '#ffffff'], error: ['#ef4b5a', '#ffffff'] },
    noteInk: '#c9d0ff',
    key: 'd',
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

export class CityScene extends Stage3D {
  constructor(container, opts = {}) {
    super(container, opts);
    this.selected = null;
    this.focusClue = null; // 단서 시점 보기 중인 단서
    this.conflicts = new Set();
    this.texCache = new Map();
    this.onLighting();
  }

  boardSpan() {
    return (this.n || 5) * SP + RIM * 2;
  }

  viewExtra() {
    return (this.n || 5) * UNIT * 0.12;
  }

  // -------------------------------------------------------------------------
  // 조명이 바뀔 때 (낮/밤 색 섞기)

  onLighting() {
    this.theme = blendPalette(THEMES.light, THEMES.dark, this.night);
    if (!this.texCache) return; // 부모 생성자에서 불린 경우
    const atm = this.atm;
    if (this.baseMesh) this.baseMesh.material.color.set(mixBase(this.theme.base, atm));
    if (this.cells) {
      const inkChanged = this.noteInk !== this.theme.noteInk;
      for (const row of this.cells) {
        for (const cell of row) {
          if (cell.building) this.styleBuilding(cell);
          if (cell.notes && inkChanged) this.drawNotes(cell, cell.noteMask);
        }
      }
      this.refreshTiles();
      this.refreshClues();
    }
    this.noteInk = this.theme.noteInk;
  }

  onViewSet() {
    this.focusClue = null;
    this.refreshTiles();
    this.refreshClues();
  }

  onFocusLost() {
    if (!this.focusClue) return;
    this.focusClue = null;
    this.refreshTiles();
    this.refreshClues();
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
    this.fitShadows(size);

    // 주어진 칸
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (puzzle.givens[r][c]) this.setCell(r, c, puzzle.givens[r][c], false);
      }
    }
    this.ready = true;
    this.refreshTiles();
    this.focusClue = null;
    this.setView('3d', { instant: true });
  }

  clearBoard() {
    super.clearBoard();
    this.cells = null;
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
        const tex = this.clueTexture(entry.value, st === 'none' ? 'open' : st);
        if (entry.sprite.material.map !== tex) {
          entry.sprite.material.map = tex;
          entry.sprite.material.needsUpdate = true;
        }
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
  // 단서 시점

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

  celebrate() {
    this.celebrating = true;
    for (const row of this.cells) {
      for (const cell of row) {
        if (!cell.building) continue;
        const g = cell.building.group;
        const delay = (cell.r + cell.c) * 70;
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
    this.celebrateCamera();
  }

  stopCelebrate() {
    this.stopCelebrateCamera();
    if (this.cells) for (const row of this.cells) for (const cell of row) if (cell.building) this.styleBuilding(cell);
  }
}

/** 노을 무렵에는 보드에도 하늘빛이 살짝 물든다 */
function mixBase(base, atm) {
  return mixHex(base, atm.skyBottom, atm.golden * 0.25);
}
