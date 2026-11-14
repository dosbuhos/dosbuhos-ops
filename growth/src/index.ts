// Worker entry: static dashboard + private API (behind the Hub), the single 15-minute cron, the coordinator Durable
// Object and the review Workflows.
import type { Env } from './env.ts';
import { app } from './api/app.ts';
import { runSchedule } from './workflows/jobs.ts';
import { authenticate } from './api/auth.ts';

export { AccountCoordinator } from './coordinator/do.ts';
export { DailyReviewWorkflow, WeeklyReviewWorkflow } from './workflows/workflows.ts';

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const withHeaders = (res: Response) => { const r = new Response(res.body, res); for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v); return r; };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return withHeaders(await app.fetch(request, env, ctx));
    // The dashboard itself is private too: no page without a valid Hub identity (or dev).
    const auth = await authenticate(request, env);
    if (!auth.ok) return withHeaders(new Response(auth.status === 503 ? 'This app is not configured yet.' : 'Sign in through the Dos Búhos Hub.', { status: auth.status, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
    const res = await env.ASSETS.fetch(request);
    const r = withHeaders(res);
    r.headers.set('cache-control', url.pathname.startsWith('/assets/') ? 'private, max-age=31536000, immutable' : 'no-store');
    return r;
  },
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSchedule(env, Date.now()).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
