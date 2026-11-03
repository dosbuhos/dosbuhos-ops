# Ulula — bodega por recipientes

Clon independiente del módulo *Bodega* de GrapeFlow para compararlo con el Cellar Tracker. Cloudflare Worker + D1, sin
build. Spec y capturas: https://claude.ai/artifact/8vt2Q1uc6rucVTKwmqv81k

**Regla central:** los formularios eligen recipientes, nunca lotes. El lote es lo que hay en el recipiente; cada operación
reescribe esa relación por medio de *estancias* (`stays`: lote × recipiente × fechas × volumen). Trazabilidad lee la cadena
de estancias; el Tablero lee la estancia abierta de cada recipiente.

| Ruta | Qué |
|---|---|
| `#/tablero` | Una celda por recipiente (tarjetas o siluetas), KPIs, filtros, agrupar por tipo o ubicación; badges Rellenar / Análisis / Limpiar |
| `#/operaciones` | Lista con filtros (lote, recipiente, color, tipo, año, estado) y el formulario de **Nueva operación**: Prensado, Sangrado, Trasiego, Trasiego a barricas, Filtración, Desfangado, Adiciones, Rellenado, Venta a granel, Coupage. Borradores, confirmar, revertir |
| `#/traza?lot=ID` | Extracto del lote: estancias (newest first) con sus eventos, origen (prensado / coupage / lías) |
| `#/analisis`, `#/catas` | Registros por depósito con vino |
| `#/actividad` | Operaciones 30 días, borradores, recipientes por limpiar, barras por tipo / mes / color |
| `#/depositos` | Alta individual, por secuencia (BBL-001…) o CSV; ubicaciones |
| `#/saldos` | Saldos de apertura: una fila por recipiente con vino → lote + estancia |
| `#/recipiente/ID` | Página del recipiente (destino para QR): contenido, acciones rápidas, movimientos, análisis, catas |

## Motor de operaciones (`src/worker.js` → `confirm`)

Lee el estado actual, valida y escribe todo en **un solo `DB.batch`** (atómico). Guarda en `operations.undo` el estado
previo de las estancias tocadas, los lotes creados y las barricas cuyo contador de llenados subió, para **Revertir**
(solo si ninguna operación posterior tocó los mismos recipientes). Un fallo al confirmar deja la operación como borrador.

- Trasiego / Filtración / Desfangado: 1 origen → N destinos (uno puede quedar en blanco = el resto); merma y lías
  opcionales; las lías forman su propio lote en otro recipiente; «Crear nuevo lote en el destino» clona el lote.
- Trasiego a barricas: llenar (1 → N barricas, cada barrica en blanco se llena a su capacidad) o vaciar (N → 1).
- Sangrado: el origen en maceración baja 1 kg por litro; el destino recibe litros del mismo lote.
- Prensado: cierra la estancia en kg y crea un lote por fracción (Free run, Prensa 1/2/3, Combinado, Orujo).
- Adiciones: productos sobre un depósito con vino, sin cambio de volumen.
- Rellenado: suma litros al depósito (origen opcional que los pierde); admite lotes distintos.
- Venta a granel: resta litros, sin lote nuevo.
- Coupage: N orígenes → lote nuevo → N destinos vacíos (o vaciados en la misma operación).

## Deploy (GitHub → Cloudflare Workers Builds, como las demás apps)

Project name `ulula`, root directory `ulula`, build command vacío, deploy command `npx wrangler deploy`.
URL: https://ulula.dos-buhos.workers.dev. D1 `ulula` (id en `wrangler.jsonc`); el esquema se aplica desde Claude o con
`npm run db:remote`. Sin login por ahora (como el Cellar Tracker al principio); después entra detrás del Hub.

## Local

```
npm install && npm run db:local && npm run dev
```
