"""serve.py — public/ on a local port the way Vercel serves it: x.json comes from x.json.gz with
Content-Encoding: gzip (vercel.json's /cfb/ rewrite). For shoot.py and hand testing.

    python3 tools/savant-cfb/serve.py [port]        # default 8791
"""
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public")


class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        p = self.path.split("?")[0].split("#")[0]
        f = os.path.join(ROOT, p.lstrip("/"))
        if p.endswith(".json") and not os.path.exists(f) and os.path.exists(f + ".gz"):
            b = open(f + ".gz", "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)
            return
        return super().do_GET()

    def log_message(self, *a):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8791), H).serve_forever()
