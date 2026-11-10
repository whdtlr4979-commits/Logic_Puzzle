// 퍼즐 게임 공용 UI 도구: 저장소, 세그먼트 버튼, 토스트, 시간 표시, 설정 창(조명/그림자)
import { sunPosition, PRESETS } from './sky.js';

export const $ = (id) => document.getElementById(id);

export const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 저장 불가 환경은 무시 */
    }
  },
};

export function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 라디오처럼 하나만 고르는 버튼 묶음. 반환값 mark(v) 로 선택을 바꿀 수 있다. */
export function bindSeg(id, attr, current, onPick) {
  const seg = $(id);
  const buttons = [...seg.querySelectorAll('button')];
  const mark = (val) => {
    for (const b of buttons) {
      const on = b.dataset[attr] === String(val);
      b.classList.toggle('active', on);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(on));
    }
  };
  mark(current);
  for (const b of buttons) {
    b.addEventListener('click', () => {
      mark(b.dataset[attr]);
      onPick(b.dataset[attr]);
    });
  }
  return mark;
}

let toastTimer = 0;
export function toast(msg) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ---------------------------------------------------------------------------
// 설정 (모든 게임이 함께 쓰는 조명/그림자)

const SETTINGS_KEY = 'logicpuzzle.settings.v1';
const LIGHT_MODES = ['auto', 'day', 'evening', 'night'];

export function loadSettings() {
  const s = storage.get(SETTINGS_KEY, null);
  if (s) {
    return {
      light: LIGHT_MODES.includes(s.light) ? s.light : 'auto',
      shadows: typeof s.shadows === 'boolean' ? s.shadows : true,
    };
  }
  // 예전 스카이스크래퍼 전용 설정에서 옮겨 온다
  const old = storage.get('logicpuzzle.skyscraper.prefs.v1', {});
  return {
    light: LIGHT_MODES.includes(old.light) ? old.light : 'auto',
    shadows: typeof old.shadows === 'boolean' ? old.shadows : true,
  };
}

const SETTINGS_HTML = `
  <form method="dialog">
    <h2 id="settings-title">설정</h2>
    <section class="setting">
      <h3>조명</h3>
      <div class="seg" id="light-seg" role="radiogroup" aria-label="조명">
        <button type="button" data-light="auto">자동</button>
        <button type="button" data-light="day">낮</button>
        <button type="button" data-light="evening">저녁</button>
        <button type="button" data-light="night">밤</button>
      </div>
      <p class="setting-note" id="light-info"></p>
    </section>
    <section class="setting">
      <label class="switch-row">
        <span>
          <span class="setting-title">그림자</span>
          <span class="setting-note">끄면 느린 기기에서 더 부드럽게 움직여요</span>
        </span>
        <input type="checkbox" class="switch" id="shadow-toggle" checked>
      </label>
    </section>
    <p class="setting-foot">설정은 모든 퍼즐에 함께 적용돼요.</p>
    <button class="primary" value="close">닫기</button>
  </form>`;

/**
 * 설정 창을 만들고 #settings-btn 에 연결한다.
 * @param {import('./stage3d.js').Stage3D} stage
 */
export function setupSettings(stage) {
  const settings = loadSettings();
  const save = () => storage.set(SETTINGS_KEY, settings);

  let dialog = $('settings-modal');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'modal';
    dialog.id = 'settings-modal';
    dialog.setAttribute('aria-labelledby', 'settings-title');
    dialog.innerHTML = SETTINGS_HTML;
    document.body.appendChild(dialog);
  }

  function updateSky(duration = 0) {
    const auto = settings.light === 'auto';
    const state = auto ? sunPosition(new Date()) : PRESETS[settings.light];
    stage.setSun(state, duration);
    const info = $('light-info');
    if (!auto) {
      info.textContent = '시간과 관계없이 고정된 조명이에요';
      return;
    }
    const time = new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
    const alt = Math.round((state.altitude * 180) / Math.PI);
    info.textContent = alt > 0
      ? `지금 ${time} · 해 높이 ${alt}°`
      : `지금 ${time} · 해가 진 시간이에요`;
  }

  bindSeg('light-seg', 'light', settings.light, (v) => {
    settings.light = v;
    save();
    updateSky(1500);
  });
  const toggle = $('shadow-toggle');
  toggle.checked = settings.shadows;
  toggle.addEventListener('change', () => {
    settings.shadows = toggle.checked;
    save();
    stage.setShadows(settings.shadows);
  });
  $('settings-btn')?.addEventListener('click', () => {
    if (settings.light === 'auto') updateSky(); // 표시되는 시각을 최신으로
    dialog.showModal();
  });

  // 자동 모드에서는 1분마다 해를 조금씩 옮긴다
  setInterval(() => {
    if (settings.light === 'auto' && !document.hidden) updateSky(2000);
  }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && settings.light === 'auto') updateSky(1500);
  });

  stage.setShadows(settings.shadows);
  updateSky();
  return settings;
}
