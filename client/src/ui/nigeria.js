// Simplified outline of Nigeria (lon, lat), for the boot screen and the war map.
// Approximate: good enough for a game map, not for navigation.
export const OUTLINE = [
  [2.69, 6.37], [2.72, 7.1], [2.76, 7.9], [2.85, 8.6], [3.12, 9.1], [3.58, 9.95], [3.65, 10.45], [3.58, 11.1],
  [3.62, 11.7], [3.85, 12.3], [4.1, 13.05], [4.4, 13.65], [5.0, 13.8], [5.6, 13.86], [6.2, 13.65], [6.75, 13.3],
  [7.45, 13.1], [8.1, 13.02], [8.65, 12.92], [9.25, 12.83], [9.85, 13.15], [10.6, 13.35], [11.4, 13.37], [12.2, 13.2],
  [12.85, 13.5], [13.35, 13.72], [13.65, 13.3], [14.1, 13.05], [14.2, 12.45], [14.58, 12.12], [14.35, 11.5], [13.9, 11.0],
  [13.55, 10.65], [13.25, 10.1], [13.2, 9.55], [12.95, 9.0], [12.75, 8.55], [12.25, 8.25], [12.0, 7.65], [11.75, 7.15],
  [11.3, 6.6], [11.05, 6.45], [10.7, 6.95], [10.25, 6.9], [9.75, 6.55], [9.3, 6.4], [8.85, 5.85], [8.62, 5.05],
  [8.5, 4.65], [8.25, 4.55], [7.55, 4.45], [7.05, 4.4], [6.55, 4.3], [6.05, 4.28], [5.6, 4.6], [5.4, 5.1],
  [5.1, 5.55], [4.75, 6.05], [4.3, 6.25], [3.75, 6.42], [3.35, 6.4], [2.69, 6.37]
];

export const BOUNDS = { minLon: 2.5, maxLon: 14.8, minLat: 4.1, maxLat: 14.0 };

// Project lon/lat into a w x h box (equirectangular, fine at this latitude).
export function projector(w, h, pad = 20) {
  const { minLon, maxLon, minLat, maxLat } = BOUNDS;
  const sx = (w - pad * 2) / (maxLon - minLon);
  const sy = (h - pad * 2) / (maxLat - minLat);
  const s = Math.min(sx, sy);
  const ox = (w - (maxLon - minLon) * s) / 2;
  const oy = (h - (maxLat - minLat) * s) / 2;
  return (lon, lat) => [ox + (lon - minLon) * s, oy + (maxLat - lat) * s];
}
