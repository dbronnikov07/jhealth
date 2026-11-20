"""Record the coach's spoken lines once, as small audio files the app plays back.

Why: the browser's built-in speech synthesiser sounds robotic and different on every device. The session only ever
says about fifty short things (the count, the cues, a few set phrases), so we record them once with a natural
voice and ship the files. The same voice then plays on every phone and laptop, and nothing is sent to a cloud
service while a patient exercises.

The voice is Kokoro-82M (open model, Apache 2.0), run on this laptop. To use a real person instead, record the
same lines yourself and save them over the files in web/public/voice/ with the same names: see lines.json there.

Set-up, once (kept outside the repo, about 600 MB):
    python3 -m venv ~/jhealth-cache/tts/venv && ~/jhealth-cache/tts/venv/bin/pip install kokoro-onnx soundfile
    cd ~/jhealth-cache/tts && curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx \\
        && curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

Run from web/:
    ~/jhealth-cache/tts/venv/bin/python scripts/make-voice.py                      # all lines, default voice
    ~/jhealth-cache/tts/venv/bin/python scripts/make-voice.py --voice am_michael   # another voice
    ~/jhealth-cache/tts/venv/bin/python scripts/make-voice.py --samples DIR        # one test phrase in several voices
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "public" / "voice"
TTS = Path.home() / "jhealth-cache" / "tts"
NUMBERS = ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen",
           "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty", "Twenty-one", "Twenty-two",
           "Twenty-three", "Twenty-four", "Twenty-five", "Twenty-six", "Twenty-seven", "Twenty-eight", "Twenty-nine", "Thirty"]
SET_PHRASES = {
    "start": "Camera's ready. Take your time.",
    "start_squat": "Camera's ready. Let's do the chair squat. Take your time.",
    "start_sit_to_stand": "Camera's ready. Let's do sit to stand. Take your time.",
    "start_arm_raise": "Camera's ready. Let's do the arm raise, out to the side. Take your time.",
    "halfway": "Halfway there.",
    "set_done": "That's the set. Take a breather, then carry on.",
    "all_done": "Nice work. That's all of them.",
}
SAMPLE = "Camera's ready. Let's do the chair squat. Take your time. One. Two. Three. Knees out, over your toes. Halfway there. Nice work."
SAMPLE_VOICES = ["af_heart", "af_bella", "am_michael", "am_fenrir", "bf_emma", "bm_george"]


def cues():
    """The cue wording comes from the app itself, so the recording can never drift from the text on screen."""
    js = "import('./src/lib/pose/exercises.ts').then((m) => console.log(JSON.stringify(m.CUE)))"
    out = subprocess.run(["node", "--no-warnings", "-e", js], cwd=WEB, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def lines():
    all_lines = {f"n{i}": f"{word}." for i, word in enumerate(NUMBERS, 1)}
    all_lines.update({key: text if text.endswith((".", "!", "?")) else text + "." for key, text in cues().items()})
    all_lines.update(SET_PHRASES)
    return all_lines


def trim(samples, rate, floor=0.012, lead=0.02, tail=0.09):
    """Cut the silence before and after the words, so two clips played back to back sound like one sentence."""
    loud = np.flatnonzero(np.abs(samples) > floor * max(1e-9, np.abs(samples).max()))
    if not len(loud):
        return samples
    a, b = max(0, loud[0] - int(lead * rate)), min(len(samples), loud[-1] + int(tail * rate))
    cut = samples[a:b].copy()
    fade = int(0.01 * rate)
    cut[:fade] *= np.linspace(0, 1, fade); cut[-fade:] *= np.linspace(1, 0, fade)
    return cut


def write_mp3(samples, rate, path):
    import soundfile as sf
    wav = path.with_suffix(".wav")
    sf.write(wav, samples, rate)
    # One loudness for every clip (-18 LUFS is comfortable for speech), mono, small.
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-af", "loudnorm=I=-18:TP=-2:LRA=7", "-ar", "44100", "-ac", "1",
                    "-codec:a", "libmp3lame", "-b:a", "64k", str(path)], check=True)
    wav.unlink()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--voice", default="af_heart")
    ap.add_argument("--speed", type=float, default=0.95)
    ap.add_argument("--samples", type=Path, help="write one test phrase per voice into this folder and stop")
    args = ap.parse_args()
    from kokoro_onnx import Kokoro
    model, voices = TTS / "kokoro-v1.0.onnx", TTS / "voices-v1.0.bin"
    if not model.exists() or not voices.exists():
        sys.exit(f"voice model not found in {TTS}; see the set-up lines at the top of this file")
    kokoro = Kokoro(str(model), str(voices))

    def speak(text, voice):
        samples, rate = kokoro.create(text, voice=voice, speed=args.speed, lang="en-gb" if voice.startswith("b") else "en-us")
        return np.asarray(samples, dtype=np.float32), rate

    if args.samples:
        args.samples.mkdir(parents=True, exist_ok=True)
        for voice in SAMPLE_VOICES:
            samples, rate = speak(SAMPLE, voice)
            write_mp3(trim(samples, rate), rate, args.samples / f"sample_{voice}.mp3")
            print("wrote", args.samples / f"sample_{voice}.mp3", f"{len(samples) / rate:.1f} s")
        return

    OUT.mkdir(parents=True, exist_ok=True)
    table = lines()
    total = 0
    for key, text in table.items():
        samples, rate = speak(text, args.voice)
        write_mp3(trim(samples, rate), rate, OUT / f"{key}.mp3")
        total += (OUT / f"{key}.mp3").stat().st_size
    (OUT / "lines.json").write_text(json.dumps({"voice": f"Kokoro-82M {args.voice}", "speed": args.speed, "lines": table}, indent=1) + "\n")
    print(f"wrote {len(table)} clips to {OUT} ({total / 1024:.0f} KB), voice {args.voice}")


if __name__ == "__main__":
    main()
