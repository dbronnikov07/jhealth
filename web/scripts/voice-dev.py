"""Development only: serve the two Python voice functions (api/tts.py, api/stt.py) on http://127.0.0.1:8799, the way
Vercel does in production. next.config.ts passes /api/tts and /api/stt through to it while `npm run dev` runs.

    npm run voice:dev        (uses ~/jhealth-cache/tts/venv and the models already downloaded there)
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


class Both(BaseHTTPRequestHandler):
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


print("voice functions on http://127.0.0.1:8799 (tts: Kokoro heart, stt: Whisper base.en)")
ThreadingHTTPServer(("127.0.0.1", 8799), Both).serve_forever()
