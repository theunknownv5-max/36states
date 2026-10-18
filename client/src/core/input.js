// Keyboard, mouse (pointer lock) and touch controls in one place.
// The game reads held keys each frame and gets one-shot presses via onPress.
export const isTouch = () => matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouse = { dx: 0, dy: 0, left: false, right: false };
    this.locked = false;
    this.enabled = false;
    this.sensitivity = 1;
    this.invertY = false;
    this.handlers = [];
    this.touch = { moveX: 0, moveY: 0, fire: false, ads: false, sprint: false, crouch: false };
    this.touchSens = 1;
    this.typing = false;

    addEventListener('keydown', (e) => {
      if (this.typing) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      if (e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight') e.preventDefault();
      if (!e.repeat) this.press(e.code, e);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.release(e.code);
    });
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked && !isTouch()) {
        this.lock();
        return;
      }
      if (e.button === 0) {
        this.mouse.left = true;
        this.press('Mouse0', e);
      }
      if (e.button === 2) {
        this.mouse.right = true;
        this.press('Mouse2', e);
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) {
        this.mouse.right = false;
        this.release('Mouse2');
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX || 0;
      this.mouse.dy += e.movementY || 0;
    });
    addEventListener(
      'wheel',
      (e) => {
        if (!this.locked) return;
        this.press(e.deltaY > 0 ? 'WheelDown' : 'WheelUp', e);
      },
      { passive: true }
    );
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.mouse.left = this.mouse.right = false;
        this.emit('unlock');
      }
    });
  }

  lock() {
    try {
      const p = this.canvas.requestPointerLock?.({ unadjustedMovement: true });
      p?.catch?.(() => this.canvas.requestPointerLock());
    } catch {
      this.canvas.requestPointerLock?.();
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  on(fn) {
    this.handlers.push(fn);
  }

  emit(code, e) {
    for (const h of this.handlers) h(code, e, true);
  }

  press(code, e) {
    if (!this.enabled && code !== 'Escape') return;
    for (const h of this.handlers) h(code, e, true);
  }

  release(code) {
    for (const h of this.handlers) h(code, null, false);
  }

  down(code) {
    return this.enabled && !this.typing && this.keys.has(code);
  }

  // Movement axes from keys or the touch stick: x = strafe right, y = forward.
  move() {
    let x = 0;
    let y = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) y += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) y -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    x += this.touch.moveX;
    y += this.touch.moveY;
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  firing() {
    return this.enabled && (this.mouse.left || this.touch.fire);
  }

  aiming() {
    return this.enabled && (this.mouse.right || this.touch.ads);
  }

  takeLook() {
    const k = 0.0022 * this.sensitivity;
    const d = { yaw: -this.mouse.dx * k, pitch: -this.mouse.dy * k * (this.invertY ? -1 : 1) };
    this.mouse.dx = this.mouse.dy = 0;
    return d;
  }

  // Touch control scheme: classic (stick + drag to look), tap (tap the right side to fire) or
  // swipe (one finger anywhere moves, two fingers twist to turn, a tap fires).
  setScheme(s) {
    this.scheme = ['classic', 'tap', 'swipe'].includes(s) ? s : 'classic';
    document.body.classList.toggle('scheme-swipe', this.scheme === 'swipe');
    document.body.classList.toggle('scheme-tap', this.scheme === 'tap');
  }

  // A short tap fires one quick burst.
  tapFire() {
    this.touch.fire = true;
    this.tapShot = true;
    clearTimeout(this.tapT);
    this.tapT = setTimeout(() => {
      this.tapShot = false;
      this.touch.fire = false;
    }, 110);
  }

  // ---------- touch controls (built over the HUD) ----------
  bindTouch(root) {
    const zone = root.querySelector('#t-move');
    const stick = root.querySelector('#t-stick');
    const knob = root.querySelector('#t-knob');
    const look = root.querySelector('#t-look');
    const R = 52;
    let stickId = null;
    let sx = 0;
    let sy = 0;
    const home = () => {
      stick.style.left = '';
      stick.style.top = '';
      stick.style.bottom = '';
    };
    // Floating stick: it appears wherever the left thumb lands.
    zone.addEventListener('touchstart', (e) => {
      if (stickId !== null) return;
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const zr = zone.getBoundingClientRect();
      sx = t.clientX;
      sy = t.clientY;
      stick.style.left = `${t.clientX - zr.left - 65}px`;
      stick.style.top = `${t.clientY - zr.top - 65}px`;
      stick.style.bottom = 'auto';
      stick.classList.add('on');
      e.preventDefault();
    });
    zone.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        const dx = t.clientX - sx;
        const dy = t.clientY - sy;
        const l = Math.min(R, Math.hypot(dx, dy));
        const a = Math.atan2(dy, dx);
        knob.style.transform = `translate(${Math.cos(a) * l}px, ${Math.sin(a) * l}px)`;
        // Small dead zone so a resting thumb does not drift.
        const k = l < 6 ? 0 : (l - 6) / (R - 6);
        this.touch.moveX = Math.cos(a) * k;
        this.touch.moveY = -Math.sin(a) * k;
        // Push to the top edge to sprint.
        this.touch.sprint = Math.hypot(dx, dy) > R * 1.15 && this.touch.moveY > 0.75;
        stick.classList.toggle('sprint', this.touch.sprint);
      }
      e.preventDefault();
    });
    const endStick = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        stickId = null;
        knob.style.transform = '';
        this.touch.moveX = this.touch.moveY = 0;
        this.touch.sprint = false;
        stick.classList.remove('on', 'sprint');
        home();
      }
    };
    zone.addEventListener('touchend', endStick);
    zone.addEventListener('touchcancel', endStick);
    // Look: drag anywhere on the right half. Several fingers can look at once.
    // (Swipe scheme: the whole screen; one finger moves, two fingers twist to turn.)
    const lookIds = new Map();
    const starts = new Map();
    let twist = null;
    const pair = () => {
      const ids = [...lookIds.keys()];
      if (ids.length < 2) return null;
      const [a, b] = [lookIds.get(ids[0]), lookIds.get(ids[1])];
      return { ang: Math.atan2(b[1] - a[1], b[0] - a[0]), my: (a[1] + b[1]) / 2 };
    };
    const lookStart = (e) => {
      for (const t of e.changedTouches) {
        lookIds.set(t.identifier, [t.clientX, t.clientY]);
        starts.set(t.identifier, { x: t.clientX, y: t.clientY, at: performance.now(), moved: 0 });
      }
      if (this.scheme === 'swipe') {
        twist = pair();
        if (lookIds.size === 1 && !twist) {
          const t = e.changedTouches[0];
          this.swipe = { id: t.identifier, x: t.clientX, y: t.clientY };
        } else this.swipeStop();
      }
    };
    const lookMove = (e) => {
      for (const t of e.changedTouches) {
        const p = lookIds.get(t.identifier);
        if (!p) continue;
        const s = starts.get(t.identifier);
        if (s) s.moved = Math.max(s.moved, Math.hypot(t.clientX - s.x, t.clientY - s.y));
        if (this.scheme !== 'swipe') {
          this.mouse.dx += (t.clientX - p[0]) * 1.5 * this.touchSens;
          this.mouse.dy += (t.clientY - p[1]) * 1.5 * this.touchSens;
        } else if (this.swipe?.id === t.identifier) {
          // One finger: a floating stick wherever it landed.
          const dx = t.clientX - this.swipe.x;
          const dy = t.clientY - this.swipe.y;
          const l = Math.min(60, Math.hypot(dx, dy));
          const k = l < 8 ? 0 : (l - 8) / 52;
          const a = Math.atan2(dy, dx);
          this.touch.moveX = Math.cos(a) * k;
          this.touch.moveY = -Math.sin(a) * k;
          this.touch.sprint = Math.hypot(dx, dy) > 75 && this.touch.moveY > 0.75;
        }
        lookIds.set(t.identifier, [t.clientX, t.clientY]);
      }
      if (this.scheme === 'swipe' && twist) {
        // Two fingers: twist to turn, slide both up or down to look up or down.
        const now = pair();
        if (now) {
          let da = now.ang - twist.ang;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          this.mouse.dx += da * 420 * this.touchSens;
          this.mouse.dy += (now.my - twist.my) * 1.5 * this.touchSens;
          twist = now;
        }
      }
      e.preventDefault();
    };
    const lookEnd = (e) => {
      for (const t of e.changedTouches) {
        lookIds.delete(t.identifier);
        const s = starts.get(t.identifier);
        starts.delete(t.identifier);
        // A quick tap fires (tap and swipe schemes).
        if (s && this.scheme !== 'classic' && s.moved < 14 && performance.now() - s.at < 260) this.tapFire();
        if (this.swipe?.id === t.identifier) this.swipeStop();
      }
      if (this.scheme === 'swipe') twist = pair();
    };
    look.addEventListener('touchstart', lookStart);
    look.addEventListener('touchmove', lookMove);
    look.addEventListener('touchend', lookEnd);
    look.addEventListener('touchcancel', lookEnd);
    const vibrate = (ms) => navigator.vibrate?.(ms);
    // data-key: a key press. data-hold: a flag while held. data-toggle: a flag that flips.
    for (const b of root.querySelectorAll('[data-key]')) {
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('down');
        vibrate(8);
        this.press(b.dataset.key);
        this.keys.add(b.dataset.key);
      });
      const up = (e) => {
        e.preventDefault();
        b.classList.remove('down');
        this.keys.delete(b.dataset.key);
        this.release(b.dataset.key);
      };
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
    }
    for (const b of root.querySelectorAll('[data-toggle]')) {
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const f = b.dataset.toggle;
        this.touch[f] = !this.touch[f];
        b.classList.toggle('on', this.touch[f]);
        vibrate(8);
      });
    }
    for (const b of root.querySelectorAll('[data-hold]')) {
      const flag = b.dataset.hold;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        vibrate(flag === 'fire' ? 12 : 8);
        if (flag === 'ads') {
          this.touch.ads = !this.touch.ads;
          b.classList.toggle('on', this.touch.ads);
          return;
        }
        this.touch.fire = true;
        b.classList.add('down');
        this.press('Mouse0');
        // The fire buttons also steer the view, like most mobile shooters.
        lookStart(e);
      });
      b.addEventListener('touchmove', (e) => {
        if (flag === 'fire') lookMove(e);
      });
      const up = (e) => {
        e.preventDefault();
        if (flag !== 'fire') return;
        lookEnd(e);
        b.classList.remove('down');
        if (!root.querySelector('[data-hold="fire"].down')) this.touch.fire = false;
      };
      b.addEventListener('touchend', up);
      b.addEventListener('touchcancel', up);
    }
  }

  swipeStop() {
    this.swipe = null;
    this.touch.moveX = this.touch.moveY = 0;
    this.touch.sprint = false;
  }

  // Forget touch state (e.g. after dying or opening a menu).
  resetTouch(root) {
    Object.assign(this.touch, { moveX: 0, moveY: 0, fire: false, sprint: false });
    root?.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
  }
}
