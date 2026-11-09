// Screenshots for review: node test/shots.mjs [base] [outdir]
import { createRequire } from 'node:module';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const BASE = process.argv[2] || 'http://localhost:8799', OUT = process.argv[3] || '/tmp/shots';
const b = await chromium.launch();
const errs = [];
async function ctxFor(opts) { const c = await b.newContext(opts); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); return p; }
const wait = (p, ms = 500) => p.waitForTimeout(ms);
// desktop
const d = await ctxFor({ viewport: { width: 1440, height: 900 } });
await d.goto(BASE); await wait(d, 1500); await d.reload(); await wait(d, 1200);
await d.screenshot({ path: `${OUT}/d1-days.png` });
await d.click('[data-src="b:winery"]'); await wait(d); await d.click('[data-zoom=hours]'); await wait(d, 700); await d.screenshot({ path: `${OUT}/d2-hours.png` });
await d.click('[data-zoom=weeks]'); await wait(d); await d.screenshot({ path: `${OUT}/d3-weeks.png` });
await d.click('[data-zoom=days]'); await d.click('[data-src=inbox]'); await wait(d);
// drag inbox card onto tomorrow column
const card = d.locator('.panel .card').first(); const cb = await card.boundingBox();
const col = d.locator('.col.today + .col'); const tb = await col.boundingBox();
await d.mouse.move(cb.x + 60, cb.y + 10); await d.mouse.down(); await d.mouse.move(cb.x + 80, cb.y + 20, { steps: 3 });
await d.mouse.move(tb.x + 100, tb.y + 300, { steps: 10 }); await wait(d, 200); await d.screenshot({ path: `${OUT}/d4-dragging.png` });
await d.mouse.up(); await wait(d); await d.screenshot({ path: `${OUT}/d5-dropped.png` });
await d.locator('.col.today .card .body').first().click(); await wait(d); await d.screenshot({ path: `${OUT}/d6-sheet.png` });
await d.keyboard.press('Escape');
// android
const m = await ctxFor({ ...devices['Pixel 7'] });
await m.goto(BASE); await wait(m, 1500); await m.reload(); await wait(m, 1200);
await m.screenshot({ path: `${OUT}/m1-today.png` });
await m.click('[data-tab=plan]'); await wait(m); await m.screenshot({ path: `${OUT}/m2-plan.png` });
await m.click('[data-tab=inbox]'); await wait(m); await m.screenshot({ path: `${OUT}/m3-inbox.png` });
await m.locator('.mm .card .body').first().click(); await wait(m); await m.screenshot({ path: `${OUT}/m4-sheet.png` });
await m.click('.scrim', { position: { x: 20, y: 20 } }); await wait(m);
await m.click('[data-tab=boards]'); await wait(m); await m.screenshot({ path: `${OUT}/m5-boards.png` });
await m.click('[data-bid=winery]'); await wait(m); await m.screenshot({ path: `${OUT}/m6-board.png` });
// long-press drag via CDP touch
const cdp = await m.context().newCDPSession(m);
const c2 = await m.locator('.mm .card').nth(1).boundingBox();
const pt = (x, y) => [{ x, y }];
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(c2.x + 120, c2.y + 20) });
await wait(m, 500);
for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(c2.x + 120 + i * 18, c2.y + 20 + i * 8) });
await wait(m, 300); await m.screenshot({ path: `${OUT}/m7-rail.png` });
const slot = await m.locator('.rail .slot').nth(2).boundingBox();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(slot.x + 40, slot.y + 15) }); await wait(m, 150);
await m.screenshot({ path: `${OUT}/m8-rail-over.png` });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(m, 500);
await m.screenshot({ path: `${OUT}/m9-after.png` });
await m.click('[data-act=capture]'); await wait(m); await m.screenshot({ path: `${OUT}/m10-capture.png` });
console.log('errors:', errs.length ? errs : 'none');
await b.close();
