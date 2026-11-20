"""The spoken coach's voice, made on our own server: Kokoro-82M (open model, Apache 2.0), voice "af_heart", the same
voice as the recorded lines. No paid service, nothing sent to a third party.

POST /api/tts  {"text": "...", "exp": 1795150000, "sig": "<hex>"}  ->  audio/mpeg
    The text must carry a signature from /api/session/talk (HMAC-SHA256 with TTS_SECRET over "exp.text") that has not
    expired, so this endpoint only ever speaks what our own coach wrote, and only for a minute.
GET  /api/tts  ->  204, after loading the model: the session calls it while the camera starts, so the first answer
    does not wait for a cold start.

The model (int8, 92 MB) is downloaded once per server instance into /tmp: bundled, it would not fit the size limit.
"""
import hashlib
import hmac
import io
import json
import os
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx"
MODEL_PATH = "/tmp/kokoro-v1.0.int8.onnx"
MODEL_SHA256 = "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb"
VOICES_PATH = os.path.join(os.path.dirname(__file__), "voices-heart.npz")
MAX_TEXT = 400
_kokoro = None
_lock = threading.Lock()   # one model load and one synthesis at a time per instance


def model():
    with _lock:
        return _load()


def _load():
    global _kokoro
    if _kokoro is None:
        if not os.path.exists(MODEL_PATH):
            tmp = MODEL_PATH + ".part"
            urllib.request.urlretrieve(MODEL_URL, tmp)
            digest = hashlib.sha256(open(tmp, "rb").read()).hexdigest()
            if digest != MODEL_SHA256:
                os.remove(tmp)
                raise RuntimeError("voice model download did not match its checksum")
            os.replace(tmp, MODEL_PATH)
        import onnxruntime as rt
        from kokoro_onnx import Kokoro
        opts = rt.SessionOptions()
        opts.intra_op_num_threads = threads()
        opts.inter_op_num_threads = 1
        opts.graph_optimization_level = rt.GraphOptimizationLevel.ORT_ENABLE_ALL
        # Waiting threads that spin burn the small CPU share a serverless function gets, and slow the real work.
        opts.add_session_config_entry("session.intra_op.allow_spinning", "0")
        session = rt.InferenceSession(MODEL_PATH, sess_options=opts, providers=["CPUExecutionProvider"])
        k = Kokoro.from_session(session, VOICES_PATH)
        _reuse_phonemizer(k)
        # The first synthesis is slow (the phonemizer starts, about 1 s, and the model's kernels warm up): pay it here,
        # during the warm-up call the session makes while the camera starts, not on the patient's first answer.
        k.create("Okay, let's go.", voice="af_heart", speed=1.05, lang="en-us")
        _kokoro = k
    return _kokoro


def _reuse_phonemizer(k):
    """The library turns text into sounds with espeak, and starts a new espeak for every request that comes in on a new
    thread (each request does): about 1 s each time. One espeak, started once, gives the same sounds."""
    from phonemizer.backend import EspeakBackend
    backend = EspeakBackend("en-us", preserve_punctuation=True, with_stress=True)
    original = k.tokenizer.phonemize
    vocab = k.tokenizer.vocab
    lock = threading.Lock()

    def phonemize(text, lang="en-us", norm=True):
        if lang != "en-us":
            return original(text, lang, norm)
        if norm:
            text = text.strip()
        with lock:
            phonemes = backend.phonemize([text])[0]
        return "".join(p for p in phonemes if p in vocab).strip()

    k.tokenizer.phonemize = phonemize


def threads():
    """Threads for the voice model. More threads than real cores made it 3 to 5 times slower (8 threads on a laptop
    with 4 fast cores: 1 s for a sentence, 4 threads: 0.38 s). A serverless function reports 2 CPUs."""
    raw = os.environ.get("TTS_THREADS", "")
    if raw.isdigit() and 0 < int(raw) <= 8:
        return int(raw)
    return max(1, min(4, os.cpu_count() or 1))


def signed(text, exp, sig):
    secret = os.environ.get("TTS_SECRET", "")
    if not secret or not isinstance(text, str) or not isinstance(exp, int) or not isinstance(sig, str):
        return False
    if exp < time.time() or exp > time.time() + 600 or not 0 < len(text) <= MAX_TEXT:
        return False
    want = hmac.new(secret.encode(), f"{exp}.{text}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, sig)


class handler(BaseHTTPRequestHandler):
    def _send(self, code, body=b"", kind="text/plain"):
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if getattr(self, "_timing", None):
            self.send_header("Server-Timing", self._timing)   # how long the voice took, for our own speed checks
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        try:
            model()
            self._send(204)
        except Exception:
            self._send(503, b"voice not available")

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 4096:
            return self._send(413 if length > 4096 else 400, b"bad request")
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:
            return self._send(400, b"bad request")
        text, exp, sig = body.get("text"), body.get("exp"), body.get("sig")
        if not signed(text, exp, sig):
            return self._send(403, b"not signed")
        try:
            import soundfile as sf
            k = model()
            t0 = time.perf_counter()
            with _lock:
                samples, rate = k.create(text, voice="af_heart", speed=1.05, lang="en-us")   # a touch brisk: shorter to make
            t1 = time.perf_counter()
            buf = io.BytesIO()
            sf.write(buf, samples, rate, format="MP3")
            t2 = time.perf_counter()
            self._timing = f"synth;dur={(t1 - t0) * 1000:.0f}, enc;dur={(t2 - t1) * 1000:.0f}, cpu;desc={threads()}"
            self._send(200, buf.getvalue(), "audio/mpeg")
        except Exception:
            self._send(503, b"voice not available")
