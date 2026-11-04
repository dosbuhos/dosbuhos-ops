# Club de beneficios (Hub `/club/`) — scope

The member app of Dos Búhos: who gets which benefits, how they get their card, how staff recognise them and apply the
benefit, and how we track it. Separate from the shipment app (`wineclub/`), which keeps doing boxes and Stripe.

## Origin
Strategy session with consultants Adela Pereira and José Gallo (Sep 28 2026). The transcript ends as benefits start,
so levels are decided and benefits per level are still open.
- **The club is an umbrella. The subscription is just one way of buying.** "No voy a cambiar mis clubes, nada más
  estoy creando niveles de socios." Every purchase on every channel accumulates on one member profile and sets the
  level:
  - Círculo subscription
  - Tienda / online
  - restaurant
  - experiences
  - external points of sale, e.g. restaurants in San Miguel
- **Socios por compras**: 3 levels by spend over 12 months:
  - Nivel 1: 0–10,000 MXN, entered from the first purchase however small
  - Nivel 2: 10,000–20,000 MXN
  - Nivel 3: over 20,000 MXN

  Current Círculo Bronce subscribers ($14,400/yr) land in Nivel 2, and Nivel 2 must give at least what Bronce gets
  today: 15% wine (Tienda/online), 10% restaurant, 4 tours/tastings, 20% events. Levels get their own names, distinct
  from the Círculos (names to be decided).
- **Socios por invitación**: status doesn't depend on spend. Purchases are still tracked; the level changes only by hand.
  - **Novios**: members for life, granted retroactively ("les mandamos su tarjetita").
  - **Empleados** (and their families): 30% at the restaurant when present, less on wine.
  - **Amigos y familia**: more on wine, less at the restaurant.
  - **Profesionales** (B2B): tour operators, wedding planners, event organisers, hotel concierges, distributors, and
    tourism distributors. 3 levels (placeholder "Aliados"). Moved up or down by hand according to the business they
    bring, tracked through reservations. Milestones apply, e.g. at the 200th visitor they brought: a Magnum or a staff
    meal.
- Subscriptions: only Bronce (about 20 members) and one Diamante today. Eric may keep only Bronce and Plata. They keep
  running in `wineclub/`; here they count as purchases.
- Exclusive experiences per level (e.g. a vertical tasting) are a type of benefit, not only discounts.
- Eric's additions (Nov 1 2026):
  - Friends, family and industry get a QR that they show for the discount automatically.
  - Receipts scanned to stack points.

Eric's ask (Nov 1 2026): give friends, family and industry people a QR. They show it and automatically get their
discount at the restaurant. The admin is a grid: programs in columns, benefits in rows, each one ticked on or off with
its discount. Invite people by WhatsApp or email, and they sign up in seconds. Staff know when friends, family or VIPs
are here. We track usage, eventually against Parrot and OpenTable.

## Users and jobs
| Who | Job | Where |
|---|---|---|
| Eric / managers | Decide which program gets what; invite people; see usage and cost | `/club/` admin (phone + desktop) |
| Guest (friend, client, distributor) | Join in under a minute, carry the card, show it | Public `/c/…` pages, no Google sign-in |
| Host / cashier / server | Scan, see what applies in plain words, apply it in Parrot, log the visit | `/club/` staff screens (phone) |
| Michael (F&B) | Know who is in today; see the cost of benefits | `/club/` Hoy + Resumen |

## v1 (build now)
1. **Programas × Beneficios grid.** The columns are programs:
   - Por compras: Nivel 1 / 2 / 3, automatic by 12-month spend; thresholds editable
   - Por invitación: Novios, Empleados, Amigos y familia, Profesionales 1 / 2 / 3
   - Fundadores: grandfathered Círculo terms

   Círculo subscribers come from the wine club database. Their subscription spend counts toward their level.
   Rows come from a benefit catalogue. Each cell has an on/off switch, a value (percent, count per year, amount), and
   limits (guests, applies to, notes). The phone layout is vertical: pick a program, see its benefit list with
   toggles. Desktop shows the full grid. Every change is audited.
2. **Invitations.** Per program: a multi-use link (e.g. "Industria 2026") or a personal invite with name and phone.
   Share by WhatsApp (wa.me with prefilled Spanish text), email (mailto), copy link, or printable QR. Optional expiry,
   optional "requires approval".
3. **Sign-up in under a minute** at `/c/i/<token>`: name, WhatsApp, optional email, optional birthday, accept the
   terms, then the card. No password. The card link is the login: save it, add it to the home screen, re-send it by
   WhatsApp.
4. **Card** at `/c/<code>`: name, program and level, QR, the benefits in plain words, remaining counts, and "Voy a ir"
   (date, party size, OpenTable reservation name). That last part feeds the Hoy list.
5. **Staff scan.** Scanning the QR with the phone camera opens `/c/<code>`; signed-in staff get the staff view. It shows:
   - a big badge (program colour) with the name and their notes
   - "Aplica hoy": each benefit as one line with its rule ("15% sobre toda la cuenta · socio presente · hasta 4
     acompañantes"), plus what is used up or not applicable
   - **Registrar visita**: party size, benefits used (tick), Parrot check number, check total, discount given, note. This
     logs the visit, decrements counts, and adds spend toward consumo levels.
   - A search by name or phone for people without their phone.
6. **Hoy.** Announced visits plus today's check-ins with program badges: "Familia y amigos · Ana López · 4 pax · 2 pm",
   and a "VIP aquí ahora" section. Copy-ready text for the shift group and for the OpenTable guest note.
7. **Resumen.** Per program: members, active in the last 90 days, visits, spend, discount given, cost of benefits, top
   members. Per member: the history.
8. **Levels by purchases.** Spend comes from three sources:
   - registered visits
   - manual entries with channel (Tienda, online, experiencias, punto externo) and an optional receipt photo
   - Círculo subscription charges, read from the wine club database

   The level updates automatically over a rolling 12 months. The card shows "Te faltan $X para Nivel 2".
9. **Profesionales.** Each visit can record "lo trajo: <profesional>" and how many people. Resumen shows the business
   each professional brought (visits, people, spend) and flags milestones (configurable, e.g. every 200 people).
   Moving a professional between levels is a manager action, and it is audited.

## Integrations, honestly
- **Parrot**: the public API appears read-only, so v1 doesn't push discounts. Staff apply the discount in Parrot and type
  the check number and total. Next: a daily reconciliation that reads Parrot checks and flags visits without a matching
  check or discount.
- **OpenTable**: no open API. v1 gives a one-tap copy of the guest note ("F&F Dos Búhos · 15% cuenta") and asks members
  for their reservation name. Next: match OpenTable confirmation emails (Gmail) to members by phone and email so the
  Hoy list fills itself.
- **Wine club**: Círculo members come from the `wineclub` D1 (read-only binding), matched by email and phone.

## Added Nov 4 2026 (Join It parity)
Socios database with filters and CSV export, add a member directly, validity and renewals, fee payments, sign-up
questions per program (form builder), and "Mis datos" on the card. Not included on purpose: automations (renewal
reminders, failed-payment notices) and communications (email/WhatsApp campaigns).

## Later
- Member receipt photo upload for points.
- Wallet passes (Apple/Google): built Nov 4 2026 (`src/club-wallet.js`); waiting on the Apple Developer and Google Wallet issuer accounts. Still later: pushing updates to cards already saved.
- Own domain for clients.
- A member self-service portal: Círculo shipments, payment history.
- Parrot and OpenTable automation.
- B2B levels moved by business brought, with referral attribution.

## Design rules
Follow the Hub's Guía de diseño y UX:
- mobile first, vertical, no horizontal scroll
- compact rows, at least 44 px targets
- Spanish (Mexico)
- `theme.css` tokens
- the public pages are the most polished surface: they are what a guest sees

## Navegación (como Join It)
Barra lateral: Hoy · Socios (Ver socios, Agregar socio, Tipos de membresía = la cuadrícula de programas × beneficios, Ajustes de socios) · Portal del socio (Tarjetas digitales, Invitaciones, Novios) · Finanzas (Pagos) · Reportes (Resumen, Actividad), y "Ver portal del socio". En teléfono la misma barra se abre con Menú; abajo quedan Hoy, Socios y Escanear. Búsqueda de socios en la barra de arriba. La ficha del socio sigue el registro de Join It: acciones arriba, perfil y comentarios internos a la izquierda, tarjeta de membresía oscura y visitas a la derecha, y pestañas (Tarjeta digital, Visitas, Pagos, Compras y nivel, Historial, Datos, Programas). Lo único distinto: la administración de beneficios (la cuadrícula).
