"""Speech to text for the spoken coach, on our own server: Whisper base.en (open model, MIT) through whisper.cpp.

Why not the browser's own speech recognition: it only exists in some browsers, needs Dictation switched on in
Safari, sends audio to Apple or Google, and on our test devices it never returned a single sentence. The page now
records short utterances itself (with the browser's echo cancellation, so the coach's voice is removed) and posts
them here. Nothing is stored: the audio is transcribed in memory and dropped.

POST /api/stt   body: raw 16 kHz mono 16-bit PCM (at most 30 s)   headers: x-exp, x-sig   ->  {"text": "..."}
    x-sig is an HMAC-SHA256 with TTS_SECRET over "stt.<exp>", issued by the session page for a few hours, so only
    someone with a patient link can use this endpoint.
GET  /api/stt   ->  204 after loading the model (the session calls it while the camera starts).

The model (148 MB) is downloaded once per server instance into /tmp and checked against its SHA-256.
"""
import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler

MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
MODEL_PATH = "/tmp/ggml-base.en.bin"
MODEL_SHA256 = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
MAX_BYTES = 16000 * 2 * 30          # 30 s: a WhatsApp voice note (live phrases are at most 10 s)
# Words Whisper should expect. Without it, a question about "the weather" at two metres from a laptop came back as
# "the name of the map" (live log, 20 November). A short hint of the vocabulary, not sentences to copy.
# The hint costs about 0.4 s on our small hosted server, so only the fast voice helper (scripts/voice-dev.py) uses it.
USE_PROMPT = False
# Only ever set on the team's own computer, to find out why something was misheard: the last utterances are kept
# there as .wav files. Never set on the hosted site, where audio is transcribed in memory and dropped.
DEBUG_DIR = os.environ.get("STT_DEBUG_DIR") or None
PROMPT = ("A patient talks to Motiva, their rehab coach, during chair squats and sit-to-stand: repetitions, knee bend, "
          "form, the camera, the weather today, how are you, can you hear me.")
_model = None
# One transcription at a time per instance: whisper.cpp is not safe to call from two threads at once, and two
# overlapping requests crashed the function twice in the live log (20 November, 00:58).
_lock = threading.Lock()


def model():
    global _model
    with _lock:
        return _load()


def _load():
    global _model
    if _model is None:
        if not os.path.exists(MODEL_PATH):
            tmp = MODEL_PATH + ".part"
            urllib.request.urlretrieve(MODEL_URL, tmp)
            h = hashlib.sha256()
            with open(tmp, "rb") as f:
                for chunk in iter(lambda: f.read(1 << 20), b""):
                    h.update(chunk)
            if h.hexdigest() != MODEL_SHA256:
                os.remove(tmp)
                raise RuntimeError("speech model download did not match its checksum")
            os.replace(tmp, MODEL_PATH)
        from pywhispercpp.model import Model
        m = Model(MODEL_PATH, print_realtime=False, print_progress=False, n_threads=max(1, min(4, os.cpu_count() or 1)))
        import numpy as np
        # The first real transcription is the slow one (2 to 3 s with the bigger model), so it is done here, on two
        # seconds of faint noise with the same settings as a real request. Silence is not enough: it returns early.
        noise = (np.random.default_rng(0).standard_normal(32000) * 0.02).astype(np.float32)
        m.transcribe(noise, language="en", single_segment=True, no_context=True, suppress_blank=True, audio_ctx=228,
                     **({"initial_prompt": PROMPT} if USE_PROMPT else {}))
        _model = m
    return _model


def allowed(exp, sig):
    secret = os.environ.get("TTS_SECRET", "")
    try:
        exp = int(exp)
    except (TypeError, ValueError):
        return False
    if not secret or not isinstance(sig, str) or exp < time.time() or exp > time.time() + 6 * 3600:
        return False
    want = hmac.new(secret.encode(), f"stt.{exp}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, sig)


def clean(text):
    """Whisper writes sounds as [BLANK_AUDIO] or (music), and sometimes repeats itself on noise."""
    text = re.sub(r"\[[^\]]*\]|\([^)]*\)|\*[^*]*\*", " ", text)
    text = re.sub(r'["“”]', "", text)
    text = re.sub(r"\s+", " ", text).strip()
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = []
    for p in parts:                       # "I am okay. I am okay." -> once
        if not out or p.lower() != out[-1].lower():
            out.append(p)
    return " ".join(out)[:300]


def keep_for_debugging(audio, text):
    """Team computer only (STT_DEBUG_DIR): the utterance as a .wav next to what Whisper made of it; the newest 40."""
    try:
        import wave
        import numpy as np
        os.makedirs(DEBUG_DIR, exist_ok=True)
        name = time.strftime("%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
        with wave.open(os.path.join(DEBUG_DIR, name + ".wav"), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
        with open(os.path.join(DEBUG_DIR, name + ".txt"), "w") as f:
            f.write(text + "\n")
        old = sorted(n for n in os.listdir(DEBUG_DIR) if n.endswith(".wav"))[:-40]
        for n in old:
            for ext in (".wav", ".txt"):
                try:
                    os.remove(os.path.join(DEBUG_DIR, n[:-4] + ext))
                except OSError:
                    pass
    except Exception:
        pass


class handler(BaseHTTPRequestHandler):
    def _send(self, code, body=b"", kind="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if getattr(self, "_timing", None):
            self.send_header("Server-Timing", self._timing)   # how long transcription took, for our own speed checks
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        try:
            model()
            self._send(204)
        except Exception:
            self._send(503, b'{"error":"speech model not available"}')

    def do_POST(self):
        if not allowed(self.headers.get("x-exp"), self.headers.get("x-sig")):
            return self._send(403, b'{"error":"not signed"}')
        length = int(self.headers.get("Content-Length") or 0)
        if length < 3200 or length > MAX_BYTES or length % 2:
            return self._send(413 if length > MAX_BYTES else 400, b'{"error":"bad audio"}')
        try:
            import numpy as np
            audio = np.frombuffer(self.rfile.read(length), dtype="<i2").astype(np.float32) / 32768.0
            seconds = len(audio) / 16000
            # Whisper invents words for silence ("directional."), so near-silent audio is answered with nothing.
            if float(np.sqrt(np.mean(audio * audio))) < 0.004:
                return self._send(200, b'{"text": ""}')
            m = model()
            t0 = time.perf_counter()
            with _lock:
                segments = m.transcribe(
                    audio, language="en", single_segment=True, no_context=True, suppress_blank=True,
                    audio_ctx=min(1500, int(seconds * 50) + 128),     # only as much context as there is audio: faster
                    **({"initial_prompt": PROMPT} if USE_PROMPT else {}),
                )
            text = clean(" ".join(s.text for s in segments))
            if DEBUG_DIR:
                keep_for_debugging(audio, text)
            self._timing = f"stt;dur={(time.perf_counter() - t0) * 1000:.0f}"
            self._send(200, json.dumps({"text": text}).encode())
        except Exception:
            self._send(503, b'{"error":"could not transcribe"}')
