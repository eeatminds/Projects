"""Original 20 s music bed for the reel (120 BPM, D major), synthesised from scratch.

Cuts in the edit land on beats: 3.0, 5.5, 8.0, 14.0 and 18.0 s. The track opens on a hit,
lifts at 3 s (claps + hats), adds chenda-style drums at 14 s, rolls into a final hit at 18 s
and rings out to 20 s.  Usage:  python3 src/music.py out.wav
"""
import sys
import wave
import numpy as np

SR, DUR, BPM = 48000, 20.0, 120
N = int(SR * DUR)
BEAT = 60 / BPM
S16 = BEAT / 4
rng = np.random.default_rng(7)
L = np.zeros(N)
R = np.zeros(N)
verb_send = np.zeros(N)        # mono send to reverb
pump_src = []                  # kick times for sidechain pumping


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def place(sig, t, gain=1.0, pan=0.0, send=0.0):
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    L[i:i + len(sig)] += sig * np.sqrt(0.5 * (1 - pan))
    R[i:i + len(sig)] += sig * np.sqrt(0.5 * (1 + pan))
    if send:
        verb_send[i:i + len(sig)] += sig * send


def fft_filter(x, lo=None, hi=None, order=2):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    h = np.ones_like(f)
    if hi:
        h /= np.sqrt(1 + (f / hi) ** (2 * order))
    if lo:
        h /= np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    return np.fft.irfft(X * h, len(x))


def env(n, a=0.002, d=0.2):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)


# ---------------------------------------------------------------- instruments
def kick():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 46 + 120 * np.exp(-t * 28)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    click = fft_filter(rng.uniform(-1, 1, n), lo=2000) * np.exp(-t * 400) * 0.3
    return np.tanh(1.6 * (body + click))


def clap():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    noise = fft_filter(rng.uniform(-1, 1, n), lo=900, hi=4200)
    e = np.zeros(n)
    for k, off in enumerate((0, 0.011, 0.022)):
        tt = np.clip(t - off, 0, None)
        e += (t >= off) * np.exp(-tt * (180 if k < 2 else 16))
    return noise * e / 2


def hat(open_=False):
    n = int((0.22 if open_ else 0.06) * SR)
    t = np.arange(n) / SR
    return fft_filter(rng.uniform(-1, 1, n), lo=7000) * np.exp(-t * (18 if open_ else 75))


def chenda(pitch=230):
    """Sharp, cracking stick drum in the spirit of a chenda."""
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    f = pitch * (1 + 0.35 * np.exp(-t * 60))
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 26)
    crack = fft_filter(rng.uniform(-1, 1, n), lo=1500, hi=6500) * np.exp(-t * 55)
    return np.tanh(1.8 * (0.8 * tone + 0.9 * crack))


def crash(d=2.4):
    n = int(d * SR)
    t = np.arange(n) / SR
    return fft_filter(rng.uniform(-1, 1, n), lo=3500, hi=14000) * np.exp(-t * 2.3) * np.minimum(1, t / 0.004)


def pluck(m, d=0.9, damp=0.996):
    """Karplus–Strong string; block-vectorised so it stays fast."""
    n = int(d * SR)
    p = max(2, int(round(SR / hz(m))))
    out = np.zeros(n + p + 2)
    out[1:p + 1] = fft_filter(rng.uniform(-1, 1, p * 8), hi=5000)[:p]
    i = p + 1
    while i < n + 1:
        j = min(i + p, n + 1)
        out[i:j] = damp * 0.5 * (out[i - p:j - p] + out[i - p - 1:j - p - 1])
        i = j
    sig = out[1:n + 1]
    sig *= np.minimum(1, (n - np.arange(n)) / (0.02 * SR))
    return sig / (np.max(np.abs(sig)) + 1e-9)


def pad(notes, d, att=0.25, rel=0.6):
    n = int(d * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for m in notes:
        for cents in (-9, 0, 8):
            f = hz(m) * 2 ** (cents / 1200)
            ph = rng.uniform()
            sig += 2 * ((f * t + ph) % 1) - 1
    sig = fft_filter(sig, hi=1600, order=2)
    e = np.minimum(1, t / att) * np.minimum(1, (d - t) / rel).clip(0, 1)
    return sig * e / (3 * len(notes))


def bass(m, d):
    n = int(d * SR)
    t = np.arange(n) / SR
    f = hz(m)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t)
    s = np.tanh(2.2 * s)               # harmonics so it reads on phone speakers
    e = np.minimum(1, t / 0.004) * np.exp(-t * 3.0) * np.minimum(1, (d - t) / 0.03).clip(0, 1)
    return fft_filter(s, hi=900) * e


# ------------------------------------------------------------------ arrangement
CH = {  # chord tones (MIDI) and bass note
    'D': ([62, 66, 69], 38), 'A': ([61, 64, 69], 45), 'Bm': ([62, 66, 71], 47), 'G': ([62, 67, 71], 43),
}
BARS = ['D', 'A', 'Bm', 'G', 'D', 'A', 'Bm', 'G', 'A']           # bars 0–8 (0–18 s); bar 9 = final D
BAR = 4 * BEAT

for b, name in enumerate(BARS):
    t0 = b * BAR
    tones, root = CH[name]
    place(pad(tones, BAR + 0.15), t0, gain=0.22 if b < 4 else 0.26, send=0.35)
    # 8th-note arpeggio, an octave up
    arp = [tones[0], tones[1], tones[2], tones[0] + 12]
    for k, idx in enumerate([0, 1, 2, 3, 2, 1, 2, 3]):
        m = arp[idx] + 12
        place(pluck(m, 0.75), t0 + k * BEAT / 2, gain=0.40 if k % 2 == 0 else 0.30,
              pan=(-0.35 if k % 2 else 0.35), send=0.25)
    # bass: half notes in the hook, driving 8ths after the first cut
    if t0 < 3.0:
        for k in range(2):
            place(bass(root, BEAT * 2 - 0.02), t0 + k * 2 * BEAT, gain=0.5)
    else:
        for k in range(8):
            place(bass(root if k != 7 else root + 7, BEAT / 2 - 0.01), t0 + k * BEAT / 2, gain=0.46)
    # drums
    kicks = [0, 8] if t0 < 2.0 else [0, 6, 8, 14] if t0 < 3.0 else [0, 6, 8, 11, 14] if b < 7 else [0, 4, 8, 11, 12, 14]
    for s in kicks:
        tk = t0 + s * S16
        place(kick(), tk, gain=0.62)
        pump_src.append(tk)
    if t0 + 2 * BAR > 3.0:
        for s in (4, 12):
            tc = t0 + s * S16
            if tc >= 3.0:
                place(clap(), tc, gain=0.45, send=0.4)
        for s in range(16):
            th = t0 + s * S16
            if th >= 3.0:
                place(hat(open_=(s % 4 == 2)), th, gain=(0.11 if s % 2 else 0.07) * (1.35 if b >= 7 else 1.0), pan=0.4)
    if b in (7, 8):  # chenda pattern under the hostel/Kerala-food scene
        for s in (2, 3, 6, 7, 10, 13, 15):
            place(chenda(250 if s % 2 else 215), t0 + s * S16, gain=0.32, pan=-0.25, send=0.15)

# fills into the alumna scene (8 s) and into the end card (18 s)
for k in range(4):
    place(chenda(240 - k * 8), 7.5 + k * S16, gain=0.25 + 0.05 * k, send=0.2)
for k in range(12):
    tt = 17.25 + k * (0.75 / 12)
    place(chenda(210 + k * 6), tt, gain=0.18 + 0.03 * k, pan=(-0.3 if k % 2 else 0.3), send=0.2)

# riser 16–18 s
n = int(2.0 * SR)
noise = rng.uniform(-1, 1, n)
blk = int(0.04 * SR)
rise = np.zeros(n)
for i in range(0, n, blk):
    frac = i / n
    seg = noise[max(0, i - blk):i + 2 * blk]
    filt = fft_filter(seg, lo=300 + 5000 * frac ** 2, hi=1200 + 9000 * frac)
    take = filt[(i - max(0, i - blk)):(i - max(0, i - blk)) + blk]
    rise[i:i + len(take)] = take * frac ** 2
place(rise, 16.0, gain=0.35, send=0.3)

# opening hit and final hit
place(crash(1.6), 0.0, gain=0.16, pan=0.2)
place(crash(2.2), 18.0, gain=0.42, pan=0.1, send=0.3)
for tk in (0.0, 18.0):
    place(kick(), tk, gain=0.75)
    pump_src.append(tk)
tones, root = CH['D']
for k, m in enumerate(tones + [tones[0] + 12, tones[1] + 12, tones[2] + 12]):
    place(pluck(m, 1.9, damp=0.9985), 18.0 + 0.012 * k, gain=0.26, pan=-0.4 + 0.16 * k, send=0.4)
place(pad(tones, 2.0, att=0.02, rel=1.6), 18.0, gain=0.3, send=0.5)
place(bass(root, 1.9), 18.0, gain=0.6)
place(clap(), 18.0, gain=0.5, send=0.5)

# ------------------------------------------------------------------ mix
# sidechain-style pump on the sustained parts is approximated on the whole bed, gently
pump = np.ones(N)
tt = np.arange(N) / SR
for tk in pump_src:
    i = int(tk * SR)
    j = min(N, i + int(0.3 * SR))
    pump[i:j] = np.minimum(pump[i:j], 1 - 0.22 * np.exp(-(tt[i:j] - tk) * 14))

ir_n = int(1.4 * SR)
ir_t = np.arange(ir_n) / SR
irL = rng.uniform(-1, 1, ir_n) * np.exp(-ir_t * 4.2)
irR = rng.uniform(-1, 1, ir_n) * np.exp(-ir_t * 4.2)
irL, irR = fft_filter(irL, hi=6000), fft_filter(irR, hi=6000)


def conv(x, h):
    m = len(x) + len(h)
    return np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(h, m), m)[:len(x)]


wetL, wetR = conv(verb_send, irL), conv(verb_send, irR)
wscale = 0.18 / (np.max(np.abs(wetL)) + 1e-9) * np.max(np.abs(verb_send))
L = L * pump + wetL * wscale
R = R * pump + wetR * wscale

fade = np.ones(N)
fade[-int(0.25 * SR):] = np.linspace(1, 0, int(0.25 * SR))
st = np.stack([L, R], 1) * fade[:, None]
st = np.tanh(st / (np.max(np.abs(st)) + 1e-9) * 1.25)
st = st / np.max(np.abs(st)) * 0.89

out = sys.argv[1] if len(sys.argv) > 1 else 'music.wav'
with wave.open(out, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((st * 32767).astype('<i2').tobytes())
print('wrote', out)
