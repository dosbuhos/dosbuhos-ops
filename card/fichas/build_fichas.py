#!/usr/bin/env python3
"""Technical sheets (fichas técnicas) → one PDF per language, from a JSON data file + bottle images.
   python3 build_fichas.py en.json out.pdf   (renders with headless Chrome; Letter, one page per wine)
   Data: [{title, place, sections:[[heading, text],...], specs:[[label, value],...], packaging, bottle (png path), color (#hex)}]"""
import json, sys, os, subprocess, base64, html
HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(sys.argv[1], encoding='utf-8'))
out = sys.argv[2]
LANG = data.get('lang', 'en'); W = data['wines']
FOOT_L = 'www.dosbuhos.com'; FOOT_R = '@vinedodosbuhos'
def b64(p): return ('data:image/jpeg;base64,' if p.endswith('.jpg') else 'data:image/png;base64,') + base64.b64encode(open(p, 'rb').read()).decode()
logo = b64(os.path.join(HERE, 'assets', 'logo.png')); mono = b64(os.path.join(HERE, 'assets', 'monogram.png'))
fonts = ''
for f, w, st in [('cormorant-garamond-latin-500-normal', 500, 'normal'), ('cormorant-garamond-latin-400-italic', 400, 'italic'), ('lato-latin-300-normal', 300, 'normal'), ('lato-latin-400-normal', 400, 'normal'), ('lato-latin-700-normal', 700, 'normal')]:
    p = os.path.join(HERE, '..', 'public', 'fonts', f + '.woff2')
    if os.path.exists(p):
        fam = 'Cormorant Garamond' if f.startswith('cormorant') else 'Lato'
        fonts += f'@font-face{{font-family:"{fam}";font-weight:{w};font-style:{st};src:url(data:font/woff2;base64,{base64.b64encode(open(p,"rb").read()).decode()}) format("woff2")}}\n'
e = html.escape
pages = []
for w in W:
    secs = ''.join(f'<h3>{e(h)}</h3><p>{e(t).replace(chr(10), "<br>")}</p>' for h, t in w['sections'])
    specs = ''.join(f'<div class="sp"><b>{e(l)}</b><span>{e(v).replace(chr(10), "<br>")}</span></div>' for l, v in w['specs'])
    pages.append(f'''<section class="pg" style="--c:{w['color']}">
  <header><img class="logo" src="{logo}" alt=""><div><h1>{e(w['title'])}</h1><div class="place">{e(w['place']).replace(chr(10), "<br>")}</div></div></header>
  <div class="body"><div class="bottle"><img src="{b64(w['bottle'])}" alt=""></div><div class="txt">{secs}<div class="specs">{specs}</div>{f'<h3>{e(w["packaging_label"])}</h3><p>{e(w["packaging"])}</p>' if w.get('packaging') else ''}</div></div>
  <footer><span>{FOOT_L}</span><img src="{mono}" alt=""><span>{FOOT_R}</span></footer>
</section>''')
doc = f'''<!DOCTYPE html><html lang="{LANG}"><head><meta charset="utf-8"><title>Dos Búhos · {'Technical sheets' if LANG=='en' else 'Fichas técnicas'} 2025</title><style>
{fonts}
@page{{size:letter;margin:0}} *{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:Lato,sans-serif;font-weight:300;color:#2b2420;-webkit-print-color-adjust:exact;print-color-adjust:exact}}
.pg{{width:8.5in;height:11in;position:relative;overflow:hidden;page-break-after:always;background:#fff;padding:.55in .6in 0}}
.pg:last-child{{page-break-after:auto}}
header{{display:flex;align-items:flex-start;gap:.35in}}
header .logo{{width:1.75in;height:auto;margin-top:.02in}}
h1{{font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;font-size:30pt;line-height:1;color:var(--c);letter-spacing:.01em}}
.place{{font-size:10.5pt;line-height:1.35;margin-top:.08in;color:#2b2420}}
.body{{display:grid;grid-template-columns:2.35in 1fr;column-gap:.35in;margin-top:.45in}}
.bottle{{height:7.2in;display:flex;align-items:center;justify-content:center}}
.bottle img{{max-height:7.2in;max-width:2.35in;object-fit:contain}}
.txt{{padding-top:.35in}}
h3{{font-size:9pt;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--c);margin:.16in 0 .05in}}
h3:first-child{{margin-top:0}}
p{{font-size:9.6pt;line-height:1.5}}
.specs{{display:grid;grid-template-columns:1fr 1fr;column-gap:.3in;row-gap:.1in;margin-top:.3in;padding-top:.18in;border-top:1px solid #e4dccb}}
.sp b{{display:block;font-size:8.5pt;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6b6045}}
.sp span{{font-size:9.6pt;line-height:1.4}}
footer{{position:absolute;left:0;right:0;bottom:0;height:.55in;background:var(--c);color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 .6in;font-family:"Cormorant Garamond",Georgia,serif;font-size:13pt;letter-spacing:.04em}}
footer img{{height:.36in;width:auto;opacity:.95}}
</style></head><body>{''.join(pages)}</body></html>'''
htmlp = out.replace('.pdf', '.html'); open(htmlp, 'w', encoding='utf-8').write(doc)
subprocess.run(['google-chrome', '--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf=' + out, '--virtual-time-budget=10000', 'file://' + os.path.abspath(htmlp)], check=True, capture_output=True)
print('wrote', out, len(W), 'pages')
