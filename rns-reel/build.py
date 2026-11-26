#!/usr/bin/env python3
"""Build the 20 s RNS College of Nursing reel (1080x1920, 30 fps, H.264 + AAC) for Meta ads.

    python3 build.py                  both cuts → out/rns-reel-ml-9x16.mp4, out/rns-reel-en-9x16.mp4
    python3 build.py --lang en        one cut
    python3 build.py --skip-render    reuse build/frames-* (only footage, music or voice-over changed)
    python3 build.py --no-vo          music only, no voice-over

Real footage: drop clips into footage/ named after their slot and rebuild. Any slot without a
clip falls back to the still-photo version from rnsnursingcollege.com.

    footage/s1.mp4   0–3 s   student to camera (keep the face in the lower half; text sits on top)
    footage/s2.mp4   3–8 s   skills lab, then ward rounds
    footage/s3.mp4   8–14 s  alumna abroad, speaking Malayalam (written consent on file)
    footage/s4.mp4   14–18 s hostel room + weekly Kerala food day

Clips are scaled to fill 9:16, trimmed from their start to the slot length, and their own audio
(e.g. the alumna's voice) is kept; the voice-over skips that slot and the music ducks under it.

Voice-over: the English cut gets a generated narrator (src/voiceover.py, Kokoro TTS). Recorded
voice-over replaces it, for either language, in one of two forms:
    footage/vo-ml.wav            one full 20 s track (.wav/.mp3/.m4a)
    footage/vo-ml/s1.wav … s5.wav  one file per line; each is trimmed and placed at its scene time
The line-by-line script and timings are in src/voiceover.py (SCRIPT_ML / SCRIPT_EN, WINDOWS).
Music: footage/music.wav (or .mp3/.m4a) replaces the generated bed.
"""
import argparse
import json
import shutil
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'src'))
from voiceover import WINDOWS  # noqa: E402  (line timings shared with the TTS script)

BUILD, OUT, FOOT = ROOT / 'build', ROOT / 'out', ROOT / 'footage'
SLOTS = {'s1': (0.0, 3.0), 's2': (3.0, 8.0), 's3': (8.0, 14.0), 's4': (14.0, 18.0)}
FPS, DUR, SR = 30, 20, 48000
DUCK = 0.3            # music gain while someone is speaking


def run(cmd):
    print('$', ' '.join(map(str, cmd))[:200])
    subprocess.run(cmd, check=True)


def has_audio(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index',
                        '-of', 'json', str(p)], capture_output=True, text=True, check=True)
    return bool(json.loads(r.stdout).get('streams'))


def find(stem, exts=('.mp4', '.mov', '.m4v', '.webm', '.mkv')):
    return next((FOOT / f'{stem}{e}' for e in exts if (FOOT / f'{stem}{e}').exists()), None)


def load(path):
    """Any audio (or the audio of a video) → float32 stereo at 48 kHz, exactly DUR seconds."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-vn', '-ac', '2', '-ar', str(SR),
                          '-t', str(DUR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, '<f4').reshape(-1, 2)
    out = np.zeros((SR * DUR, 2), np.float32)
    out[:len(x)] = x[:SR * DUR]
    return out


def assemble_lines(folder, skip):
    """footage/vo-<lang>/s1.wav … s5.wav → one 20 s track, each line at its scene's start time."""
    track = np.zeros((SR * DUR, 2), np.float32)
    for slot, (a, b) in WINDOWS.items():
        f = next((folder / f'{slot}{e}' for e in ('.wav', '.mp3', '.m4a') if (folder / f'{slot}{e}').exists()), None)
        if f is None or slot in skip:
            continue
        raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(f), '-ac', '2', '-ar', str(SR), '-f', 'f32le', '-'],
                             capture_output=True, check=True).stdout
        x = np.frombuffer(raw, '<f4').reshape(-1, 2)
        loud = np.flatnonzero(np.abs(x).max(1) > 0.01)
        if len(loud):
            x = x[max(0, loud[0] - SR // 50):loud[-1] + SR // 20]
        if len(x) / SR > b - a:
            print(f'WARNING {f.name}: {len(x) / SR:.2f}s is longer than its {b - a:.2f}s slot', file=sys.stderr)
        i = int(a * SR)
        x = x[:len(track) - i]
        track[i:i + len(x)] += x
    return track


def save(path, x):
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype('<i2').tobytes())


def duck_gain(speech):
    """Smooth music gain: DUCK wherever speech is present (with lead-in and hang time), else 1."""
    hop = SR // 100
    mono = speech.mean(1)
    rms = np.sqrt(np.add.reduceat(mono ** 2, np.arange(0, len(mono), hop)) / hop)
    on = rms > 0.008
    pre, post = 12, 30                                   # frames of 10 ms
    mask = np.zeros_like(on, dtype=float)
    for i in np.flatnonzero(on):
        mask[max(0, i - pre):i + post] = 1
    sm, y = np.zeros_like(mask), 0.0
    for i, m in enumerate(mask):                         # attack ~60 ms, release ~250 ms
        y += (m - y) * (0.16 if m > y else 0.04)
        sm[i] = y
    g = 1 - (1 - DUCK) * sm
    return np.repeat(g, hop)[:len(mono)][:, None].astype(np.float32)


def background(clips):
    """Footage slots normalised to their exact length, gaps as black + silence, concatenated."""
    segs, voiced = [], []
    for slot, (a, b) in list(SLOTS.items()) + [('end', (18.0, 20.0))]:
        d, seg = b - a, BUILD / f'seg_{slot}.mov'
        if slot in clips:
            aud = has_audio(clips[slot])
            if aud:
                voiced.append(slot)
            run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(clips[slot]),
                 '-f', 'lavfi', '-i', f'anullsrc=r={SR}:cl=stereo', '-filter_complex',
                 f'[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps={FPS},'
                 f'trim=0:{d},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={d},format=yuv420p[v];'
                 + (f'[0:a]aformat=sample_rates={SR}:channel_layouts=stereo,atrim=0:{d},asetpts=PTS-STARTPTS,'
                    f'afade=t=in:d=0.06,apad,atrim=0:{d},afade=t=out:st={d - 0.12}:d=0.12[a]' if aud else
                    f'[1:a]atrim=0:{d}[a]'),
                 '-map', '[v]', '-map', '[a]', '-t', str(d), '-c:v', 'libx264', '-preset', 'fast', '-crf', '12',
                 '-c:a', 'pcm_s16le', str(seg)])
        else:
            run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                 '-f', 'lavfi', '-i', f'color=c=black:s=1080x1920:r={FPS}:d={d}',
                 '-f', 'lavfi', '-i', f'anullsrc=r={SR}:cl=stereo', '-t', str(d),
                 '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p',
                 '-c:a', 'pcm_s16le', str(seg)])
        segs.append(seg)
    bg = BUILD / 'background.mov'
    (BUILD / 'segments.txt').write_text(''.join(f"file '{s}'\n" for s in segs))
    run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
         '-i', str(BUILD / 'segments.txt'), '-c', 'copy', str(bg)])
    return bg, voiced


def build(lang, args, clips, music, bg, voiced):
    print(f'\n=== {lang} cut ===')
    # graphics / stills layer
    frames = BUILD / f'frames-{lang}'
    if not args.skip_render or not frames.exists():
        shutil.rmtree(frames, ignore_errors=True)
        cmd = ['node', ROOT / 'src/render.mjs', '--out', frames, '--lang', lang, '--workers', '3']
        if clips:
            cmd += ['--footage', ','.join(clips)]
        run(cmd)

    # voice-over: recorded track wins; otherwise generated for English
    vo = None
    if not args.no_vo:
        vo = find(f'vo-{lang}', ('.wav', '.mp3', '.m4a'))
        if vo is None and (FOOT / f'vo-{lang}').is_dir():
            vo = BUILD / f'vo-{lang}-lines.wav'
            save(vo, assemble_lines(FOOT / f'vo-{lang}', set(voiced)))
        elif vo is None and lang == 'en':
            vo = BUILD / 'vo-en.wav'
            run([sys.executable, ROOT / 'src/voiceover.py', vo, '--voice', args.voice, '--skip', ','.join(voiced)])
    print('voice-over:', vo or 'none')

    # mix: music ducked under any speech (voice-over + on-camera audio), then loudness-normalised
    m = load(music)
    speech = np.zeros_like(m)
    if vo:
        speech += load(vo)
    if clips:
        speech += load(bg)
    mix = m * duck_gain(speech) + speech if speech.any() else m
    save(BUILD / f'mix-{lang}-raw.wav', mix / max(1.0, np.abs(mix).max()))
    audio = BUILD / f'mix-{lang}.wav'
    run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(BUILD / f'mix-{lang}-raw.wav'),
         '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.84:level=0',
         '-t', str(DUR), '-c:a', 'pcm_s16le', str(audio)])

    # video: graphics over the footage background (if any), muxed with the mix
    out = OUT / f'rns-reel-{lang}-9x16.mp4'
    vin = ['-framerate', str(FPS), '-i', str(frames / 'f%04d.png')]
    vfc = '[0:v]format=yuv420p[v]'
    if clips:
        vin += ['-i', str(bg)]
        vfc = '[1:v][0:v]overlay=format=auto,format=yuv420p[v]'
    run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *vin, '-i', str(audio),
         '-filter_complex', vfc, '-map', '[v]', '-map', f'{2 if clips else 1}:a',
         '-t', str(DUR), '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level', '4.1',
         '-pix_fmt', 'yuv420p', '-r', str(FPS), '-g', str(FPS * 2), '-bf', '2',
         '-c:a', 'aac', '-b:a', '192k', '-ar', str(SR), '-movflags', '+faststart', str(out)])
    run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', '1.6', '-i', str(out),
         '-frames:v', '1', '-q:v', '2', str(OUT / f'rns-reel-{lang}-thumbnail.jpg')])
    print('done →', out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--lang', choices=['ml', 'en', 'all'], default='all')
    ap.add_argument('--skip-render', action='store_true')
    ap.add_argument('--no-vo', action='store_true')
    ap.add_argument('--voice', default='af_heart', help='Kokoro voice for the generated English VO')
    args = ap.parse_args()

    BUILD.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)
    clips = {s: p for s in SLOTS if (p := find(s))}
    print('footage slots:', ', '.join(clips) or 'none (stills version)')

    music = find('music', ('.wav', '.mp3', '.m4a'))
    if music is None:
        music = BUILD / 'music_raw.wav'
        run([sys.executable, ROOT / 'src/music.py', music])

    bg, voiced = background(clips) if clips else (None, [])
    for lang in (['ml', 'en'] if args.lang == 'all' else [args.lang]):
        build(lang, args, clips, music, bg, voiced)


if __name__ == '__main__':
    main()
