// Quality presets. Medium is tuned for mid-range Android phones. (Shared with Eko Pulse.)
export const PRESETS = {
  low: {
    name: 'Low',
    pixelRatio: 1,
    shadows: false,
    shadowMapSize: 512,
    postprocessing: false,
    bloom: false,
    antialias: true,
    pedestrians: 40,
    traffic: 6,
    textureSize: 512,
    drawDistance: 900
  },
  medium: {
    name: 'Medium',
    pixelRatio: 1.25,
    shadows: true,
    shadowMapSize: 1024,
    postprocessing: true,
    bloom: true,
    antialias: false,
    pedestrians: 90,
    traffic: 14,
    textureSize: 1024,
    drawDistance: 1600
  },
  high: {
    name: 'High',
    pixelRatio: 2,
    shadows: true,
    shadowMapSize: 2048,
    postprocessing: true,
    bloom: true,
    antialias: false,
    pedestrians: 160,
    traffic: 24,
    textureSize: 1024,
    drawDistance: 2600
  }
};

export function detectQuality() {
  const params = new URLSearchParams(location.search);
  const forced = params.get('q');
  if (forced && PRESETS[forced]) return forced;
  try {
    const saved = localStorage.getItem('36s.quality');
    if (saved && PRESETS[saved]) return saved;
  } catch {
    /* storage blocked */
  }
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  if (mobile && (cores <= 4 || mem <= 3)) return 'low';
  if (mobile) return 'medium';
  return cores >= 8 ? 'high' : 'medium';
}

export function saveQuality(q) {
  try {
    localStorage.setItem('36s.quality', q);
  } catch {
    /* storage blocked */
  }
}
