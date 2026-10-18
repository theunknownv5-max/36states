// While you wait to come back (flying the drone after death, or waiting for the medevac) the
// big option cards step aside: a slim panel shows the countdown, quick buttons to come back,
// and the drone tours this battlefield's billboards, LED screens and floor adverts one by one
// (tap Visit or Chat for the one on screen).
import { api } from '../core/server.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export class WaitAds {
  constructor(game) {
    this.g = game;
    this.shown = false;
    this.adKey = '';
    this.idx = 0;
    $('wa-actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (!b) return;
      if (b.dataset.r === 'options') return this.g.cams.exitDrone();
      this.g.cams.exitDrone();
      this.g.respawn(b.dataset.r);
    });
    $('wa-chat').onclick = () => {
      const ad = this.current;
      if (ad?.chat) this.g.net.send({ t: 'adChatOpen', adId: ad.adId });
    };
  }

  update(now, sNow) {
    const g = this.g;
    const st = g.status;
    const drone = g.cams?.mode === 'drone';
    const waiting = (st === 'dead' && drone) || st === 'medevac';
    // The big death cards only while you are choosing (not while flying the drone).
    // A choice was just made: keep the cards away while the server brings you back.
    const pending = st === 'dead' && now - (g.respawnAt || 0) < 1600;
    if (st === 'dead') $('death').hidden = drone || pending;
    if (st === 'medevac') $('medevac').hidden = true;
    if (waiting !== this.shown) {
      this.shown = waiting;
      $('wait-ads').hidden = !waiting;
      document.body.classList.toggle('waiting', waiting);
      this.adKey = '';
    }
    if (!waiting) return;
    // Countdown.
    const m = g.me || {};
    let secs;
    let title;
    if (st === 'medevac') {
      secs = Math.max(0, Math.ceil((m.medevacAt - sNow) / 1000));
      title = '🚁 Medevac on its way · sponsors';
    } else {
      secs = g.hud.noRespawn ? null : Math.max(0, Math.ceil(60 - (performance.now() - (g.hud.deadSince || performance.now())) / 1000));
      title = g.hud.noRespawn ? '🛸 Watching the round' : '📺 Sponsors on this battlefield';
    }
    const t = secs == null ? 'You join the next round' : st === 'medevac' ? `You land back in <b>${secs}</b>s` : `Medevac comes for you automatically in <b>${secs}</b>s`;
    const key = `${title}|${t}|${st}|${g.hud.noRespawn}|${m.gems}`;
    if (key !== this.key) {
      this.key = key;
      $('wa-title').textContent = title;
      $('wa-time').innerHTML = t;
      const canBack = st === 'dead' && !g.hud.noRespawn;
      const k = (key) => (g.touch ? '' : ` <kbd>${key}</kbd>`);
      $('wa-actions').innerHTML = canBack
        ? `<button data-r="gem" ${m.gems > 0 ? '' : 'disabled'}>💎 Gem now (${m.gems || 0})${k('1')}</button><button data-r="spirit">👻 Spirit run${k('2')}</button><button data-r="medevac">🚁 Medevac${k('3')}</button><button data-r="options" class="ghost">All options${k('T')}</button>`
        : '';
    }
    // The advert the drone is showing right now (the tour), with Visit and Chat.
    const panel = g.cams.tourPanel?.();
    const tour = g.cams.tour;
    $('wait-ads').classList.toggle('touring', !!panel);
    if (panel) {
      const i = g.boards.current(panel, sNow);
      const ad = i >= 0 ? panel.list[i] : null;
      const key = `${panel.id}|${ad?.adId || 'house'}`;
      if (key === this.adKey) return;
      this.adKey = key;
      this.current = ad;
      const card = $('wa-ad');
      card.classList.remove('in');
      void card.offsetWidth;
      card.classList.add('in');
      card.classList.toggle('house', !ad);
      const where = { sky: 'Skyline billboard', led: 'LED screen', ground: 'Ground advert', wall: 'Wall banner' }[panel.type] || 'Billboard';
      $('wa-img').hidden = !ad;
      if (ad) $('wa-img').src = ad.image;
      $('wa-name').textContent = ad ? ad.advertiser || 'Sponsor' : 'Your brand could be here';
      $('wa-sub').textContent = `${where} · ${tour.i + 1} of ${tour.list.length}${ad ? '' : ' · advertise: proofofduty.com/advertise'}`;
      $('wa-link').hidden = ad ? !ad.link : false;
      $('wa-link').href = ad ? (ad.link ? (/^https?:\/\//.test(ad.link) ? ad.link : `https://${ad.link}`) : '#') : api('/advertise');
      $('wa-chat').hidden = !ad?.chat;
      return;
    }
    // Flying it yourself: a small reminder of how to get the tour back.
    if (this.adKey !== 'manual') {
      this.adKey = 'manual';
      this.current = null;
      $('wa-ad').classList.add('house');
      $('wa-img').hidden = true;
      $('wa-name').textContent = tour ? 'You are flying the drone' : 'Drone view';
      $('wa-sub').textContent = tour ? 'Leave the controls for a few seconds and the drone shows you the adverts again.' : 'Watch the battlefield while you wait.';
      $('wa-link').hidden = true;
      $('wa-chat').hidden = true;
    }
  }

  hide() {
    this.shown = false;
    document.body.classList.remove('waiting');
    $('wait-ads').hidden = true;
  }
}
