/* render.js: a canvas 2D painter's-algorithm renderer for BidTown.
 *
 * Same technique as the template: everything with a footprint on the ground
 * goes into one list, sorted by x + y, painted back to front. Layers, in
 * order: sky, ground, district washes, roads, THE SORTED PASS, overlays, then
 * screen-space labels.
 *
 * Every dynamic element reads Sim.state and draws the real value: the boom
 * lamp and the gatehouse windows show which check passed or failed, the bid
 * masts carry the actual rival bids and ours, the page's slot lights when an
 * impression is delivered, the turnstile arms spin on a click, and the ledger
 * board shows the live metric identities.
 */
(function (global) {
  'use strict';

  var Iso = global.Iso, World = global.World, Sim = global.Sim, Bid = global.Bid;
  var P = Iso.project;

  var cam = null, ctx = null, t = 0;
  var labels = [];
  var showLabels = true;
  var C = World.palette;

  var SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  var MONO = 'ui-monospace, Menlo, Consolas, monospace';

  /* ------------------------------------------------------------------ sky */

  function drawSky(w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#eef3f6');
    g.addColorStop(0.55, '#e9eef0');
    g.addColorStop(1, '#e3e6e2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /* --------------------------------------------------------------- ground */

  function plate(inset, z) {
    return [
      P(inset, inset, z), P(World.GW - inset, inset, z),
      P(World.GW - inset, World.GH - inset, z), P(inset, World.GH - inset, z)
    ];
  }

  var GRASS = ['#8aa96a', '#93b073', '#83a463', '#9ab77c'];

  function drawGround() {
    ctx.fillStyle = 'rgba(120,124,110,0.30)';
    Iso.poly(ctx, plate(-0.9, -0.35));
    ctx.fillStyle = '#93b073';
    Iso.poly(ctx, plate(0, 0));
    for (var gx = 1; gx < World.GW; gx += 2) {
      for (var gy = 1; gy < World.GH; gy += 2) {
        var n = Iso.hash2(gx, gy, 17);
        if (n < 0.45) continue;
        ctx.fillStyle = GRASS[(n * 4) | 0];
        Iso.disc(ctx, gx + n, gy + (1 - n), 0, 0.7 + n * 0.5);
      }
    }
    ctx.strokeStyle = 'rgba(74,69,64,0.28)';
    ctx.lineWidth = 1.4;
    Iso.polyLine(ctx, plate(0, 0), true);
  }

  function drawZones(activeId) {
    for (var i = 0; i < World.districts.length; i++) {
      var d = World.districts[i];
      var on = d.id === activeId;
      ctx.fillStyle = Iso.rgba(d.color, on ? 0.16 : 0.055);
      Iso.disc(ctx, d.x, d.y, 0.01, d.r);
      if (on) {
        ctx.strokeStyle = Iso.rgba(d.color, 0.5);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        var p = P(d.x, d.y, 0.01);
        ctx.ellipse(p.x, p.y, d.r * Iso.TW * 1.41421, d.r * Iso.TH * 1.41421, 0, 0, 6.2832);
        ctx.stroke();
      }
    }
  }

  /* ---------------------------------------------------------------- roads */

  function roadQuad(a, b, width, dz) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy) || 1;
    var nx = -dy / len * width / 2, ny = dx / len * width / 2;
    var za = (a.z || 0) + (dz || 0), zb = (b.z || 0) + (dz || 0);
    Iso.poly(ctx, [
      P(a.x + nx, a.y + ny, za), P(b.x + nx, b.y + ny, zb),
      P(b.x - nx, b.y - ny, zb), P(a.x - nx, a.y - ny, za)
    ]);
  }

  function drawRoute(route, opts) {
    var width = opts.width, i, s;
    ctx.fillStyle = opts.shoulder || C.road;
    for (i = 0; i < route.segs.length; i++) {
      s = route.segs[i];
      roadQuad(s.a, s.b, width + 0.5, 0);
      Iso.disc(ctx, s.a.x, s.a.y, s.a.z || 0, (width + 0.5) / 2);
    }
    var last = route.pts[route.pts.length - 1];
    Iso.disc(ctx, last.x, last.y, last.z || 0, (width + 0.5) / 2);

    ctx.fillStyle = opts.surface || C.roadTop;
    for (i = 0; i < route.segs.length; i++) {
      s = route.segs[i];
      roadQuad(s.a, s.b, width, 0.005);
      Iso.disc(ctx, s.a.x, s.a.y, (s.a.z || 0) + 0.005, width / 2);
    }
    Iso.disc(ctx, last.x, last.y, (last.z || 0) + 0.005, width / 2);

    ctx.strokeStyle = opts.dash || 'rgba(96,90,78,0.35)';
    ctx.lineWidth = 1.3;
    ctx.setLineDash(opts.dashPattern || [6, 7]);
    ctx.beginPath();
    for (i = 0; i < route.pts.length; i++) {
      var p = P(route.pts[i].x, route.pts[i].y, (route.pts[i].z || 0) + 0.01);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawRoads() {
    drawRoute(World.routes.a, { width: 2.6 });
    drawRoute(World.routes.b, { width: 2.6 });
    drawRoute(World.routes.c, { width: 2.6 });
    drawRoute(World.routes.d, { width: 2.6 });
    drawRoute(World.routes.e, { width: 2.6 });
    drawRoute(World.routes.pass, {
      width: 1.9, surface: '#d2ccbd', dash: 'rgba(109,144,104,0.55)', dashPattern: [4, 6]
    });
    drawRoute(World.routes.loss, {
      width: 1.9, surface: '#d6c9c4', dash: 'rgba(176,84,112,0.5)', dashPattern: [4, 6]
    });
  }

  /* ------------------------------------------------------------- helpers  */

  var FACE_ANG = Math.atan2(Iso.TH, Iso.TW);          // wall running along +x
  var FACE_ANG_X = Math.atan2(Iso.TH, -Iso.TW);       // wall running along +y
  var FACE_U = Math.hypot(Iso.TW, Iso.TH);

  function worldText(x, y, z, text, o) {
    o = o || {};
    var p = P(x, y, z);
    ctx.save();
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    var sx = p.x * cam.scale + cam.ox, sy = p.y * cam.scale + cam.oy;
    var size = o.size || 10;
    ctx.font = (o.bold ? '600 ' : '') + size + 'px ' + (o.mono ? MONO : SANS);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (o.bg) {
      var w = ctx.measureText(text).width + 8;
      ctx.fillStyle = o.bgFill || 'rgba(255,253,247,0.85)';
      roundRect(sx - w / 2, sy - size * 0.8, w, size * 1.6, 4);
      ctx.fill();
      ctx.strokeStyle = o.bgStroke || 'rgba(90,82,70,0.3)';
      ctx.lineWidth = 1;
      roundRect(sx - w / 2, sy - size * 0.8, w, size * 1.6, 4);
      ctx.stroke();
    }
    ctx.fillStyle = o.color || '#3a352e';
    ctx.fillText(text, sx, sy);
    ctx.restore();
  }

  function faceQuad(face, wall, y0, y1, z0, z1) {
    if (face === 'x') {
      return [P(wall, y0, z1), P(wall, y1, z1), P(wall, y1, z0), P(wall, y0, z0)];
    }
    return [P(y0, wall, z1), P(y1, wall, z1), P(y1, wall, z0), P(y0, wall, z0)];
  }

  function lamp(x, y, z, color, on, r) {
    var p = P(x, y, z);
    if (on) {
      ctx.fillStyle = Iso.rgba(color, 0.32);
      ctx.beginPath();
      ctx.arc(p.x, p.y, (r || 4.5) * 2.1, 0, 6.2832);
      ctx.fill();
    }
    ctx.fillStyle = on ? color : Iso.mix(color, '#c9c4b6', 0.7);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r || 4.5, 0, 6.2832);
    ctx.fill();
    ctx.strokeStyle = 'rgba(74,69,64,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /* ------------------------------------------------------------- landmarks */

  /* The Page: the publisher. Its slot lights when an impression is served. */
  function drawPage(b) {
    Iso.box(ctx, { x: b.x, y: b.y, z: 0, w: b.w, d: b.d, h: b.h, color: b.color, panels: b.panels });
    /* browser chrome: a slim band along the top of the road face */
    Iso.box(ctx, {
      x: b.x + 0.2, y: b.y + b.d - 0.6, z: b.h, w: b.w - 0.4, d: 0.6, h: 0.3,
      color: Iso.mix(b.color, '#ffffff', 0.3)
    });
    var s = Sim.state;
    var serving = s.station === 'impression' && s.cur && s.cur.won;
    var served = s.cur && s.cur.won;
    var wall = b.y + b.d;
    /* the slot, painted on the road face */
    ctx.fillStyle = serving ? Iso.mix('#f2e3cf', C.teal, 0.25) : (served ? '#e8e2d4' : 'rgba(120,124,110,0.16)');
    Iso.poly(ctx, faceQuad('y', wall + 0.02, b.x + 2.6, b.x + 5.4, 0.9, 2.2));
    ctx.strokeStyle = serving ? 'rgba(63,138,134,0.8)' : 'rgba(74,69,64,0.35)';
    ctx.lineWidth = serving ? 1.8 : 1;
    ctx.setLineDash(served ? [] : [3, 3]);
    Iso.polyLine(ctx, faceQuad('y', wall + 0.02, b.x + 2.6, b.x + 5.4, 0.9, 2.2), true);
    ctx.setLineDash([]);
    worldText(b.x + 4, wall + 0.15, 1.55, served ? 'AD' : 'SLOT', {
      size: serving ? 12 : 9.5, bold: serving, mono: true,
      color: serving ? '#3f8a86' : 'rgba(74,69,64,0.5)'
    });
  }

  /* The Gatehouse: three check windows on the face the reader sees; the
     failing one goes red the moment the opportunity is turned away. */
  function drawGatehouse(b) {
    Iso.box(ctx, { x: b.x, y: b.y, z: 0, w: b.w, d: b.d, h: b.h, color: b.color, windows: { cols: 3, seed: 5, color: '#aab4bd' } });
    Iso.box(ctx, {
      x: b.x + 0.3, y: b.y + 0.3, z: b.h, w: b.w - 0.6, d: b.d - 0.6, h: 0.32,
      color: Iso.mix(b.color, '#ffffff', 0.35)
    });
    var s = Sim.state;
    var gate = s.cur ? s.cur.gate : null;
    var wall = b.x + b.w;    /* the east face looks back into the town */
    var names = ['audience', 'frequency', 'budget'];
    var passed = s.cur && !gate && s.phaseDone.gate;
    for (var i = 0; i < 3; i++) {
      var z0 = b.h - 0.45 - i * 0.85, z1 = z0 - 0.6;
      var blocked = gate === names[i];
      ctx.fillStyle = blocked ? '#c86a5a' : (passed ? '#8fb98a' : '#b9bec4');
      Iso.poly(ctx, faceQuad('x', wall + 0.02, b.y + 1.0, b.y + 2.6, z1, z0));
      ctx.strokeStyle = 'rgba(60,54,48,0.5)';
      ctx.lineWidth = 1.2;
      Iso.polyLine(ctx, faceQuad('x', wall + 0.02, b.y + 1.0, b.y + 2.6, z1, z0), true);
    }
    /* the lamp over the near check */
    lamp(13.4, b.y + 0.2, b.h + 0.55, gate ? '#b8503f' : '#5f8a52', s.station === 'gate' || !!gate, 4);
  }

  function drawBoomPost(b) {
    Iso.box(ctx, { x: b.x - 0.24, y: b.y - 0.24, z: 0, w: 0.48, d: 0.48, h: 2.6, color: b.color });
  }

  function drawBoomBeam(b) {
    Iso.box(ctx, { x: b.x - 1.55, y: b.y - 0.22, z: 2.6, w: 3.1, d: 0.44, h: 0.3, color: Iso.mix(b.color, '#ffffff', 0.25) });
    var s = Sim.state;
    var blocked = s.cur && s.cur.gate;
    lamp(b.x, b.y, 3.15, blocked ? '#b8503f' : '#5f8a52', s.station === 'gate' || !!blocked, 5);
    worldText(b.x, b.y, 3.8, blocked ? 'BLOCKED' : 'PASS', {
      size: 10, bold: true, mono: true,
      color: blocked ? '#a8402f' : '#3f6d38'
    });
  }

  /* The Bidding Office: the bid board carries the live formula inputs. */
  function drawOffice(b) {
    Iso.box(ctx, { x: b.x, y: b.y, z: 0, w: b.w, d: b.d, h: b.h, color: b.color, panels: b.panels });
    /* the board on the road face (south) */
    var wall = b.y + b.d;
    var s = Sim.state;
    ctx.fillStyle = 'rgba(255,253,247,0.94)';
    Iso.poly(ctx, faceQuad('y', wall + 0.02, b.x + 0.8, b.x + 5.6, 0.6, 2.4));
    ctx.strokeStyle = 'rgba(74,69,64,0.4)';
    ctx.lineWidth = 1.2;
    Iso.polyLine(ctx, faceQuad('y', wall + 0.02, b.x + 0.8, b.x + 5.6, 0.6, 2.4), true);
    if (state_has_cur()) {
      worldText(b.x + 1.5, wall + 0.06, 1.95, 'pCTR ' + Bid.fmtPct(s.cur.pctr, 2), { size: 9.5, mono: true, color: '#6f63a8' });
      worldText(b.x + 3.0, wall + 0.06, 1.95, 'pCVR ' + Bid.fmtPct(s.cur.pcvr, 2), { size: 9.5, mono: true, color: '#6f63a8' });
      worldText(b.x + 4.5, wall + 0.06, 1.95, 'bid $' + Bid.fmtMoney(s.cur.bid), { size: 11, bold: true, mono: true, color: '#8a5a3c' });
    }
    lamp(b.x + 0.3, b.y + 0.4, b.h + 0.5, '#6f63a8', s.station === 'bid', 4);
  }

  function state_has_cur() { return !!Sim.state.cur; }

  /* The Auction Hall: three bid masts across the road side. */
  function drawHall(b) {
    Iso.box(ctx, { x: b.x, y: b.y, z: 0, w: b.w, d: b.d, h: b.h, color: b.color, panels: b.panels });
    Iso.box(ctx, {
      x: b.x + 0.6, y: b.y + 0.6, z: b.h, w: b.w - 1.2, d: b.d - 1.2, h: 0.4,
      color: Iso.mix(b.color, '#ffffff', 0.3)
    });
    /* the gavel podium by the road */
    Iso.cylinder(ctx, { x: b.x + 4.5, y: b.y + b.d + 0.6, z: 0, r: 0.5, h: 1.1, color: '#c8bfa8' });
    var s = Sim.state;
    var done = s.station === 'auction' && s.cur && !s.cur.gate;
    if (done && s.cur.won) {
      var p = P(b.x + 4.5, b.y + b.d + 0.6, 1.6);
      ctx.fillStyle = Iso.rgba('#c2913c', 0.35);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, 6.2832);
      ctx.fill();
    }
  }

  function drawBidMast(b) {
    var s = Sim.state;
    var t0 = s.cur;
    var values = t0 ? [t0.bid, t0.rivals[0], t0.rivals[1]] : [null, null, null];
    var v = values[b.which];
    var winner = t0 && !t0.gate && t0.won && b.which === 0;
    var rivalWon = t0 && !t0.gate && !t0.won &&
      v === Math.max(t0.rivals[0], t0.rivals[1]);
    Iso.cylinder(ctx, { x: b.x, y: b.y, z: 0, r: 0.12, h: 3.0, color: '#8e8878' });
    var on = winner || rivalWon;
    lamp(b.x, b.y, 3.25, winner ? '#5f8a52' : '#c2913c', on && s.phaseDone.auction, 4.5);
    if (v != null) {
      worldText(b.x, b.y, 3.9, (b.which === 0 ? 'you $' : '$') + Bid.fmtMoney(v), {
        size: 10, mono: true, bold: winner,
        color: winner ? '#3f6d38' : (on ? '#8a5a3c' : '#6b655c')
      });
    }
  }

  /* The Delivery Bay: the ad server. A screen shows the served creative. */
  function drawBay(b) {
    Iso.box(ctx, { x: b.x, y: b.y, z: 0, w: b.w, d: b.d, h: b.h, color: b.color, panels: b.panels });
    var s = Sim.state;
    var serving = s.station === 'impression' && s.cur && s.cur.won;
    Iso.orientedBox(ctx, {
      x: b.x + 2.2, y: b.y + b.d + 0.5, z: 1.1, hx: 1, hy: -1, len: 2.4, wid: 0.16, h: 1.5,
      color: '#f4f1e6'
    });
    Iso.orientedBox(ctx, {
      x: b.x + 2.2, y: b.y + b.d + 0.5, z: 1.25, hx: 1, hy: -1, len: 2.0, wid: 0.06, h: 1.2,
      color: serving ? Iso.mix('#f2e3cf', C.teal, 0.4) : '#cfd6d8', edge: false
    });
    worldText(b.x + 2.2, b.y + b.d + 0.5, 2.9, 'SERVE', { size: 9.5, bold: true, color: '#3f8a86' });
  }

  function drawTurnPost(b) {
    Iso.box(ctx, { x: b.x - 0.22, y: b.y - 0.22, z: 0, w: 0.44, d: 0.44, h: 2.4, color: b.color });
  }

  function drawTurnBeam(b) {
    Iso.box(ctx, { x: b.x - 0.22, y: b.y - 1.5, z: 2.4, w: 0.44, d: 3.0, h: 0.3, color: Iso.mix(b.color, '#ffffff', 0.25) });
    var s = Sim.state;
    var spinning = s.station === 'click' && s.cur && s.cur.won;
    var ang = spinning ? t * 3.2 : 0.6;
    /* three arms on the near post, turning while clicks arrive */
    for (var i = 0; i < 3; i++) {
      var a = ang + i * 2.094;
      Iso.orientedBox(ctx, {
        x: b.x + Math.cos(a) * 0.55, y: b.y + Math.sin(a) * 0.55, z: 0.35,
        hx: Math.cos(a), hy: Math.sin(a), len: 1.1, wid: 0.12, h: 0.12,
        color: '#6d9068'
      });
    }
    lamp(b.x, b.y, 2.95, '#6d9068', spinning, 4.5);
  }

  /* The Checkout: a till and a bell. */
  function drawStore(b) {
    Iso.box(ctx, { x: b.x, y: b.y, z: 0, w: b.w, d: b.d, h: b.h, color: b.color, panels: b.panels });
    /* awning over the road face */
    var wall = b.y + b.d;
    ctx.fillStyle = '#b05470';
    Iso.poly(ctx, faceQuad('y', wall - 0.05, b.x + 0.6, b.x + 5.4, 2.3, 2.75));
    ctx.strokeStyle = 'rgba(74,69,64,0.35)';
    ctx.lineWidth = 1;
    Iso.polyLine(ctx, faceQuad('y', wall - 0.05, b.x + 0.6, b.x + 5.4, 2.3, 2.75), true);
    var s = Sim.state;
    var ringing = s.station === 'conversion' && s.cur && s.cur.conversions > 0;
    if (ringing) {
      var p = P(b.x + 3, wall + 0.3, 3.4);
      ctx.strokeStyle = Iso.rgba('#c2913c', 0.8);
      ctx.lineWidth = 2;
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 + i * 5 + (s.stationT * 14 % 6), -2.4, -0.7);
        ctx.stroke();
      }
      lamp(b.x + 3, wall + 0.3, 3.35, '#c2913c', true, 4);
    }
  }

  /* The Performance Office: the ledger board and the learning wheel. */
  function drawLedger(b) {
    Iso.box(ctx, { x: b.x, y: b.y, z: 0, w: b.w, d: b.d, h: b.h, color: b.color, panels: b.panels });
    var wall = b.y + b.d;
    var s = Sim.state;
    var m = Bid.metrics(s.camp || Bid.create({}));
    /* the board on the road face */
    ctx.fillStyle = 'rgba(255,253,247,0.94)';
    Iso.poly(ctx, faceQuad('y', wall + 0.02, b.x + 0.6, b.x + 6.4, 0.6, 2.6));
    ctx.strokeStyle = 'rgba(74,69,64,0.4)';
    ctx.lineWidth = 1.2;
    Iso.polyLine(ctx, faceQuad('y', wall + 0.02, b.x + 0.6, b.x + 6.4, 0.6, 2.6), true);
    var rows = [
      ['CPM $' + Bid.fmtMoney(m.cpm), 1.45],
      ['CTR ' + Bid.fmtPct(m.ctr, 2), 2.25],
      ['CPA ' + (m.cpa ? '$' + Bid.fmtMoney(m.cpa) : '-'), 1.45],
      ['ROAS ' + (m.roas ? m.roas.toFixed(2) : '-'), 2.25]
    ];
    for (var i = 0; i < rows.length; i++) {
      worldText(b.x + rows[i][1], wall + 0.06, i < 2 ? 2.05 : 1.05,
        rows[i][0], { size: 10, mono: true, bold: s.station === 'learn', color: '#8a5a3c' });
    }
    /* the learning wheel on the roof turns while the loop closes */
    var spinning = s.station === 'learn';
    Iso.gear(ctx, b.x + b.w / 2, b.y + b.d / 2, b.h + 0.2, 0.95, 9,
      (spinning ? t * 1.6 : t * 0.1), '#b09a86');
  }

  function drawFountain(b) {
    Iso.cylinder(ctx, { x: b.x, y: b.y, z: 0, r: 0.9, h: 0.4, color: '#b9c2c8' });
    Iso.cylinder(ctx, { x: b.x, y: b.y, z: 0.4, r: 0.28, h: 0.5, color: '#a9b3ba' });
    var p = P(b.x, b.y, 1.1);
    ctx.fillStyle = Iso.rgba('#ffffff', 0.5);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4 + Math.sin(t * 2.2) * 1.2, 0, 6.2832);
    ctx.fill();
  }

  var KIND = {
    page: drawPage, gatehouse: drawGatehouse, boomPost: drawBoomPost,
    boomBeam: drawBoomBeam, office: drawOffice, hall: drawHall,
    bidmast: drawBidMast, bay: drawBay, turnPost: drawTurnPost,
    turnBeam: drawTurnBeam, store: drawStore, ledger: drawLedger,
    fountain: drawFountain
  };

  /* -------------------------------------------------------- small props  */

  function drawLamp(p) {
    Iso.cylinder(ctx, { x: p.x, y: p.y, z: 0, r: 0.13, h: 2.7, color: '#9c968a' });
    Iso.box(ctx, { x: p.x - 0.28, y: p.y - 0.22, z: 2.7, w: 0.56, d: 0.44, h: 0.18, color: '#c8c2b2' });
  }

  function drawTree(p) {
    var n = Iso.hash2(p.x, p.y, p.seed || 1);
    Iso.cylinder(ctx, { x: p.x, y: p.y, z: 0, r: 0.18, h: 0.9 + n * 0.4, color: '#8a7358' });
    var r = 0.85 + n * 0.5;
    ctx.fillStyle = n < 0.5 ? '#5f8a52' : '#6d9068';
    Iso.disc(ctx, p.x, p.y, 1.5 + n * 0.8, r);
    ctx.fillStyle = Iso.rgba('#ffffff', 0.16);
    Iso.disc(ctx, p.x - r * 0.25, p.y - r * 0.25, 1.62 + n * 0.8, r * 0.6);
  }

  /* --------------------------------------------------------------- the van
     The van is the bid request. Its plate says which opportunity and which
     user; the gauge on its flank is the bid itself against an $8 scale; the
     crates in the bed are the creative it won and the money a conversion
     brought back to the ledger. */

  function drawVan(v) {
    var s = Sim.state;
    var cur = s.cur;
    var hx = v.dx, hy = v.dy;
    var z = v.z || 0;

    ctx.fillStyle = 'rgba(80,76,66,0.22)';
    Iso.disc(ctx, v.x, v.y, z + 0.01, 1.05);

    Iso.orientedBox(ctx, { x: v.x, y: v.y, z: z + 0.16, hx: hx, hy: hy, len: 2.5, wid: 1.25, h: 0.34, color: '#5c6a72' });
    Iso.orientedBox(ctx, { x: v.x - hx * 0.35, y: v.y - hy * 0.35, z: z + 0.5, hx: hx, hy: hy, len: 1.7, wid: 1.2, h: 1.0, color: '#eae6da' });
    Iso.orientedBox(ctx, { x: v.x + hx * 0.85, y: v.y + hy * 0.85, z: z + 0.5, hx: hx, hy: hy, len: 0.85, wid: 1.1, h: 0.76, color: '#8a5a3c' });

    /* the gauge: the bid, scaled against $8 */
    var frac = cur ? Math.min(1, cur.bid / 8) : 0;
    var px = -hy, py = hx;
    var side = (px + py) > 0 ? 1 : -1;
    var gx = v.x - hx * 0.35 + px * side * 0.63;
    var gy = v.y - hy * 0.35 + py * side * 0.63;
    var GLEN = 1.5;
    Iso.orientedBox(ctx, {
      x: gx, y: gy, z: z + 0.72, hx: hx, hy: hy, len: GLEN, wid: 0.03, h: 0.42,
      color: '#6d675c', edge: false
    });
    if (frac > 0) {
      Iso.orientedBox(ctx, {
        x: gx - hx * (GLEN * (1 - frac) / 2), y: gy - hy * (GLEN * (1 - frac) / 2),
        z: z + 0.74, hx: hx, hy: hy, len: Math.max(0.07, GLEN * frac - 0.06),
        wid: 0.05, h: 0.34,
        color: cur && cur.won ? '#7fc06a' : '#b8503f', edge: false
      });
    }

    /* cargo: the creative crate when we won; the money crate at the checkout */
    if (cur && cur.won) {
      Iso.orientedBox(ctx, {
        x: v.x - hx * 0.7 + px * 0.26, y: v.y - hy * 0.7 + py * 0.26, z: z + 1.5,
        hx: hx, hy: hy, len: 0.42, wid: 0.44, h: 0.38, color: '#3f8a86'
      });
    }
    if (cur && cur.conversions > 0 && (s.station === 'conversion' || s.station === 'learn')) {
      Iso.orientedBox(ctx, {
        x: v.x - hx * 1.05 + px * 0.24, y: v.y - hy * 1.05 + py * 0.24, z: z + 1.48,
        hx: hx, hy: hy, len: 0.38, wid: 0.4, h: 0.34, color: '#c2913c'
      });
    }

    ctx.fillStyle = '#3f3a34';
    [[0.8, 0.5], [0.8, -0.5], [-0.8, 0.5], [-0.8, -0.5]].forEach(function (o) {
      Iso.disc(ctx, v.x + hx * o[0] + px * o[1], v.y + hy * o[0] + py * o[1], z + 0.14, 0.22);
    });
  }

  /* -------------------------------------------------------------- labels  */

  function drawLabels() {
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    ctx.textBaseline = 'middle';
    labels.sort(function (a, b) { return (b.pri || 0) - (a.pri || 0); });

    var placed = [];
    var i;
    for (i = 0; i < labels.length; i++) {
      var L = labels[i];
      var p = P(L.x, L.y, L.z);
      L.ax = p.x * cam.scale + cam.ox;
      L.ay = p.y * cam.scale + cam.oy;
      L.px = (L.size || 12) * Math.min(1.15, Math.max(0.92, cam.scale));
      ctx.font = (L.bold ? '600 ' : '') + L.px + 'px ' + fontOf(L);
      var wpx = ctx.measureText(L.text).width;
      var subw = L.sub ? ctx.measureText(L.sub).width * 0.85 : 0;
      L.boxW = Math.max(wpx, subw) + 16;
      L.boxH = L.sub ? L.px * 2.4 : L.px * 1.75;
      L.sy = L.lift ? L.ay - L.lift - L.boxH / 2 : L.ay;
      for (var tries = 0; tries < 10 && overlaps(L, placed); tries++) {
        L.sy -= L.boxH * 0.92;
      }
      placed.push(L);
    }
    for (i = 0; i < labels.length; i++) drawPlate(labels[i]);
  }

  function fontOf(L) {
    return L.mono ? MONO : '"Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif';
  }

  function overlaps(L, placed) {
    for (var i = 0; i < placed.length; i++) {
      var o = placed[i];
      if (Math.abs(L.ax - o.ax) < (L.boxW + o.boxW) / 2 + 2 &&
          Math.abs(L.sy - o.sy) < (L.boxH + o.boxH) / 2 + 2) return true;
    }
    return false;
  }

  function drawPlate(L) {
    var ax = L.ax, ay = L.ay, sy = L.sy, size = L.px;
    var boxW = L.boxW, boxH = L.boxH;
    ctx.textAlign = 'center';
    ctx.font = (L.bold ? '600 ' : '') + size + 'px ' + fontOf(L);

    if (L.lift) {
      ctx.strokeStyle = Iso.rgba(L.tint || '#6e6250', 0.6);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(ax, sy + boxH / 2);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.fillStyle = Iso.rgba(L.tint || '#6e6250', 0.85);
      ctx.beginPath();
      ctx.arc(ax, ay, 2.4, 0, 6.2832);
      ctx.fill();
    }

    ctx.fillStyle = 'rgba(96,84,66,0.26)';
    roundRect(ax - boxW / 2 + 1, sy - boxH / 2 + 2.5, boxW, boxH, 5);
    ctx.fill();
    ctx.fillStyle = L.tint ? Iso.mix('#fffdf7', L.tint, 0.14) : '#fffdf7';
    roundRect(ax - boxW / 2, sy - boxH / 2, boxW, boxH, 5);
    ctx.fill();
    ctx.strokeStyle = Iso.rgba(L.tint || '#6e6250', 0.85);
    ctx.lineWidth = L.bold ? 1.7 : 1.2;
    roundRect(ax - boxW / 2, sy - boxH / 2, boxW, boxH, 5);
    ctx.stroke();

    ctx.fillStyle = L.color || '#3a352e';
    ctx.fillText(L.text, ax, sy + (L.sub ? -size * 0.42 : 0));
    if (L.sub) {
      ctx.font = (size * 0.85) + 'px ' + MONO;
      ctx.fillStyle = 'rgba(70,62,52,0.85)';
      ctx.fillText(L.sub, ax, sy + size * 0.62);
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------------------------------------------------------------- draw  */

  function key(o) { return o.x + o.y + ((o.w || 0) + (o.d || 0)) * 0.5; }

  function draw(canvas, camera, time, activeDistrict, hoverDistrict) {
    ctx = canvas.getContext('2d');
    cam = camera;
    t = time;
    labels.length = 0;

    var w = canvas.width / cam.dpr, h = canvas.height / cam.dpr;
    ctx.setTransform(cam.dpr, 0, 0, cam.dpr, 0, 0);
    drawSky(w, h);

    ctx.setTransform(cam.scale * cam.dpr, 0, 0, cam.scale * cam.dpr,
                     cam.ox * cam.dpr, cam.oy * cam.dpr);
    drawGround();
    drawZones(activeDistrict);
    drawRoads();

    /* ---- one sorted pass over everything with a footprint ---- */
    var items = [];
    var i, s = Sim.state;

    for (i = 0; i < World.buildings.length; i++) {
      var b = World.buildings[i];
      if (b.kind && KIND[b.kind]) items.push({ k: b.x + b.y, f: KIND[b.kind], a: b });
      else items.push({ k: key(b), f: null, a: b });
    }
    for (i = 0; i < World.props.length; i++) {
      var pr = World.props[i];
      items.push({ k: pr.x + pr.y, f: pr.kind === 'tree' ? drawTree : drawLamp, a: pr });
    }
    var v = Sim.vanPosition();
    items.push({ k: v.x + v.y + 0.2, f: drawVan, a: v });

    items.sort(function (p, q) { return p.k - q.k; });
    for (i = 0; i < items.length; i++) {
      if (items[i].f) { items[i].f(items[i].a); continue; }
      var o = items[i].a;
      Iso.box(ctx, o);
      if (o.roof) {
        Iso.gableRoof(ctx, {
          x: o.x - 0.08, y: o.y - 0.08, z: o.z + o.h,
          w: o.w + 0.16, d: o.d + 0.16, h: o.roofH || 0.45, color: o.roof
        });
      }
    }

    /* ---- district plates ---- */
    if (showLabels) {
      var declutter = cam.scale < 0.34;
      for (i = 0; i < World.districts.length; i++) {
        var d = World.districts[i];
        var isActive = d.id === activeDistrict || d.id === hoverDistrict;
        if (declutter && !isActive) continue;
        var sub = isActive ? d.tag : null;
        if (d.id === 'gate' && s.camp) {
          sub = 'spend $' + Bid.fmtMoney(s.camp.spend) + ' / $' + Bid.fmtMoney(s.budget);
        }
        if (d.id === 'auction' && s.cur && !s.cur.gate && s.phaseDone.auction) {
          sub = s.cur.won ? 'cleared $' + Bid.fmtMoney(s.cur.clearing)
                          : 'lost: top rival $' + Bid.fmtMoney(Math.max(s.cur.rivals[0], s.cur.rivals[1]));
        }
        if (d.id === 'slot' && s.cur) {
          sub = 'opportunity ' + (s.cur.idx + 1) + ' of 24';
        }
        labels.push({
          x: d.x, y: d.y, z: 0, lift: isActive ? 34 : 26,
          text: d.name, sub: sub,
          color: isActive ? d.color : '#3d3831',
          tint: d.color,
          size: isActive ? 16.5 : 14, bold: isActive,
          pri: isActive ? 2 : 1
        });
      }
    }

    /* ---- live readouts ---- */
    if (s.cur) {
      labels.push({
        x: v.x, y: v.y, z: (v.z || 0) + 2.6, lift: 8,
        text: 'opp ' + (s.cur.idx + 1) + ' - ' + s.cur.user,
        sub: s.cur.gate ? 'passed'
          : (s.cur.won ? 'won $' + Bid.fmtMoney(s.cur.clearing) + ' CPM'
                       : 'lost at $' + Bid.fmtMoney(s.cur.bid)),
        color: '#3d3831', tint: '#8a8272', size: 13, bold: true, mono: true,
        pri: 3
      });
    } else {
      labels.push({
        x: v.x, y: v.y, z: (v.z || 0) + 2.6, lift: 8,
        text: 'the day is scripted', sub: 'press Run',
        color: '#3d3831', tint: '#8a8272', size: 12, mono: true, pri: 3
      });
    }

    /* the ledger board: the live metrics are painted on the building; the
       plate above it carries the learning - what the next bid believes */
    var m = s.camp ? Bid.metrics(s.camp) : null;
    if (m) {
      var est = Bid.estimates(s.camp);
      labels.push({
        x: World.LEDGER.x + World.LEDGER.w / 2, y: World.LEDGER.y + World.LEDGER.d + 0.2, z: 3.4, lift: 6,
        text: 'next bid $' + Bid.fmtMoney(Bid.bidFor(s.camp)),
        sub: 'pCTR ' + Bid.fmtPct(est.pctr, 2) + ' \u00b7 pCVR ' + Bid.fmtPct(est.pcvr, 2),
        color: '#8a5a3c', tint: '#a85a44', size: 12, bold: true, mono: true, pri: 3
      });
      labels.push({
        x: World.LEDGER.x + 1.8, y: World.LEDGER.y + World.LEDGER.d + 0.2, z: 3.4, lift: 6,
        text: Bid.fmtInt(s.camp.impressions), sub: 'impressions',
        color: '#3d3831', tint: '#7d8b96', size: 10.5, mono: true, pri: 2
      });
      labels.push({
        x: World.LEDGER.x + 5.2, y: World.LEDGER.y + World.LEDGER.d + 0.2, z: 3.4, lift: 6,
        text: '$' + Bid.fmtMoney(s.camp.spend), sub: 'spend',
        color: '#3d3831', tint: '#7d8b96', size: 10.5, mono: true, pri: 2
      });
    }

    /* the audience houses carry their user ids */
    for (i = 0; i < World.HOUSES.length; i++) {
      labels.push({
        x: World.HOUSES[i].x + 0.9, y: World.HOUSES[i].y + 0.4, z: 2.2, lift: 0,
        text: World.HOUSE_USERS[i], sub: null,
        color: '#6b655c', tint: '#7d8b96', size: 9.5, mono: true, pri: 1
      });
    }

    drawLabels();
  }

  global.Renderer = {
    draw: draw,
    setLabels: function (v) { showLabels = v; }
  };
})(window);
