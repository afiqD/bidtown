/* shots.mjs - dev harness for BidTown: capture the day at interesting moments.
 * Usage: node scripts/shots.mjs http://localhost:8001/ [prefix]
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const req = createRequire(pathToFileURL(process.cwd() + '/'));
const { chromium } = req('playwright');

const url = process.argv[2] || 'http://localhost:8001/';
const prefix = process.argv[3] || 'shot';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') console.log('console error:', m.text()); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(600);

async function snap(name) {
  await page.screenshot({ path: `${prefix}-${name}.png` });
  console.log('shot', name);
}
await snap('start');

async function toStation(id, name, opts = {}) {
  const found = await page.evaluate(({ id, afterOpp, attempt }) => {
    const Sim = window.Sim;
    Sim.state.speed = 8;
    for (let i = 0; i < 500; i++) {
      const cur = Sim.state.cur;
      const here = Sim.state.station === id &&
        (!afterOpp || (cur && cur.idx + 1 >= afterOpp)) &&
        (!attempt || (cur && cur.won === attempt));
      if (here) { Sim.pause(); return true; }
      Sim.step();
      for (let k = 0; k < 8; k++) Sim.update(0.1);
    }
    return false;
  }, { id, afterOpp: opts.afterOpp || 0, attempt: opts.won });
  if (!found) { console.log('DID NOT REACH', id, JSON.stringify(opts)); return; }
  await page.waitForTimeout(450);
  await snap(name);
}

await toStation('gate', 'gate-blocked', { afterOpp: 10 });        // audience gate on row 10
await toStation('bid', 'bid', { afterOpp: 5 });
await toStation('auction', 'auction-won', { afterOpp: 1, won: true });
await toStation('auction', 'auction-lost', { afterOpp: 6, won: false });
await toStation('impression', 'serve', { afterOpp: 3, won: true });
await toStation('click', 'click', { afterOpp: 3, won: true });
await toStation('conversion', 'convert', { afterOpp: 3 });
await toStation('learn', 'ledger', { afterOpp: 4 });
await toStation('done', 'closed');

/* mobile: sheet closed + open, plus landscape */
const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
mob.on('pageerror', (e) => console.log('mobile pageerror:', e.message));
await mob.goto(url, { waitUntil: 'load' });
await mob.waitForTimeout(700);
await mob.screenshot({ path: `${prefix}-mobile-closed.png` });
await mob.click('#sheet-handle');
await mob.waitForTimeout(400);
await mob.screenshot({ path: `${prefix}-mobile-open.png` });
console.log('shot mobile');

await browser.close();
