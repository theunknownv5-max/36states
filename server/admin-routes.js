// Super admin API (everything under /api/admin/ apart from the ad routes kept in index.js).
// Roles: super (everything), moderator (players, battles, chat, reports), marketing
// (notifications, announcements, ads). Every change is written to the audit log.
import { pidOf, lagosDay } from './control.js';
import { rankFor, GAME } from '../shared/config.js';
import { STATE_BY_ID } from '../shared/states.js';

const CAN = {
  super: () => true,
  moderator: (area) => ['players', 'battles', 'moderation', 'dashboard', 'read'].includes(area),
  marketing: (area) => ['notify', 'ads', 'dashboard', 'read'].includes(area)
};

export function adminRoutes(ctx) {
  const { control, store, matches, tokenConns, push, inbox, social, json, readBody, profilePublic } = ctx;
  const profiles = () => store.data.profiles;
  const byPid = () => {
    const m = new Map();
    for (const p of Object.values(profiles())) m.set(pidOf(p.token), p);
    return m;
  };
  const online = (token) => (tokenConns.get(token)?.size || 0) > 0;
  const liveMatchOf = (token) => {
    for (const c of tokenConns.get(token) || []) if (c.match && c.player) return { key: c.match.key, state: c.match.stateId, mode: c.match.modeId };
    return null;
  };
  const sendTo = (token, msg) => {
    for (const c of tokenConns.get(token) || []) if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  };
  const everyone = (msg) => {
    for (const set of tokenConns.values()) for (const c of set) if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg));
  };
  const playerRow = (p) => ({
    pid: pidOf(p.token),
    name: p.name,
    account: !!p.account,
    xp: p.xp || 0,
    rank: rankFor(p.xp || 0).name,
    level: rankFor(p.xp || 0).level,
    gems: p.gems || 0,
    kills: p.kills || 0,
    deaths: p.deaths || 0,
    wins: p.wins || 0,
    matches: p.matches || 0,
    created: p.created || 0,
    lastSeen: p.lastSeen || 0,
    online: online(p.token),
    banned: !!control.banInfo(p),
    muted: !!control.muted(p),
    crew: social.tagOf(p)
  });

  return async function handle(req, res, route, who) {
    const area = (a) => {
      if (!CAN[who.role]?.(a)) {
        json(res, 403, { error: `Your role (${who.role}) can't do this.` });
        return false;
      }
      return true;
    };
    const m = req.method;
    const body = m === 'GET' ? {} : await readBody(req, 10 * 1024 * 1024);

    // ---------- dashboard ----------
    if (route === 'me' && m === 'GET') return json(res, 200, { name: who.name, role: who.role }), true;
    if (route === 'dashboard' && m === 'GET') {
      let on = 0;
      for (const s of tokenConns.values()) if (s.size) on++;
      const live = [...matches.values()].filter((x) => x.humans().length).length;
      return json(res, 200, { ...control.dashboard(profiles(), on), liveBattles: live, push: push.count(), game: GAME, fcm: push.fcmReady() }), true;
    }

    // ---------- players ----------
    if (route === 'players' && m === 'GET') {
      if (!area('players')) return true;
      const url = new URL(req.url, 'http://x');
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const filter = url.searchParams.get('filter') || '';
      const sort = url.searchParams.get('sort') || 'lastSeen';
      let list = Object.values(profiles()).map(playerRow);
      if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.pid.startsWith(q));
      if (filter === 'online') list = list.filter((p) => p.online);
      if (filter === 'banned') list = list.filter((p) => p.banned);
      if (filter === 'muted') list = list.filter((p) => p.muted);
      if (filter === 'accounts') list = list.filter((p) => p.account);
      list.sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
      return json(res, 200, { total: list.length, players: list.slice(0, 200) }), true;
    }
    let mm = /^players\/([a-f0-9]{12})(?:\/([a-z]+))?$/.exec(route);
    if (mm) {
      if (!area('players')) return true;
      const p = byPid().get(mm[1]);
      if (!p) return json(res, 404, { error: 'Player not found' }), true;
      const action = mm[2];
      if (!action && m === 'GET') {
        const threads = inbox.forPlayer(p.token).length;
        return json(res, 200, { ...playerRow(p), ban: control.banInfo(p), mutedUntil: p.mutedUntil || 0, profile: profilePublic(p), live: liveMatchOf(p.token), friends: (p.friends || []).length, rivals: Object.keys(p.rivals || {}).length, threads, pushDevices: (push.store.data.subs[p.token] || []).length, daily: p.daily?.streak || 0, chat: control.chat.filter((c) => c.pid === mm[1]).slice(-20) }), true;
      }
      if (m !== 'POST') return false;
      const kick = (reason) => {
        for (const c of tokenConns.get(p.token) || []) {
          if (c.match && c.player) c.match.removePlayer(c.player.id);
          c.match = c.player = null;
          c.ws.send(JSON.stringify({ t: 'kicked', reason }));
        }
      };
      if (action === 'ban') {
        const hours = Number(body.hours) || 0;
        p.ban = { reason: String(body.reason || 'Rules broken').slice(0, 200), at: Date.now(), until: hours > 0 ? Date.now() + hours * 3600000 : 0, by: who.name };
        kick(`You don collect ban: ${p.ban.reason}`);
        for (const c of tokenConns.get(p.token) || []) c.ws.close();
      } else if (action === 'unban') p.ban = null;
      else if (action === 'mute') p.mutedUntil = Date.now() + (Number(body.hours) || 24) * 3600000;
      else if (action === 'unmute') p.mutedUntil = 0;
      else if (action === 'kick') kick(String(body.reason || 'Admin remove you from the battle.'));
      else if (action === 'grant') {
        if (!area('economy')) return true;
        const gems = Math.round(Number(body.gems) || 0);
        const xp = Math.round(Number(body.xp) || 0);
        if (Math.abs(gems) > 1000 || Math.abs(xp) > 1000000) return json(res, 400, { error: 'Too much at once' }), true;
        p.gems = Math.max(0, (p.gems || 0) + gems);
        p.xp = Math.max(0, (p.xp || 0) + xp);
        sendTo(p.token, { t: 'notice', title: '🎁 Gift from the POD team', body: [gems ? `${gems > 0 ? '+' : ''}${gems} 💎` : '', xp ? `${xp > 0 ? '+' : ''}${xp} XP` : ''].filter(Boolean).join(' · ') + (body.note ? ` · ${String(body.note).slice(0, 120)}` : '') });
      } else if (action === 'rename') {
        const name = String(body.name || '').replace(/[^\w .'-]/g, '').trim().slice(0, 18);
        if (name.length < 2) return json(res, 400, { error: 'Name too short' }), true;
        p.name = p.nameLock = name;
        for (const [k, a] of Object.entries(store.data.accounts)) if (a.token === p.token) a.username = name;
      } else if (action === 'reset') {
        if (!area('economy')) return true;
        Object.assign(p, { xp: 0, kills: 0, deaths: 0, wins: 0, matches: 0 });
      } else if (action === 'message') {
        const n = { title: String(body.title || 'Message from the POD team').slice(0, 80), body: String(body.body || '').slice(0, 400) };
        sendTo(p.token, { t: 'notice', ...n });
        if (body.push) await push.send(n, [p.token]);
      } else if (action === 'delete') {
        if (!area('economy')) return true;
        kick('Account removed');
        delete store.data.profiles[p.token];
        for (const [k, a] of Object.entries(store.data.accounts)) if (a.token === p.token) delete store.data.accounts[k];
      } else return json(res, 404, { error: 'Unknown action' }), true;
      ctx.saveProfile();
      control.audit(who, `player ${action}`, `${p.name} (${mm[1]}) ${JSON.stringify(body).slice(0, 160)}`);
      return json(res, 200, { ok: true, player: store.data.profiles[p.token] ? playerRow(p) : null }), true;
    }

    // ---------- live battles ----------
    if (route === 'battles' && m === 'GET') {
      if (!area('battles')) return true;
      const list = [...matches.values()].map((x) => ({
        key: x.key,
        state: x.stateId,
        stateName: STATE_BY_ID[x.stateId]?.name,
        mode: x.modeId,
        real: !!x.opts.noBots,
        score: x.score,
        startedAt: x.startedAt,
        ended: x.ended,
        humans: x.humans().map((p) => ({ id: p.id, pid: pidOf(p.profile.token), name: p.name, side: p.side, kills: p.kills, deaths: p.deaths, status: p.status })),
        bots: x.players.size - x.humans().length
      }));
      return json(res, 200, { battles: list.sort((a, b) => b.humans.length - a.humans.length) }), true;
    }
    mm = /^battles\/([^/]+)\/(end|message|kick)$/.exec(route);
    if (mm && m === 'POST') {
      if (!area('battles')) return true;
      const x = matches.get(decodeURIComponent(mm[1]));
      if (!x) return json(res, 404, { error: 'Battle not found' }), true;
      if (mm[2] === 'end') x.endMatch();
      if (mm[2] === 'message') for (const p of x.humans()) x.toast(p, `📢 ${String(body.text || '').slice(0, 140)}`, 'streak');
      if (mm[2] === 'kick') {
        const p = x.players.get(String(body.id));
        if (p?.human) {
          x.send(p, { t: 'kicked', reason: String(body.reason || 'Admin remove you from the battle.') });
          x.removePlayer(p.id);
          for (const c of tokenConns.get(p.profile.token) || []) if (c.player === p) c.match = c.player = null;
        }
      }
      control.audit(who, `battle ${mm[2]}`, `${mm[1]} ${JSON.stringify(body).slice(0, 120)}`);
      return json(res, 200, { ok: true }), true;
    }

    // ---------- moderation ----------
    if (route === 'chat' && m === 'GET') {
      if (!area('moderation')) return true;
      const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').toLowerCase();
      const list = control.chat.filter((c) => !q || c.text.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)).slice(-300).reverse();
      return json(res, 200, { chat: list }), true;
    }
    if (route === 'reports' && m === 'GET') {
      if (!area('moderation')) return true;
      return json(res, 200, { reports: control.store.data.reports.slice(0, 200) }), true;
    }
    mm = /^reports\/([a-f0-9]+)\/(dismiss|resolve)$/.exec(route);
    if (mm && m === 'POST') {
      if (!area('moderation')) return true;
      const r = control.store.data.reports.find((x) => x.id === mm[1]);
      if (!r) return json(res, 404, { error: 'Report not found' }), true;
      r.status = mm[2] === 'dismiss' ? 'dismissed' : 'resolved';
      r.closedBy = who.name;
      control.save();
      control.audit(who, `report ${mm[2]}`, `${r.target?.name}: ${r.reason}`);
      return json(res, 200, { ok: true }), true;
    }
    if (route === 'conversations' && m === 'GET') {
      if (!area('moderation')) return true;
      const list = Object.values(inbox.threads)
        .sort((a, b) => b.updated - a.updated)
        .slice(0, 200)
        .map((t) => ({ id: t.id, business: t.business, player: t.playerName, board: t.boardCode, msgs: t.msgs.slice(-6), count: t.msgs.length, blocked: t.blocked, updated: t.updated }));
      return json(res, 200, { conversations: list }), true;
    }

    // ---------- notifications, broadcasts, announcements ----------
    if (route === 'notify' && m === 'POST') {
      if (!area('notify')) return true;
      const n = { title: String(body.title || '').slice(0, 80), body: String(body.body || '').slice(0, 400), url: /^https?:\/\/|^\//.test(body.url || '') ? body.url : null };
      if (!n.title || !n.body) return json(res, 400, { error: 'Title and message please' }), true;
      let targets = null;
      const all = Object.values(profiles());
      if (body.target === 'inactive') targets = all.filter((p) => p.lastSeen && Date.now() - p.lastSeen > (Number(body.days) || 3) * 86400000).map((p) => p.token);
      if (body.target === 'player') {
        const p = byPid().get(String(body.pid || ''));
        if (!p) return json(res, 404, { error: 'Player not found' }), true;
        targets = [p.token];
      }
      const result = body.channels?.push === false ? { sent: 0, failed: 0, devices: 0 } : await push.send(n, targets);
      let inApp = 0;
      if (body.channels?.inApp !== false) {
        // Notes to everybody stay in the in-app notification list; targeted ones go only to those players live.
        const notice = targets ? { id: Math.random().toString(36).slice(2, 10), at: Date.now(), ...n } : control.addNotice(n);
        const set = targets ? new Set(targets) : null;
        for (const [token, conns] of tokenConns) {
          if (set && !set.has(token)) continue;
          for (const c of conns)
            if (c.ws.readyState === 1) {
              c.ws.send(JSON.stringify({ t: 'notice', ...notice }));
              inApp++;
            }
        }
      }
      push.store.data.history.unshift({ at: Date.now(), by: who.name, ...n, target: body.target || 'all', ...result, inApp });
      if (push.store.data.history.length > 200) push.store.data.history.length = 200;
      push.store.markDirty();
      control.audit(who, 'notification', `${n.title} → ${body.target || 'all'} (${result.sent} pushed, ${inApp} in app)`);
      return json(res, 200, { ...result, inApp }), true;
    }
    if (route === 'notify' && m === 'GET') {
      if (!area('notify')) return true;
      return json(res, 200, { history: push.store.data.history.slice(0, 100), devices: push.count(), fcm: push.fcmReady(), notices: control.store.data.notices }), true;
    }
    if (route === 'broadcast' && m === 'POST') {
      if (!area('notify')) return true;
      const text = String(body.text || '').slice(0, 160);
      if (!text) return json(res, 400, { error: 'Type the message' }), true;
      everyone({ t: 'broadcast', text, kind: body.kind || 'info' });
      control.audit(who, 'broadcast', text);
      return json(res, 200, { ok: true }), true;
    }
    if (route === 'announcement' && m === 'PUT') {
      if (!area('notify')) return true;
      const a = body.text ? { text: String(body.text).slice(0, 200), kind: body.kind || 'info', url: body.url || null, until: body.hours ? Date.now() + Number(body.hours) * 3600000 : 0 } : null;
      control.store.data.announcement = a;
      control.save();
      everyone({ t: 'control', ...control.publicState() });
      control.audit(who, a ? 'announcement' : 'announcement cleared', a?.text || '');
      return json(res, 200, { announcement: a }), true;
    }

    // ---------- game settings ----------
    if (route === 'config' && m === 'GET') {
      if (!area('read')) return true;
      const d = control.store.data;
      return json(res, 200, { maintenance: d.maintenance, event: d.event, minBuild: d.minBuild, updateUrl: d.updateUrl, tunables: control.tunablesView(), announcement: control.announcement() }), true;
    }
    if (route === 'config' && m === 'PUT') {
      if (!area('config')) return true;
      const d = control.store.data;
      if (body.maintenance) {
        d.maintenance = { on: !!body.maintenance.on, message: String(body.maintenance.message || d.maintenance.message).slice(0, 200) };
        if (d.maintenance.on) {
          // Everyone back to the lobby.
          for (const x of matches.values()) for (const p of x.humans()) x.send(p, { t: 'kicked', reason: d.maintenance.message });
          for (const x of [...matches.values()]) for (const p of x.humans()) x.removePlayer(p.id);
          for (const conns of tokenConns.values()) for (const c of conns) c.match = c.player = null;
          for (const set of tokenConns.values())
            for (const c of set) {
              c.match = c.player = null;
            }
        }
      }
      if ('event' in body) d.event = body.event?.name ? { name: String(body.event.name).slice(0, 40), xpMult: Math.min(5, Math.max(1, Number(body.event.xpMult) || 1)), moneyMult: Math.min(5, Math.max(1, Number(body.event.moneyMult) || 1)), until: body.event.hours ? Date.now() + Number(body.event.hours) * 3600000 : 0 } : null;
      if ('minBuild' in body) d.minBuild = Math.max(0, Math.round(Number(body.minBuild) || 0));
      if ('updateUrl' in body) d.updateUrl = /^https?:\/\//.test(body.updateUrl || '') ? body.updateUrl : '';
      if (body.overrides) control.setOverrides(body.overrides);
      control.save();
      everyone({ t: 'control', ...control.publicState() });
      control.audit(who, 'settings', JSON.stringify(body).slice(0, 280));
      return json(res, 200, { ok: true }), true;
    }

    // ---------- admin team and audit ----------
    if (route === 'team' && m === 'GET') {
      if (!area('team')) return true;
      return json(res, 200, { admins: control.store.data.admins.map(({ keyHash, ...a }) => a), audit: control.store.data.audit.slice(0, 300) }), true;
    }
    if (route === 'team' && m === 'POST') {
      if (!area('team')) return true;
      const a = control.addAdmin(body.name, body.role);
      control.audit(who, 'admin added', `${a.name} (${a.role})`);
      return json(res, 200, { admin: a }), true;
    }
    mm = /^team\/([a-f0-9]+)$/.exec(route);
    if (mm && m === 'DELETE') {
      if (!area('team')) return true;
      control.removeAdmin(mm[1]);
      control.audit(who, 'admin removed', mm[1]);
      return json(res, 200, { ok: true }), true;
    }
    if (route === 'export/players.csv' && m === 'GET') {
      if (!area('players')) return true;
      const rows = [['id', 'name', 'account', 'rank', 'xp', 'gems', 'kills', 'deaths', 'wins', 'matches', 'created', 'lastSeen', 'banned']];
      for (const p of Object.values(profiles()).map(playerRow)) rows.push([p.pid, p.name, p.account, p.rank, p.xp, p.gems, p.kills, p.deaths, p.wins, p.matches, p.created ? new Date(p.created).toISOString() : '', p.lastSeen ? new Date(p.lastSeen).toISOString() : '', p.banned]);
      res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': `attachment; filename="pod-players-${lagosDay()}.csv"` });
      res.end(rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n'));
      return true;
    }
    return false;
  };
}
