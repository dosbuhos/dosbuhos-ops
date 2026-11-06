#!/usr/bin/env python3
"""Builds cellar/public/staging-review.html: tonight's changes (CHANGELOG.md) with before/after screenshots from review/.
Open it on staging at /staging-review.html. Screenshots are copied to cellar/public/staging-review/."""
import html, pathlib, re, shutil

here = pathlib.Path(__file__).parent
pub = here.parent / 'public'
dst = pub / 'staging-review'
if dst.exists():
    shutil.rmtree(dst)
dst.mkdir(parents=True)

def md(text):
    out, para = [], []
    for line in text.splitlines():
        if line.startswith('#'):
            n = len(line) - len(line.lstrip('#'))
            out.append(f'<h{n + 1}>{html.escape(line.lstrip("#").strip())}</h{n + 1}>')
        elif line.strip().startswith(('- ', '* ')):
            out.append('<li>' + inline(line.strip()[2:]) + '</li>')
        elif line.strip():
            out.append('<p>' + inline(line.strip()) + '</p>')
    return '\n'.join(out)

def inline(s):
    s = html.escape(s)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'`(.+?)`', r'<code>\1</code>', s)
    return s

log = (here / 'CHANGELOG.md').read_text() if (here / 'CHANGELOG.md').exists() else ''
shots = []
for night in sorted((here / 'review').glob('*'), reverse=True):
    if not night.is_dir():
        continue
    pairs = {}
    for f in sorted(night.glob('*.png')):
        m = re.match(r'(.+?)-(before|after)\.png$', f.name)
        key, kind = (m.group(1), m.group(2)) if m else (f.stem, 'after')
        (dst / night.name).mkdir(exist_ok=True)
        shutil.copyfile(f, dst / night.name / f.name)
        pairs.setdefault(key, {})[kind] = f'staging-review/{night.name}/{f.name}'
    if pairs:
        shots.append((night.name, pairs))

cards = ''.join(
    f'<section><h2>{html.escape(n)}</h2>' + ''.join(
        f'<figure><figcaption>{html.escape(k)}</figcaption><div class="pair">'
        + ''.join(f'<div><small>{lbl}</small><img loading="lazy" src="{p[kind]}" alt="{html.escape(k)} {lbl}"></div>'
                  for kind, lbl in (('before', 'antes'), ('after', 'después')) if kind in p)
        + '</div></figure>' for k, p in pairs.items()) + '</section>'
    for n, pairs in shots)

page = f'''<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Revisión de staging</title><style>
body{{margin:0;font:15px/1.5 system-ui,sans-serif;color:#2b3330;background:#f6f5f1}}main{{max-width:980px;margin:0 auto;padding:16px}}
h1{{font-size:22px;margin:8px 0 4px}}h2{{font-size:18px;margin:24px 0 8px}}h3{{font-size:16px;margin:18px 0 6px}}
li{{margin:4px 0 4px 18px}}code{{background:#ebe8df;padding:1px 4px;border-radius:4px}}
figure{{margin:14px 0;background:#fff;border:1px solid #e2ded3;border-radius:12px;padding:10px}}figcaption{{font-weight:600;margin-bottom:6px}}
.pair{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}}.pair img{{width:100%;border:1px solid #ddd;border-radius:8px}}
small{{color:#78827d}}.log{{background:#fff;border:1px solid #e2ded3;border-radius:12px;padding:6px 16px}}
</style></head><body><main><h1>Revisión de staging</h1><p>Lo que se cambió de noche en la copia de prueba. Nada de esto está en la app real todavía.</p>
<div class="log">{md(log)}</div>{cards}</main></body></html>'''
(pub / 'staging-review.html').write_text(page)
print('wrote', pub / 'staging-review.html', sum(len(p) for _, p in shots), 'screens')
