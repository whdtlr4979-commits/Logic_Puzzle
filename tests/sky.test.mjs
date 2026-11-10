import test from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition, atmosphere, sunDirection, lerpSun, mixHex } from '../games/common/sky.js';

const deg = (r) => (r * 180) / Math.PI;
// 서울(37.57N, 126.98E), 시각은 KST(UTC+9) 를 UTC 로 환산
const seoul = (iso) => sunPosition(new Date(iso), 37.57, 126.98);

test('Seoul summer solstice noon is high in the south', () => {
  const p = seoul('2026-06-21T03:30:00Z'); // 12:30 KST ≈ 남중
  assert.ok(Math.abs(deg(p.altitude) - 75.9) < 1.5, `alt ${deg(p.altitude)}`);
  assert.ok(Math.abs(deg(p.azimuth) - 180) < 15, `az ${deg(p.azimuth)}`);
});

test('Seoul winter solstice noon is low', () => {
  const p = seoul('2026-12-21T03:30:00Z');
  assert.ok(Math.abs(deg(p.altitude) - 29) < 1.5, `alt ${deg(p.altitude)}`);
});

test('morning sun is in the east, evening in the west, midnight below horizon', () => {
  const am = seoul('2026-03-20T22:00:00Z'); // 07:00 KST
  const pm = seoul('2026-03-21T09:00:00Z'); // 18:00 KST
  const night = seoul('2026-03-21T15:00:00Z'); // 24:00 KST
  assert.ok(deg(am.azimuth) > 60 && deg(am.azimuth) < 120);
  assert.ok(deg(pm.azimuth) > 240 && deg(pm.azimuth) < 300);
  assert.ok(night.altitude < 0);
});

test('atmosphere: night is dark, day is bright', () => {
  const n = atmosphere(-30 * Math.PI / 180);
  const d = atmosphere(50 * Math.PI / 180);
  assert.equal(n.day, 0);
  assert.equal(d.day, 1);
  assert.equal(n.sunIntensity, 0);
  assert.equal(d.moonIntensity, 0);
  assert.ok(atmosphere(2 * Math.PI / 180).golden > 0.9);
});

test('sunDirection maps north to -z and east to +x', () => {
  const e = sunDirection({ altitude: 0, azimuth: Math.PI / 2 });
  const s = sunDirection({ altitude: 0, azimuth: Math.PI });
  assert.ok(Math.abs(e.x - 1) < 1e-9 && Math.abs(s.z - 1) < 1e-9);
});

test('lerpSun takes the short way around and mixHex blends', () => {
  const m = lerpSun({ altitude: 0, azimuth: 350 * Math.PI / 180 }, { altitude: 0, azimuth: 10 * Math.PI / 180 }, 0.5);
  assert.ok(Math.abs(Math.cos(m.azimuth) - 1) < 1e-9);
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
});

test('sunset in Seoul on Nov 9 is around 17:30 KST', () => {
  const before = seoul('2026-11-09T08:15:00Z'); // 17:15 KST
  const after = seoul('2026-11-09T08:45:00Z'); // 17:45 KST
  assert.ok(before.altitude > 0, `17:15 alt ${deg(before.altitude)}`);
  assert.ok(after.altitude < 0, `17:45 alt ${deg(after.altitude)}`);
});
