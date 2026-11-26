#!/usr/bin/env python3
"""Build the 20 s RNS College of Nursing reel (1080x1920, 30 fps, H.264 + AAC) for Meta ads.

    python3 build.py                 (add --skip-render to reuse build/frames)

Real footage: drop clips into footage/ named after their slot and rebuild. Any slot without a
clip falls back to the still-photo version from rnsnursingcollege.com.

    footage/s1.mp4   0–3 s   student to camera (keep the face in the lower half; text sits on top)
    footage/s2.mp4   3–8 s   skills lab, then ward rounds
    footage/s3.mp4   8–14 s  alumna abroad, speaking Malayalam (written consent on file)
    footage/s4.mp4   14–18 s hostel room + weekly Kerala food day

Clips are scaled to fill 9:16, trimmed from their start to the slot length, and their own audio
(e.g. the alumna's voice) is mixed in while the music ducks underneath.
Own music: put footage/music.wav (or .mp3/.m4a) to replace the generated bed.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILD, OUT, FOOT = ROOT / 'build', ROOT / 'out', ROOT / 'footage'
SLOTS = {'s1': (0.0, 3.0), 's2': (3.0, 8.0), 's3': (8.0, 14.0), 's4': (14.0, 18.0)}
FPS, DUR = 30, 20


def run(cmd):
    print('$', ' '.join(map(str, cmd))[:220])
    subprocess.run(cmd, check=True)


def has_audio(p):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index',
                        '-of', 'json', str(p)], capture_output=True, text=True, check=True)
    return bool(json.loads(r.stdout).get('streams'))


def find(stem):
    for ext in ('.mp4', '.mov', '.m4v', '.webm', '.mkv'):
        if (FOOT / f'{stem}{ext}').exists():
            return FOOT / f'{stem}{ext}'
    return None


def main():
    BUILD.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)
    clips = {s: p for s in SLOTS if (p := find(s))}
    print('footage slots:', ', '.join(clips) or 'none (stills version)')

    # 1. music bed
    music = next((FOOT / f'music{e}' for e in ('.wav', '.mp3', '.m4a') if (FOOT / f'music{e}').exists()), None)
    if music is None:
        music = BUILD / 'music_raw.wav'
        run([sys.executable, ROOT / 'src/music.py', music])

    # 2. graphics / stills layer
    frames = BUILD / 'frames'
    if '--skip-render' not in sys.argv:          # reuse build/frames when only footage/music changed
        shutil.rmtree(frames, ignore_errors=True)
        cmd = ['node', ROOT / 'src/render.mjs', '--out', frames, '--workers', '3']
        if clips:
            cmd += ['--footage', ','.join(clips)]
        run(cmd)

    # 3. background track for footage slots: each clip normalised to exactly its slot length
    #    (9:16 fill, 30 fps, 48 kHz stereo), gaps filled with black + silence, then concatenated.
    segs, voiced, cursor = [], [], 0.0
    for slot, (a, b) in list(SLOTS.items()) + [('end', (18.0, 20.0))]:
        d = b - a
        seg = BUILD / f'seg_{slot}.mp4'
        if slot in clips:
            src, aud = clips[slot], has_audio(clips[slot])
            if aud:
                voiced.append((a, b))
            run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', str(src),
                 '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-filter_complex',
                 f'[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps={FPS},'
                 f'trim=0:{d},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={d},format=yuv420p[v];'
                 + (f'[0:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=0:{d},asetpts=PTS-STARTPTS,'
                    f'afade=t=in:d=0.06,apad,atrim=0:{d},afade=t=out:st={d - 0.12}:d=0.12[a]' if aud else
                    f'[1:a]atrim=0:{d}[a]'),
                 '-map', '[v]', '-map', '[a]', '-t', str(d), '-c:v', 'libx264', '-preset', 'fast', '-crf', '12',
                 '-c:a', 'pcm_s16le', str(seg.with_suffix('.mov'))])
        else:
            run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                 '-f', 'lavfi', '-i', f'color=c=black:s=1080x1920:r={FPS}:d={d}',
                 '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', str(d),
                 '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p',
                 '-c:a', 'pcm_s16le', str(seg.with_suffix('.mov'))])
        segs.append(seg.with_suffix('.mov'))

    # 4. audio, rendered on its own: music (ducked under on-camera speech) + footage audio, loudness-normalised
    bg = BUILD / 'background.mov'
    if clips:
        (BUILD / 'segments.txt').write_text(''.join(f"file '{sp}'\n" for sp in segs))
        run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
             '-i', str(BUILD / 'segments.txt'), '-c', 'copy', str(bg)])
    duck = '+'.join(f'between(t,{a},{b})' for a, b in voiced)
    mus = (f'[0:a]aformat=sample_rates=48000:channel_layouts=stereo,apad,atrim=0:{DUR},asetpts=PTS-STARTPTS'
           + (f",volume='if({duck},0.22,1)':eval=frame" if voiced else '') + '[mus]')
    if clips:
        afc = mus + f';[1:a]atrim=0:{DUR},asetpts=PTS-STARTPTS[fx];[mus][fx]amix=inputs=2:duration=first:normalize=0[mx]'
        ain = ['-i', str(music), '-i', str(bg)]
    else:
        afc, ain = mus.replace('[mus]', '[mx]'), ['-i', str(music)]
    audio = BUILD / 'mix.wav'
    run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *ain, '-filter_complex',
         afc + ';[mx]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.84:level=0[a]', '-map', '[a]',
         '-t', str(DUR), '-c:a', 'pcm_s16le', str(audio)])

    # 5. video: graphics layer over the background (if any), then mux with the audio
    out = OUT / 'rns-reel-9x16.mp4'
    vin = ['-framerate', str(FPS), '-i', str(frames / 'f%04d.png')]
    if clips:
        vin += ['-i', str(bg)]
        vfc = '[1:v][0:v]overlay=format=auto,format=yuv420p[v]'
    else:
        vfc = '[0:v]format=yuv420p[v]'
    run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *vin, '-i', str(audio),
         '-filter_complex', vfc, '-map', '[v]', '-map', f'{2 if clips else 1}:a',
         '-t', str(DUR), '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level', '4.1',
         '-pix_fmt', 'yuv420p', '-r', str(FPS), '-g', str(FPS * 2), '-bf', '2',
         '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', str(out)])
    run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', '1.6', '-i', str(out),
         '-frames:v', '1', '-q:v', '2', str(OUT / 'rns-reel-thumbnail.jpg')])
    print('done →', out)


if __name__ == '__main__':
    main()
