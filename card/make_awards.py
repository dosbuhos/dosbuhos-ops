"""Build the master awards summary PDFs (EN/ES) from AWARDS in build_app.py.  Run: python3 make_awards.py"""
import ast, os, re, subprocess, tempfile, datetime
ROOT=os.path.dirname(os.path.abspath(__file__)); src=open(os.path.join(ROOT,'build_app.py'),encoding='utf-8').read()
AWARDS=ast.literal_eval(re.search(r'^AWARDS = (\[.*?^\])',src,re.S|re.M).group(1))
MED={"gg":("Grand Gold","Gran Oro"),"g":("Gold","Oro"),"s":("Silver","Plata"),"b":("Bronze","Bronce"),"m":("Merit","Mérito")}
T={'en':dict(t='Awards & Scores',sub='Bodega Dos Búhos · San Miguel de Allende, Guanajuato, México',upd='Updated',note='Estate-grown, certified organic (Oregon Tilth / USDA NOP). Newest first.',pts='Scores'),
   'es':dict(t='Premios y Puntajes',sub='Bodega Dos Búhos · San Miguel de Allende, Guanajuato, México',upd='Actualizado',note='Uvas propias, certificadas orgánicas (Oregon Tilth / USDA NOP). Lo más reciente primero.',pts='Puntajes')}
MONTHS={'en':['January','February','March','April','May','June','July','August','September','October','November','December'],'es':['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']}
def page(L):
    t=T[L]; d=datetime.date.today(); i=0 if L=='en' else 1
    blocks=[]
    for a in AWARDS:
        name=a['comp']
        yr=f" {a['year']}" if a['year'] else ' · '+{'en':'earlier editions','es':'ediciones anteriores'}[L]
        rows=''.join(f"<tr><td>{w}</td><td class='m {m}'>{(MED[m][i] if m in MED else m)}</td></tr>" for w,m in a['items'])
        blocks.append(f"<section><h2>{name}{yr}</h2><table>{rows}</table></section>")
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:CG;src:url(file://{ROOT}/public/fonts/cormorant-garamond-latin-500-normal.woff2)}}
@font-face{{font-family:Lato;src:url(file://{ROOT}/public/fonts/lato-latin-400-normal.woff2)}}
@page{{size:Letter;margin:12mm 15mm}} body{{font:9.8pt/1.3 Lato,sans-serif;color:#1d1a17}}
header{{display:flex;align-items:center;gap:16px;border-bottom:1px solid #c9a26a;padding-bottom:10px;margin-bottom:12px}}
header img{{height:52px}} h1{{font:500 26pt/1 CG,Georgia,serif;margin:0}} .sub{{color:#6b6157;font-size:9pt;margin-top:4px}}
.note{{font-size:9pt;color:#6b6157;margin:0 0 10px}} .cols{{column-count:2;column-gap:12mm}}
section{{break-inside:avoid;margin:0 0 7px}} h2{{font:500 12pt/1.15 CG,Georgia,serif;margin:0 0 3px;color:#7a5a2c}}
table{{width:100%;border-collapse:collapse}} td{{padding:1.5px 0;border-bottom:.5px solid #e5ddd2}} td.m{{text-align:right;white-space:nowrap;font-size:9pt;letter-spacing:.04em}}
.gg{{color:#8a6418;font-weight:bold}} .g{{color:#8a6418}} footer{{margin-top:10px;font-size:8pt;color:#8a8178}}
</style></head><body><header><img src="file://{ROOT}/public/press/files/logos/DosBuhos_Monogram-Lockup_Black.png"><div><h1>{t['t']}</h1><div class="sub">{t['sub']}</div></div></header>
<p class="note">{t['note']} {t['upd']}: {MONTHS[L][d.month-1]} {d.year}.</p><div class="cols">{''.join(blocks)}</div>
<footer>hola.dosbuhos.com/press · reservaciones@dosbuhos.com · @vinedodosbuhos</footer></body></html>"""
for L,fn in [('en','Dos-Buhos-Awards-EN.pdf'),('es','Dos-Buhos-Premios-ES.pdf')]:
    with tempfile.NamedTemporaryFile('w',suffix='.html',delete=False,encoding='utf-8') as f: f.write(page(L)); h=f.name
    out=os.path.join(ROOT,'public','docs',fn)
    subprocess.run(['google-chrome','--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--disable-component-update','--no-first-run','--allow-file-access-from-files','--no-pdf-header-footer',f'--print-to-pdf={out}','file://'+h],check=True,capture_output=True,timeout=120)
    print(fn, os.path.getsize(out)//1024,'KB')
