# arqueo · Conteo y conciliación del Almacén 1

Whoever pulls bottles for an orden de venta counts the whole SKU before the surtido can close. The count becomes the
balance, and the differences leave as a list administración captures in Zoho. Zoho is read-only here.

Lives behind the Hub at `apps.dosbuhos.com/arqueo/`, and at `arqueo.dosbuhos.com` once the custom domain is attached.

## How it works

- **Surtir** — the open órdenes de venta of Almacén 1, read from Zoho. Picking one asks for the bottles that left and
  then, unavoidably, for a full count of that wine: tarimas × cajas, cajas sueltas, botellas sueltas.
- **Blind, in two passes** — nothing on screen says what the system expected. The count is sent, the app answers with the
  difference, and only then does it ask for a motivo (and a photo when the difference is big). The same counts come back
  with the reasons and are written.
- **The ledger** — a balance is always `SUM(movimiento.botellas)`. A count never patches a balance: it writes an
  `ajuste_conteo` movement for the difference, so the number always has an explanation behind it.
- **Rotación** — wines nobody has pulled lately (45 days, 30 for the ten largest) and wines with two differences in a row
  come up in *Pendientes de conteo*.
- **Conciliación** — Arqueo against Zoho, wine by wine, plus the adjustment list (CSV) and the OVs fantasma: open orders
  that already have a factura, which is why Zoho's "disponible" is wrong by tens of thousands of bottles.

## Routes

`/api/estado` · `/api/skus` · `/api/ovs` · `/api/ov/:id` · `/api/surtido` · `/api/conteo` · `/api/conteos` ·
`/api/conteo/:id` · `/api/rotacion` · `/api/variaciones` · `/api/revisar` · `/api/movimiento` · `/api/movimientos` ·
`/api/posicion` · `/api/sku` · `/api/conciliacion` · `/api/ajustes/generar` · `/api/ajuste` · `/api/ajustes.csv` ·
`/api/fantasmas` · `/api/foto` · `/api/sync` · `/api/cfg`

## Bindings

- `DB` — D1 `arqueo` (migrations in `migrations/`)
- `FOTOS` — R2 `arqueo-fotos`
- `ZOHO` — service binding to the Muestras Worker (`dosbuhos-ops`, entrypoint `ZohoRead`), read-only
- `HUB_SESSION_SECRET` — account Secrets Store, checked in `src/hub-secret.js`
- Cron `10 9 * * *` (3:10 am San Miguel): Zoho snapshot, phantom-OV scan, and verification of adjustments marked
  *aplicado* — if Zoho still disagrees the adjustment reopens itself.

## Secrets

None. Zoho goes through the `ZOHO` binding and `HUB_SECRET` comes from the Secrets Store.

## Roles

`ADMIN_EMAILS` (plus Hub admins) are supervisors: they see balances, review variances and generate the adjustment list.
`ALMACEN_EMAILS` are the almacenistas: they pick, count and record movements, and never see an expected quantity.

## Still open

- The baseline count. Until it is done and `base_cerrada` is set to 1, the conciliación is comparing against Zoho's old
  numbers. The loop corrects drift from the baseline forward; it cannot fix what was already wrong when it started.
- Case and pallet sizes default to 12 and none. They are edited per wine in **Vinos**.
