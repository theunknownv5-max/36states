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
    this.touch = { moveX: 0, moveY: 0, fire: false, ads: false, sprint: false };
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

  // ---------- touch controls (built over the HUD) ----------
  bindTouch(root) {
    const stick = root.querySelector('#t-stick');
    const knob = root.querySelector('#t-knob');
    const look = root.querySelector('#t-look');
    let stickId = null;
    let sx = 0;
    let sy = 0;
    stick.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      stickId = t.identifier;
      const r = stick.getBoundingClientRect();
      sx = r.left + r.width / 2;
      sy = r.top + r.height / 2;
      e.preventDefault();
    });
    stick.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== stickId) continue;
        const dx = t.clientX - sx;
        const dy = t.clientY - sy;
        const l = Math.min(55, Math.hypot(dx, dy));
        const a = Math.atan2(dy, dx);
        knob.style.transform = `translate(${Math.cos(a) * l}px, ${Math.sin(a) * l}px)`;
        this.touch.moveX = (Math.cos(a) * l) / 55;
        this.touch.moveY = -(Math.sin(a) * l) / 55;
        this.touch.sprint = l > 52 && this.touch.moveY > 0.8;
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
      }
    };
    stick.addEventListener('touchend', endStick);
    stick.addEventListener('touchcancel', endStick);
    let lookId = null;
    let lx = 0;
    let ly = 0;
    look.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      lookId = t.identifier;
      lx = t.clientX;
      ly = t.clientY;
    });
    look.addEventListener('touchmove', (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== lookId) continue;
        this.mouse.dx += (t.clientX - lx) * 1.6;
        this.mouse.dy += (t.clientY - ly) * 1.6;
        lx = t.clientX;
        ly = t.clientY;
      }
      e.preventDefault();
    });
    look.addEventListener('touchend', () => (lookId = null));
    // Buttons: data-key presses a key; data-hold sets a touch flag while held.
    for (const b of root.querySelectorAll('[data-key]')) {
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.press(b.dataset.key);
        this.keys.add(b.dataset.key);
      });
      b.addEventListener('touchend', (e) => {
        e.preventDefault();
        this.keys.delete(b.dataset.key);
        this.release(b.dataset.key);
      });
    }
    for (const b of root.querySelectorAll('[data-hold]')) {
      const flag = b.dataset.hold;
      b.addEventListener('touchstart', (e) => {
        e.preventDefault();
        this.touch[flag] = flag === 'ads' ? !this.touch.ads : true;
        if (flag === 'fire') {
          this.press('Mouse0');
          // Firing button also steers the view, like most mobile shooters.
          const t = e.changedTouches[0];
          lookId = t.identifier;
          lx = t.clientX;
          ly = t.clientY;
        }
      });
      b.addEventListener('touchmove', (e) => {
        if (flag !== 'fire') return;
        for (const t of e.changedTouches) {
          if (t.identifier !== lookId) continue;
          this.mouse.dx += (t.clientX - lx) * 1.2;
          this.mouse.dy += (t.clientY - ly) * 1.2;
          lx = t.clientX;
          ly = t.clientY;
        }
        e.preventDefault();
      });
      b.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (flag !== 'ads') this.touch[flag] = false;
      });
    }
  }
}
