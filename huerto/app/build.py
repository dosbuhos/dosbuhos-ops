"""Arma las dos versiones de la app del huerto a partir de las mismas fuentes:
   - ../public/index.html  -> versión web pública (Cloudflare Worker), con el adaptador web-shim.js
   - ./artifact.html       -> versión para el Artifact de Claude
Uso: python3 build.py"""
import json, os
here = os.path.dirname(os.path.abspath(__file__))
rd = lambda f: open(os.path.join(here, f), encoding='utf-8').read()
tpl, eng, data, shim = rd('template.html'), rd('engine.js'), rd('plan-data.js'), rd('web-shim.js')
geo = json.dumps(json.load(open(os.path.join(here, 'geo.json'))), separators=(',', ':'))
page = tpl.replace('/*DATA*/', data).replace('/*ENGINE*/', eng).replace('/*GEO*/', geo)
open(os.path.join(here, 'artifact.html'), 'w', encoding='utf-8').write(page)
head, rest = page.split('<style>', 1)
web = ('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
       + head.strip() + '\n<style>\n*{margin:0}body{margin:0}\n' + rest.split('</style>', 1)[0] + '</style>\n'
       '<script>' + shim + '</script>\n</head>\n<body>\n' + rest.split('</style>', 1)[1] + '\n</body>\n</html>\n')
web = web.replace('*{margin:0}body{margin:0}\n', 'body{margin:0}\n')
os.makedirs(os.path.join(here, '..', 'public'), exist_ok=True)
open(os.path.join(here, '..', 'public', 'index.html'), 'w', encoding='utf-8').write(web)
print('ok', len(web))
