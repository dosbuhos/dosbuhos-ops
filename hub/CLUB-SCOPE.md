# Club de beneficios (Hub `/club/`) — scope

The member app of Dos Búhos: who gets which benefits, how they get their card, how staff recognise them and apply the
benefit, and how we track it. Separate from the shipment app (`wineclub/`), which keeps doing boxes and Stripe.

## Origin
Consultants Adela Pereira and José Gallo proposed a consumption-based loyalty club (not only subscriptions) as an
umbrella over the paid Círculos:
- **Socios por consumo**: 3 levels by annual spend across channels (0–10,000 / 10,000–20,000 / >20,000 MXN). Entry from
  the first purchase. Current Bronce subscribers land in level 2.
- **Socios por invitación**: novios (members for life, retroactive), empleados (30% restaurant when present, less on
  wine), familia y amigos (more on wine, less on restaurant), profesionales B2B (tour operators, wedding planners,
  hotel concierges, distributors, restaurant clients) in 3 levels moved by hand according to the business they bring.
- **Círculos de suscripción** (Bronce, Plata, Oro, Diamante, plus founding members) keep running in `wineclub/` and
  appear here automatically.

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
1. **Programas × Beneficios grid.** Columns are programs: Familia y amigos, Industria (3 levels), Empleados, Novios,
   Consumo (3 levels), and Círculo Bronce / Plata / Oro / Diamante / Fundadores (read from the wine club database).
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
8. **Consumo levels.** Spend comes from registered visits plus manual entries (Tienda receipts). The level updates
   automatically over a rolling 12 months.

## Integrations, honestly
- **Parrot**: the public API appears read-only, so v1 doesn't push discounts. Staff apply the discount in Parrot and type
  the check number and total. Next: a daily reconciliation that reads Parrot checks and flags visits without a matching
  check or discount.
- **OpenTable**: no open API. v1 gives a one-tap copy of the guest note ("F&F Dos Búhos · 15% cuenta") and asks members
  for their reservation name. Next: match OpenTable confirmation emails (Gmail) to members by phone and email so the
  Hoy list fills itself.
- **Wine club**: Círculo members come from the `wineclub` D1 (read-only binding), matched by email and phone.

## Later
- Member receipt photo upload for points.
- Wallet passes (Apple/Google).
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
