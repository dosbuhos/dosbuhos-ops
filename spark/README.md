# Spark — Dos Búhos

Mini CRM for restaurant sparks. Eric and Diana run every conversation from one WhatsApp Business number; reps only capture the spark and pour.

The D1 database `spark` already exists in your Cloudflare account with tables and the wine list loaded.

## 1. Deploy (5 min, on your PC)

Unzip this folder (e.g. next to `dosbuhos-ops`), open a terminal in it:

```
npm install
npx wrangler login          # only if you're not logged in already
npx wrangler secret put ADMIN_PASSWORD      # the password you two will use
npx wrangler secret put SESSION_SECRET      # any long random text
npx wrangler secret put ANTHROPIC_API_KEY   # console.anthropic.com → API keys
npx wrangler deploy
```

Open `https://spark.<your-subdomain>.workers.dev` → log in as Eric or Diana.

No terminal? Cloudflare dashboard → Workers → Create → paste `dist/spark-worker.js`, then in Settings add: D1 binding `DB` → `spark`, and the secrets above as variables.

## 2. WhatsApp Business (Meta Cloud API)

1. business.facebook.com → WhatsApp Manager → add the number (a new SIM or a number not active on regular WhatsApp; Meta's "coexistence" lets you keep using the WhatsApp Business app on the same number).
2. developers.facebook.com → your app → WhatsApp → API Setup: copy **Phone number ID**; create a **System User permanent token** with `whatsapp_business_messaging`.
3. Secrets:
   ```
   npx wrangler secret put WA_TOKEN
   npx wrangler secret put WA_PHONE_ID
   npx wrangler secret put WA_NUMBER        # digits, e.g. 524151234567
   npx wrangler secret put WA_VERIFY_TOKEN  # any word, e.g. buhos2026
   npx wrangler secret put WA_APP_SECRET    # App settings → Basic → App secret
   ```
4. WhatsApp → Configuration → Webhook: URL `https://spark.<subdomain>.workers.dev/webhook/whatsapp`, verify token = the word above. Subscribe to **messages**.
5. Create a message template named **spark_seguimiento** (category Marketing or Utility, language Spanish MX). Body, with two variables:
   > Hola {{1}}, soy {{2}} de Bodega Dos Búhos. Gracias por probar nuestros vinos. ¿Te comparto una propuesta pensada para tu menú?

   WhatsApp only allows free text within 24 h of the client's last message. Outside that window Spark sends this template automatically; once they reply, the window reopens.

## 3. Optional: email proposals

`npx wrangler secret put RESEND_API_KEY` and `EMAIL_FROM` (verify dosbuhos.com in Resend). Without it, the Email button opens your mail app pre-filled.

## How it works

- **Capture**: each rep has a QR (`/s/CODE`) that opens WhatsApp to the business number with their code, so the spark is attributed. Or the rep uses their page `/r/CODE` → "Nuevo spark".
- **Hoy**: what needs a reply, new sparks, upcoming appointments, anything stalled 7 days.
- **Lead**: thread, AI draft reply, menu (photo/PDF/text — menus sent by WhatsApp are transcribed automatically), one-tap proposal, appointment.
- **Proposal**: public page `/p/…` with pairings against their dishes, by-the-glass picks, prices (from Vinos), terms, and a WhatsApp button. Tracks views.
- **Handoff**: "Agendar → Cata en su restaurante" assigns a rep and gives you a pre-written WhatsApp brief to send them. Their page lists their pours; they tap "Cata hecha". "Visita a la bodega" skips the rep entirely.
- **AI**: summarizes each thread in one line and moves the stage forward on its own. Auto-reply is off by default (Ajustes) — turn it on once the drafts sound right.
