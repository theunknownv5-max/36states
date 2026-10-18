// In battle: aim at an advert (or point the drone at one) and press J / tap 💬 to chat with
// that business. While you chat, the server keeps you safe: nobody can hurt you, bots ignore
// you, and you can't shoot or move (moving away ends the chat). In a solo campaign stage the
// whole battle pauses.
import * as THREE from 'three';
import { chatPanel } from './ui/chat.js';
import { isTouch } from './core/input.js';

const $ = (id) => document.getElementById(id);
const RANGE = { wall: 16, led: 40, ground: 45, sky: 280 };

export class AdChat {
  constructor(game) {
    this.g = game;
    this.ray = new THREE.Raycaster();
    this.center = new THREE.Vector2(0, 0);
    this.target = null;
    this.open = false;
    this.t = 0;
    const net = game.net;
    net.on('adChat', (m) => this.onOpened(m));
    net.on('chatEnded', (m) => {
      if (!this.open) return;
      const why = { moved: 'You moved away, so the chat closed. It is still in your Inbox.', time: 'Chat time is up. Continue in your Inbox after the battle.' }[m.reason];
      this.close(true);
      if (why) game.hud?.toast(why, 'info', 2600);
    });
  }

  reset() {
    this.target = null;
    this.open = false;
    $('ad-prompt').hidden = true;
    $('chatting-badge').hidden = true;
  }

  // Which advert (with a business behind it) is under the crosshair or drone reticle.
  update(dt) {
    this.t += dt;
    if (this.t < 0.2) return;
    this.t = 0;
    const g = this.g;
    const boards = g.boards;
    let found = null;
    const can = !this.open && !g.anyMenu() && (g.status === 'alive' || g.cams?.mode === 'drone');
    if (can && boards?.pickables?.length) {
      this.ray.setFromCamera(this.center, g.camera);
      const hits = this.ray.intersectObjects(boards.pickables, false);
      for (const h of hits) {
        const p = boards.panels.get(h.object.userData.boardId);
        if (!p) continue;
        const max = g.cams?.mode === 'drone' ? 260 : RANGE[p.type] || 30;
        if (h.distance > max) break;
        const idx = boards.current(p, g.net.serverNow());
        const ad = idx >= 0 ? p.list[idx] : null;
        if (ad?.chat) found = { ad, panel: p };
        break;
      }
    }
    const key = found ? found.ad.adId : '';
    if (key !== this.key) {
      this.key = key;
      this.target = found;
      const el = $('ad-prompt');
      el.hidden = !found;
      if (found) el.innerHTML = `${isTouch() ? '💬' : '<kbd>J</kbd>'} Chat with <b>${escapeHtml(found.ad.advertiser)}</b>`;
    }
  }

  openTarget() {
    if (this.open) return;
    if (!this.target) {
      if (this.g.cams?.mode === 'drone') this.g.hud.toast('Point the drone reticle at an advert that has chat', 'info', 1600);
      return;
    }
    this.g.net.send({ t: 'adChatOpen', adId: this.target.ad.adId });
  }

  onOpened(m) {
    const g = this.g;
    if (!m.ok) return g.hud?.toast(m.reason || 'Chat cannot open right now', 'bad', 2400);
    this.open = true;
    this.adId = m.ad.id;
    if (!isTouch()) g.input.unlock();
    g.touchKey = null;
    $('ad-prompt').hidden = true;
    $('chatting-badge').hidden = g.status !== 'alive';
    const safe = g.status !== 'alive' ? '' : m.paused ? '⏸ Game paused while you chat.' : '🛡 You are safe while you chat: nobody can shoot you. If you move, the chat closes.';
    chatPanel.show({
      id: m.thread?.id,
      business: m.ad.business,
      image: m.ad.image,
      link: m.ad.link,
      safe,
      msgs: m.thread?.msgs || [],
      onSend: (text) => g.net.send({ t: 'adMsg', adId: this.adId, text }),
      onClose: () => this.close()
    });
  }

  close(silent) {
    if (!this.open) return;
    this.open = false;
    $('chatting-badge').hidden = true;
    chatPanel.close(true);
    if (!silent) this.g.net.send({ t: 'adChatClose' });
    else this.g.net.send({ t: 'adChatClose' });
    this.g.touchKey = null;
    if (!isTouch() && this.g.running && this.g.status === 'alive' && !this.g.anyMenu()) this.g.input.lock();
  }

  onHurt() {}
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
