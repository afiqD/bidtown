/* ui.js: DOM panels, controls, narration.
 *
 * The canvas shows the mechanism; this file shows the numbers. Every widget
 * reads Sim.state or calls Bid directly - nothing is stored twice, so the
 * panel can never disagree with the town.
 */
(function (global) {
  'use strict';

  var Sim = global.Sim, World = global.World, Bid = global.Bid;

  var $ = function (id) { return document.getElementById(id); };

  var el = {};
  var activeDistrict = null;
  var pinnedDistrict = null;
  var lastPaint = 0;
  var flyTo = null;
  var sheetOpen = false;

  var STATION_LABEL = {
    slot: 'slot', gate: 'gate', bid: 'bid', auction: 'auction',
    impression: 'serve', click: 'click', conversion: 'convert',
    learn: 'ledger', done: 'closed'
  };

  var PHASE_ORDER = ['slot', 'gate', 'bid', 'auction', 'impression', 'click', 'conversion', 'learn'];

  /* ------------------------------------------------------------------ init */

  function init() {
    [
      'stage-chip', 'stage-tag', 'stage-name', 'stage-short', 'stage-body',
      'dwell', 'dwell-bar', 'dwell-hint',
      'opp-idx', 'opp-user', 'opp-line', 'phase-chips', 'opp-note',
      'bid-line', 'rival-a', 'rival-b', 'clearing-line', 'winrate-line',
      'm-impressions', 'm-clicks', 'm-conversions', 'm-spend', 'm-cpm', 'm-ctr',
      'm-cvr', 'm-cpc', 'm-cpa', 'm-roas', 'budget-bar', 'budget-note',
      'est-pctr', 'est-pcvr', 'est-bid', 'est-next',
      'district-chips', 'hud-phase', 'hud-opp', 'hud-spend', 'hud-now', 'hud-note',
      'inspector', 'btn-run', 'btn-play', 'play-glyph', 'btn-step', 'btn-reset',
      'speed', 'budget', 'targetcpa', 'freqcap',
      'v-speed', 'v-budget', 'v-targetcpa', 'v-freqcap',
      'follow', 'labels', 'btn-about', 'about', 'about-close', 'btn-panel', 'tooltip',
      'sheet-handle', 'btn-tune', 'dock', 'dock-tune'
    ].forEach(function (id) { el[id] = $(id); });

    buildChips();
    wire();
    applyResponsiveLabels();

    Sim.on(function (name, payload) {
      if (name === 'station') onStation(payload);
      if (name === 'reset') { pinnedDistrict = null; paint(true); }
    });
  }

  function buildChips() {
    World.districts.forEach(function (d) {
      var b = document.createElement('button');
      b.textContent = d.name;
      b.dataset.id = d.id;
      b.addEventListener('click', function () {
        showDistrict(d, true);
        flyTo = { x: d.x, y: d.y };
      });
      el['district-chips'].appendChild(b);
    });
  }

  function wire() {
    el['btn-run'].addEventListener('click', function () { Sim.run(); paint(true); });
    el['btn-play'].addEventListener('click', function () { Sim.toggle(); paint(true); });
    el['btn-step'].addEventListener('click', function () { Sim.step(); });
    el['btn-reset'].addEventListener('click', function () { Sim.replayTour(); Sim.run(); paint(true); });

    bindRange('speed', 'v-speed', function (v) { Sim.state.speed = v; return v.toFixed(2) + 'x'; });
    bindRange('budget', 'v-budget', function (v) {
      Sim.setParams({ budget: v | 0 });
      return '$' + (v | 0) + '/day';
    });
    bindRange('targetcpa', 'v-targetcpa', function (v) {
      Sim.setParams({ targetCpa: v | 0 });
      return '$' + (v | 0);
    });
    bindRange('freqcap', 'v-freqcap', function (v) {
      Sim.setParams({ freqCap: v | 0 });
      return (v | 0) + ' per user';
    });

    el.labels.addEventListener('change', function () { global.Renderer.setLabels(el.labels.checked); });

    el['btn-about'].addEventListener('click', function () { el.about.hidden = false; });
    el['about-close'].addEventListener('click', function () { el.about.hidden = true; });
    el.about.addEventListener('click', function (e) { if (e.target === el.about) el.about.hidden = true; });

    el['btn-panel'].addEventListener('click', function () {
      var hidden = el.inspector.classList.toggle('hidden');
      el['btn-panel'].setAttribute('aria-expanded', String(!hidden));
      applyResponsiveLabels();
    });
    window.addEventListener('resize', applyResponsiveLabels);

    el['sheet-handle'].addEventListener('click', function () { setSheet(!sheetOpen); });

    el['btn-tune'].addEventListener('click', function () {
      var open = el.dock.classList.toggle('tune-open');
      el['btn-tune'].setAttribute('aria-expanded', String(open));
      el['btn-tune'].title = open ? 'Hide settings' : 'Show settings';
    });
  }

  function isMobile() { return window.matchMedia('(max-width: 900px)').matches; }

  function applyResponsiveLabels() {
    var hidden = el.inspector.classList.contains('hidden');
    var narrow = isMobile();
    el['btn-panel'].textContent = narrow ? (hidden ? 'Panel' : 'Hide')
                                         : (hidden ? 'Show panel' : 'Hide panel');
    el['btn-about'].textContent = narrow ? 'About' : 'About & accuracy';
    el['dwell-hint'].innerHTML = narrow
      ? 'reading stop: tap <b>❚❚</b> below to hold it here'
      : 'reading stop: press <kbd>Space</kbd> to hold it here';
  }

  function setSheet(open) {
    sheetOpen = open;
    el.inspector.classList.toggle('open', open);
    document.body.classList.toggle('sheet-open', open);
    el['sheet-handle'].setAttribute('aria-expanded', String(open));
    if (open) el.inspector.scrollTop = 0;
  }

  function bindRange(id, out, fn) {
    var input = el[id];
    var apply = function () { el[out].textContent = fn(parseFloat(input.value)); };
    input.addEventListener('input', apply);
    apply();
  }

  /* -------------------------------------------------------------- narration */

  function onStation(station) {
    var id = station === 'done' ? null : (World.stationToDistrict[station] || station);
    activeDistrict = id;
    if (!pinnedDistrict && id) {
      var d = World.districtById[id];
      if (d) writeCard(d, station);
    }
    if (station === 'done') writeDone();
    paint(true);
  }

  function writeCard(d, station) {
    el['stage-chip'].textContent = STATION_LABEL[station] || d.id;
    el['stage-chip'].style.color = d.color;
    el['stage-chip'].style.background = global.Iso.rgba(d.color, 0.14);
    el['stage-chip'].style.borderColor = global.Iso.rgba(d.color, 0.3);
    el['stage-tag'].textContent = d.tag;
    el['stage-name'].textContent = d.name;
    el['stage-short'].textContent = d.short;
    el['stage-body'].textContent = d.body;
  }

  function writeDone() {
    var s = Sim.state;
    var camp = s.camp;
    var m = Bid.metrics(camp);
    var proj = s.projection;
    var beats = [];
    if (m.cpa && proj.cpa && Math.abs(m.cpa - proj.cpa) > 0.01) {
      beats.push('This setting closed at a $' + Bid.fmtMoney(m.cpa) +
        ' CPA against the $' + Bid.fmtMoney(proj.cpa) + ' the projection expected.');
    }
    el['stage-chip'].textContent = 'closed';
    el['stage-tag'].textContent = camp.blocks + ' blocks delivered';
    el['stage-name'].textContent = 'The day is over';
    el['stage-short'].textContent = 'The script ran out after 24 opportunities: ' +
      Bid.fmtInt(camp.impressions) + ' impressions, ' + camp.clicks + ' clicks, ' +
      camp.conversions + ' conversion' + (camp.conversions === 1 ? '' : 's') +
      ', $' + Bid.fmtMoney(camp.spend) + ' spent' +
      (m.cpa ? ', CPA $' + Bid.fmtMoney(m.cpa) : '') + '.';
    el['stage-body'].textContent = 'Every number in the ledger came out of the arithmetic: the gates, ' +
      'the smoothed estimates, the target-CPA bid, the second-price clearing, the billing and the ' +
      'update that moved the next bid. The scripted audience is the only fixed part; the campaign\u2019s ' +
      'response to it is real. ' + beats.join(' ') +
      ' Raise the budget or move the target CPA in the dock and press Run again: the same day, a different ledger.';
  }

  function showDistrict(d, pin) {
    pinnedDistrict = pin ? d.id : null;
    writeCard(d, Sim.state.station);
    if (pin) {
      el['stage-chip'].textContent = 'pinned';
      el['stage-tag'].textContent = d.tag + ' \u00b7 tap empty ground to resume';
      if (isMobile()) setSheet(true);
    }
    updateChips();
  }

  function updateChips() {
    var kids = el['district-chips'].children;
    for (var i = 0; i < kids.length; i++) {
      kids[i].classList.toggle('on', kids[i].dataset.id === (pinnedDistrict || activeDistrict));
    }
  }

  /* ------------------------------------------------------------------ paint */

  function paint(force) {
    var now = performance.now();
    if (!force && now - lastPaint < 90) return;
    lastPaint = now;

    var s = Sim.state;
    var camp = s.camp;
    if (!camp) return;
    var m = Bid.metrics(camp);
    var t = s.cur;

    el['play-glyph'].textContent = s.paused || s.finished ? '\u25b6' : '\u275a\u275a';

    el['hud-phase'].textContent = s.station ? (STATION_LABEL[s.station] || s.station) : 'idle';
    el['hud-opp'].textContent = t ? ((t.idx + 1) + ' / 24') : '0 / 24';
    el['hud-spend'].textContent = '$' + Bid.fmtMoney(camp.spend) + ' / $' + Bid.fmtMoney(s.budget);
    el['hud-now'].textContent = s.lastResult || (t ? (t.user + ' at the ' + (s.station || 'start')) : 'ready');
    el['hud-note'].textContent = hudNote(s, t);

    var showing = s.reading && s.dwellTotal > 0 && s.dwellLeft > 0;
    el.dwell.hidden = !showing;
    if (showing) {
      el['dwell-bar'].style.width = (s.dwellLeft / s.dwellTotal * 100).toFixed(1) + '%';
    }

    paintOpportunity(s, t, camp);
    paintAuction(s, t, m);
    paintLedger(s, camp, m, t);
    updateChips();
  }

  function hudNote(s, t) {
    if (s.finished) return '';
    if (s.reading) return '\u23f8 holding here so you can read the panel';
    if (!s.running) return 'Press Run to play the scripted day.';
    if (!t) return '';
    if (s.station === 'gate' && t.gate) return 'gate: ' + t.gateNote;
    if (s.station === 'gate' && !t.gate) return 'gate passed: audience, frequency and budget all clear';
    if (s.station === 'bid') return 'the bid is pCTR x pCVR x target CPA, clamped: $' + Bid.fmtMoney(t.bid);
    if (s.station === 'auction' && t.won) return '\u2696 won: the runner-up set the price at $' + Bid.fmtMoney(t.clearing) + ' CPM';
    if (s.station === 'auction' && !t.gate) return 'lost the auction; losing costs nothing';
    if (s.station === 'impression') return 'served: 1,000 impressions billed at $' + Bid.fmtMoney(t.clearing) + ' CPM';
    if (s.station === 'click') return t.clicks + ' clicks walked through the turnstile (CPM billing: no extra cost)';
    if (s.station === 'conversion') return 'a conversion: +$' + Bid.AOV + ' revenue, and the CPA moved';
    if (s.tourDone) return '\u23e9 every district explained, running the rest at speed (drag Speed down to slow it)';
    return '';
  }

  function paintOpportunity(s, t, camp) {
    el['opp-idx'].textContent = t ? ((t.idx + 1) + ' / 24') : '-';
    el['opp-user'].textContent = t ? t.user + (t.audience ? '' : ' (outside targeting)') : '-';
    el['opp-line'].textContent = t ? t.note : 'waiting for the first opportunity';
    el['opp-note'].textContent = t
      ? (t.gate ? 'Passed. Nothing was bid, nothing was billed; the day moves on.'
                : (t.won ? 'Delivered: ' + Bid.fmtInt(Bid.BLOCK) + ' impressions, ' + t.clicks +
                    ' clicks' + (t.conversions ? ', ' + t.conversions + ' conversion' : '') + '.'
                         : 'No delivery. The rival above was our bid; the estimate will not move from a loss.'))
      : '';

    var phases = PHASE_ORDER;
    el['phase-chips'].innerHTML = phases.map(function (p) {
      var done = !!s.phaseDone[p];
      var live = s.station === p;
      var skipped = t && (
        ((p === 'bid' || p === 'auction') && t.gate) ||
        ((p === 'impression' || p === 'click' || p === 'learn') && !t.gate && !t.won) ||
        (p === 'conversion' && !(t.won && t.conversions))
      );
      if (skipped) return '<span class="pchip skip">' + p + '</span>';
      return '<span class="pchip' + (done ? ' done' : '') + (live ? ' live' : '') + '">' + p + '</span>';
    }).join('');
  }

  function paintAuction(s, t, m) {
    el['bid-line'].textContent = t ? '$' + Bid.fmtMoney(t.bid) : '-';
    el['rival-a'].textContent = t ? '$' + Bid.fmtMoney(t.rivals[0]) : '-';
    el['rival-b'].textContent = t ? '$' + Bid.fmtMoney(t.rivals[1]) : '-';
    el['clearing-line'].textContent = t
      ? (t.gate ? '-' : (t.won ? 'won at $' + Bid.fmtMoney(t.clearing) + ' CPM'
                               : 'lost to $' + Bid.fmtMoney(Math.max(t.rivals[0], t.rivals[1]))))
      : '-';
    el['winrate-line'].textContent = (m.winRate ? Bid.fmtPct(m.winRate, 0) : '-') + ' of auctions entered';
  }

  function paintLedger(s, camp, m, t) {
    el['m-impressions'].textContent = Bid.fmtInt(camp.impressions);
    el['m-clicks'].textContent = Bid.fmtInt(camp.clicks);
    el['m-conversions'].textContent = String(camp.conversions);
    el['m-spend'].textContent = '$' + Bid.fmtMoney(camp.spend);
    el['m-cpm'].textContent = m.cpm ? '$' + Bid.fmtMoney(m.cpm) : '-';
    el['m-ctr'].textContent = m.ctr ? Bid.fmtPct(m.ctr, 2) : '-';
    el['m-cvr'].textContent = m.cvr ? Bid.fmtPct(m.cvr, 1) : '-';
    el['m-cpc'].textContent = m.cpc ? '$' + Bid.fmtMoney(m.cpc) : '-';
    el['m-cpa'].textContent = m.cpa ? '$' + Bid.fmtMoney(m.cpa) : '-';
    el['m-roas'].textContent = m.roas ? m.roas.toFixed(2) + 'x' : '-';

    var frac = s.budget ? Math.min(1, camp.spend / s.budget) : 0;
    el['budget-bar'].style.width = (frac * 100).toFixed(1) + '%';
    el['budget-bar'].className = frac >= 1 ? 'full' : (frac > 0.8 ? 'warn' : '');
    el['budget-note'].textContent = frac >= 1
      ? 'The cap is reached: the gate now closes on every remaining opportunity.'
      : '$' + Bid.fmtMoney(s.budget - camp.spend) + ' of the cap is still unspent' +
        (s.projection && s.projection.cpa
          ? '; the projection expects a $' + Bid.fmtMoney(s.projection.cpa) + ' CPA on these settings.'
          : '.');

    /* estimates and the next bid */
    var e = Bid.estimates(camp);
    el['est-pctr'].textContent = Bid.fmtPct(e.pctr, 2);
    el['est-pcvr'].textContent = Bid.fmtPct(e.pcvr, 2);
    el['est-bid'].textContent = '$' + Bid.fmtMoney(Bid.bidFor(camp));
    el['est-next'].textContent = t && t.nextBid
      ? 'after this opportunity: $' + Bid.fmtMoney(t.nextBid)
      : 'the priors were 0.50% and 2.50%';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------------------------------------------- exports */

  global.UI = {
    init: init,
    paint: paint,
    run: function () { Sim.run(); paint(true); },
    resetAll: function () { Sim.replayTour(); Sim.run(); paint(true); },
    showDistrict: showDistrict,
    unpin: function () { pinnedDistrict = null; updateChips(); },
    activeDistrict: function () { return pinnedDistrict || activeDistrict; },
    takeFlyTo: function () { var f = flyTo; flyTo = null; return f; },
    el: el
  };
})(window);
