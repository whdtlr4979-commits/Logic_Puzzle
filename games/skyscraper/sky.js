// 시간에 따른 해의 위치와 하늘/조명 색 계산 (three.js 와 무관한 순수 함수)

const RAD = Math.PI / 180;

/** 위도 기본값: 서울. 브라우저는 위치를 묻지 않는 한 위도를 알 수 없다. */
export const DEFAULT_LATITUDE = 37.5;

/** 시간대(UTC 오프셋)로 경도를 어림한다. 예: UTC+9 → 135° */
export function longitudeFromTimezone(date = new Date()) {
  return (-date.getTimezoneOffset() / 60) * 15;
}

/** 브라우저 시간대 이름 → 대표 도시 좌표 [위도, 경도] */
const ZONES = {
  'Asia/Seoul': [37.57, 126.98],
  'Asia/Pyongyang': [39.02, 125.75],
  'Asia/Tokyo': [35.68, 139.69],
  'Asia/Shanghai': [31.23, 121.47],
  'Asia/Hong_Kong': [22.32, 114.17],
  'Asia/Taipei': [25.03, 121.57],
  'Asia/Singapore': [1.35, 103.82],
  'Asia/Bangkok': [13.76, 100.5],
  'Asia/Ho_Chi_Minh': [10.82, 106.63],
  'Asia/Manila': [14.6, 120.98],
  'Asia/Jakarta': [-6.2, 106.85],
  'Asia/Kolkata': [28.61, 77.21],
  'Asia/Dubai': [25.2, 55.27],
  'Australia/Sydney': [-33.87, 151.21],
  'Australia/Melbourne': [-37.81, 144.96],
  'Pacific/Auckland': [-36.85, 174.76],
  'Europe/London': [51.51, -0.13],
  'Europe/Paris': [48.86, 2.35],
  'Europe/Berlin': [52.52, 13.4],
  'Europe/Madrid': [40.42, -3.7],
  'Europe/Rome': [41.9, 12.5],
  'Europe/Moscow': [55.76, 37.62],
  'America/New_York': [40.71, -74.01],
  'America/Chicago': [41.88, -87.63],
  'America/Denver': [39.74, -104.99],
  'America/Los_Angeles': [34.05, -118.24],
  'America/Vancouver': [49.28, -123.12],
  'America/Toronto': [43.65, -79.38],
  'America/Sao_Paulo': [-23.55, -46.63],
  'America/Mexico_City': [19.43, -99.13],
  'Pacific/Honolulu': [21.31, -157.86],
};

/**
 * 위치를 묻지 않고 어림한 현재 위치. 시간대 이름이 표에 있으면 그 도시 좌표,
 * 없으면 UTC 오프셋으로 경도를, 위도는 서울 값을 쓴다.
 */
export function guessLocation(date = new Date()) {
  let zone = '';
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* 무시 */
  }
  if (ZONES[zone]) return { lat: ZONES[zone][0], lon: ZONES[zone][1], zone };
  return { lat: DEFAULT_LATITUDE, lon: longitudeFromTimezone(date), zone };
}

/**
 * 해의 고도/방위각 (NOAA 근사식)
 * @param {Date} date
 * @param {number} latDeg 위도 (북위 +)
 * @param {number} lonDeg 경도 (동경 +)
 * @returns {{altitude:number, azimuth:number}} 라디안. 방위각은 북쪽 0, 동쪽 π/2 (시계 방향)
 */
export function sunPosition(date, latDeg, lonDeg) {
  if (latDeg == null || lonDeg == null) {
    const loc = guessLocation(date);
    latDeg ??= loc.lat;
    lonDeg ??= loc.lon;
  }
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear) / 86400000) + 1;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hours - 12) / 24);

  // 균시차(분)와 적위(라디안)
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g)
    - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g)
    - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);

  const trueSolarMinutes = hours * 60 + eqTime + 4 * lonDeg;
  const hourAngle = (trueSolarMinutes / 4 - 180) * RAD;
  const lat = latDeg * RAD;

  const cosZenith = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const altitude = Math.PI / 2 - Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  // 남쪽 기준 각도 → 북쪽 기준으로 바꾼다
  const azimuth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
  ) + Math.PI;
  return { altitude, azimuth: ((azimuth % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) };
}

/** 수동 조명 모드에서 쓰는 고정된 해의 위치 */
export const PRESETS = {
  day: { altitude: 58 * RAD, azimuth: 200 * RAD },
  evening: { altitude: 4 * RAD, azimuth: 290 * RAD },
  night: { altitude: -35 * RAD, azimuth: 20 * RAD },
};

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function mixHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}
export { mixHex };

const SKY = {
  dayTop: '#5f9dff',
  dayBottom: '#dcebff',
  nightTop: '#070b1f',
  nightBottom: '#1b2452',
  duskTop: '#3a3f86',
  duskBottom: '#ff9d6b',
};

/**
 * 해의 고도로부터 장면 분위기를 계산한다.
 * @returns {{
 *   day:number,       // 0 = 밤, 1 = 낮
 *   golden:number,    // 해가 지평선 근처일 때의 노을 정도 0..1
 *   sunIntensity:number, moonIntensity:number,
 *   sunColor:string, skyTop:string, skyBottom:string,
 * }}
 */
export function atmosphere(altitude) {
  const deg = altitude / RAD;
  const day = smoothstep(-6, 10, deg); // 시민 박명(-6°)부터 밝아진다
  const golden = deg > -8 ? Math.max(0, 1 - Math.abs(deg - 2) / 12) : 0;
  const sunIntensity = smoothstep(-2, 9, deg);
  const moonIntensity = 1 - smoothstep(-8, 2, deg);
  const sunColor = mixHex('#fff7ea', '#ff9a52', golden * 0.85);
  let skyTop = mixHex(SKY.nightTop, SKY.dayTop, day);
  let skyBottom = mixHex(SKY.nightBottom, SKY.dayBottom, day);
  skyTop = mixHex(skyTop, SKY.duskTop, golden * 0.55);
  skyBottom = mixHex(skyBottom, SKY.duskBottom, golden * 0.75);
  return { day, golden, sunIntensity, moonIntensity, sunColor, skyTop, skyBottom };
}

/** 장면 좌표계에서 해 방향 단위 벡터. 보드의 위쪽(-z)을 북쪽, +x 를 동쪽으로 본다. */
export function sunDirection({ altitude, azimuth }) {
  const c = Math.cos(altitude);
  return { x: Math.sin(azimuth) * c, y: Math.sin(altitude), z: -Math.cos(azimuth) * c };
}

/** 고도/방위각 사이를 보간 (방위각은 짧은 쪽으로) */
export function lerpSun(a, b, t) {
  let d = b.azimuth - a.azimuth;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return { altitude: a.altitude + (b.altitude - a.altitude) * t, azimuth: a.azimuth + d * t };
}
