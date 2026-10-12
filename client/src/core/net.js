// WebSocket link to the game server, with clock sync so every client agrees on
// server time (gem cooldowns, lag-compensated shots, interpolation).
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.offset = 0; // serverTime - localTime
    this.rtt = 80;
    this.samples = [];
    this.online = false;
    this.hello = null;
    this.retries = 0;
  }

  on(type, fn) {
    (this.handlers[type] ||= []).push(fn);
    return () => (this.handlers[type] = this.handlers[type].filter((f) => f !== fn));
  }

  emit(type, msg) {
    for (const fn of this.handlers[type] || []) fn(msg);
  }

  url() {
    const env = import.meta.env || {};
    if (env.VITE_SERVER_URL) {
      const base = env.VITE_SERVER_URL.replace(/\/$/, '');
      return base.endsWith('/ws') ? base : `${base}/ws`;
    }
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  connect(hello) {
    this.hello = hello;
    this.stopped = false;
    return new Promise((resolve) => {
      let ws;
      try {
        ws = new WebSocket(this.url());
      } catch {
        this.emit('status', false);
        resolve(false);
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this.online = true;
        this.retries = 0;
        this.send({ t: 'hello', ...this.hello });
        this.emit('status', true);
        this.startPing();
        resolve(true);
      };
      ws.onclose = () => {
        const was = this.online;
        this.online = false;
        clearInterval(this.pingTimer);
        this.emit('status', false);
        if (!was) resolve(false);
        if (this.stopped) return;
        this.retries++;
        setTimeout(() => this.reconnect(), Math.min(8000, 800 * this.retries));
      };
      ws.onerror = () => {};
      ws.onmessage = (e) => {
        let msg;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.t === 'pong') return this.onPong(msg);
        if (msg.t === 'welcome') this.token = msg.token;
        if (msg.t === 'authError') this.stopped = true;
        if (msg.serverTime && !this.samples.length) this.offset = msg.serverTime - Date.now();
        this.emit(msg.t, msg);
      };
    });
  }

  reconnect() {
    // Come back as the same profile: accounts log in again, guests reuse their token.
    const hello = this.hello?.mode ? this.hello : { name: this.hello?.name, token: this.token || this.hello?.token };
    this.emit('reconnecting', this.retries);
    this.connect(hello);
  }

  close() {
    this.stopped = true;
    this.ws?.close();
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  startPing() {
    clearInterval(this.pingTimer);
    const ping = () => this.send({ t: 'ping', c: Date.now() });
    ping();
    setTimeout(ping, 300);
    setTimeout(ping, 700);
    this.pingTimer = setInterval(ping, 2000);
  }

  onPong(m) {
    const now = Date.now();
    const rtt = now - m.c;
    this.samples.push({ rtt, off: m.s - (m.c + rtt / 2) });
    if (this.samples.length > 9) this.samples.shift();
    // Trust the fastest round trips most.
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, 4);
    this.offset = best.reduce((s, x) => s + x.off, 0) / best.length;
    this.rtt = this.samples.reduce((s, x) => s + x.rtt, 0) / this.samples.length;
    this.emit('ping', Math.round(this.rtt));
  }

  serverNow() {
    return Date.now() + this.offset;
  }
}
