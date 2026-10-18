// Chat with the businesses on the billboards: the conversation window (shared by the
// battle and the lobby), the Inbox list, and unread badges.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
const when = (t) => {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export function toast(text, ms = 3500) {
  const t = document.createElement('div');
  t.className = 'pod-toast';
  t.textContent = text;
  Object.assign(t.style, { position: 'fixed', left: '50%', top: '18px', transform: 'translateX(-50%)', zIndex: 200, background: 'rgba(20,14,8,.95)', color: '#fff', border: '1px solid rgba(255,179,71,.5)', padding: '10px 16px', borderRadius: '10px', fontWeight: 700, maxWidth: '90vw' });
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

// The conversation window.
export class ChatPanel {
  constructor() {
    this.el = $('adchat');
    this.onSend = null;
    this.onClose = null;
    $('ac-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('ac-input').value.trim();
      if (!v || !this.onSend) return;
      this.onSend(v);
      $('ac-input').value = '';
    });
    // Keys typed here must not move the soldier or open menus.
    for (const ev of ['keydown', 'keyup']) $('ac-input').addEventListener(ev, (e) => e.stopPropagation());
    $('ac-close').onclick = () => this.close();
    this.el.addEventListener('click', (e) => e.target === this.el && this.close());
  }

  get isOpen() {
    return !this.el.hidden;
  }

  show({ id, business, image, link, safe, msgs, onSend, onClose }) {
    this.id = id || null;
    this.onSend = onSend;
    this.onClose = onClose;
    $('ac-name').textContent = business;
    $('ac-sub').textContent = 'Business on the billboard';
    $('ac-img').src = image || '';
    $('ac-img').hidden = !image;
    $('ac-link').hidden = !link;
    if (link) $('ac-link').href = link;
    $('ac-safe').hidden = !safe;
    $('ac-safe').textContent = safe || '';
    this.setMsgs(msgs || []);
    this.el.hidden = false;
    setTimeout(() => $('ac-input').focus(), 50);
  }

  setMsgs(msgs) {
    const box = $('ac-msgs');
    box.innerHTML = msgs.length
      ? msgs.map((m) => `<div class="m ${m.me ? 'me' : 'biz'}">${m.me ? esc(m.text) : linkify(m.text)}<small>${when(m.at)}</small></div>`).join('')
      : '<div class="empty">Say hello. Ask about price, delivery or whatever you need. The business replies in your Inbox.</div>';
    box.scrollTop = box.scrollHeight;
  }

  close(silent) {
    if (this.el.hidden) return;
    this.el.hidden = true;
    $('ac-input').blur();
    const cb = this.onClose;
    this.onClose = null;
    this.id = null;
    if (!silent) cb?.();
  }
}

export const chatPanel = typeof document !== 'undefined' && $('adchat') ? new ChatPanel() : null;

// Inbox: every conversation you have with businesses, from the lobby or the pause menu.
export class InboxUI {
  constructor(net) {
    this.net = net;
    this.threads = [];
    this.unread = 0;
    net.on('inbox', (m) => {
      this.threads = m.threads;
      this.setUnread(m.unread);
      this.render();
    });
    net.on('inboxUnread', (m) => this.setUnread(m.unread));
    net.on('welcome', (m) => this.setUnread(m.inboxUnread || 0));
    net.on('inboxNew', (m) => {
      this.setUnread(m.unread);
      const i = this.threads.findIndex((t) => t.id === m.thread.id);
      if (i >= 0) this.threads[i] = m.thread;
      else this.threads.unshift(m.thread);
      if (chatPanel.isOpen && chatPanel.id === m.thread.id) {
        chatPanel.setMsgs(m.thread.msgs);
        this.net.send({ t: 'threadRead', id: m.thread.id });
      } else this.onNotify?.(`📨 ${m.thread.business} replied. Check your Inbox.`);
      if (!$('inbox').hidden) this.render();
    });
    net.on('thread', (m) => {
      const i = this.threads.findIndex((t) => t.id === m.thread.id);
      if (i >= 0) this.threads[i] = m.thread;
      else this.threads.unshift(m.thread);
      if (chatPanel.isOpen && (chatPanel.id === m.thread.id || !chatPanel.id)) {
        chatPanel.id = m.thread.id;
        chatPanel.setMsgs(m.thread.msgs);
      }
    });
    net.on('adChatError', (m) => (this.onNotify || toast)(m.error));
    $('inbox-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-thread]');
      if (b) this.openThread(b.dataset.thread);
    });
  }

  setUnread(n) {
    this.unread = n || 0;
    for (const id of ['inbox-badge', 'inbox-badge-game']) {
      const b = $(id);
      if (!b) continue;
      b.hidden = !this.unread;
      b.textContent = this.unread;
    }
  }

  open() {
    $('inbox').hidden = false;
    $('inbox-list').innerHTML = '<div class="empty">Loading…</div>';
    this.net.send({ t: 'inbox' });
  }

  render() {
    $('inbox-list').innerHTML = this.threads.length
      ? this.threads
          .map((t) => {
            const last = t.msgs[t.msgs.length - 1];
            return `<button class="th ${t.unread ? 'unread' : ''}" data-thread="${esc(t.id)}"><img src="${esc(t.image)}" alt=""><div><b>${esc(t.business)}</b><span>${last ? (last.me ? 'You: ' : '') + esc(last.text) : ''}</span></div>${t.unread ? `<i class="badge">${t.unread}</i>` : `<small class="muted">${last ? when(last.at) : ''}</small>`}</button>`;
          })
          .join('')
      : '<div class="empty">No message yet. In battle, aim at any advert with 💬 and press J (or tap the chat button) to talk to that business.</div>';
  }

  openThread(id) {
    const t = this.threads.find((x) => x.id === id);
    if (!t) return;
    $('inbox').hidden = true;
    this.net.send({ t: 'threadRead', id });
    t.unread = 0;
    chatPanel.show({
      id,
      business: t.business,
      image: t.image,
      link: t.link,
      msgs: t.msgs,
      safe: t.blocked ? 'This business is no longer accepting messages from you.' : '',
      onSend: (text) => this.net.send({ t: 'adMsg', threadId: id, text }),
      onClose: () => this.onThreadClosed?.()
    });
  }
}
