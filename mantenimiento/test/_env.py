"""Shared settings for the local test tools (seed.py, e2e.py, shots.py)."""
import json, os
BASE = os.environ.get('BASE', 'http://127.0.0.1:8787')
HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, '.state.json')          # written by seed.py: session ids and record ids
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
# The app has its own stylesheet and fonts now. THEME_CSS and the routes below are left from when it loaded the Hub's
# theme.css: they only keep a stray request to it off the network.
THEME = open(os.environ['THEME_CSS']).read() if os.environ.get('THEME_CSS') else None

def state():
    return json.load(open(STATE))

def launch(p):
    return p.chromium.launch(executable_path=CHROME, args=['--no-sandbox']) if os.path.exists(CHROME) else p.chromium.launch()

def route_theme(ctx):
    if THEME: ctx.route('**/theme.css*', lambda r: r.fulfill(status=200, content_type='text/css', body=THEME))
    else: ctx.route('**/theme.css*', lambda r: r.abort())
    ctx.route('**/fonts.googleapis.com/**', lambda r: r.abort())

def cookie(sid):
    return {'name': 'mt_sid', 'value': sid, 'url': BASE, 'httpOnly': True, 'secure': True, 'sameSite': 'Lax'}
