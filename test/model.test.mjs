/* model.test.mjs: hand-derived expectations for the BidTown campaign model.
 *
 * Every number below was worked out by hand from docs/knowledge-base.md before
 * running anything, so the test is an independent check and not a snapshot of
 * whatever the model happens to do. Run: node test/model.test.mjs
 */
await import('../js/model.js');
const Bid = globalThis.Bid;

let failures = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${e}\n  actual   ${a}`);
  }
}
function near(actual, expected, label, tol = 1e-9) {
  if (Math.abs(actual - expected) > tol) {
    failures++;
    console.error(`FAIL ${label}\n  expected ${expected}\n  actual   ${actual}`);
  }
}
function ok(cond, label) {
  if (!cond) { failures++; console.error(`FAIL ${label}`); }
}

/* ---- declared constants ------------------------------------------------- */

eq([Bid.AOV, Bid.BLOCK, Bid.BID_MIN, Bid.BID_MAX], [45, 1000, 0.10, 20.00], 'declared facts');
eq(Bid.OPPORTUNITIES.length, 24, 'a 24-opportunity day');
eq(Bid.OPPORTUNITIES.filter((o) => !o.audience).length, 3, 'three out-of-audience rows');

/* ---- the estimates and the bid, at zero data ---------------------------- */

let camp = Bid.create({});
let e = Bid.estimates(camp);
near(e.pctr, 10 / 2000, 'pCTR prior is 0.5 percent');
near(e.pcvr, 5 / 200, 'pCVR prior is 2.5 percent');
near(Bid.bidFor(camp), 0.005 * 0.025 * 30 * 1000, 'first bid is $3.75');

camp = Bid.create({ targetCpa: 60 });
near(Bid.bidFor(camp), 7.50, 'the target CPA scales the bid linearly');
camp = Bid.create({ targetCpa: 1000 });
near(Bid.bidFor(camp), Bid.BID_MAX, 'the clamp caps any bid at $20');

/* ---- the auction rule --------------------------------------------------- */

eq(Bid.clearingFor(4.00, [2.10, 2.90]), { won: true, clearing: 2.91 }, 'second price: runner-up plus a cent');
eq(Bid.clearingFor(2.80, [2.10, 2.90]), { won: false, clearing: null }, 'a losing bid costs nothing');
eq(Bid.clearingFor(2.90, [2.10, 2.90]), { won: false, clearing: null }, 'a tie loses: strictly highest wins');
eq(Bid.clearingFor(2.95, [2.00, 2.94]), { won: true, clearing: 2.95 }, 'clearing never exceeds our own bid');

/* ---- the default day, rows 1 to 5 by hand -------------------------------
 * Row 1: bid 3.75 vs 2.10/2.90: win, clearing 2.91. Block 1: 4 clicks.
 * Row 2: pCTR (4+10)/3000, pCVR 5/204: bid 3.4314: win, clearing 2.61,
 *        block 2 converts: +$45.
 * Row 3: pCTR 20/4000, pCVR 6/210: bid 4.2857: win, clearing 2.86, block 3.
 * Row 4: u1 has 3 of 3 blocks: the frequency gate.
 * Row 5: pCTR 23/5000, pCVR 6/213: bid 3.8873: win, clearing 3.71, block 4.
 */

camp = Bid.create({});
let t1 = Bid.step(camp), t2 = Bid.step(camp), t3 = Bid.step(camp), t4 = Bid.step(camp), t5 = Bid.step(camp);

eq([t1.bid.toFixed(2), t1.won, t1.clearing, t1.block, t1.clicks, t1.conversions],
  ['3.75', true, 2.91, 1, 4, 0], 'row 1');
eq([t2.bid.toFixed(4), t2.won, t2.clearing, t2.conversions, t2.revenue],
  ['3.4314', true, 2.61, 1, 45], 'row 2 converts');
eq([t3.bid.toFixed(4), t3.won, t3.clearing, t3.block, t3.conversions],
  ['4.2857', true, 2.86, 3, 0], 'row 3');
eq([t4.gate, t4.won], ['frequency', false], 'row 4 is frequency-capped');
eq([t5.bid.toFixed(4), t5.won, t5.clearing, t5.block], ['3.8873', true, 3.71, 4], 'row 5');
near(camp.spend, 2.91 + 2.61 + 2.86 + 3.71, 'spend after five rows');

/* ---- the default day, to the end ---------------------------------------- */

camp = Bid.create({});
const traces = Bid.run(camp);
eq(traces.length, 24, 'the day runs 24 opportunities');
eq(camp.blocks, 11, 'eleven blocks deliver at the defaults');
eq(camp.impressions, 11000, 'eleven thousand impressions');
eq(camp.clicks, 61, 'sixty-one clicks');
eq(camp.conversions, 2, 'two conversions at the default budget');
near(camp.spend, 38.50, 'spend (the cap is checked before the auction, so one clearing overshoots)', 0.005);
eq(camp.revenue, 90, 'two conversions at $45');
eq([traces[21].gate, traces[22].gate, traces[23].gate], ['budget', 'budget', 'budget'],
  'the day ends on the budget gate');
eq(traces.filter(function (t) { return t.gate === 'frequency'; }).length, 1,
  'exactly one frequency gate (row 4) at the defaults');
eq(traces.filter(function (t) { return t.gate === 'audience'; }).length, 3, 'three audience gates');

let m = Bid.metrics(camp);
near(m.cpm, 38.51 / 11000 * 1000, 'CPM identity', 0.005);
near(m.cpc, m.cpm / (m.ctr * 1000), 'CPC identity');
near(m.cpa, m.cpc / m.cvr, 'CPA identity');
near(m.roas, Bid.AOV / m.cpa, 'ROAS identity');
near(m.roas, camp.revenue / camp.spend, 'ROAS from revenue');
eq([m.ctr < 0.01, m.cvr < 0.1, m.cpm > 2 && m.cpm < 5], [true, true, true],
  'metrics stay in believable territory');

/* ---- the sliders are real levers ---------------------------------------- */

camp = Bid.create({ budget: 40 });
Bid.run(camp);
eq([camp.blocks, camp.conversions], [12, 3], 'a bigger budget buys block 12 and its conversion');
ok(camp.spend > 38.51, 'and spends more');

camp = Bid.create({ budget: 36, targetCpa: 60 });
Bid.run(camp);
ok(camp.blocks < 11, 'a higher target CPA bids dearer and delivers fewer blocks on a fixed budget');

camp = Bid.create({ freqCap: 1 });
Bid.run(camp);
ok(camp.blocks < 11, 'a tighter frequency cap delivers fewer blocks');

/* ---- the step boundary -------------------------------------------------- */

camp = Bid.create({});
Bid.run(camp);
eq(Bid.step(camp), null, 'no opportunity after the day ends');

/* ---- every trace is internally consistent ------------------------------- */

camp = Bid.create({});
let prevSpend = 0, prevImps = 0;
for (const t of Bid.run(camp)) {
  ok(t.totals.spend >= prevSpend && t.totals.impressions >= prevImps, 'counters never go backwards');
  if (t.gate) ok(t.clearing === null && !t.delivered && t.cost === 0, 'a gated row bids nothing');
  if (t.won) ok(t.cost > 0 && t.delivered && t.totals.impressions === 1000 * t.block, 'a won row delivers one block');
  if (!t.won) ok(t.cost === 0 && !t.delivered, 'a lost row costs nothing');
  prevSpend = t.totals.spend; prevImps = t.totals.impressions;
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('PASS - gates, estimates, bids, auction, billing, metrics and levers all match hand-derived values.');
const end = Bid.totals(camp);
console.log(`default day: ${camp.blocks} blocks, ${end.impressions} impressions, ${end.clicks} clicks, ` +
  `${end.conversions} conversions, spend $${end.spend.toFixed(2)}, CPA $${Bid.metrics(camp).cpa.toFixed(2)}`);
