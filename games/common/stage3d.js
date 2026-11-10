// 퍼즐 게임 공용 3D 무대 (three.js)
//
// 렌더러/카메라/시점 전환/시간대 조명/그림자/포인터 입력/애니메이션을 담당한다.
// 각 게임은 이 클래스를 상속해 보드와 말(빌딩, 나무, 텐트 …)만 만들면 된다.
//
// 하위 클래스가 덮어쓸 수 있는 메서드
//   boardSpan()     보드 한 변의 길이 (테두리 포함) — 카메라 거리 계산에 사용
//   viewExtra()     3D 보기에서 높은 물체 때문에 더 물러날 거리 (기본 0)
//   onLighting()    조명이 바뀐 뒤 재질 색을 다시 칠할 때 (this.night: 0 낮 ~ 1 밤)
//   onViewSet(view) setView 로 시점이 바뀔 때
//   onFocusLost()   사용자가 드래그로 특수 시점(예: 단서 시점)을 벗어날 때
//   onHoverChange() 마우스가 가리키는 칸/단서가 바뀔 때 (this.hoverCell, this.hoverClue)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { atmosphere, sunDirection, lerpSun, mixHex, PRESETS } from './sky.js';

export const FOV = 40;
export const TOP_FOV = 1; // 위에서 보기: 사실상 평면(정사영)에 가까운 시야각

export const easeOutBack = (t) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** 낮/밤 두 팔레트(같은 키)를 t(0 낮 ~ 1 밤) 로 섞는다. 숫자와 #rrggbb 문자열만 섞는다. */
export function blendPalette(day, night, t) {
  const out = {};
  for (const key of Object.keys(day)) {
    const x = day[key];
    const y = night[key];
    if (typeof x === 'number') out[key] = x + (y - x) * t;
    else if (typeof x === 'string' && x.startsWith('#')) out[key] = mixHex(x, y, t);
    else out[key] = t > 0.5 ? y : x;
  }
  return out;
}

export function glowTexture(inner, outer) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, inner);
  grad.addColorStop(0.32, outer);
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 주변광/바닥 기본 팔레트 */
export const DEFAULT_LIGHTS = {
  day: { hemiSky: '#ffffff', hemiGround: '#b7bdd6', hemi: 2.1, sun: 1.9, ground: '#dfe5f5' },
  night: { hemiSky: '#9fb2ff', hemiGround: '#20203a', hemi: 1.5, sun: 1.6, ground: '#0f1330' },
};

export class Stage3D {
  constructor(container, { onCellClick, onClueClick, onViewChange, lights = DEFAULT_LIGHTS } = {}) {
    this.container = container;
    this.onCellClick = onCellClick || (() => {});
    this.onClueClick = onClueClick || (() => {});
    this.onViewChange = onViewChange || (() => {});
    this.lights = lights;
    this.sunState = PRESETS.day;
    this.atm = atmosphere(this.sunState.altitude);
    this.night = 1 - this.atm.day;
    this.skyTween = null;
    this.shadows = true;

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

    // 밤에는 반대편 하늘의 달빛
    this.moon = new THREE.DirectionalLight('#a9bbff');
    this.moon.shadow.mapSize.set(1024, 1024);
    this.moon.shadow.bias = -0.0005;
    this.moon.shadow.normalBias = 0.02;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    // 하늘에 보이는 해/달 (카메라를 낮게 내리면 보인다)
    const disc = (tex, size) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false, fog: false,
      }));
      sp.scale.set(size, size, 1);
      sp.renderOrder = -1;
      sp.raycast = () => {};
      this.scene.add(sp);
      return sp;
    };
    this.sunDisc = disc(glowTexture('#fffbe8', 'rgba(255,214,120,0.45)'), 26);
    this.moonDisc = disc(glowTexture('#f2f4ff', 'rgba(170,190,255,0.25)'), 14);

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
    this.pickables = [];

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.tweens = [];
    this.cameraTween = null;
    this.view = '3d';
    this.azimuth = 0;
    this.hoverCell = null;
    this.hoverClue = null;
    this.ready = false; // 보드가 만들어졌는지

    this.applyLighting();
    this.bindEvents();
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // -------------------------------------------------------------------------
  // 하위 클래스용 기본 구현

  boardSpan() { return 8; }
  viewExtra() { return 0; }
  onLighting() {}
  onViewSet() {}
  onFocusLost() {}
  onHoverChange() {}

  // -------------------------------------------------------------------------
  // 조명

  applyLighting() {
    const atm = this.atm;
    const pal = blendPalette(this.lights.day, this.lights.night, this.night);
    this.palette = pal;
    // 노을 무렵에는 주변광과 바닥에 하늘빛이 물든다
    this.hemi.color.set(mixHex(pal.hemiSky, '#ffb48a', atm.golden * 0.6));
    this.hemi.groundColor.set(pal.hemiGround);
    this.hemi.intensity = pal.hemi;
    this.ground.material.color.set(mixHex(pal.ground, atm.skyBottom, 0.25 + atm.golden * 0.3));

    // 해: 실제 고도로 밝기/색을 정하고, 그림자가 너무 길어지지 않게 방향은 고도 10° 이상으로 둔다
    const sunDir = sunDirection({ altitude: Math.max(this.sunState.altitude, THREE.MathUtils.degToRad(10)), azimuth: this.sunState.azimuth });
    this.sun.position.set(sunDir.x * 20, sunDir.y * 20, sunDir.z * 20);
    this.sun.color.set(atm.sunColor);
    this.sun.intensity = this.lights.day.sun * atm.sunIntensity;
    this.setCastShadow(this.sun, this.shadows && atm.sunIntensity > 0.02);

    // 달: 해의 반대쪽 높은 하늘
    const moonDir = sunDirection({ altitude: THREE.MathUtils.degToRad(48), azimuth: this.sunState.azimuth + Math.PI * 0.85 });
    this.moon.position.set(moonDir.x * 20, moonDir.y * 20, moonDir.z * 20);
    this.moon.intensity = 0.9 * atm.moonIntensity;
    this.setCastShadow(this.moon, this.shadows && atm.moonIntensity > 0.5);

    // 하늘에 그려지는 해/달
    const realSun = sunDirection(this.sunState);
    this.sunDisc.position.set(realSun.x * 150, realSun.y * 150, realSun.z * 150);
    this.sunDisc.material.color.set(mixHex('#ffffff', '#ffb070', atm.golden));
    this.sunDisc.visible = this.sunState.altitude > -0.06;
    this.moonDisc.position.set(moonDir.x * 150, moonDir.y * 150, moonDir.z * 150);
    this.moonDisc.material.opacity = atm.moonIntensity;
    this.moonDisc.visible = atm.moonIntensity > 0.01;

    // 배경 하늘 (캔버스는 투명, 뒤의 무대 배경을 바꾼다)
    this.container.style.background = `linear-gradient(180deg, ${atm.skyTop}, ${atm.skyBottom})`;

    this.onLighting();
  }

  /** 그림자 켜기/끄기 */
  setShadows(on) {
    this.shadows = !!on;
    this.applyLighting();
  }

  setCastShadow(light, on) {
    if (light.castShadow === on) return;
    light.castShadow = on;
    // 그림자 광원 수가 바뀌면 재질 셰이더를 다시 만들어야 한다
    this.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.needsUpdate = true;
    });
  }

  /**
   * 해의 위치를 바꾼다 (라디안: altitude 고도, azimuth 북쪽 기준 방위각).
   * @param {{altitude:number, azimuth:number}} state
   * @param {number} duration 0 이면 즉시
   */
  setSun(state, duration = 0) {
    if (!duration) {
      this.skyTween = null;
      this.applySun(state);
      return;
    }
    this.skyTween = { t0: performance.now(), dur: duration, from: { ...this.sunState }, to: state };
  }

  applySun(state) {
    this.sunState = state;
    this.atm = atmosphere(state.altitude);
    this.night = 1 - this.atm.day;
    this.applyLighting();
  }

  /** 그림자 범위를 보드 크기에 맞춘다 */
  fitShadows(span) {
    const ext = span * 0.85;
    for (const light of [this.sun, this.moon]) {
      const sh = light.shadow.camera;
      sh.left = -ext; sh.right = ext; sh.top = ext; sh.bottom = -ext;
      sh.near = 1; sh.far = 60;
      sh.updateProjectionMatrix();
    }
  }

  // -------------------------------------------------------------------------
  // 보드

  /** 보드 위 물체를 모두 치운다 (캐시된 텍스처/공유 지오메트리는 남김) */
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
    this.pickables = [];
    this.ready = false;
    this.controls.autoRotate = false;
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
    this.controls.autoRotate = false;
    const span = this.boardSpan();
    let target;
    let polar;
    let dist;
    let fov;
    if (view === 'top') {
      // 아주 먼 곳에서 아주 좁은 시야각으로 내려다보면 원근감이 사라져 평면처럼 보인다
      fov = TOP_FOV;
      target = new THREE.Vector3(0, 0, 0);
      polar = 1e-4; // 정확히 0 이면 OrbitControls 가 방향을 잃는다
      dist = this.fitDistance(span * 0.54, fov);
    } else {
      fov = FOV;
      target = new THREE.Vector3(0, 0.5, 0);
      polar = THREE.MathUtils.degToRad(46);
      dist = this.fitDistance(span * 0.6 + this.viewExtra(), fov);
    }
    const pos = target.clone().add(new THREE.Vector3().setFromSphericalCoords(dist, polar, az));
    this.flyTo(pos, target, fov, instant);
    this.onViewSet(view);
  }

  rotate(dir) {
    // 현재 방위각을 90° 단위로 맞춘 뒤 회전
    const snapped = Math.round(this.currentAzimuth() / (Math.PI / 2)) * (Math.PI / 2);
    this.setView(this.view === 'top' ? 'top' : '3d', { azimuth: snapped + dir * (Math.PI / 2) });
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
   * 사용자가 위에서 보기/특수 시점에서 직접 돌리기 시작하면 시야각을 기본값으로
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
    const d = this.fitDistance(this.boardSpan() * 0.6 + this.viewExtra(), FOV);
    return d * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
  }

  /** 카메라가 아주 멀리 있을 때도 깊이 정밀도가 유지되도록 near/far 를 거리에 맞춘다 */
  updateClipping() {
    const r = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.1, r - 30);
    this.camera.far = r + 600;
    this.camera.updateProjectionMatrix();
  }

  /** 완성 축하: 3D 시점으로 돌아간 뒤 천천히 회전 */
  celebrateCamera() {
    this.celebrating = true;
    this.setView('3d');
    setTimeout(() => {
      if (this.celebrating) this.controls.autoRotate = true;
    }, 900);
  }

  stopCelebrateCamera() {
    this.celebrating = false;
    this.controls.autoRotate = false;
  }

  // -------------------------------------------------------------------------
  // 입력

  /** 드래그로 직접 카메라를 움직이기 시작함 */
  onUserCamera() {
    this.controls.autoRotate = false;
    const wasTweening = !!this.cameraTween;
    this.cameraTween = null;
    if (this.view !== '3d' && this.view !== 'free') {
      // 평면/특수 시점을 벗어나 자유 시점으로 (시야각은 stepFovNormalize 가 천천히 복귀)
      this.view = 'free';
      this.fovGoal = FOV;
      this.sizeGoal = this.defaultViewSize();
      this.onFocusLost();
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
      if (hit.type === 'cell') this.onCellClick(hit.r, hit.c, hit);
      else if (hit.type === 'clue') this.onClueClick(hit.side, hit.index, hit);
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
      this.onHoverChange();
    });
    el.addEventListener('pointerleave', () => {
      if (!this.hoverCell && !this.hoverClue) return;
      this.hoverCell = null;
      this.hoverClue = null;
      if (this.ready) this.onHoverChange();
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
  }

  pick(e) {
    if (!this.ready) return null;
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
      // 흐려진 물체는 클릭 대상에서 제외
      const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
      if (m?.transparent && m.opacity < 0.5) continue;
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
    if (this.skyTween) {
      const st = this.skyTween;
      const t = Math.min(1, (now - st.t0) / st.dur);
      this.applySun(lerpSun(st.from, st.to, easeInOut(t)));
      if (t >= 1) this.skyTween = null;
    }
    if (this.cameraTween) this.stepCameraTween(now);
    else this.stepFovNormalize();
    this.updateClipping();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
