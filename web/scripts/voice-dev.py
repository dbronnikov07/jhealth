"""The fast voice helper: the two Python voice functions (api/tts.py, api/stt.py) on http://127.0.0.1:8799.

    npm run voice:start      in the background: Terminal can be closed (npm run voice:stop to stop it)
    npm run voice:fast       in this Terminal window, for watching its log
    (both use ~/jhealth-cache/tts/venv and the models already downloaded there)

Two uses:
- The live site (https://motiva-health.vercel.app) looks for it when a camera session starts and, if it answers,
  sends speech to text and the coach's voice here instead of to our server: on this laptop that is about 0.05 s and
  0.2-0.4 s instead of 0.8 s and 1.5-3.5 s. Only browsers where /fast-voice was opened look for it. It accepts only the same signed tickets as the server (TTS_SECRET from
  web/.env.local), answers only to our own site's pages (CORS), and listens on the loopback address only, so nothing
  outside this laptop can reach it.
- Development: next.config.ts passes /api/tts and /api/stt through to it while `npm run dev` runs.
"""
import importlib.util
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent
CACHE = Path.home() / "jhealth-cache" / "tts"
for line in (WEB / ".env.local").read_text().splitlines():
    if line.startswith("TTS_SECRET="):
        os.environ["TTS_SECRET"] = line.split("=", 1)[1].strip().strip('"')


def load(name):
    spec = importlib.util.spec_from_file_location(name, WEB / "api" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


tts, stt = load("tts"), load("stt")
if (CACHE / "kokoro-v1.0.int8.onnx").exists():
    tts.MODEL_PATH = str(CACHE / "kokoro-v1.0.int8.onnx")
if (CACHE / "whisper" / "ggml-base.en.bin").exists():
    stt.MODEL_PATH = str(CACHE / "whisper" / "ggml-base.en.bin")


ALLOWED_ORIGINS = {"https://motiva-health.vercel.app", "https://jhealth-beta.vercel.app", "http://localhost:3100"}


class Both(BaseHTTPRequestHandler):
    def end_headers(self):
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "content-type, x-exp, x-sig")
            self.send_header("Access-Control-Allow-Methods", "GET, POST")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Access-Control-Max-Age", "600")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204 if self.headers.get("Origin", "") in ALLOWED_ORIGINS else 403)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _pick(self):
        return stt.handler if self.path.startswith("/api/stt") else tts.handler

    def do_GET(self):
        self._pick().do_GET(self)

    def do_POST(self):
        self._pick().do_POST(self)

    def _send(self, *a, **k):
        return self._pick()._send(self, *a, **k)

    def log_message(self, fmt, *args):
        print("voice", self.command, self.path, args[1] if len(args) > 1 else "")


# Both models load (and run once) before the helper answers, so the session's first check finds it ready.
import time
t = time.perf_counter()
tts.model()
stt.model()
print(f"Models ready in {time.perf_counter() - t:.1f} s (voice threads: {tts.threads()}).", flush=True)
print("Fast voice helper on http://127.0.0.1:8799 (speech to text: Whisper base.en, voice: Kokoro heart).", flush=True)
ThreadingHTTPServer(("127.0.0.1", 8799), Both).serve_forever()
