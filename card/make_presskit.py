#!/usr/bin/env python3
"""Build the downloadable press kit: EN + ES PDFs (print mode of /press/) and a ZIP of the press photos.
Run after build_app.py:  python3 make_presskit.py   (needs google-chrome)"""
import os, subprocess, threading, zipfile, json, re, http.server, socketserver, functools, time
ROOT = os.path.dirname(os.path.abspath(__file__)); PUB = os.path.join(ROOT, "public"); DOCS = os.path.join(PUB, "docs")
os.makedirs(DOCS, exist_ok=True)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Q, directory=PUB)); port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
for lang, name in (("en", "Dos-Buhos-Press-Kit-EN.pdf"), ("es", "Dos-Buhos-Kit-de-Prensa-ES.pdf")):
    out = os.path.join(DOCS, name)
    subprocess.run(["google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--no-first-run", "--disable-sync", "--no-pdf-header-footer",
                    "--virtual-time-budget=8000", f"--print-to-pdf={out}", f"http://127.0.0.1:{port}/press/index.html?print=1&lang={lang}"],
                   check=True, capture_output=True)
    print(name, os.path.getsize(out) // 1024, "KB")
srv.shutdown()
# photos zip — every photo the press kit lists, named by its caption
html = open(os.path.join(PUB, "press", "index.html"), encoding="utf-8").read()
import ast
photos = ast.literal_eval(re.search(r"^PHOTOS = (\[.*?^\])", open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "build_app.py"), encoding="utf-8").read(), re.S | re.M).group(1))  # full selection, not just the 8 on the page
zp = os.path.join(DOCS, "Dos-Buhos-Press-Photos.zip")
with zipfile.ZipFile(zp, "w", zipfile.ZIP_STORED) as z:
    for i, p in enumerate(photos, 1):
        cap = re.sub(r"[^A-Za-z0-9]+", "-", p["en"]).strip("-")
        tag = "-LOWRES" if p.get("lowres") else ""
        z.write(os.path.join(PUB, p["f"]), f"Dos-Buhos-{i:02d}-{cap}{tag}.jpg")
    z.writestr("README.txt", "Dos Búhos press photos. Credit: Dos Búhos.\nFiles marked LOWRES are previews; high-resolution versions on request: cabosari@dosbuhos.com\n")
print("zip", os.path.getsize(zp) // 1024, "KB", len(photos), "photos")
