/* world.js: BidTown - the static place. Routes, stations, districts, landmarks.
 *
 * One lap is one ad opportunity: the bid request leaves the publisher's page,
 * passes the gatehouse (audience, frequency, budget), gets a price at the
 * bidding office, races two rivals in the auction hall, and - only if it wins -
 * the creative is served at the delivery bay, a reader clicks at the turnstile,
 * maybe converts at the checkout, and the day's numbers close at the
 * performance office, where the next bid is computed.
 *
 * Routes chain, one leg per decision:
 *   A    slot -> gate            (blocked laps take PASS back to the slot)
 *   B    gate -> bid -> auction  (lost laps take LOSS back to the slot)
 *   C    auction -> impression -> click
 *   D    click -> conversion
 *   E    conversion -> learn -> slot (the loop closes; a new opportunity begins)
 *
 * A station's `id` is a model step. Gated stations (sim.js) are driven past on
 * laps where nothing happened, so a passed opportunity is a short, honest lap.
 */
(function (global) {
  'use strict';

  var Iso = global.Iso;
  var makeRoute = Iso.makeRoute;

  /* ---- routes ------------------------------------------------------------- */

  var A = makeRoute([
    [18, 10],      // 0 slot: the request is born
    [13, 10],      // 1 corner
    [13, 18]       // 2 gate
  ]);

  var PASS = makeRoute([
    [13, 18],
    [14.5, 13],
    [18, 10]
  ]);

  var B = makeRoute([
    [13, 18],      // 0 gate
    [13, 27],      // 1 corner
    [17, 31],      // 2 bid desk
    [28, 32]       // 3 auction floor
  ]);

  var LOSS = makeRoute([
    [28, 32],
    [24, 24],
    [19, 15],
    [18, 10]
  ]);

  var C = makeRoute([
    [28, 32],      // 0 auction
    [40, 30],      // 1 delivery bay
    [45, 27],      // 2 corner
    [45, 20]       // 3 turnstile
  ]);

  var D = makeRoute([
    [45, 20],      // 0 turnstile
    [45, 14],      // 1 corner
    [42, 10]       // 2 checkout
  ]);

  var E = makeRoute([
    [42, 10],      // 0 checkout
    [30, 10],      // 1 performance office
    [18, 10]       // 2 slot (next opportunity)
  ]);

  function station(route, idx, id, dwell) {
    return { dist: route.cum[idx], id: id, dwell: dwell == null ? 0.8 : dwell };
  }

  var STATIONS = {
    a: [station(A, 0, 'slot', 1.4), station(A, 2, 'gate', 1.6)],
    pass: [],
    b: [station(B, 2, 'bid', 1.5), station(B, 3, 'auction', 1.8)],
    loss: [],
    c: [station(C, 1, 'impression', 1.8), station(C, 3, 'click', 1.4)],
    d: [station(D, 2, 'conversion', 1.6)],
    e: [station(E, 1, 'learn', 1.6)]
  };

  var STATION_TO_DISTRICT = {
    slot: 'slot', gate: 'gate', bid: 'bid', auction: 'auction',
    impression: 'impression', click: 'click', conversion: 'conversion',
    learn: 'learn'
  };

  /* ---- palette ------------------------------------------------------------ */

  var COL = {
    steel:  '#4a7a9b',
    violet: '#6f63a8',
    ochre:  '#c2913c',
    stone:  '#7d8b96',
    rose:   '#b05470',
    sage:   '#6d9068',
    teal:   '#3f8a86',
    orange: '#c07a3c',
    brick:  '#a85a44',
    moss:   '#5f8a52',
    plum:   '#8b5f96',
    ink:    '#4a4540',
    paper:  '#e5e1d5',
    road:   '#c9c4b6',
    roadTop:'#d8d3c6'
  };

  /* ---- districts (clickable, narrated) ------------------------------------ */

  var DISTRICTS = [
    {
      id: 'slot', name: 'The Page', x: 20, y: 7, r: 4.8, color: COL.steel,
      tag: 'An opportunity appears',
      short: 'Every page view with an ad slot starts a race that lasts about a hundred milliseconds.',
      body: 'A reader opens an article and the slot is empty for a moment. The page hands the exchange everything a bidder could want: an anonymous user id, the device, the page, the size and position of the slot. That package is the bid request this van is carrying, and the whole journey ahead of it happens before the content finishes rendering. One page with three slots is three requests; an exchange may send each of them to dozens of bidders at once. This day is 24 opportunities, one user session each: watch the request leave empty and come back, sometimes, with an ad.'
    },
    {
      id: 'gate', name: 'The Gatehouse', x: 16, y: 17, r: 4.4, color: COL.stone,
      tag: 'Three questions first',
      short: 'The cheapest bid is the one you never made: three checks come before any money moves.',
      body: 'Is this user in the targeting, and not excluded? Has this user seen enough today? Is there budget left for this hour? Only a request that passes all three reaches the bidding desk; a failed check is a pass, not a loss, and it costs nothing. In a real platform most requests die here, which is why the gatehouse is built wider than the auction hall. Watch the booms: on this day the audience check blocks three sessions, the frequency cap stops one user\'s fourth block, and once the day\'s budget is gone the gate closes on everything that remains.'
    },
    {
      id: 'bid', name: 'Bidding Office', x: 18, y: 28, r: 4.6, color: COL.plum,
      tag: 'pCTR x pCVR x target',
      short: 'The bid is an estimate of value, not an opinion about the ad.',
      body: 'Everything here is arithmetic on two estimates: how often this audience clicks, and how often a click converts. The office started with priors, 0.5 percent and 2.5 percent, because a platform begins with history rather than a blank sheet. After every delivered block those estimates are smoothed toward what actually happened, and the bid is recomputed: pCTR x pCVR x target CPA, in CPM terms, clamped to a sane range. With a $30 target the first bid is $3.75. Watch it move through the day as clicks and a conversion arrive: a bid is a belief with a timestamp.'
    },
    {
      id: 'auction', name: 'Auction Hall', x: 29, y: 28.5, r: 5.4, color: COL.ochre,
      tag: 'Second price',
      short: 'The winner is the highest bid; the price is set by the runner-up.',
      body: 'Two rivals bid against us on every opportunity, and the rule is second price: the highest bid wins and pays the runner-up plus a cent, never more than its own bid. That is why a bid is a maximum, not a promise; overbid and the runner-up still sets your price. This is the classic model, and the one most marketers still carry in their heads; many exchanges have since moved to first price with header bidding, where winners pay what they bid and bidders shade. Losing here is free: six of this day\'s auctions are lost, mostly when the market runs above our estimated value.'
    },
    {
      id: 'impression', name: 'Delivery Bay', x: 39, y: 27, r: 4.6, color: COL.teal,
      tag: 'Serve, count, bill',
      short: 'The winning creative is served into the slot and the impression is billed at the clearing price.',
      body: 'The ad server serves the winning creative into the slot on the page and writes one number: an impression. One opportunity here is a block of a thousand of them, billed at the clearing CPM, and that single line is the spine of the whole metric tree: spend divided by impressions times a thousand is the CPM you actually paid, and it starts here rather than in a report the next morning. This day\'s blocks clear between $2.61 and $4.01, so the day reads a $3.50 average CPM. In a real account the same line arrives millions of times; only the volume changes.'
    },
    {
      id: 'click', name: 'Turnstile', x: 45.5, y: 21, r: 4.2, color: COL.sage,
      tag: 'CTR, and a free lesson',
      short: 'A click does not change what you pay under CPM billing. It changes what you can learn.',
      body: 'Clicks walk through here and are counted one at a time: 61 of them across 11,000 impressions, a 0.55 percent CTR. Notice what does not happen at the till: under CPM billing the click costs nothing extra, and the CPC in the ledger, $0.63 today, is just spend divided by clicks, a derived view of the same money. What the click really buys is information, a signal that reaches the estimates upstairs and moves the next bid, plus a visitor on the landing page. Whether that visitor converts is the next building\'s problem.'
    },
    {
      id: 'conversion', name: 'Checkout', x: 43, y: 7, r: 4.4, color: COL.rose,
      tag: 'The only event that pays',
      short: 'CVR and CPA are born here; everything before was cost.',
      body: 'A conversion is the only event in this town that produces revenue: two of them today, $45 each. Conversions divided by clicks is the CVR, 3.3 percent; spend divided by conversions is the CPA, $19.25 against a $30 target, which means this day was bought for less than it was allowed to cost. Last-click attribution credits the click that walked through the turnstile, and that is the only attribution this model has; real accounts also argue about view-through windows and multi-touch splits. The checkout is also what closes the loop: without conversions there is nothing to learn from, only clicks.'
    },
    {
      id: 'learn', name: 'Performance Office', x: 30, y: 7, r: 4.6, color: COL.brick,
      tag: 'The loop closes',
      short: 'The day\'s numbers become the next bid; the evidence moves the estimate.',
      body: 'Every metric a performance marketer lives by is one line of arithmetic from four counters: CPM $3.50, CTR 0.55 percent, CVR 3.3 percent, CPC $0.63, CPA $19.25, ROAS 2.34, and the identities tie them together: ROAS is AOV divided by CPA, CPA is CPC divided by CVR. Here the estimates are updated from the day\'s counters and the next bid is recomputed. Real platforms do this with learned models over enormous feature sets and deliberate exploration; this office is the honest simple version. Raise the budget and watch the ledger: the twelfth block carries a conversion the default day could not afford.'
    }
  ];

  var DISTRICT_BY_ID = {};
  DISTRICTS.forEach(function (d) { DISTRICT_BY_ID[d.id] = d; });

  function readSeconds(stationId) {
    var d = DISTRICT_BY_ID[STATION_TO_DISTRICT[stationId] || stationId];
    if (!d) return 9;
    var words = (d.short + ' ' + d.body).split(/\s+/).length;
    return Math.min(26, Math.max(9, words / 3.8 + 3.5));
  }

  /* ---- landmarks the renderer and the sim share --------------------------- */

  var PAGE = { x: 16, y: 4, w: 8, d: 5, h: 3.0 };        // publisher, north-west
  var LEDGER = { x: 28, y: 5, w: 7, d: 4, h: 3.0 };      // performance office
  var STORE = { x: 40, y: 4, w: 6, d: 5, h: 2.8 };       // checkout
  var GATE_HOUSE = { x: 15, y: 14.5, w: 4.5, d: 4, h: 2.6 };
  var OFFICE = { x: 15.5, y: 25.5, w: 6.5, d: 4.5, h: 3.0 };  // bidding
  var HALL = { x: 24.5, y: 24.5, w: 9, d: 5.5, h: 3.4 };      // auction
  var BAY = { x: 35, y: 23.5, w: 7, d: 4.5, h: 2.8 };         // delivery
  var TURN = { x: 43.4, y: 19.6 };                            // turnstile posts
  var BOOM = { y: 18, postA: 11.7, postB: 14.3 };             // gate boom across the west road
  var MASTS = [[25.5, 30.3], [28, 30.3], [30.5, 30.3]];       // us, rival A, rival B
  var HOUSES = [26.5, 29, 31.5, 34, 36.5, 39].map(function (x) {
    return { x: x, y: 15, w: 1.8, d: 1.6, h: 1.4 };
  });
  var HOUSE_USERS = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];

  /* ---- buildings and props ------------------------------------------------ */

  var buildings = [];
  var props = [];

  function put(o) { buildings.push(o); return o; }

  function block(x, y, o) {
    put({
      x: x, y: y, z: 0, w: o.w, d: o.d, h: o.h, color: o.color,
      roof: o.roof, roofH: o.roofH,
      windows: { cols: o.cols || 3, seed: Math.round(x * 7 + y * 13), color: o.lit }
    });
  }

  function distToRoutes(x, y) {
    var best = 1e9;
    [A, PASS, B, LOSS, C, D, E].forEach(function (r) {
      r.segs.forEach(function (s) {
        var vx = s.b.x - s.a.x, vy = s.b.y - s.a.y;
        var t = ((x - s.a.x) * vx + (y - s.a.y) * vy) / (vx * vx + vy * vy);
        t = Math.max(0, Math.min(1, t));
        var d = Math.hypot(x - (s.a.x + vx * t), y - (s.a.y + vy * t));
        if (d < best) best = d;
      });
    });
    return best;
  }

  function build() {
    if (buildings.length) return;

    /* -- The Page: a browser slab with the slot on its road face ---------- */
    put({
      kind: 'page', x: PAGE.x, y: PAGE.y, z: 0, w: PAGE.w, d: PAGE.d, h: PAGE.h,
      color: '#c3d0d9', panels: { cols: 6, seed: 21, color: '#dbe6ec' }
    });

    /* -- Performance Office: ledger hall with the metrics board ----------- */
    put({
      kind: 'ledger', x: LEDGER.x, y: LEDGER.y, z: 0, w: LEDGER.w, d: LEDGER.d,
      h: LEDGER.h, color: '#d6b8ac', panels: { cols: 6, seed: 9, color: '#eed7cb' }
    });

    /* -- Checkout: a shop with a till and a bell -------------------------- */
    put({
      kind: 'store', x: STORE.x, y: STORE.y, z: 0, w: STORE.w, d: STORE.d, h: STORE.h,
      color: '#d5b3bd', panels: { cols: 4, seed: 4, color: '#ecd5dc' }
    });

    /* -- The Gatehouse: the three checks and one boom across the road ----- */
    put({
      kind: 'gatehouse', x: GATE_HOUSE.x, y: GATE_HOUSE.y, z: 0, w: GATE_HOUSE.w,
      d: GATE_HOUSE.d, h: GATE_HOUSE.h, color: '#c8cdd2'
    });
    put({ kind: 'boomPost', x: BOOM.postA, y: BOOM.y, color: COL.stone });
    put({ kind: 'boomBeam', x: (BOOM.postA + BOOM.postB) / 2, y: BOOM.y, color: COL.stone });
    put({ kind: 'boomPost', x: BOOM.postB, y: BOOM.y, color: COL.stone });

    /* -- Bidding Office: the desk where the bid is computed --------------- */
    put({
      kind: 'office', x: OFFICE.x, y: OFFICE.y, z: 0, w: OFFICE.w, d: OFFICE.d,
      h: OFFICE.h, color: '#b6afd0', panels: { cols: 5, seed: 7, color: '#d8d3ea' }
    });

    /* -- Auction Hall: three masts on the road side of the hall ----------- */
    put({
      kind: 'hall', x: HALL.x, y: HALL.y, z: 0, w: HALL.w, d: HALL.d, h: HALL.h,
      color: '#ddc79a', panels: { cols: 7, seed: 11, color: '#edd9ab' }
    });
    MASTS.forEach(function (m, i) {
      put({ kind: 'bidmast', x: m[0], y: m[1], color: COL.ochre, which: i });
    });

    /* -- Delivery Bay: the ad server, with a serve chute ------------------ */
    put({
      kind: 'bay', x: BAY.x, y: BAY.y, z: 0, w: BAY.w, d: BAY.d, h: BAY.h,
      color: '#a9c4c2', panels: { cols: 6, seed: 5, color: '#cfe0de' }
    });

    /* -- Turnstile: a gate across the east road --------------------------- */
    put({ kind: 'turnPost', x: TURN.x, y: TURN.y - 1.6, color: COL.sage });
    put({ kind: 'turnBeam', x: TURN.x + 0.1, y: TURN.y, color: COL.sage });
    put({ kind: 'turnPost', x: TURN.x, y: TURN.y + 1.6, color: COL.sage });

    /* -- Audience Row: six small houses, one per user in the script ------- */
    HOUSES.forEach(function (h, i) {
      block(h.x, h.y, {
        w: h.w, d: h.d, h: h.h + (i % 2) * 0.25,
        color: i % 2 ? '#d8cfbe' : '#cfc7b6', cols: 2, lit: '#8b9aa4',
        roof: i % 3 ? '#b09a86' : '#a8907c', roofH: 0.45
      });
    });

    /* -- scenery ---------------------------------------------------------- */
    var spots = [
      [10, 24], [10, 30], [20, 20], [24, 20], [30, 20], [34, 20], [40, 16],
      [42, 24], [48, 12], [48, 30], [34, 37], [24, 37], [14, 37], [52, 22],
      [8, 14], [30, 3], [24, 3], [38, 12]
    ];
    spots.forEach(function (s, i) {
      if (distToRoutes(s[0], s[1]) < 2.6) return;
      var n = Iso.hash2(s[0], s[1], 3);
      if (n < 0.45) {
        block(s[0], s[1], {
          w: 1.8 + n * 1.6, d: 1.6 + n, h: 1.3 + n * 1.4,
          color: n < 0.22 ? '#d8cfbe' : '#cfc7b6', cols: 2, lit: '#8b9aa4',
          roof: '#b09a86', roofH: 0.45
        });
      } else {
        props.push({ kind: n < 0.75 ? 'tree' : 'lamp', x: s[0], y: s[1], seed: i + 5 });
      }
    });
    for (var k = 0; k < 4; k++) {
      props.push({ kind: 'lamp', x: 15 + k * 8, y: 11.4, seed: 40 + k });
    }

    /* -- the ad carriers for 'loaded' houses: crates appear above them ---- */
    put({ kind: 'fountain', x: 32.5, y: 24.5, color: '#9aa3ac' });
  }

  global.World = {
    GW: 58, GH: 40,
    routes: { a: A, pass: PASS, b: B, loss: LOSS, c: C, d: D, e: E },
    stations: STATIONS,
    districts: DISTRICTS,
    districtById: DISTRICT_BY_ID,
    stationToDistrict: STATION_TO_DISTRICT,
    readSeconds: readSeconds,
    palette: COL,
    buildings: buildings,
    props: props,
    build: build,
    distToRoutes: distToRoutes,

    PAGE: PAGE, LEDGER: LEDGER, STORE: STORE, GATE_HOUSE: GATE_HOUSE,
    OFFICE: OFFICE, HALL: HALL, BAY: BAY, TURN: TURN, BOOM: BOOM,
    MASTS: MASTS, HOUSES: HOUSES, HOUSE_USERS: HOUSE_USERS
  };
})(window);
