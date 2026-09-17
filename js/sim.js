/* sim.js: the state machine that walks one campaign through the day.
 *
 * Same pacing engine as the template, adapted with three declared changes:
 *
 *   1. Six chained routes: a lap advances through A (slot, gate), then either
 *      PASS (blocked) or B (bid, auction), then either LOSS or C (impression,
 *      click), then D (conversion) and E (learn). Every decision the model
 *      makes picks the next leg, so failed opportunities are short, honest
 *      laps and won ones are the full journey.
 *   2. Gated stations: a station whose event did not happen this lap (a bid on
 *      a passed opportunity, an impression on a lost auction) is driven past
 *      without a stop. The loop-closing ledger only runs on laps that reach it.
 *   3. The day ends when the script is out: the slot's step returns null, the
 *      van stops at the page, and the finale fires.
 *
 * Everything else is the template: stations own the model steps, the FIRST
 * visit to a district stops for as long as its write-up takes to read, and
 * what the reader has already read (`tour`) survives a reset.
 */
(function (global) {
  'use strict';

  var Bid = global.Bid;
  var World = global.World;
  var Iso = global.Iso;

  var BASE_SPEED = 6;        // grid units / second at 1x

  var tour = { seen: Object.create(null), done: false };

  /* Everything is readable except the two that only fire on special laps
     (the checkout needs a conversion, the turnstile needs a delivered block),
     and both of those arrive within the default day. */
  var TOUR_REQUIRED = ['slot', 'gate', 'bid', 'auction', 'impression', 'click', 'conversion', 'learn'];

  var state = {
    running: false,
    paused: true,
    finished: false,

    station: null,
    stationT: 0,
    stepMode: false,
    speed: 1,

    /* ---- model inputs, wired to the sliders in ui.js ---- */
    budget: 36,
    targetCpa: 30,
    freqCap: 3,

    /* ---- the campaign ---- */
    camp: null,
    projection: null,        // a headless full run, for the projected ledger
    cur: null,               // the trace of the opportunity in hand
    phaseDone: { slot: false, gate: false, bid: false, auction: false,
                 impression: false, click: false, conversion: false, learn: false },
    haltPending: false,
    lastResult: '',

    /* ---- pacing ---- */
    reading: false,
    dwellLeft: 0,
    dwellTotal: 0,
    tourDone: false
  };

  var van = { routeName: 'a', dist: 0, dwell: 0, stationIdx: 0 };

  var listeners = [];
  function emit(name, payload) {
    for (var i = 0; i < listeners.length; i++) listeners[i](name, payload);
  }

  /* ---- the campaign ------------------------------------------------------ */

  function project() {
    var camp = Bid.create({ budget: state.budget, targetCpa: state.targetCpa, freqCap: state.freqCap });
    var traces = Bid.run(camp);
    var m = Bid.metrics(camp);
    return {
      blocks: camp.blocks || 0,
      impressions: camp.impressions,
      clicks: camp.clicks,
      conversions: camp.conversions,
      spend: camp.spend,
      revenue: camp.revenue,
      cpa: m.cpa,
      roas: m.roas,
      opportunities: traces.length
    };
  }

  function setParams(params) {
    if (params.budget != null) state.budget = params.budget;
    if (params.targetCpa != null) state.targetCpa = params.targetCpa;
    if (params.freqCap != null) state.freqCap = params.freqCap;
    state.projection = project();
    /* The settings are the program, so a fresh day is the only honest
       response to changing them. The tour survives. */
    if (state.running && !state.finished) run();
    else loadCampaign();
  }

  function loadCampaign() {
    state.camp = Bid.create({ budget: state.budget, targetCpa: state.targetCpa, freqCap: state.freqCap });
  }

  /* ---- lifecycle --------------------------------------------------------- */

  function reset() {
    state.finished = false;
    state.cur = null;
    state.haltPending = false;
    state.lastResult = '';
    state.phaseDone = { slot: false, gate: false, bid: false, auction: false,
                        impression: false, click: false, conversion: false, learn: false };
    state.tourDone = tour.done;
    state.reading = false;
    state.dwellLeft = 0;
    state.dwellTotal = 0;
    loadCampaign();
    van.routeName = 'a';
    van.dist = 0;
    van.stationIdx = 0;
    van.dwell = 0;
  }

  function run() {
    reset();
    state.running = true;
    state.paused = false;
    emit('reset');
  }

  /* ---- per-station work -------------------------------------------------- */

  var OPS = {
    /* The opportunity is born (or the day is out of script). */
    slot: function () {
      var t = Bid.step(state.camp);
      if (!t) { state.haltPending = true; return; }
      state.cur = t;
      state.phaseDone = { slot: true, gate: false, bid: false, auction: false,
                          impression: false, click: false, conversion: false, learn: false };
    },

    gate: function () {
      state.phaseDone.gate = true;
      state.lastResult = state.cur.gate ? state.cur.note : 'gate passed';
    },

    bid: function () {
      state.phaseDone.bid = true;
    },

    auction: function () {
      state.phaseDone.auction = true;
      state.lastResult = state.cur.note;
    },

    impression: function () {
      state.phaseDone.impression = true;
    },

    click: function () {
      state.phaseDone.click = true;
    },

    conversion: function () {
      state.phaseDone.conversion = true;
    },

    learn: function () {
      state.phaseDone.learn = true;
    }
  };

  /* A station that does not apply to this opportunity is driven past. */
  var GATES = {
    bid: function () { return !!state.cur && !state.cur.gate; },
    auction: function () { return !!state.cur && !state.cur.gate; },
    impression: function () { return !!state.cur && state.cur.won; },
    click: function () { return !!state.cur && state.cur.won; },
    conversion: function () { return !!state.cur && state.cur.conversions > 0; },
    learn: function () { return !!state.cur && state.cur.won; }
  };

  /* ---- update ------------------------------------------------------------ */

  function routeOf(name) { return World.routes[name]; }

  function travelBoost() { return state.tourDone ? 6.5 : 1; }
  function dwellBoost() { return state.tourDone ? 3.0 : 1; }

  function fire(st) {
    state.station = st.id;
    state.stationT = 0;
    var op = OPS[st.id];
    if (op) op();
    emit('station', st.id);
  }

  function finishRun() {
    state.finished = true;
    state.paused = true;
    state.haltPending = false;
    state.station = 'done';
    tour.done = true;
    state.tourDone = true;
    emit('station', 'done');
  }

  /* Which leg comes next. Every decision the model made this lap picks it. */
  function advanceRoute() {
    var t = state.cur;
    var blocked = !!t && !!t.gate;
    var lost = !!t && !t.gate && !t.won;
    var clicked = !!t && t.won && t.clicks > 0;

    if (van.routeName === 'a') {
      if (state.haltPending) { finishRun(); return; }
      next(blocked ? 'pass' : 'b', blocked ? 0.3 : 0.2);
    } else if (van.routeName === 'pass' || van.routeName === 'loss') {
      newLap();
    } else if (van.routeName === 'b') {
      next(lost ? 'loss' : 'c', lost ? 0.35 : 0.2);
    } else if (van.routeName === 'c') {
      next(clicked ? 'd' : 'e', 0.2);
    } else if (van.routeName === 'd') {
      next('e', 0.2);
    } else if (van.routeName === 'e') {
      newLap();
    }
  }

  function next(routeName, dwell) {
    van.routeName = routeName;
    van.dist = 0;
    van.stationIdx = 0;
    van.dwell = dwell;
  }

  function newLap() {
    if (state.haltPending) { finishRun(); return; }
    /* Peek whether the script has another opportunity at all. */
    if (state.camp.idx >= Bid.OPPORTUNITIES.length) { finishRun(); return; }
    next('a', 0);
  }

  function update(dt) {
    state.stationT += dt;
    if (!state.running || state.paused || state.finished) return;

    /* The day ends at the slot, not in the dwell branch: step() and the speed
       slider can both zero a dwell, and a finished day must never send the
       van around again. */
    if (state.haltPending && van.routeName === 'a' && van.dwell <= 0) {
      finishRun();
      return;
    }

    var sdt = dt * state.speed * travelBoost();

    if (van.dwell > 0) {
      van.dwell -= dt * state.speed;
      state.dwellLeft = Math.max(0, van.dwell);
      if (van.dwell <= 0) {
        state.reading = false;
        state.dwellTotal = 0;
      }
      return;
    }

    var route = routeOf(van.routeName);
    van.dist += BASE_SPEED * sdt;

    var sts = World.stations[van.routeName];
    while (van.stationIdx < sts.length) {
      var st = sts[van.stationIdx];
      if (van.dist < st.dist) break;
      van.stationIdx++;

      var gate = GATES[st.id];
      if (gate && !gate()) continue;

      van.dist = st.dist;
      var topic = World.stationToDistrict[st.id] || st.id;
      var firstTime = !tour.seen[topic];
      fire(st);
      tour.seen[topic] = true;
      if (TOUR_REQUIRED.every(function (id) { return tour.seen[id]; })) tour.done = true;
      state.tourDone = tour.done;
      van.dwell = firstTime ? World.readSeconds(st.id) : st.dwell / dwellBoost();
      state.reading = firstTime;
      state.dwellTotal = van.dwell;
      state.dwellLeft = van.dwell;
      if (state.stepMode) { state.paused = true; state.stepMode = false; }
      return;
    }

    if (van.dist >= route.total) advanceRoute();
  }

  /* ---- queries used by the renderer and the camera ----------------------- */

  function vanPosition() {
    return Iso.smoothAt(routeOf(van.routeName), van.dist, 0.8);
  }

  global.Sim = {
    state: state,
    van: van,
    run: run,
    reset: function () { reset(); emit('reset'); },
    replayTour: function () { tour.seen = Object.create(null); tour.done = false; },
    setParams: setParams,
    project: project,
    update: update,
    vanPosition: vanPosition,
    on: function (fn) { listeners.push(fn); },
    play: function () { if (!state.finished) { state.paused = false; state.running = true; } },
    pause: function () { state.paused = true; },
    toggle: function () { if (state.paused) this.play(); else this.pause(); },
    step: function () {
      if (state.finished) return;
      state.running = true;
      state.stepMode = true;
      state.paused = false;
      if (van.dwell > 0) van.dwell = 0;
    }
  };

  /* Boot: a campaign and its projection exist before the reader presses Run. */
  state.projection = project();
  loadCampaign();
})(window);
