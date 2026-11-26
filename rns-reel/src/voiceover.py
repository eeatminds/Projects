"""English voice-over for the reel, generated locally with Kokoro TTS (Apache-2.0 model + voices).

Each line is fitted to its scene window (speed nudged up if it runs long) and placed on a 20 s
timeline, written as a 24 kHz mono WAV.  Slots that already carry on-camera speech are skipped.

    python3 src/voiceover.py OUT.wav [--voice af_heart] [--skip s3,s1]

The model files (~350 MB) are downloaded into models/ on first use.
"""
import argparse
import sys
import urllib.request
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / 'models'
FILES = {
    'kokoro-v1.0.onnx': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx',
    'voices-v1.0.bin': 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin',
}
DUR = 20.0

# When each voice-over line may play (start, latest end), shared by every language. The last
# line starts just before the end-card cut (a J-cut) so it has room to breathe.
WINDOWS = {'s1': (0.15, 2.85), 's2': (3.10, 7.85), 's3': (8.30, 13.80), 's4': (14.15, 17.30), 's5': (17.35, 19.92)}

# English narrator lines. Spelled for the TTS: "hundred-bed", not "100-bed". Wording was checked
# with speech-to-text: "Hostel rooms" came out as "hostile rooms" and "WhatsApp us" as
# "what's up us", hence the phrasing below.
SCRIPT_EN = {
    's1': 'Finished Plus Two? What next?',
    's2': 'Train in our skills lab. Then, ward rounds at our own hundred-bed hospital.',
    's3': "Devika studied nursing here. Today, she's an advanced practice nurse in Ireland.",
    's4': 'Stay in our hostel, with Kerala food day every week.',
    's5': 'Admissions open. Message us on WhatsApp!',
}
# Malayalam lines for a voice artist or a Malayalam-capable TTS (not generated here: the open
# Malayalam voices available offline do not have a clear licence for paid ads).
SCRIPT_ML = {
    's1': 'പ്ലസ് ടു കഴിഞ്ഞോ? ഇനി എന്ത്?',
    's2': 'ആദ്യം സ്കിൽസ് ലാബിൽ പരിശീലനം. പിന്നെ, സ്വന്തം നൂറ് ബെഡ് ആശുപത്രിയിൽ വാർഡ് റൗണ്ട്സ്.',
    's3': 'ദേവിക ഇവിടെയാണ് നഴ്സിങ് പഠിച്ചത്. ഇന്ന് അയർലൻഡിൽ അഡ്വാൻസ്ഡ് പ്രാക്ടീസ് നഴ്സാണ്.',
    's4': 'ഹോസ്റ്റൽ സൗകര്യം, എല്ലാ ആഴ്ചയും കേരള ഫുഡ് ഡേ.',
    's5': 'അഡ്മിഷൻ തുടങ്ങി. ഇപ്പോൾ തന്നെ WhatsApp ചെയ്യൂ!',
}
# Pronunciation overrides (IPA). Default US phonemes give "dih-VIK-uh" and "KERR-uh-luh".
PRONOUNCE = {'Devika': 'dˈeɪvɪkə', 'Kerala': 'kˈeɪɾələ'}


def ensure_models():
    MODELS.mkdir(exist_ok=True)
    for name, url in FILES.items():
        p = MODELS / name
        if not p.exists():
            print('downloading', name)
            urllib.request.urlretrieve(url, p)


def trim(x, sr, thresh=0.01):
    idx = np.where(np.abs(x) > thresh)[0]
    if not len(idx):
        return x
    a = max(0, idx[0] - int(0.02 * sr))
    b = min(len(x), idx[-1] + int(0.06 * sr))
    return x[a:b]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out')
    ap.add_argument('--voice', default='af_heart')
    ap.add_argument('--skip', default='')
    args = ap.parse_args()
    skip = set(filter(None, args.skip.split(',')))

    ensure_models()
    from kokoro_onnx import Kokoro
    tts = Kokoro(str(MODELS / 'kokoro-v1.0.onnx'), str(MODELS / 'voices-v1.0.bin'))

    sr = 24000
    track = np.zeros(int(DUR * sr), dtype=np.float32)
    for slot, text in SCRIPT_EN.items():
        a, b = WINDOWS[slot]
        if slot in skip:
            print(f'{slot}: skipped (on-camera audio)')
            continue
        window = b - a
        speed = 1.0
        phon = tts.tokenizer.phonemize(text, 'en-us')
        for word, ipa in PRONOUNCE.items():
            phon = phon.replace(tts.tokenizer.phonemize(word, 'en-us').strip(), ipa)
        for _ in range(4):
            samples, sr_ = tts.create(phon, voice=args.voice, speed=speed, is_phonemes=True)
            assert sr_ == sr
            clip = trim(np.asarray(samples, dtype=np.float32), sr)
            length = len(clip) / sr
            if length <= window or speed >= 1.3:
                break
            speed = min(1.3, speed * length / window * 1.02)
        if length > window:
            print(f'WARNING {slot}: line runs {length - window:.2f}s past its scene; shorten the text', file=sys.stderr)
        i = int(a * sr)
        clip = clip[: len(track) - i]
        clip *= np.minimum(1, (len(clip) - np.arange(len(clip))) / (0.02 * sr))   # soft tail
        track[i:i + len(clip)] += clip
        print(f'{slot}: {a:5.2f}–{a + length:5.2f}s (window ends {b:.2f}, speed {speed:.2f})  "{text}"')

    peak = np.max(np.abs(track)) or 1.0
    track = track / peak * 0.9
    with wave.open(args.out, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((track * 32767).astype('<i2').tobytes())
    print('wrote', args.out)


if __name__ == '__main__':
    main()
