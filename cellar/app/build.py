#!/usr/bin/env python3
"""Build public/ from the Claude artifact source.
Usage: python3 cellar/app/build.py [path/to/cellar-targets.html]
Wraps the artifact in a full HTML document and loads web-shim.js first, so the page's
window.claude.use(...) calls go to this Worker (D1, Google Sheets, Claude API) instead of claude.ai."""
import pathlib, shutil, sys
here = pathlib.Path(__file__).resolve().parent
src = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else here / "cellar-targets.html"
out = here.parent / "public"
out.mkdir(exist_ok=True)
body = src.read_text(encoding="utf-8")
if src != here / "cellar-targets.html":
    shutil.copyfile(src, here / "cellar-targets.html")
head = ('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<meta name="robots" content="noindex">\n<meta name="theme-color" content="#f6f3ee">\n'
        '<script src="/web-shim.js"></script>\n')
i = body.find("<style")  # artifact puts <title>, metas and fonts first; keep them in <head>
page = head + body[:i] + body[i:] if i >= 0 else head + body
(out / "index.html").write_text(page + '\n<script src="/chat-ui.js" defer></script>\n</html>\n', encoding="utf-8")
shutil.copyfile(here / "web-shim.js", out / "web-shim.js")
shutil.copyfile(here / "chat-ui.js", out / "chat-ui.js")
print("built", out / "index.html", len(page), "bytes")
