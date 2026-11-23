// KlaviyoGuests: the one door through which guest names and contact details leave Klaviyo for our own apps.
// It has no route and no public address: only another Worker in this account that declares the service binding can
// call it (today the Reservaciones app, reservaciones/, which keeps the guests in its own database). Growth Terminal's
// own code never calls it, so the dashboard, its reports and the AI review stay free of guest identities.
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Env } from './env.ts';
import { readGuestPage, NOT_READY, type GuestPage, type GuestQuery } from './connectors/klaviyo-guests.ts';

export class KlaviyoGuests extends WorkerEntrypoint<Env> {
  /** One page of one reservation metric's events, each with who booked: name, email, phone. Read-only. */
  async page(q: GuestQuery): Promise<GuestPage> {
    const env = this.env;
    if (!env.KLAVIYO_API_KEY || env.DATA_KIND !== 'real') return NOT_READY;
    return readGuestPage(env.DB, env.KLAVIYO_API_KEY, q, Date.now(), { restaurantId: env.OPENTABLE_RID });
  }
}
