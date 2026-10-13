#!/usr/bin/env python3
"""Makes every sound effect of the native game as WAV files, with the same recipes the lite
app synthesises live in Web Audio (client/src/core/audio.js): guns, footsteps per surface,
explosions, grenades, hits, UI, ambience loops. Run from native/:  python3 tools/gen_sounds.py
"""
import os
import wave
import numpy as np
from scipy.signal import lfilter

SR = 22050
OUT = os.path.join(os.path.dirname(__file__), '..', 'sounds')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(36)
WHITE = rng.uniform(-1, 1, SR * 4)
_b = np.zeros(SR * 6)
last = 0.0
w = rng.uniform(-1, 1, SR * 6)
for i in range(len(_b)):
    last = (last + 0.02 * w[i]) / 1.02
    _b[i] = last * 3.5
BROWN = _b


def biquad(kind, f, q):
    f = min(max(f, 20), SR * 0.45)
    w0 = 2 * np.pi * f / SR
    a = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    if kind == 'lowpass':
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    elif kind == 'highpass':
        b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    else:  # bandpass (constant 0 dB peak)
        b = [a, 0, -a]
    A = [1 + a, -2 * c, 1 - a]
    return np.array(b) / A[0], np.array(A) / A[0]


def filt(x, kind, f, f2, q):
    """Biquad with an exponential frequency sweep from f to f2, in 64-sample blocks."""
    out = np.zeros_like(x)
    zi = np.zeros(2)
    n = len(x)
    for s in range(0, n, 64):
        e = min(n, s + 64)
        ff = f if not f2 else f * (f2 / f) ** (s / max(1, n))
        b, a = biquad(kind, ff, q)
        out[s:e], zi = lfilter(b, a, x[s:e], zi=zi)
    return out


@np.errstate(over="ignore", invalid="ignore")
def env(n, attack, gain):
    t = np.arange(n) / SR
    dur = n / SR
    at = max(attack, 1e-4)
    e = np.where(t < at, 0.0001 * (gain / 0.0001) ** (t / at), gain * (0.0001 / gain) ** ((t - at) / max(1e-4, dur - at)))
    return e


class Snd:
    def __init__(self, secs):
        self.buf = np.zeros(int(SR * secs) + 1)

    def add(self, start, x):
        s = int(start * SR)
        if s >= len(self.buf):
            return
        e = min(len(self.buf), s + len(x))
        self.buf[s:e] += x[: e - s]

    def noise(self, start, dur, gain, kind='bandpass', f=1000, q=1.0, f2=None, attack=0.002, brown=False):
        n = max(8, int(dur * SR))
        src = BROWN if brown else WHITE
        o = rng.integers(0, len(src) - n - 1)
        x = filt(src[o:o + n].copy(), kind, f, f2, q)
        self.add(start, x * env(n, attack, gain))

    def tone(self, start, f, dur, gain, f2=None, wave_='sine', attack=0.003):
        n = max(8, int(dur * SR))
        t = np.arange(n) / SR
        fr = f * (f2 / f) ** (t / dur) if f2 else np.full(n, f)
        ph = 2 * np.pi * np.cumsum(fr) / SR
        if wave_ == 'sine':
            x = np.sin(ph)
        elif wave_ == 'square':
            x = np.sign(np.sin(ph)) * 0.7
        elif wave_ == 'triangle':
            x = 2 / np.pi * np.arcsin(np.sin(ph))
        else:  # sawtooth
            x = 2 * ((ph / (2 * np.pi)) % 1) - 1
        self.add(start, x * env(n, attack, gain))

    def save(self, name, norm=None):
        x = self.buf
        # Trim the silent tail.
        nz = np.nonzero(np.abs(x) > 1e-4)[0]
        if len(nz):
            x = x[: nz[-1] + 1]
        peak = np.max(np.abs(x)) + 1e-9
        if norm:
            x = x / peak * norm
        elif peak > 0.98:
            x = x / peak * 0.98
        write(name, x)


def write(name, x):
    data = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)


def loop(name, secs, kind, f, q=0.7, gain=0.3, brown=False, lfo=0.0, depth=0.0, extra=None):
    """A perfectly seamless loop: noise shaped in the frequency domain (circular)."""
    n = int(SR * secs)
    src = (np.random.default_rng(len(name)).standard_normal(n))
    F = np.fft.rfft(src)
    fr = np.fft.rfftfreq(n, 1 / SR)
    if kind == 'lowpass':
        h = 1 / np.sqrt(1 + (fr / f) ** 4)
    elif kind == 'bandpass':
        bw = f / q
        h = np.exp(-((fr - f) / bw) ** 2)
    else:
        h = np.ones_like(fr)
    if brown:
        h = h / np.maximum(fr, 20) * 60
    x = np.fft.irfft(F * h, n)
    x = x / (np.max(np.abs(x)) + 1e-9)
    if lfo:
        cycles = max(1, round(lfo * secs))  # whole cycles so the loop stays seamless
        t = np.arange(n) / SR
        x = x * (1 - depth + depth * (0.5 + 0.5 * np.sin(2 * np.pi * cycles * t / secs)))
    if extra is not None:
        x = x + extra(n)
    write(name, x / (np.max(np.abs(x)) + 1e-9) * gain)


# ---------- guns (same numbers as the lite app) ----------
GUNS = {
    'pistol': dict(crack=2600, q=0.9, thump=150, thumpDur=0.07, body=0.12, tail=0.45, gain=0.8),
    'magnum': dict(crack=1800, q=0.8, thump=95, thumpDur=0.12, body=0.18, tail=0.8, gain=1.05),
    'smg': dict(crack=3000, q=1, thump=160, thumpDur=0.05, body=0.08, tail=0.35, gain=0.7),
    'rifle': dict(crack=1900, q=0.7, thump=110, thumpDur=0.1, body=0.14, tail=1.0, gain=1.0),
    'battle': dict(crack=1500, q=0.7, thump=90, thumpDur=0.12, body=0.16, tail=1.1, gain=1.1),
    'mg': dict(crack=1700, q=0.75, thump=100, thumpDur=0.1, body=0.13, tail=0.9, gain=1.0),
    'shotgun': dict(crack=900, q=0.6, thump=70, thumpDur=0.16, body=0.25, tail=1.2, gain=1.2),
    'sniper': dict(crack=2400, q=0.6, thump=80, thumpDur=0.14, body=0.16, tail=2.2, gain=1.25),
}
for kind, p in GUNS.items():
    for mine in (True, False):
        for v in range(2):
            s = Snd(p['tail'] + 0.4)
            g = p['gain'] * 0.9
            jit = 1 + (v - 0.5) * 0.12
            s.noise(0, 0.05 + p['body'] * 0.3, g * 0.9, f=p['crack'] * jit, q=p['q'], attack=0.0008)
            s.noise(0, p['body'], g * 0.8, kind='lowpass', f=5000, f2=300, attack=0.001)
            s.tone(0, p['thump'] * 1.6 * jit, p['thumpDur'] + 0.06, g * 0.9, f2=p['thump'] * 0.6, attack=0.001)
            s.noise(0.03, p['tail'], g * 0.18, kind='lowpass', f=1400, f2=150, attack=0.02, brown=True)
            if mine:
                s.noise(0.035, 0.03, 0.25, f=4200, q=3)
            s.save(f"gun_{kind}{'_mine' if mine else ''}_{v}", norm=0.95)

s = Snd(1.3)
s.tone(0, 120, 0.25, 1.2, f2=40)
s.noise(0, 1.1, 0.9, f=600, f2=3000, q=0.5, attack=0.01)
s.noise(0, 0.6, 0.6, kind='lowpass', f=2500, f2=200, brown=True)
s.save('rpg', norm=0.95)

s = Snd(0.1)
s.noise(0, 0.03, 0.35, f=3200, q=4)
s.save('dry')


def reload_snd(name, clicks):
    s = Snd(max(t for t, _, _ in clicks) + 0.2)
    for t, f, g in clicks:
        s.noise(t, 0.035, g, f=f, q=3)
    s.save(name, norm=0.8)

reload_snd('reload', [(0.15, 1800, 0.35), (0.35, 900, 0.25), (1.2, 1400, 0.45), (1.7, 2600, 0.5), (1.8, 3400, 0.4)])
reload_snd('reload_pkm', [(0.15, 1800, 0.35), (0.35, 900, 0.25), (3.2, 1400, 0.45), (4.2, 2600, 0.5), (4.3, 3400, 0.4)])
reload_snd('reload_danegun', [(0.2, 900, 0.35), (0.9, 2000, 0.35), (1.4, 3000, 0.45)])
reload_snd('reload_rpg', [(0.4, 700, 0.5), (2.6, 1500, 0.5), (3.2, 2500, 0.35)])

s = Snd(0.3)
s.noise(0, 0.22, 0.4, f=800, f2=3000, q=1.5, attack=0.04)
s.save('swing', norm=0.6)

for surf, f in {'metal': 3500, 'wood': 900, 'concrete': 2200, 'water': 600, 'flesh': 400, 'dirt': 1500}.items():
    s = Snd(0.5)
    s.noise(0, 0.18 if surf == 'water' else 0.06, 0.5, f=f, q=8 if surf == 'metal' else 1.5)
    if surf == 'metal':
        s.tone(0, 2800, 0.35, 0.12, f2=900)
    s.save('impact_' + surf, norm=0.7)

s = Snd(0.15)
s.noise(0, 0.09, 0.5, f=5000, f2=2500, q=2)
s.save('whiz', norm=0.6)

for v in range(2):
    s = Snd(3.2)
    s.tone(0, 70 - v * 8, 1.4, 1.6, f2=22, attack=0.004)
    s.noise(0, 1.8, 1.4, kind='lowpass', f=3000, f2=120, attack=0.002, brown=True)
    s.noise(0, 0.25, 1.0, kind='highpass', f=1500, attack=0.001)
    for i in range(10):
        s.noise(0.25 + rng.random() * 1.6, 0.03, 0.08 + rng.random() * 0.1, f=1500 + rng.random() * 3000, q=2)
    s.save(f'explosion_{v}', norm=0.98)
s = Snd(3.5)
s.tone(0, 60, 1.6, 1.4, f2=20, attack=0.01)
s.noise(0, 2.4, 1.4, kind='lowpass', f=700, f2=100, attack=0.01, brown=True)
s.save('explosion_far', norm=0.9)

for heavy in (False, True):
    s = Snd(0.25)
    s.tone(0, 110 if heavy else 150, 0.14, 0.8 if heavy else 0.55, f2=50)
    s.noise(0, 0.06, 0.6 if heavy else 0.35, kind='lowpass', f=1400, f2=300)
    s.save('punch_heavy' if heavy else 'punch', norm=0.8)

s = Snd(0.8)
for i, f in enumerate([880, 1175, 1568]):
    s.tone(i * 0.07, f, 0.5, 0.12, wave_='triangle')
s.save('heal', norm=0.5)

s = Snd(0.1)
s.tone(0, 1000, 0.08, 0.35, wave_='square', attack=0.002)
s.save('beep', norm=0.5)

s = Snd(1.4)
s.tone(0, 2100, 1.3, 0.35, f2=380, attack=0.2)
s.save('incoming', norm=0.6)

s = Snd(0.6)
s.noise(0, 0.04, 0.3, f=3000, q=5)
s.noise(0.3, 0.25, 0.25, f=600, f2=1800, q=1, attack=0.05)
s.save('throw', norm=0.5)

s = Snd(0.08)
s.noise(0, 0.05, 0.3, f=1800, q=4)
s.save('bounce', norm=0.5)

s = Snd(0.8)
s.noise(0, 0.6, 1.4, kind='highpass', f=800, attack=0.001)
s.save('flashbang', norm=0.95)
s = Snd(4.0)
s.tone(0, 3600, 4.0, 0.12, attack=0.05)
s.save('ring', norm=0.25)

s = Snd(2.6)
s.noise(0, 2.5, 0.35, f=1800, q=0.5, attack=0.1)
s.save('smoke', norm=0.5)

# ---------- footsteps per surface ----------
FOOT = {
    'sand': dict(f=900, q=0.7, dur=0.11, gain=0.35, grit=0.4),
    'dirt': dict(f=600, q=0.9, dur=0.09, gain=0.45, grit=0.2),
    'gravel': dict(f=1600, q=0.6, dur=0.12, gain=0.45, grit=1),
    'mud': dict(f=350, q=1.2, dur=0.14, gain=0.5, grit=0, wet=True),
    'concrete': dict(f=1200, q=1.4, dur=0.06, gain=0.5, grit=0.1, click=True),
    'wood': dict(f=420, q=2, dur=0.09, gain=0.6, knock=190),
    'metal': dict(f=2400, q=6, dur=0.12, gain=0.45, ring=780),
    'water': dict(f=700, q=0.6, dur=0.22, gain=0.55, wet=True, splash=True),
}
for surf, p in FOOT.items():
    for v in range(3):
        s = Snd(0.4)
        g = p['gain'] * (0.85 + v * 0.1)
        s.noise(0, p['dur'], g, kind='lowpass' if p.get('wet') else 'bandpass', f=p['f'] * (0.88 + v * 0.1), q=p['q'])
        if p.get('grit'):
            for i in range(3):
                s.noise(rng.random() * p['dur'], 0.012, g * p['grit'] * 0.5, f=3000 + rng.random() * 3000, q=3)
        if p.get('click'):
            s.noise(0, 0.015, g * 0.6, f=4000, q=4)
        if p.get('knock'):
            s.tone(0, p['knock'], 0.08, g * 0.8, f2=p['knock'] * 0.7)
        if p.get('ring'):
            s.tone(0, p['ring'], 0.18, g * 0.25, wave_='triangle')
        if p.get('splash'):
            s.noise(0.04, 0.25, g * 0.6, f=1500, f2=500, q=0.7)
        s.save(f'step_{surf}_{v}', norm=0.6)

s = Snd(0.15)
s.noise(0, 0.12, 0.12, f=500, q=1.5)
s.save('jump', norm=0.3)

# ---------- feedback and UI ----------
s = Snd(0.06)
s.noise(0, 0.04, 0.4, f=2800, q=3)
s.save('hit', norm=0.6)
s = Snd(0.4)
s.tone(0, 2300, 0.35, 0.35, wave_='triangle', attack=0.001)
s.save('headshot', norm=0.6)
s = Snd(0.35)
s.tone(0.0, 520, 0.12, 0.25, wave_='square')
s.tone(0.09, 780, 0.16, 0.25, wave_='square')
s.save('kill', norm=0.55)
s = Snd(0.25)
s.tone(0, 90, 0.18, 0.7, f2=50)
s.noise(0, 0.08, 0.3, f=500, q=1)
s.save('hurt', norm=0.8)
s = Snd(0.35)
s.tone(0, 55, 0.12, 0.5, f2=40)
s.tone(0.18, 50, 0.12, 0.35, f2=38)
s.save('heartbeat', norm=0.8)
s = Snd(0.9)
for i, f in enumerate([1046, 1318, 1568, 2093]):
    s.tone(i * 0.07, f, 0.6, 0.18, wave_='triangle')
s.save('gem', norm=0.6)
s = Snd(0.06)
s.tone(0, 1200, 0.05, 0.15, wave_='square')
s.save('click', norm=0.35)
s = Snd(0.5)
s.tone(0, 660, 0.18, 0.2, wave_='square')
s.tone(0.2, 880, 0.25, 0.2, wave_='square')
s.save('alert', norm=0.45)
s = Snd(0.4)
s.tone(0, 440, 0.1, 0.2, wave_='triangle')
s.tone(0.1, 660, 0.25, 0.2, wave_='triangle')
s.save('buy', norm=0.45)

# ---------- ambience ----------
for v in range(3):
    s = Snd(1.2)
    base = 2000 + rng.random() * 2500
    for i in range(2 + v * 2):
        s.tone(i * 0.13, base * (1 + rng.random() * 0.3), 0.09, 0.08, f2=base * (0.7 + rng.random() * 0.6))
    s.save(f'bird_{v}', norm=0.4)
s = Snd(1.3)
s.tone(0, 420, 0.35, 0.12, wave_='square')
s.tone(0.45, 420, 0.6, 0.12, wave_='square')
s.save('horn', norm=0.35)

loop('amb_wind', 8, 'lowpass', 380, gain=0.5, brown=False, lfo=0.125, depth=0.5)
loop('amb_wind_dry', 8, 'lowpass', 700, gain=0.6, lfo=0.125, depth=0.5)
loop('amb_insects', 4, 'bandpass', 5200, q=6, gain=0.12, lfo=7, depth=0.6)
loop('amb_water', 6, 'lowpass', 300, gain=0.4, lfo=0.33, depth=0.5)
loop('amb_traffic', 8, 'lowpass', 180, gain=0.45, lfo=0.125, depth=0.3)
loop('amb_rain', 4, 'bandpass', 2600, q=0.4, gain=0.35, lfo=0.25, depth=0.15)
loop('fire_loop', 4, 'lowpass', 900, gain=0.5, lfo=0.5, depth=0.2,
     extra=lambda n: np.where(np.random.default_rng(4).random(n) > 0.9993, np.random.default_rng(5).uniform(-0.8, 0.8, n), 0))


def drone_loop(n):
    t = np.arange(n) / SR
    x = np.zeros(n)
    for f in (178, 181, 356):
        ph = (t * f) % 1
        x += 2 * ph - 1
    return x

n = SR * 2
d = drone_loop(n)
d = filt(d, 'bandpass', 900, None, 1.0)
write('drone_loop', d / np.max(np.abs(d)) * 0.25)

print('sounds written to', os.path.abspath(OUT))
tot = 0
for f in sorted(os.listdir(OUT)):
    tot += os.path.getsize(os.path.join(OUT, f))
print(len(os.listdir(OUT)), 'files,', tot // 1024, 'KB')
