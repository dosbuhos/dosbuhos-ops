# dosbuhos-ops

Internal apps and tools for Bodega Dos Búhos.

| Folder | What it is |
|---|---|
| `huerto/` | Huerto orgánico: plan de siembra, lista semanal de Adrián, semillero, cosechas y experiencias. Página pública en Cloudflare Workers; guardar cambios pide PIN (tabla `config` en D1 `huerto`). Fuentes en `huerto/app/`; se arma con `python3 huerto/app/build.py` |
| `wineclub/` | Club Dos Búhos: agenda de envíos del club de vinos (atrasados, hoy, próximos), historial por socio y uso de beneficios. Worker `wineclub` (+ `wineclub-staging`), D1, Cloudflare Access |
| `zoho-inventory/` | Zoho Inventory tracking and automation. First app: sample-bottle tracking for sales reps (Cloudflare Worker) |

Add each new app or tool as its own folder.
