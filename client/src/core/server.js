// Where the game server lives. On the website it is the same address as the page.
// In the Android app (or if the page is hosted elsewhere, e.g. Vercel) set
// VITE_SERVER_ORIGIN at build time, e.g. https://three6states.onrender.com
const env = import.meta.env || {};
const origin = (env.VITE_SERVER_ORIGIN || '').replace(/\/+$/, '');

export const HTTP_BASE = origin; // '' means same origin
export const WS_URL =
  env.VITE_SERVER_URL ||
  (origin ? `${origin.replace(/^http/, 'ws')}/ws` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

// Prefix server paths (/api/..., /ads/...) with the server address when needed.
export const api = (path) => (path.startsWith('http') ? path : HTTP_BASE + path);

// Running inside the Android app?
export const IS_APP = !!window.Capacitor?.isNativePlatform?.();

// App build number (the GitHub Actions run number, set as VITE_BUILD when the APK is built).
// The server can ask players on old builds to update.
export const BUILD = Number(env.VITE_BUILD) || 0;
// The APK was built with Firebase (google-services.json) so it can get push notifications.
export const HAS_FCM = env.VITE_FCM === '1';
