// Heads-up display: score and sites, radar, vitals, ammo, killfeed, hit markers,
// damage arcs, world labels, the death/spirit/medevac screens, buy menu,
// scoreboard and match end.
import * as THREE from 'three';
import { WEAPONS, GEAR, FACTIONS, SIDES, priceFor, RESPAWN, KILLSTREAKS } from '../../../shared/config.js';
import { STATE_BY_ID } from '../../../shared/states.js';
import { AMBULANCE } from '../../../shared/vehicles.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => '₦' + Math.round(n).toLocaleString();
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const WNAME = (w) => ({ artillery: 'Artillery', frag: 'Grenade', bleed: 'Blood finish', drum: 'Fuel drum', fire: 'Burned', bomb: 'Bomb', c4: 'C4', vehicle: 'Run over', fist: 'Punch', knife: 'Machete', croc: '🐊 Crocodile', dog: '🐕 Guard dog', drown: '🌊 Drowned', tank: 'Fuel tank blast', crush: 'Crushed by a lorry' })[w] || WEAPONS[w]?.name || w || '';

export class Hud {
  constructor() {
    this.radar = $('radar').getContext('2d');
    this.labels = $('labels');
    this.labelPool = [];
    this.v = new THREE.Vector3();
    this.lastToast = '';
    this.nadeSel = 'frag';
  }

  setMatch(stateId, side, faction) {
    const s = STATE_BY_ID[stateId];
    $('state-tag').textContent = `${s.name.toUpperCase()} · ${SIDES[side].label} · ${FACTIONS[faction].label}`;
    $('killfeed').innerHTML = '';
    $('chat-log').innerHTML = '';
  }

  score(score, sites, msLeft) {
    $('sc-sec').textContent = score.sec;
    $('sc-out').textContent = score.out;
    if (msLeft !== undefined) {
      const s = Math.max(0, Math.ceil(msLeft / 1000));
      $('timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    if (sites) {
      $('sites').innerHTML = sites
        .map((x) => {
          const k = Math.abs(x.progress);
          const col = x.progress > 0 ? 'var(--sec)' : 'var(--out)';
          return `<div class="s ${x.owner || ''} ${x.contested ? 'contested' : ''} ${x.id === 'D' ? 'D' : ''}" title="${esc(x.label)}">${x.id === 'D' ? '◆' : x.id}${x.owner ? '' : `<i style="width:${(k * 100).toFixed(0)}%;background:${col}"></i>`}</div>`;
        })
        .join('');
    }
  }

  me(m, local) {
    $('hp').textContent = Math.max(0, Math.round(m.health));
    $('ap').textContent = Math.round(m.armor) + (m.helmet ? '+' : '');
    $('hp-bar').style.width = `${Math.max(0, m.health)}%`;
    $('hp-bar').style.background = m.health < 30 ? 'var(--bad)' : 'var(--good)';
    $('money').textContent = fmt(m.money);
    $('gems').textContent = m.gems;
    const id = m.weapons[m.slot];
    const w = WEAPONS[id];
    $('weapon-name').textContent = w?.name || '';
    const a = local?.ammo ?? m.ammo[id];
    if (w?.melee) {
      $('mag').textContent = '—';
      $('reserve').textContent = '';
    } else if (a) {
      $('mag').textContent = a.mag;
      $('reserve').textContent = a.reserve;
      $('mag').style.color = a.mag === 0 ? 'var(--bad)' : '';
    }
    this.nades(m);
    const st = [];
    if (m.streaksAvail?.uav) st.push(`<span>5 · ${KILLSTREAKS.uav.name}</span>`);
    if (m.streaksAvail?.artillery) st.push(`<span>6 · ${KILLSTREAKS.artillery.name}</span>`);
    $('streaks').innerHTML = st.join('');
    $('vignette').style.opacity = m.status === 'alive' ? Math.max(0, (45 - m.health) / 45) * 0.9 : 0;
  }

  nades(m) {
    const list = [];
    for (const k of ['frag', 'smoke', 'flash']) if (m[k] > 0) list.push(`<span class="${this.nadeSel === k ? 'sel' : ''}">${{ frag: '💣', smoke: '☁', flash: '✦' }[k]} ${m[k]}</span>`);
    if (m.medkit > 0) list.push(`<span>✚ ${m.medkit} (X)</span>`);
    if (m.bloodpill > 0) list.push(`<span>💊 ${m.bloodpill} (N)</span>`);
    if (m.c4 > 0) list.push(`<span>🧨 ${m.c4} (P)</span>`);
    if (this.c4Planted > 0) list.push(`<span class="sel">💥 Blow ${this.c4Planted} (L)</span>`);
    if (m.status === 'alive' && m.health <= 70 && Date.now() >= (m.ambReady || 0) && m.money >= AMBULANCE.fee && m.veh == null) list.push(`<span>🚑 ₦${(AMBULANCE.fee / 1000).toFixed(1)}k (K)</span>`);
    $('nades').innerHTML = list.join('');
  }

  stamina(k) {
    $('stam-bar').style.width = `${(k * 100).toFixed(0)}%`;
    $('stam-bar').style.opacity = k < 0.99 ? 1 : 0;
  }

  kill(m, myId) {
    const d = document.createElement('div');
    d.className = 'k' + (m.killer === myId || m.victim === myId ? ' me' : '');
    const killer = m.kn ? `<span class="${m.ks}">${esc(m.kn)}</span>` : '';
    d.innerHTML = `${killer}<span class="w">${esc(WNAME(m.w))}${m.head ? ' ⌖' : ''}</span><span class="${m.vs}">${esc(m.vn)}</span>`;
    $('killfeed').prepend(d);
    while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
    setTimeout(() => d.remove(), 7000);
  }

  toast(text, kind = 'info', ms = 3500) {
    const box = $('toasts');
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), ms);
  }

  banner(text, ms = 3500) {
    const b = $('banner');
    b.textContent = text;
    b.hidden = false;
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => (b.hidden = true), ms);
  }

  hitmarker(head, kill) {
    const h = $('hitmarker');
    h.style.color = kill ? '#ff3b3b' : head ? '#ffd23f' : '#fff';
    h.style.transition = 'none';
    h.style.opacity = 1;
    h.style.transform = `translate(-50%,-50%) rotate(45deg) scale(${kill ? 1.4 : 1})`;
    requestAnimationFrame(() => {
      h.style.transition = 'opacity 0.35s, transform 0.35s';
      h.style.opacity = 0;
    });
  }

  damageFrom(angle) {
    const d = document.createElement('div');
    d.className = 'arc';
    d.style.transform = `rotate(${angle}rad)`;
    $('damage-arcs').appendChild(d);
    requestAnimationFrame(() => requestAnimationFrame(() => (d.style.opacity = 0)));
    setTimeout(() => d.remove(), 1100);
  }

  crosshair(gapPx, show, colour = '#fff') {
    const c = $('crosshair');
    c.style.display = show ? '' : 'none';
    c.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
    for (const i of c.children) i.style.background = colour;
  }

  flash(strength) {
    const f = $('flash');
    f.style.transition = 'none';
    f.style.opacity = Math.min(1, strength * 1.2);
    requestAnimationFrame(() => {
      f.style.transition = `opacity ${1 + strength * 3.5}s ease-in`;
      f.style.opacity = 0;
    });
  }

  scope(on) {
    $('scope').hidden = !on;
  }

  prompt(text) {
    const p = $('prompt');
    if (!text) p.hidden = true;
    else {
      p.hidden = false;
      p.innerHTML = text;
    }
  }

  progress(k, text) {
    const p = $('progress');
    if (k === null) {
      p.hidden = true;
      return;
    }
    p.hidden = false;
    p.firstElementChild.style.width = `${(k * 100).toFixed(0)}%`;
    p.lastElementChild.textContent = text;
  }

  net(rtt, online) {
    $('net').textContent = online ? `${rtt} ms` : 'reconnecting…';
    $('net').style.color = !online || rtt > 180 ? 'var(--bad)' : '';
  }

  // ---------- radar ----------
  drawRadar({ me, yaw, players, sites, walls, gemsReady, uav, myId, mySide, range = 60 }) {
    const c = this.radar;
    const S = 200;
    const R = S / 2;
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(10,16,20,0.6)';
    c.fillRect(0, 0, S, S);
    c.translate(R, R);
    c.rotate(yaw);
    const k = (R - 6) / range;
    const P = (x, z) => [(x - me.x) * k, (z - me.z) * k];
    c.strokeStyle = 'rgba(255,255,255,0.07)';
    for (let r = 20; r < range; r += 20) {
      c.beginPath();
      c.arc(0, 0, r * k, 0, Math.PI * 2);
      c.stroke();
    }
    for (const s of sites) {
      const [x, y] = P(s.x, s.z);
      c.fillStyle = s.owner === 'sec' ? 'rgba(79,157,255,0.35)' : s.owner === 'out' ? 'rgba(255,90,79,0.35)' : s.id === 'D' ? 'rgba(255,193,59,0.35)' : 'rgba(255,255,255,0.15)';
      c.beginPath();
      c.arc(x, y, s.r * k, 0, Math.PI * 2);
      c.fill();
      c.save();
      c.translate(x, y);
      c.rotate(-yaw);
      c.fillStyle = '#fff';
      c.font = '700 13px Rajdhani';
      c.textAlign = 'center';
      c.fillText(s.id === 'D' ? '◆' : s.id, 0, 5);
      c.restore();
    }
    walls.forEach((w, i) => {
      const [x, y] = P(w.gem.x, w.gem.z);
      c.fillStyle = gemsReady[i] ? '#3fe0ff' : 'rgba(63,224,255,0.25)';
      c.fillRect(x - 2.5, y - 2.5, 5, 5);
    });
    for (const p of players) {
      if (p.id === myId) continue;
      const mate = p.side === mySide;
      const seen = mate || p.flags & 512 || (p.flags & 8 && Math.hypot(p.x - me.x, p.z - me.z) < 70);
      if (!seen || p.flags & 256) continue;
      const [x, y] = P(p.x, p.z);
      c.fillStyle = mate ? (p.flags & 2 ? '#ffb02a' : '#4f9dff') : '#ff4a3a';
      c.beginPath();
      c.arc(x, y, mate ? 4 : 4.5, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    // Me: arrow pointing up.
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(R, R - 7);
    c.lineTo(R + 5, R + 5);
    c.lineTo(R, R + 2);
    c.lineTo(R - 5, R + 5);
    c.fill();
    if (uav) {
      c.strokeStyle = '#ffcf4a';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(R, R, R - 3, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 1;
    }
  }

  // ---------- world-space labels (names, sites, gems) ----------
  worldLabels(camera, items) {
    const W = innerWidth;
    const H = innerHeight;
    let n = 0;
    for (const it of items) {
      this.v.set(it.x, it.y, it.z).project(camera);
      if (this.v.z > 1 || this.v.z < -1) continue;
      let sx = (this.v.x * 0.5 + 0.5) * W;
      let sy = (-this.v.y * 0.5 + 0.5) * H;
      if (!it.clamp && (sx < -50 || sx > W + 50 || sy < -50 || sy > H + 50)) continue;
      if (it.clamp) {
        sx = Math.max(30, Math.min(W - 30, sx));
        sy = Math.max(118, Math.min(H - 90, sy));
      }
      let el = this.labelPool[n];
      if (!el) {
        el = document.createElement('div');
        this.labels.appendChild(el);
        this.labelPool.push(el);
      }
      el.className = it.cls;
      if (el._html !== it.html) {
        el.innerHTML = it.html;
        el._html = it.html;
      }
      el.style.left = `${sx.toFixed(0)}px`;
      el.style.top = `${sy.toFixed(0)}px`;
      el.style.display = '';
      el.style.opacity = it.opacity ?? 1;
      n++;
    }
    for (let i = n; i < this.labelPool.length; i++) this.labelPool[i].style.display = 'none';
  }

  // ---------- death and respawn ----------
  showState(status, m, info = {}) {
    $('downed').hidden = status !== 'downed';
    $('death').hidden = status !== 'dead';
    $('spirit').hidden = status !== 'spirit';
    $('medevac').hidden = status !== 'medevac';
    if (status === 'dead') {
      $('opt-gems').textContent = m.gems;
      $('opt-gem').disabled = m.gems < RESPAWN.gemCost;
      $('death-by').innerHTML = info.killer ? `<b>${esc(info.killer)}</b> killed you · ${esc(WNAME(info.weapon))}${info.head ? ' (headshot)' : ''}` : 'You were killed';
      // Modes without respawn (Plant & Defuse) wait for the next round instead.
      $('death-options').hidden = !!this.noRespawn;
      $('death-wait').hidden = !this.noRespawn;
      $('death').querySelector('h2').textContent = this.noRespawn ? 'YOU ARE OUT THIS ROUND' : 'BACK TO THE FRONT LINE';
    }
  }

  timers(status, m, serverNow) {
    if (status === 'downed') $('downed-t').textContent = Math.max(0, Math.ceil((m.downedAt + RESPAWN.downedMs - serverNow) / 1000));
    if (status === 'spirit') $('spirit-t').textContent = Math.max(0, Math.ceil((m.spiritUntil - serverNow) / 1000));
    if (status === 'medevac') $('medevac-t').textContent = Math.max(0, Math.ceil((m.medevacAt - serverNow) / 1000));
    if (status === 'dead' && this.deadSince) $('death-auto').textContent = this.noRespawn ? '' : `Medevac comes for you automatically in ${Math.max(0, Math.ceil(60 - (performance.now() - this.deadSince) / 1000))} s.`;
  }

  // ---------- buy menu ----------
  renderBuy(m, inZone, onBuy) {
    $('buy-money').textContent = fmt(m.money);
    $('buy-where').textContent = inZone ? 'You can buy here' : 'Go back to your base (or buy as you just land)';
    const grid = $('buy-grid');
    grid.innerHTML = '';
    const groups = [
      ['Pistols', ['hawk']],
      ['SMGs & shotguns', ['mp5', 'danegun']],
      ['Rifles', ['ak47', 'g3', 'svd']],
      ['Heavy', ['pkm', 'rpg']],
      ['Two hands (rank unlock)', ['dualp9', 'dualmp5']],
      ['Gear', ['vest', 'helmet', 'medkit', 'bloodpill']],
      ['Grenades & explosives', ['frag', 'smoke', 'flash', 'c4']]
    ];
    let key = 1;
    for (const [title, items] of groups) {
      const h = document.createElement('h4');
      h.textContent = title;
      grid.appendChild(h);
      for (const id of items) {
        const w = WEAPONS[id];
        const g = GEAR[id];
        const base = w?.price ?? g?.price;
        const price = priceFor(id, m.faction);
        const b = document.createElement('button');
        b.className = 'item';
        const locked = w?.unlockLevel && (m.level || 1) < w.unlockLevel;
        b.disabled = !inZone || m.money < price || m.status !== 'alive' || locked;
        const stats = locked ? `🔒 Opens at rank level ${w.unlockLevel}` : w ? `${w.dmg}${w.pellets ? '×' + w.pellets : ''} dmg · ${w.mag} rds · ${w.rpm} rpm` : id === 'bloodpill' ? `+${g.heal} health over ${g.secs}s, keep moving` : id === 'c4' ? 'Stick on a wall or vehicle (P), detonate (L)' : g.name;
        b.innerHTML = `<kbd>${key <= 9 ? key : ''}</kbd><b>${w?.name || g.name}</b><span class="price">${price === 0 ? 'FREE' : fmt(price)}</span>${price < base ? `<span class="old">${fmt(base)}</span>` : ''}<small>${stats}</small>`;
        b.onclick = () => onBuy(id);
        b.dataset.item = id;
        b.dataset.key = key++;
        grid.appendChild(b);
      }
    }
  }

  // ---------- scoreboard ----------
  scoreboard(roster, myId, score) {
    $('sb-sec').textContent = score.sec;
    $('sb-out').textContent = score.out;
    for (const side of ['sec', 'out']) {
      const rows = roster
        .filter((r) => r.side === side)
        .sort((a, b) => b.points - a.points)
        .map((r) => `<tr class="${r.id === myId ? 'me' : ''} ${r.bot ? 'bot' : ''}"><td>${esc(r.name)}</td><td>${FACTIONS[r.faction]?.label || ''}</td><td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists}</td><td>${r.points}</td></tr>`)
        .join('');
      $(`sb-${side}-t`).innerHTML = `<tr><th>Name</th><th>Unit</th><th>K</th><th>D</th><th>A</th><th>Pts</th></tr>${rows}`;
    }
  }

  // End of match: result, your stats, and (for campaign stages) what next.
  matchEnd(m, mySide, myId, actions = []) {
    $('matchend').hidden = false;
    const stage = m.mode === 'stage';
    const won = m.winner === mySide;
    $('me-title').textContent = stage ? (won ? 'STAGE CLEAR!' : 'STAGE FAIL') : !m.winner ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
    $('me-title').style.color = !m.winner && !stage ? '#fff' : won ? 'var(--good)' : 'var(--bad)';
    $('me-sub').textContent = stage ? m.modeState?.title || '' : won ? 'Your unit has proven its duty!' : m.winner ? 'The enemy took this one. Regroup and hit back.' : 'Nobody won. The next one decides it.';
    $('me-debrief').hidden = true;
    $('me-debrief').innerHTML = '';
    $('me-score').innerHTML = stage ? '' : `<span style="color:var(--sec)">${m.score.sec}</span> — <span style="color:var(--out)">${m.score.out}</span>`;
    const me = m.roster.find((r) => r.id === myId);
    $('me-stats').innerHTML = me
      ? [
          ['Kills', me.kills],
          ['Deaths', me.deaths],
          ['Assists', me.assists],
          ['Headshots', me.hs || 0],
          ['Accuracy', `${me.acc || 0}%`],
          ['Points', me.points]
        ]
          .map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`)
          .join('')
      : '';
    $('me-mvp').textContent = m.mvp ? `MVP: ${m.mvp}` : '';
    const box = $('me-actions');
    box.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = `btn ${a.primary ? 'primary' : ''}`;
      b.textContent = a.label;
      b.onclick = a.run;
      box.appendChild(b);
    }
    this.endNoAuto = stage;
    const until = performance.now() + m.next;
    clearInterval(this.endT);
    this.endT = setInterval(() => {
      const s = Math.max(0, Math.ceil((until - performance.now()) / 1000));
      $('me-next').textContent = this.endNoAuto ? '' : `Rest and refit · the next battle here starts in ${s}s`;
      if (s <= 0) clearInterval(this.endT);
    }, 250);
  }

  // Big centre callout: headshots, multi-kills, round results.
  callout(text) {
    const c = $('callout');
    c.textContent = text;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
  }

  modebar(html) {
    const b = $('modebar');
    if (!html) {
      b.hidden = true;
      return;
    }
    b.hidden = false;
    if (b._html !== html) {
      b.innerHTML = html;
      b._html = html;
    }
  }

  // Your personal debrief: medals, what you earned, the Tour of Duty and new orders from HQ.
  debrief(d, { deploy, map } = {}) {
    const box = $('me-debrief');
    const c = d.chapter;
    const pct = Math.min(100, Math.round((c.merit / c.need) * 100));
    const medals = d.medals.length
      ? `<div class="db-medals">${d.medals.map((x) => `<span class="db-medal" title="${esc(x.why)}">🎖 ${esc(x.medal)}</span>`).join('')}</div>`
      : d.allMedals.length
        ? `<div class="db-others">${d.allMedals.map((x) => `🎖 ${esc(x.medal)}: ${esc(x.name)}`).join(' · ')}</div>`
        : '';
    const earned = [d.gems ? `+${d.gems} 💎` : '', d.xp ? `+${d.xp} XP` : ''].filter(Boolean).join('  ');
    const done = d.finished
      ? `<div class="db-done">CHAPTER COMPLETE: ${esc(d.finished.title.toUpperCase())}<small>New title unlocked: ${esc(d.finished.rank)}</small></div>`
      : '';
    const o = d.orders;
    box.innerHTML = `${medals}${earned ? `<div class="db-earned">${earned}</div>` : ''}${done}
      <div class="db-tour">
        <div class="db-tour-h"><b>TOUR OF DUTY · CHAPTER ${c.n}/${c.of}</b><span>${esc(c.title)}</span></div>
        <div class="db-bar"><i style="width:${pct}%"></i></div>
        <div class="db-tour-f">Merit ${c.merit}/${c.need} · a win gives 3, a loss 1 · ${c.wins} wins in ${c.battles} battles</div>
        <p>${esc(c.story)}</p>
      </div>
      ${o ? `<div class="db-orders"><b>NEW ORDERS FROM HQ</b><p>${esc(o.brief)}</p><div class="me-actions"></div></div>` : ''}`;
    if (o) {
      const row = box.querySelector('.db-orders .me-actions');
      const add = (label, primary, run) => {
        const b = document.createElement('button');
        b.className = `btn ${primary ? 'primary' : ''}`;
        b.textContent = label;
        b.onclick = run;
        row.appendChild(b);
      };
      add(`Deploy to ${o.name}`, true, () => deploy?.(o));
      add('Stay and fight here', false, () => {
        row.innerHTML = '<span class="muted">Staying. Rest up, the next battle here starts soon.</span>';
      });
      add('Back to the map', false, () => map?.());
    }
    box.hidden = false;
  }

  // Real players in this battle right now (you included).
  liveCount(n) {
    const el = $('live-count');
    if (!el || n === undefined) return;
    el.hidden = false;
    el.textContent = `👥 ${n} real`;
    el.title = `${n} real ${n === 1 ? 'player' : 'players'} in this battle`;
  }

  hideMatchEnd() {
    $('matchend').hidden = true;
    clearInterval(this.endT);
  }

  chat(m) {
    const d = document.createElement('div');
    if (m.team) d.className = 'team';
    d.innerHTML = `<b style="color:${m.side === 'sec' ? '#8cbcff' : '#ff9a92'}">${m.team ? '[TEAM] ' : ''}${esc(m.name)}:</b> ${esc(m.text)}`;
    $('chat-log').appendChild(d);
    while ($('chat-log').children.length > 7) $('chat-log').firstChild.remove();
    setTimeout(() => (d.style.opacity = 0.35), 12000);
  }
}
