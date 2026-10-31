# dosbuhos-ops

Internal apps and tools for Bodega Dos Búhos.

| Folder | What it is |
|---|---|
| `hub/` | Hub: el centro de mando. Un solo inicio de sesión con Google, lanzador de todas las apps por sección, administración de personas y accesos, bitácora. Worker `hub`, D1 `hub`; las apps se sirven detrás bajo `/<slug>/` |
| `huerto/` | Huerto orgánico: plan de siembra, lista semanal de Adrián, semillero, cosechas y experiencias. Página pública en Cloudflare Workers; guardar cambios pide PIN (tabla `config` en D1 `huerto`). Fuentes en `huerto/app/`; se arma con `python3 huerto/app/build.py` |
| `mantenimiento/` | Mantenimiento: tareas por área/prioridad para Adrián, carpinteros y proveedores externos; fotos, notas, equipos e historial de servicio. Worker `dosbuhos-mantenimiento`, D1 `mantenimiento`, login con nombre + PIN |
| `wineclub/` | Club Dos Búhos: agenda de envíos del club de vinos (atrasados, hoy, próximos), historial por socio y uso de beneficios. Worker `wineclub` (+ `wineclub-staging`), D1, Cloudflare Access |
| `cellar/` | Calendario de bodega (Cellar Target Calendar): vinos, labs, órdenes de trabajo de Excellovint, protocolos y Learn. Worker `cellar`, D1 `cellar`, Google sign-in; lee y escribe Excellovint con una cuenta de servicio. Fuente = el artifact de Claude; se arma con `python3 cellar/app/build.py` |
| `zoho-inventory/` | Zoho Inventory tracking and automation. First app: sample-bottle tracking for sales reps (Cloudflare Worker) |

Add each new app or tool as its own folder.
