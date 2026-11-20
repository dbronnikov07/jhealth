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
import time
import urllib.request
from http.server import BaseHTTPRequestHandler

MODEL_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx"
MODEL_PATH = "/tmp/kokoro-v1.0.int8.onnx"
MODEL_SHA256 = "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb"
VOICES_PATH = os.path.join(os.path.dirname(__file__), "voices-heart.npz")
MAX_TEXT = 400
_kokoro = None


def model():
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
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro(MODEL_PATH, VOICES_PATH)
    return _kokoro


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
            samples, rate = model().create(text, voice="af_heart", speed=1.05, lang="en-us")   # a touch brisk: shorter to make
            buf = io.BytesIO()
            sf.write(buf, samples, rate, format="MP3")
            self._send(200, buf.getvalue(), "audio/mpeg")
        except Exception:
            self._send(503, b"voice not available")
