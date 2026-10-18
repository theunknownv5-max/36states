// What the POD team says to players: the 🔔 News list, the lobby announcement strip (and
// running events like double XP), maintenance and "update your app" screens, bans, kicks,
// live broadcasts, and the push-notification switch in Settings.
import { IS_APP, HAS_FCM } from '../core/server.js';
import { toast } from './chat.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//.test(u || '') || /^\/[^/]/.test(u || '') ? u : null);
const ago = (t) => {
  const s = Math.max(1, (Date.now() - t) / 1000);
  if (s < 3600) return `${Math.round(s / 60) || 1} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
};
const unb64u = (s) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

export class Notices {
  constructor({ net, store, isInGame, onKicked, hudToast }) {
    this.net = net;
    this.store = store;
    this.isInGame = isInGame;
    this.onKicked = onKicked;
    this.hudToast = hudToast;
    this.notes = [];
    this.control = {};
    this.push = { vapid: null, fcm: false, on: false };
    $('btn-notes').onclick = () => this.openNotes();
    net.on('notice', (m) => this.onNotice(m));
    net.on('broadcast', (m) => this.say(`📢 ${m.text}`, m.kind === 'warn' ? 'bad' : 'info', 7000));
    net.on('control', (m) => this.setControl(m));
    net.on('kicked', (m) => this.kicked(m.reason));
    net.on('pushState', (m) => this.pushState(m));
    net.on('welcome', (m) => this.welcome(m));
    // Banned while playing: the reconnect is refused.
    net.on('authError', (m) => m.banned && this.lock('🚫 Account blocked', m.error, '', 'ban'));
    $('set-push').addEventListener('change', (e) => this.togglePush(e.target.checked));
  }

  // ---------- connect ----------
  welcome(m) {
    if (m.push) this.push = { ...this.push, ...m.push };
    if (m.control) this.setControl(m.control);
    if (m.needUpdate) this.updateScreen();
    this.syncPushSwitch();
    // Keep the server's list of this device fresh (tokens and endpoints change now and then).
    if (this.store.get('push') === '1' && !this.push.on) this.togglePush(true, true);
  }

  say(text, kind = 'info', ms = 4500) {
    if (this.isInGame()) this.hudToast(text, kind, ms);
    else toast(text);
  }

  // ---------- news list ----------
  onNotice(n) {
    // Admin notices have an id and go in the 🔔 list; quick replies (like "report received") just pop.
    if (n.id && !this.notes.some((x) => x.id === n.id)) {
      this.notes.unshift(n);
      this.badge();
      if (!$('notes').hidden) this.renderNotes();
    }
    this.say(`🔔 ${n.title}${n.body ? ` — ${n.body}` : ''}`, 'info', 6500);
  }

  seenAt() {
    return +(this.store.get('notesSeen', 0) || 0);
  }

  badge() {
    const n = this.notes.filter((x) => x.at > this.seenAt()).length;
    $('notes-badge').hidden = !n;
    $('notes-badge').textContent = n > 9 ? '9+' : n;
  }

  openNotes() {
    this.renderNotes();
    $('notes').hidden = false;
    this.store.set('notesSeen', Date.now());
    this.badge();
  }

  renderNotes() {
    const seen = this.seenAt();
    $('notes-body').innerHTML = this.notes.length
      ? this.notes
          .map((n) => {
            const url = safeUrl(n.url);
            return `<div class="note-item ${n.at > seen ? 'new' : ''}"><b>${esc(n.title)}</b><p>${esc(n.body)}</p><small>${ago(n.at)}</small>${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener">Open</a>` : ''}</div>`;
          })
          .join('')
      : '<p class="muted">No news yet. Updates, events and gifts from the POD team will show here.</p>';
  }

  // ---------- announcement strip, events, maintenance ----------
  setControl(c) {
    this.control = c;
    for (const n of c.notices || []) if (!this.notes.some((x) => x.id === n.id)) this.notes.push(n);
    this.notes.sort((a, b) => b.at - a.at);
    this.badge();
    const bar = $('announce');
    const a = c.announcement;
    const ev = c.event;
    const parts = [];
    if (ev) {
      const mult = [ev.xpMult > 1 ? `${ev.xpMult}× XP` : '', ev.moneyMult > 1 ? `${ev.moneyMult}× money` : ''].filter(Boolean).join(' + ');
      const left = ev.until ? Math.max(1, Math.round((ev.until - Date.now()) / 3600000)) : 0;
      parts.push(`<span class="ev">🔥 ${esc(ev.name || 'Event')}</span> <span>${esc(mult)}${left ? ` · ${left} h left` : ''}</span>`);
    }
    if (a) {
      const url = safeUrl(a.url);
      parts.push(`<span>${a.kind === 'warn' ? '⚠' : '📢'} ${esc(a.text)}</span>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">More →</a>` : ''}`);
    }
    bar.hidden = !parts.length;
    bar.className = `announce ${a?.kind === 'warn' ? 'warn' : ev && !a ? 'event' : ''}`;
    bar.innerHTML = parts.join('<span class="muted">·</span>');
    if (c.maintenance) this.lock('🛠 Maintenance', c.maintenance, '<button class="btn primary" id="lock-retry">Try again</button>');
    else if (this.locked === 'maint') this.unlock();
  }

  lock(title, body, acts = '', kind = 'maint') {
    this.locked = kind;
    $('lock-title').textContent = title;
    $('lock-body').textContent = body;
    $('lock-acts').innerHTML = acts;
    $('lockout').hidden = false;
    const retry = $('lock-retry');
    if (retry) retry.onclick = () => location.reload();
  }

  unlock() {
    this.locked = null;
    $('lockout').hidden = true;
  }

  updateScreen() {
    const url = safeUrl(this.control.updateUrl) || 'https://github.com/theunknownv5-max/36states/releases/latest';
    this.lock('⬆ New version available', 'This version of the app is out of date. Download the new one to keep playing; it has new things you will like.', `<a class="btn primary" href="${esc(url)}" target="_blank" rel="noopener">Download update</a>`, 'update');
  }

  kicked(reason) {
    this.onKicked?.();
    if (this.control.maintenance) return;
    toast(`⚠ ${reason || 'You were removed from the battle.'}`);
  }

  // Ban message comes as an authError at sign in; the auth form shows it.

  // ---------- push notifications ----------
  canPush() {
    if (IS_APP) return HAS_FCM && !!window.Capacitor?.Plugins?.PushNotifications && this.push.fcm;
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!this.push.vapid;
  }

  syncPushSwitch() {
    const sw = $('set-push');
    const note = $('push-note');
    const can = this.canPush();
    sw.disabled = !can;
    sw.checked = can && this.store.get('push') === '1';
    note.textContent = can
      ? sw.checked
        ? 'On. We go tell you about updates, events and gifts, even when the game close.'
        : 'Off. Turn them on so you never miss double XP weekends and gifts.'
      : IS_APP
        ? 'Notifications will work after the next app update.'
        : 'This browser does not support notifications. You will still see news under the 🔔 button.';
  }

  pushState(m) {
    this.push.on = m.on;
    if (m.error) $('push-note').textContent = `Could not turn on: ${m.error}`;
  }

  async togglePush(on, quiet = false) {
    const note = $('push-note');
    if (!on) {
      this.store.set('push', '0');
      this.net.send({ t: 'pushOff' });
      try {
        const reg = await navigator.serviceWorker?.getRegistration('/sw.js');
        await (await reg?.pushManager.getSubscription())?.unsubscribe();
      } catch {
        /* nothing to undo */
      }
      return this.syncPushSwitch();
    }
    if (!this.canPush()) return this.syncPushSwitch();
    try {
      if (IS_APP) await this.subscribeApp();
      else await this.subscribeWeb(quiet);
      this.store.set('push', '1');
      this.syncPushSwitch();
      if (!quiet) toast('🔔 Notifications on');
    } catch (e) {
      this.store.set('push', '0');
      this.syncPushSwitch();
      if (!quiet) note.textContent = e.message || 'Notifications could not be turned on.';
    }
  }

  async subscribeWeb(quiet) {
    if (Notification.permission === 'denied') throw new Error('Notifications are blocked for this site. Allow them in your browser settings first.');
    if (Notification.permission !== 'granted') {
      if (quiet) throw new Error('');
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('You no allow notifications.');
    }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(this.push.vapid) });
    this.net.send({ t: 'pushSub', kind: 'web', sub: sub.toJSON() });
  }

  async subscribeApp() {
    const P = window.Capacitor.Plugins.PushNotifications;
    let perm = await P.checkPermissions();
    if (perm.receive !== 'granted') perm = await P.requestPermissions();
    if (perm.receive !== 'granted') throw new Error('You no allow notifications for this app.');
    if (!this.appListeners) {
      this.appListeners = true;
      await P.createChannel?.({ id: 'pod', name: 'Game news', description: 'Updates, events and gifts', importance: 4 }).catch(() => {});
      P.addListener('registration', (t) => this.net.send({ t: 'pushSub', kind: 'fcm', token: t.value }));
      P.addListener('registrationError', () => ($('push-note').textContent = 'Notifications cannot start on this phone.'));
      P.addListener('pushNotificationReceived', (n) => this.say(`🔔 ${n.title || ''} ${n.body || ''}`, 'info', 6000));
    }
    await P.register();
  }
}
