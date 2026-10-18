// Real people, real ties: friends (by friend code), crews (with a tag shown before your name in
// battle) and rivals (the real players you keep trading kills with). Stored on the profiles.
import { createHash, randomBytes } from 'node:crypto';

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const clean = (s, n) => String(s || '').replace(/[^\w .'-]/g, '').trim().slice(0, n);

export class Social {
  constructor(store, save, presence) {
    this.store = store; // players.json store: { profiles, accounts, crews, codes }
    this.save = save;
    this.presence = presence; // token -> { online, where } (from the server's live connections)
    const d = store.data;
    d.crews ||= {};
    d.codes ||= {};
  }

  get profiles() {
    return this.store.data.profiles;
  }

  // Short friend code, e.g. POD-7K3QX (stable per profile).
  codeOf(p) {
    if (p.code) return p.code;
    const h = createHash('sha256').update(p.token).digest();
    let code = 'POD-';
    for (let i = 0; i < 5; i++) code += CODE_ALPHABET[h[i] % CODE_ALPHABET.length];
    while (this.store.data.codes[code] && this.store.data.codes[code] !== p.token) code = 'POD-' + Array.from(randomBytes(5), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    p.code = code;
    this.store.data.codes[code] = p.token;
    this.save();
    return code;
  }

  byCode(code) {
    const token = this.store.data.codes[String(code || '').trim().toUpperCase()];
    return token ? this.profiles[token] : null;
  }

  crewOf(p) {
    return p.crew ? this.store.data.crews[p.crew] || null : null;
  }

  tagOf(p) {
    return this.crewOf(p)?.tag || null;
  }

  // ---------- friends ----------
  addFriend(me, code) {
    const other = this.byCode(code);
    if (!other) throw new Error('No soldier has that friend code. Check it and try again.');
    if (other === me) throw new Error('That is your own code 😄');
    me.friends ||= [];
    other.friends ||= [];
    other.requests ||= [];
    me.requests ||= [];
    if (me.friends.includes(other.token)) throw new Error(`${other.name} is already your friend.`);
    // They already asked you: accept straight away.
    if (me.requests.includes(other.token)) return this.accept(me, this.codeOf(other));
    if (!other.requests.includes(me.token)) other.requests.push(me.token);
    this.save();
    return { sent: other.name, to: other.token };
  }

  accept(me, code) {
    const other = this.byCode(code);
    if (!other || !(me.requests || []).includes(other.token)) throw new Error('That request has expired.');
    me.requests = me.requests.filter((t) => t !== other.token);
    me.friends ||= [];
    other.friends ||= [];
    if (!me.friends.includes(other.token)) me.friends.push(other.token);
    if (!other.friends.includes(me.token)) other.friends.push(me.token);
    other.requests = (other.requests || []).filter((t) => t !== me.token);
    this.save();
    return { friend: other.name, to: other.token };
  }

  decline(me, code) {
    const other = this.byCode(code);
    if (other) me.requests = (me.requests || []).filter((t) => t !== other.token);
    this.save();
  }

  removeFriend(me, code) {
    const other = this.byCode(code);
    if (!other) return;
    me.friends = (me.friends || []).filter((t) => t !== other.token);
    other.friends = (other.friends || []).filter((t) => t !== me.token);
    this.save();
  }

  // ---------- crews ----------
  createCrew(me, name, tag) {
    name = clean(name, 24);
    tag = String(tag || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (name.length < 3) throw new Error('Crew name suppose reach 3 letters.');
    if (tag.length < 2) throw new Error('A crew tag is 2 to 4 letters or numbers, like GBG.');
    if (Object.values(this.store.data.crews).some((c) => c.tag === tag)) throw new Error(`Another crew already uses [${tag}].`);
    if (me.crew) this.leaveCrew(me);
    const id = Array.from(randomBytes(5), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    this.store.data.crews[id] = { id, name, tag, owner: me.token, members: [me.token], created: Date.now() };
    me.crew = id;
    this.save();
    return this.store.data.crews[id];
  }

  joinCrew(me, code) {
    const crew = this.store.data.crews[String(code || '').trim().toUpperCase().replace(/^CREW-/, '')];
    if (!crew) throw new Error('No crew get that code.');
    if (crew.members.length >= 30) throw new Error('That crew is full (30 soldiers).');
    if (me.crew === crew.id) throw new Error('You are already in this crew.');
    if (me.crew) this.leaveCrew(me);
    crew.members.push(me.token);
    me.crew = crew.id;
    this.save();
    return crew;
  }

  leaveCrew(me) {
    const crew = this.crewOf(me);
    me.crew = null;
    if (!crew) return;
    crew.members = crew.members.filter((t) => t !== me.token);
    if (!crew.members.length) delete this.store.data.crews[crew.id];
    else if (crew.owner === me.token) crew.owner = crew.members[0];
    this.save();
  }

  // ---------- crew room: chat, the tactics plan, training ----------
  crewChat(me, text) {
    const crew = this.crewOf(me);
    if (!crew) throw new Error('Join or start a crew first.');
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text) throw new Error('Type something first.');
    const t = Date.now();
    me.crewChatTimes = (me.crewChatTimes || []).filter((x) => x > t - 20000);
    if (me.crewChatTimes.length >= 8) throw new Error('Slow down small.');
    me.crewChatTimes.push(t);
    const msg = { at: t, from: me.name, me: me.token, text };
    (crew.chat ||= []).push(msg);
    if (crew.chat.length > 120) crew.chat.splice(0, crew.chat.length - 120);
    this.save();
    return { crew, msg };
  }

  crewPlan(me, text) {
    const crew = this.crewOf(me);
    if (!crew) throw new Error('Join or start a crew first.');
    crew.plan = { text: String(text || '').slice(0, 1200), by: me.name, at: Date.now() };
    this.save();
    return crew;
  }

  // ---------- rivals ----------
  // Called when one real player kills another.
  recordKill(killer, victim) {
    const kr = (killer.rivals ||= {});
    const vr = (victim.rivals ||= {});
    const a = (kr[victim.token] ||= { name: victim.name, theyKilledMe: 0, iKilledThem: 0 });
    const b = (vr[killer.token] ||= { name: killer.name, theyKilledMe: 0, iKilledThem: 0 });
    a.iKilledThem++;
    a.name = victim.name;
    b.theyKilledMe++;
    b.name = killer.name;
    a.at = b.at = Date.now();
    // Keep the 40 most recent rivalries.
    for (const r of [kr, vr]) {
      const keys = Object.keys(r);
      if (keys.length > 40) for (const k of keys.sort((x, y) => r[x].at - r[y].at).slice(0, keys.length - 40)) delete r[k];
    }
    this.save();
    const revenge = a.theyKilledMe >= 2 && a.iKilledThem <= a.theyKilledMe; // you finally got back at them
    return { revenge };
  }

  // Your top rival: the real player who has killed you most (at least twice).
  rivalOf(p) {
    let best = null;
    for (const [token, r] of Object.entries(p.rivals || {})) if (r.theyKilledMe >= 2 && (!best || r.theyKilledMe > best.theyKilledMe)) best = { token, ...r };
    return best;
  }

  // ---------- what the lobby shows ----------
  view(me) {
    const who = (token) => {
      const p = this.profiles[token];
      if (!p) return null;
      const pr = this.presence(token);
      return { code: this.codeOf(p), name: p.name, tag: this.tagOf(p), online: pr.online, where: pr.where };
    };
    const crew = this.crewOf(me);
    return {
      code: this.codeOf(me),
      friends: (me.friends || []).map(who).filter(Boolean),
      requests: (me.requests || []).map(who).filter(Boolean),
      crew: crew
        ? {
            code: `CREW-${crew.id}`,
            name: crew.name,
            tag: crew.tag,
            owner: crew.owner === me.token,
            members: crew.members.map((t) => {
              const w = who(t);
              const sk = this.profiles[t]?.skills;
              return w && { ...w, swim: Math.floor(sk?.swim || 0), fitness: Math.floor(sk?.fitness || 0) };
            }).filter(Boolean),
            chat: (crew.chat || []).slice(-60).map((m) => ({ at: m.at, from: m.from, mine: m.me === me.token, text: m.text })),
            plan: crew.plan || null
          }
        : null,
      skills: { swim: Math.floor(me.skills?.swim || 0), fitness: Math.floor(me.skills?.fitness || 0) },
      rivals: Object.values(me.rivals || {})
        .filter((r) => r.theyKilledMe + r.iKilledThem > 0)
        .sort((a, b) => b.theyKilledMe + b.iKilledThem - (a.theyKilledMe + a.iKilledThem))
        .slice(0, 8)
        .map((r) => ({ name: r.name, theyKilledMe: r.theyKilledMe, iKilledThem: r.iKilledThem }))
    };
  }
}
