"""本地自包含 Web 预览：从 verify_ui 的真实 NAS fixture 提供 /api/state、/api/config，
   并静态托管 litedock/app/web。仅用于 verify_web_dom.js 在无 NAS 隧道时做真实浏览器渲染校验。
   用法：python tools/serve_web_preview.py  （监听 127.0.0.1:23000）"""
import os, json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
ROOT = os.path.dirname(APP)
WEB = os.path.join(ROOT, "litedock", "app", "web")
FIX = os.environ.get("LD_FIXTURE") or os.path.join(HERE, "fixtures", "state.json")
with open(FIX, encoding="utf-8") as f:
    STATE = json.load(f)
CONFIG = STATE.get("config", {})

MIME = {".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
        ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon"}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/api/state":
            return self._json(STATE)
        if p == "/api/config":
            return self._json(CONFIG)
        if p == "/api/info":
            return self._json(STATE.get("info", {}))
        if p in ("/", "/index.html"):
            p = "/index.html"
        fp = os.path.normpath(os.path.join(WEB, p.lstrip("/")))
        if not fp.startswith(WEB) or not os.path.isfile(fp):
            self.send_response(404); self.end_headers(); return
        with open(fp, "rb") as f:
            b = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(os.path.splitext(fp)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 23000
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
