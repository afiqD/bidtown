/* model.js: a campaign that really bids, really pays and really learns.
 *
 * THIS IS THE LESSON. Every number the panel shows comes out of the
 * arithmetic below: the eligibility checks, the smoothed estimates, the
 * target-CPA bid formula, the second-price clearing, the billing, the metric
 * identities and the update that moves the next bid. Delete the renderer and
 * the campaign still runs.
 *
 * The honest boundary, restated in the About modal and the README:
 *
 *   Genuinely computed   the gate checks; the frequency counts; the
 *                        estimates and their priors; the bid formula and its
 *                        clamp; the auction result and clearing price; the
 *                        billing; the counters; every metric identity; the
 *                        pacing arithmetic; the learning update.
 *   Scaled / scripted    one opportunity here is a 1,000-impression block
 *                        from one placement, so a 24-opportunity day moves
 *                        real dollars (a real auction fills one impression;
 *                        the auction logic is unchanged). The rivals, the
 *                        audience flags and the clicks/conversions are a
 *                        fixed script: DECLARED below, not simulated.
 *   ASSUMED              the AOV; the prior pseudo-counts; the bid clamp;
 *                        hard-cap pacing instead of smooth pacing; second
 *                        price instead of first price with shading; last-click
 *                        attribution only.
 *   Faked                the buildings and the audience town. Nothing numeric.
 */
(function (global) {
  'use strict';

  /* ---- declared facts of the town --------------------------------------- */

  var AOV = 45;                       // ASSUMED: one conversion is worth $45
  var BLOCK = 1000;                   // impressions per delivered block
  var BID_MIN = 0.10, BID_MAX = 20.00;  // ASSUMED clamp on any bid (CPM)

  /* Smoothed estimates: the honest simple version of what a real model does.
     pCTR_hat = (clicks + 10) / (impressions + 2000)      prior 0.5 percent
     pCVR_hat = (conversions + 5) / (clicks + 200)        prior 2.5 percent
     Heavy pseudo-counts on purpose: a platform starts with history, so two
     lucky clicks must not double the bid. */
  var PRIOR_PCTR = { a: 10, b: 1990 };
  var PRIOR_PCVR = { a: 5, b: 195 };

  /* The scripted day. user, in audience, the two rival CPM bids.
     Rivals: DECLARED script, not a simulation of other advertisers.
     Calibrated so the market is cheap early, competitive mid-day and cheap
     again late, and the campaign's learned bid decides each auction. */
  var OPPORTUNITIES = [
    { user: 'u1', audience: true,  rivalA: 2.10, rivalB: 2.90 },
    { user: 'u1', audience: true,  rivalA: 2.40, rivalB: 2.60 },
    { user: 'u1', audience: true,  rivalA: 2.20, rivalB: 2.85 },
    { user: 'u1', audience: true,  rivalA: 2.30, rivalB: 2.75 },
    { user: 'u2', audience: true,  rivalA: 3.40, rivalB: 3.70 },
    { user: 'u2', audience: true,  rivalA: 4.30, rivalB: 4.70 },
    { user: 'u2', audience: true,  rivalA: 3.60, rivalB: 3.75 },
    { user: 'u2', audience: true,  rivalA: 4.60, rivalB: 5.00 },
    { user: 'u3', audience: true,  rivalA: 3.40, rivalB: 4.20 },
    { user: 'u3', audience: false, rivalA: 2.50, rivalB: 2.70 },
    { user: 'u3', audience: true,  rivalA: 3.45, rivalB: 3.70 },
    { user: 'u3', audience: true,  rivalA: 4.40, rivalB: 4.80 },
    { user: 'u4', audience: true,  rivalA: 3.50, rivalB: 3.80 },
    { user: 'u4', audience: true,  rivalA: 4.10, rivalB: 4.50 },
    { user: 'u4', audience: false, rivalA: 4.40, rivalB: 4.80 },
    { user: 'u4', audience: true,  rivalA: 3.20, rivalB: 3.60 },
    { user: 'u5', audience: true,  rivalA: 3.55, rivalB: 3.85 },
    { user: 'u5', audience: true,  rivalA: 4.50, rivalB: 4.90 },
    { user: 'u5', audience: false, rivalA: 4.55, rivalB: 4.95 },
    { user: 'u5', audience: true,  rivalA: 3.30, rivalB: 3.65 },
    { user: 'u6', audience: true,  rivalA: 3.60, rivalB: 3.99 },
    { user: 'u6', audience: true,  rivalA: 3.15, rivalB: 3.55 },
    { user: 'u6', audience: true,  rivalA: 4.70, rivalB: 5.10 },
    { user: 'u6', audience: true,  rivalA: 3.25, rivalB: 3.60 }
  ];

  /* What the audience does with each DELIVERED block (1,000 impressions):
     a scripted number of clicks, and conversions on the listed blocks.
     Declared: not a simulated audience. */
  var CLICKS_PER_BLOCK = [4, 6, 3, 8, 5, 4, 7, 6, 5, 9, 4, 3, 6, 5, 4, 6, 7, 4, 5, 6, 4, 5, 6, 4];
  var CONVERSIONS_AT_BLOCK = [2, 8, 12];   // one conversion each, when those blocks deliver

  /* ---- campaign state ---------------------------------------------------- */

  function create(params) {
    params = params || {};
    return {
      budget: params.budget == null ? 36 : params.budget,          // dollars per day
      targetCpa: params.targetCpa == null ? 30 : params.targetCpa, // dollars
      freqCap: params.freqCap == null ? 3 : params.freqCap,        // blocks per user
      idx: 0,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      freq: {},          // user -> blocks delivered (today)
      last: null
    };
  }

  function estimates(camp) {
    var pc = PRIOR_PCTR, pv = PRIOR_PCVR;
    /* Beta-style smoothing: at zero data the estimate equals the prior mean,
       and observations pull it toward the observed rate. */
    return {
      pctr: (camp.clicks + pc.a) / (camp.impressions + pc.a + pc.b),
      pcvr: (camp.conversions + pv.a) / (camp.clicks + pv.a + pv.b)
    };
  }

  function bidFor(camp) {
    var e = estimates(camp);
    var bid = e.pctr * e.pcvr * camp.targetCpa * 1000;
    if (bid < BID_MIN) bid = BID_MIN;
    if (bid > BID_MAX) bid = BID_MAX;
    return bid;
  }

  function metrics(camp) {
    var m = {
      cpm: camp.impressions ? camp.spend / camp.impressions * 1000 : 0,
      ctr: camp.impressions ? camp.clicks / camp.impressions : 0,
      cvr: camp.clicks ? camp.conversions / camp.clicks : 0,
      cpc: camp.clicks ? camp.spend / camp.clicks : 0,
      cpa: camp.conversions ? camp.spend / camp.conversions : 0,
      roas: camp.spend ? camp.revenue / camp.spend : 0,
      winRate: camp.bidsMade ? camp.wins / camp.bidsMade : 0
    };
    return m;
  }

  /* The auction rule as a pure function, so it can be tested on its own.
     Second price, declared: the winner is strictly the highest bid; it pays
     the runner-up (the highest other bid) plus a cent, never above its own. */
  function clearingFor(bid, rivals) {
    var highest = Math.max(rivals[0], rivals[1]);
    if (bid > highest) {
      /* money rounds to cents */
      return { won: true, clearing: Math.round(Math.min(bid, highest + 0.01) * 100) / 100 };
    }
    return { won: false, clearing: null };
  }

  /* Execute one opportunity. Returns a trace of everything that happened,
     or null when the day's script is exhausted. */
  function step(camp) {
    if (camp.idx >= OPPORTUNITIES.length) return null;
    var op = OPPORTUNITIES[camp.idx];
    var e = estimates(camp);

    var t = {
      idx: camp.idx,
      user: op.user,
      audience: op.audience,
      rivals: [op.rivalA, op.rivalB],
      pctr: e.pctr,
      pcvr: e.pcvr,
      bid: bidFor(camp),
      gate: null,
      gateNote: '',
      won: false,
      clearing: null,
      cost: 0,
      delivered: false,
      block: 0,            // which delivered block this was (1-based)
      clicks: 0,
      conversions: 0,
      revenue: 0,
      note: ''
    };

    /* --- the gate: audience, then frequency, then budget ---------------- */
    if (!op.audience) {
      t.gate = 'audience';
      t.gateNote = op.user + ' is outside the targeting';
    } else if ((camp.freq[op.user] || 0) >= camp.freqCap) {
      t.gate = 'frequency';
      t.gateNote = op.user + ' has had ' + (camp.freq[op.user] || 0) +
        ' of ' + camp.freqCap + ' allowed impressions today';
    } else if (camp.spend >= camp.budget) {
      t.gate = 'budget';
      t.gateNote = 'budget spent: $' + fmtMoney(camp.spend) + ' of $' + fmtMoney(camp.budget);
    }

    /* --- the auction ------------------------------------------------------
       Second price, declared: the winner pays the second-highest bid plus a
       cent, never above its own bid. Losing is free. */
    if (!t.gate) {
      camp.bidsMade = (camp.bidsMade || 0) + 1;
      var result = clearingFor(t.bid, t.rivals);
      if (result.won) {
        t.won = true;
        t.clearing = result.clearing;
        t.cost = round2(t.clearing);
        camp.spend = round2(camp.spend + t.cost);
        camp.wins = (camp.wins || 0) + 1;
      }
    }

    /* --- delivery, and the scripted audience ----------------------------- */
    if (t.won) {
      camp.impressions += BLOCK;
      camp.freq[op.user] = (camp.freq[op.user] || 0) + 1;
      t.delivered = true;
      camp.blocks = (camp.blocks || 0) + 1;
      t.block = camp.blocks;

      var scriptedClicks = CLICKS_PER_BLOCK[t.block - 1] || 0;
      t.clicks = scriptedClicks;
      camp.clicks += scriptedClicks;

      if (CONVERSIONS_AT_BLOCK.indexOf(t.block) !== -1) {
        t.conversions = 1;
        camp.conversions += 1;
        t.revenue = AOV;
        camp.revenue += AOV;
      }
    }

    /* --- the learning update ---------------------------------------------
       With one exception, nothing here is ML: the estimates are smoothed
       observed rates and the bid is the target-CPA formula. That is the
       declared simplification; the loop it demonstrates is real. */
    var e2 = estimates(camp);
    t.nextPctr = e2.pctr;
    t.nextPcvr = e2.pcvr;
    t.nextBid = bidFor(camp);
    t.totals = totals(camp);
    t.metrics = metrics(camp);

    t.note = t.gate
      ? 'passed: ' + t.gateNote
      : t.won
        ? 'won at $' + fmtMoney(t.clearing) + ' CPM, ' + t.clicks + ' clicks' +
          (t.conversions ? ', ' + t.conversions + ' conversion' + (t.conversions > 1 ? 's' : '') : '')
        : 'lost: the top rival bid $' + fmtMoney(Math.max(t.rivals[0], t.rivals[1])) +
          ' against our $' + fmtMoney(t.bid);

    camp.idx++;
    camp.last = t;
    return t;
  }

  function run(camp) {
    var traces = [];
    var t;
    while ((t = step(camp))) traces.push(t);
    return traces;
  }

  function totals(camp) {
    return {
      spend: camp.spend,
      impressions: camp.impressions,
      clicks: camp.clicks,
      conversions: camp.conversions,
      revenue: camp.revenue,
      budget: camp.budget
    };
  }

  /* ---- formatting -------------------------------------------------------- */

  function round2(x) { return Math.round(x * 100) / 100; }

  function fmtMoney(x) {
    return (Math.round(x * 100) / 100).toFixed(2);
  }

  function fmtCpm(x) {
    return '$' + fmtMoney(x);
  }

  function fmtPct(x, d) {
    return (x * 100).toFixed(d == null ? 2 : d) + '%';
  }

  function fmtInt(x) {
    return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  global.Bid = {
    AOV: AOV, BLOCK: BLOCK, BID_MIN: BID_MIN, BID_MAX: BID_MAX,
    PRIOR_PCTR: PRIOR_PCTR, PRIOR_PCVR: PRIOR_PCVR,
    OPPORTUNITIES: OPPORTUNITIES,
    CLICKS_PER_BLOCK: CLICKS_PER_BLOCK,
    CONVERSIONS_AT_BLOCK: CONVERSIONS_AT_BLOCK,
    create: create, step: step, run: run,
    clearingFor: clearingFor,
    estimates: estimates, bidFor: bidFor, metrics: metrics, totals: totals,
    fmtMoney: fmtMoney, fmtCpm: fmtCpm, fmtPct: fmtPct, fmtInt: fmtInt
  };
})(typeof window === 'undefined' ? globalThis : window);
