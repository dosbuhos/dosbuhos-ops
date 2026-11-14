# dosbuhos-ops

Internal apps and tools for Bodega Dos Búhos.

| Folder | What it is |
|---|---|
| `hub/` | Hub: el centro de mando. Un solo inicio de sesión con Google, lanzador de todas las apps por sección, administración de personas y accesos, bitácora. Worker `hub`, D1 `hub`; las apps se sirven detrás bajo `/<slug>/`. Incluye Anuncios (`/ads/`: Google + Meta, retorno, alertas y pendientes) |
| `huerto/` | Huerto orgánico: plan de siembra, lista semanal de Adrián, semillero, cosechas y experiencias. Página pública en Cloudflare Workers; guardar cambios pide PIN (tabla `config` en D1 `huerto`). Fuentes en `huerto/app/`; se arma con `python3 huerto/app/build.py` |
| `mantenimiento/` | Mantenimiento: tareas por área/prioridad para Adrián, carpinteros y proveedores externos; fotos, notas, equipos e historial de servicio. Worker `dosbuhos-mantenimiento`, D1 `mantenimiento`, login con nombre + PIN |
| `wineclub/` | Club Dos Búhos: agenda de envíos del club de vinos (atrasados, hoy, próximos), historial por socio y uso de beneficios. Worker `wineclub` (+ `wineclub-staging`), D1, Cloudflare Access |
| `cellar/` | Calendario de bodega (Cellar Target Calendar): vinos, labs, órdenes de trabajo de Excellovint, protocolos y Learn. Worker `cellar`, D1 `cellar`, Google sign-in; lee y escribe Excellovint con una cuenta de servicio. Fuente = el artifact de Claude; se arma con `python3 cellar/app/build.py` |
| `ulula/` | Ulula: bodega por recipientes (clon del módulo Bodega de GrapeFlow para compararlo con el Cellar Tracker). Tablero por recipiente, operaciones con estancias de lotes, trazabilidad, análisis, catas. Worker `ulula`, D1 `ulula`, sin login por ahora |
| `cotizador/` | Cotizador de eventos: la lógica del cotizador de Acrobat (menús, barra por horas, consumo mínimo, renta del espacio, servicio e IVA) como app de celular; propuesta para el cliente en PDF de 3 páginas (Browser Rendering, `POST /pdf`) y resumen por WhatsApp. Worker `cotizador`, PIN (secreto `PIN`) o firma del Hub; secreto opcional `ANTHROPIC_API_KEY` para que Claude escriba la nota de apertura. D1 `cotizador` con las cotizaciones guardadas (quién, cliente, evento, fecha, total, estado; reabrir, duplicar, eliminar). Incluye `/personal` (Personal para eventos: plantilla, costo y reparto del fee), abierto sin login por ahora — pendiente asegurarlo — y `/guia` |
| `card/` | Tarjeta QR · link tree: la tarjeta QR de cada persona del equipo y el mini sitio público (visitas, OpenTable, eventos, vinos, premios, fotos, kit de prensa), EN/ES, instalable y offline. Worker `card`, solo archivos estáticos |
| `horizonte/` | Horizonte: planificador personal de Eric (reemplazo de Timestripe), fuera del Hub. Tareas, tableros, días y horizontes; funciona sin conexión y sincroniza entre teléfono y computadora. Worker `horizonte`, D1 `horizonte`, Google sign-in solo para Eric |
| `canario/` | Canario de reservas: dos veces al día (8:00 y 11:00) revisa que un cliente pueda reservar mesa y cada experiencia en OpenTable y que los botones de dosbuhos.com sigan apuntando a OpenTable; avisa al teléfono por ntfy cuando algo falla. Worker `canario`, KV `canario`, sin login ni secretos |
| `growth/` | Growth Terminal: tablero tipo bolsa para anuncios, reservas y capacidad, con un operador de IA acotado (propone; las reglas y un coordinador deciden y ejecutan). Worker `growth`, D1 `growth`, R2 `growth-archive`, Durable Object por cuenta, Workflows, cron cada 15 min; detrás del Hub en `/growth/`. Hoy: Google Ads real cada hora desde el feed del Hub (D1 `hub`, solo lectura); reservas de OpenTable pendientes (datos solo para socios de OpenTable). Ver `growth/docs/readiness.md` |
| `zoho-inventory/` | Zoho Inventory tracking and automation. First app: sample-bottle tracking for sales reps (Cloudflare Worker) |

Add each new app or tool as its own folder.
