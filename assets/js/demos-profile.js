/* Fig. 5 Walk the Hubble-constant profile. Needs demos.js and demos-data.js loaded first; styles in demos-profile.css.
   Final round (2026-10-28): a plain key above the plot (HTML), the penalty plotted evenly in sigma, cursor labels placed
   clear of the curves, and the data choice plus the dark QCD parameter panel behind Details (the panel is its own canvas
   below the controls, so opening it or switching to all parameters never moves the plot or the control under the pointer). */
(function () {
  'use strict';
  var E = window.EPDemos, HP = window.EPDemosHelpers; if (!E || !HP) return;
  var C = E.C, RM = E.RM, rgba = E.rgba, smooth = E.smooth, makeCanvas = E.makeCanvas, loop = E.loop, box = E.box, setOut = E.setOut;
  var fetchJSON = HP.fetchJSON, whenNear = HP.whenNear, note = HP.note, failed = HP.failed, enable = HP.enable, interp1 = HP.interp1, seg = HP.seg, toggle = HP.toggle;
  var TAU = Math.PI * 2;
  var XMIN = 66, XMAX = 74.5, YMAX = 7;        // plot range: H0 in km/s/Mpc, penalty in sigma
  var MORPH = 0.45, GHOST = 1.5;                // seconds: curves morph to a new data choice; a faint copy of the old ones fades meanwhile
  var PLANCK = [67.4, 0.5], SHOES = [73.0, 1.0];
  var LEAD_ON = 'Penalty for adding SH<span class="pf-0">0</span>ES', LEAD_OFF = 'Best-fit H<sub>0</sub> without SH<span class="pf-0">0</span>ES, km/s/Mpc';
  var GLOSS = ['the oldest light in the universe (CMB), a map of galaxies (DESI) and supernovae (SN)',
               'adds when the first atomic nuclei formed (BBN)',
               'adds a sharper view of the oldest light (ACT), plus BBN'];
  // parameter rows: data column, plain name, symbol in small type, decimals (-1: the confinement temperature, shown in MeV)
  var KEY = [['dqcd_N_IR', 'extra radiation', 'ΔN', 2], ['omega_cdm', 'dark matter', 'ωc', 4], ['dqcd_log10_T_c', 'confinement scale', 'Λd', -1]];
  var ALL = KEY.concat([['omega_b', 'ordinary matter', 'ωb', 5], ['n_s', 'ripple tilt', 'nₛ', 4], ['logA', 'ripple strength', 'ln 10¹⁰Aₛ', 3], ['Mb', 'supernova brightness', 'Mb', 3]]);
  function fmt(p, v) { return p[3] < 0 ? Math.pow(10, v - 6).toFixed(1) : v.toFixed(p[3]); }

  function font(size, mono, bold) { return (bold ? '600 ' : '') + size + 'px ' + (mono ? C.mono : C.sans); }
  function tw(g, text, size, mono, bold) { g.font = font(size, mono, bold); return g.measureText(text).width; }
  function txt(g, text, x, y, o) {   // text with a halo in the plot colour, so a curve behind it never cuts a letter
    g.font = font(o.size, o.mono, o.bold); g.textAlign = o.align || 'left'; g.textBaseline = 'alphabetic';
    if (o.halo !== false) { g.lineJoin = 'round'; g.lineWidth = 4; g.strokeStyle = C.bg; g.strokeText(text, x, y); }
    g.fillStyle = o.color || C.text2; g.fillText(text, x, y);
  }

  function demoProfile() {
    var fig = document.getElementById('demo-profile'); if (!fig) return;
    var cv = fig.querySelector('.pf-stage canvas'); if (!cv) return;
    var S = makeCanvas(cv), g = S.ctx;
    var pcv = fig.querySelector('.pf-pstage canvas'), P = pcv ? makeCanvas(pcv) : null, pstage = pcv ? pcv.parentNode : null;
    var range = fig.querySelector('[data-ctl="h0"]'), out = fig.querySelector('[data-out="h0"]');
    var outL = fig.querySelector('[data-out="lcdm"]'), outD = fig.querySelector('[data-out="dqcd"]');
    var lead = fig.querySelector('[data-out="lead"]'), gloss = fig.querySelector('[data-out="gloss"]'), rowsSel = fig.querySelector('[data-ctl="rows"]');
    var D = null, combo = 0, shoes = true, H = +range.value, run = null;
    var tr = null, sweep = null, swept = false, touched = false, tagA = 1, rowsAll = false, panelH = 0;
    var PX = 0, PY = 0, PW = 1, PH = 1;          // the plot rectangle in CSS px, shared with pointer input
    var cache = {}, boxes = [], nb = 0;

    /* ---------- data ---------- */
    function state() { return { combo: combo, shoes: shoes }; }
    function raw(name, s) { return D.combos[s.combo].models[name + (s.shoes ? '_shoes' : '')]; }
    function minChi(m) { var c = m.cols.chi2, b = c[0]; for (var i = 1; i < c.length; i++) if (c[i] < b) b = c[i]; return b; }
    // one curve: its H0 grid and the penalty in sigma, sqrt(chi2 at that H0 - the model's best chi2 without SH0ES)
    function curve(name, s) {
      var k = name + s.combo + (s.shoes ? 's' : 'n'); if (cache[k]) return cache[k];
      var m = raw(name, s), xs = m.cols.H0, d = m.cols.Delta_chi2, L = s.shoes ? minChi(m) - minChi(raw(name, { combo: s.combo, shoes: false })) : 0;
      var ys = new Float64Array(xs.length), bi = 0;
      for (var i = 0; i < xs.length; i++) { ys[i] = Math.sqrt(Math.max(0, d[i] + L)); if (ys[i] < ys[bi]) bi = i; }
      return (cache[k] = { xs: xs, ys: ys, lo: xs[0], hi: xs[xs.length - 1], best: bi, m: m, iv: m.intervals ? m.intervals['68.0'] : null });
    }
    function val(c, h) { return h < c.lo || h > c.hi ? null : interp1(c.xs, c.ys, h); }
    function bestH() { var c = curve('dqcd', state()); return c.xs[c.best]; }
    function ease() { return tr ? smooth(Math.min(1, tr.t / MORPH)) : 1; }
    // the value drawn at h right now: mid-morph it blends the old and the new curve, so the dot stays on the line
    function shown(name, h) {
      var cb = curve(name, state()), vb = val(cb, h), e = ease(); if (e >= 1 || vb == null) return vb;
      var ca = curve(name, tr.from), lo = Math.max(ca.lo, cb.lo), hi = Math.min(ca.hi, cb.hi);
      if (hi <= lo) return vb;
      if (h >= lo && h <= hi) { var va = val(ca, h); return va + (vb - va) * e; }
      var edge = h < lo ? lo : hi; return vb + (val(ca, edge) - val(cb, edge)) * (1 - e);
    }

    /* ---------- geometry ---------- */
    function xOf(h) { return PX + (h - XMIN) / (XMAX - XMIN) * PW; }
    function yOf(s) { return PY + PH - s / YMAX * PH; }
    function hOf(x) { return XMIN + (x - PX) / PW * (XMAX - XMIN); }
    // a polyline over [lo, hi]: curve cb shifted by off, or (ca given) the blend of ca and cb at progress e
    function path(ca, cb, lo, hi, e, off) {
      var i = 0, j = 0, xa = ca ? ca.xs : null, xb = cb.xs, na = xa ? xa.length : 0, n2 = xb.length, first = true;
      function pt(h) { var v = val(cb, h); if (ca) { var a = val(ca, h); v = a + (v - a) * e; } v += off; if (first) { g.moveTo(xOf(h), yOf(v)); first = false; } else g.lineTo(xOf(h), yOf(v)); }
      g.beginPath(); pt(lo);
      while (i < na || j < n2) {
        var ha = i < na ? xa[i] : Infinity, hb = j < n2 ? xb[j] : Infinity, x = ha < hb ? ha : hb;
        if (ha === x) i++; if (hb === x) j++;
        if (x >= hi) break; if (x > lo) pt(x);
      }
      pt(hi);
    }
    function drawModel(name, color, dashed) {
      var cb = curve(name, state()), e = ease();
      g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = 'round'; g.setLineDash(dashed ? [6, 4] : []);
      if (e >= 1) { path(null, cb, cb.lo, cb.hi, 1, 0); g.stroke(); }
      else {
        var ca = curve(name, tr.from), lo = Math.max(ca.lo, cb.lo), hi = Math.min(ca.hi, cb.hi);
        if (hi > lo) {   // the shared stretch morphs; the parts only one curve has fade, attached to the morphing ends
          path(ca, cb, lo, hi, e, 0); g.stroke();
          g.globalAlpha = e;
          if (cb.lo < lo) { path(null, cb, cb.lo, lo, 1, (val(ca, lo) - val(cb, lo)) * (1 - e)); g.stroke(); }
          if (cb.hi > hi) { path(null, cb, hi, cb.hi, 1, (val(ca, hi) - val(cb, hi)) * (1 - e)); g.stroke(); }
          g.globalAlpha = 1 - e;
          if (ca.lo < lo) { path(null, ca, ca.lo, lo, 1, (val(cb, lo) - val(ca, lo)) * e); g.stroke(); }
          if (ca.hi > hi) { path(null, ca, hi, ca.hi, 1, (val(cb, hi) - val(ca, hi)) * e); g.stroke(); }
        } else { g.globalAlpha = 1 - e; path(null, ca, ca.lo, ca.hi, 1, 0); g.stroke(); g.globalAlpha = e; path(null, cb, cb.lo, cb.hi, 1, 0); g.stroke(); }
        g.globalAlpha = 1;
      }
      g.setLineDash([]);
    }

    /* ---------- label placement: try spots around an anchor, avoid other labels and both curves ---------- */
    function addBox(x0, y0, x1, y1) { var b = boxes[nb] || (boxes[nb] = {}); b.x0 = x0; b.y0 = y0; b.x1 = x1; b.y1 = y1; nb++; }
    function overlaps(x0, y0, x1, y1) { var n = 0; for (var q = 0; q < nb; q++) { var b = boxes[q]; if (x0 < b.x1 && x1 > b.x0 && y0 < b.y1 && y1 > b.y0) n++; } return n; }
    function curveHits(x0, y0, x1, y1, settled) {   // settled: judge against the curves the morph is heading to
      var n = 0;
      for (var s = 0; s < 2; s++) for (var k = 0; k <= 12; k++) {
        var nm = s ? 'dqcd' : 'lcdm', h = hOf(x0 + (x1 - x0) * k / 12), v = settled ? val(curve(nm, state()), h) : shown(nm, h); if (v == null) continue;
        var y = yOf(v); if (y > y0 - 4 && y < y1 + 4) n++;
      }
      return n;
    }
    var OFFS = [0, -14, 16, -28, 30, -44, 46, -60, 62, -78, 80, -96, 98];
    // texts: wordings to try, longest first; sides: +1 right of the anchor, -1 left; returns the chosen spot
    function place(texts, ax, ay, o, sides, offs) {
      var best = null, bc = Infinity;
      for (var ti = 0; ti < texts.length; ti++) {
        var w = tw(g, texts[ti], o.size, o.mono, o.bold);
        for (var si = 0; si < sides.length; si++) for (var k = 0; k < offs.length; k++) {
          var side = sides[si], dy = offs[k], x0 = side > 0 ? ax + (o.gap || 10) : side < 0 ? ax - (o.gap || 10) - w : ax - w / 2, y = ay + dy + o.size * 0.36;
          var bx0 = x0 - 3, bx1 = x0 + w + 3, by0 = y - o.size - 1, by1 = y + 4;
          var cost = Math.abs(dy) * 0.5 + si * 3 + ti * 30;
          if (bx0 < PX + 2 || bx1 > PX + PW - 2 || by0 < PY + 2 || by1 > PY + PH - 2) cost += 1000;
          cost += overlaps(bx0, by0, bx1, by1) * 400 + curveHits(bx0, by0, bx1, by1) * 40;
          if (cost < bc) { bc = cost; best = { text: texts[ti], x: x0, y: y, dy: dy, b0: bx0, b1: bx1, c0: by0, c1: by1, cost: cost }; }
        }
        if (bc < 60) break;
      }
      return best;
    }
    function commit(p) { addBox(p.b0, p.c0, p.b1, p.c1); }

    /* ---------- the plot ---------- */
    function draw() {
      var W = S.W, Hc = S.H; if (!W) return false;
      var narrow = W < 520, pad = narrow ? 10 : 14, fs = narrow ? 12 : 13;
      g.fillStyle = C.surface; g.fillRect(0, 0, W, Hc);
      // axis titles, worded by measured width
      var yT = 'penalty, σ', yG = ['higher = worse fit; 1σ is ordinary, 5σ almost never happens by chance', '1σ is ordinary, 5σ almost never happens by chance', '1σ ordinary, 5σ almost never by chance'];
      var yTw = tw(g, yT, fs, false, true), yOne = yTw + 12 + tw(g, yG[0], 12) <= W - 2 * pad, yLine2 = tw(g, yG[1], 12) <= W - 2 * pad ? yG[1] : yG[2];
      PX = pad + (narrow ? 26 : 30); PW = W - PX - pad - (narrow ? 4 : 10);
      var xT = 'H₀, how fast the universe expands: km/s per Mpc (3.3 million light-years)', xOne = tw(g, xT, 12) <= PW;
      PY = pad + (yOne ? 18 : 36) + 8;
      PH = Hc - PY - (19 + 17 + (xOne ? 0 : 16) + 4 + pad - 4);
      txt(g, yT, pad, pad + 12, { size: fs, bold: true, color: C.text, halo: false });
      if (yOne) txt(g, yG[0], pad + yTw + 12, pad + 12, { size: 12, halo: false });
      else { txt(g, '(higher = worse fit)', pad + yTw + 8, pad + 12, { size: 12, halo: false }); txt(g, yLine2, pad, pad + 30, { size: 12, halo: false }); }
      box(g, { x: PX, y: PY, w: PW, h: PH });
      // the two measurements, as bands
      [[PLANCK, true], [SHOES, shoes]].forEach(function (b) { g.fillStyle = rgba(C.text3, b[1] ? 0.13 : 0.06); g.fillRect(xOf(b[0][0] - b[0][1]), PY, xOf(b[0][0] + b[0][1]) - xOf(b[0][0] - b[0][1]), PH); });
      g.strokeStyle = C.border; g.lineWidth = 1;
      for (var s = 1; s < YMAX; s++) { g.beginPath(); g.moveTo(PX, Math.round(yOf(s)) + 0.5); g.lineTo(PX + PW, Math.round(yOf(s)) + 0.5); g.stroke(); }
      for (s = 0; s <= YMAX; s++) txt(g, s ? s + 'σ' : '0', PX - 6, yOf(s) + 4, { size: 12, mono: true, align: 'right', halo: false });
      for (var t = XMIN; t <= XMAX; t += 1) {
        g.strokeStyle = C.borderStrong; g.beginPath(); g.moveTo(Math.round(xOf(t)) + 0.5, PY + PH - 4); g.lineTo(Math.round(xOf(t)) + 0.5, PY + PH); g.stroke();
        if (!narrow || t % 2 === 0) txt(g, String(t), xOf(t), PY + PH + 19, { size: 12, mono: true, align: 'center', halo: false });
      }
      if (xOne) txt(g, xT, PX + PW / 2, PY + PH + 36, { size: 12, align: 'center', halo: false });
      else { txt(g, 'H₀, how fast the universe expands,', PX + PW / 2, PY + PH + 36, { size: 12, align: 'center', halo: false }); txt(g, 'km/s per Mpc (3.3 million light-years)', PX + PW / 2, PY + PH + 52, { size: 12, align: 'center', halo: false }); }
      if (!D) { drawPanel(); return false; }

      var e = ease(), open = details();
      g.save(); g.beginPath(); g.rect(PX, PY, PW, PH); g.clip();
      if (tr && tr.t < GHOST) {   // where the curves were a moment ago
        g.globalAlpha = 0.3 * (1 - tr.t / GHOST); g.lineWidth = 1.5;
        [['lcdm', C.text2, true], ['dqcd', C.accent, false]].forEach(function (sp) { var c = curve(sp[0], tr.from); g.strokeStyle = sp[1]; g.setLineDash(sp[2] ? [6, 4] : []); path(null, c, c.lo, c.hi, 1, 0); g.stroke(); });
        g.setLineDash([]); g.globalAlpha = 1;
      }
      if (open) [['lcdm', C.text2], ['dqcd', C.accent]].forEach(function (sp) {   // Details: each model's likely H0 range (68%)
        var c = curve(sp[0], state()), iv = c.iv; if (!iv) return;
        var lo = Math.max(iv.lo, c.lo), hi = Math.min(iv.hi, c.hi); if (hi <= lo) return;
        g.globalAlpha = e; g.strokeStyle = rgba(sp[1], 0.28); g.lineWidth = 9; g.lineCap = 'round'; g.lineJoin = 'round';
        path(null, c, lo, hi, 1, 0); g.stroke(); g.lineCap = 'butt'; g.globalAlpha = 1;
      });
      drawModel('lcdm', C.text2, true); drawModel('dqcd', C.accent, false);
      g.restore();

      nb = 0;
      // band names: bottom of the band, or its top when a curve runs through the bottom
      [[PLANCK, 'Planck', 'early universe', true], [SHOES, 'SH0ES', shoes ? 'nearby stars' : 'nearby stars, left out', shoes]].forEach(function (b) {
        var l1 = b[1] + ' ' + b[0][0].toFixed(1) + (narrow ? '' : ' ± ' + b[0][1].toFixed(1)), w = Math.max(tw(g, l1, 12, true), tw(g, b[2], 12)) + 6;
        var bc = xOf(b[0][0]), cx = bc, y = PY + PH - 12, bcost = Infinity;
        for (var si = 0; si < 3; si++) for (var yi = 0; yi < 2; yi++) {   // centred on the band or slid sideways (still over it), at its bottom or its top
          var c0 = Math.max(PX + w / 2 + 2, Math.min(PX + PW - w / 2 - 2, bc + [0, -1, 1][si] * (w / 2 - 12))), y0 = yi ? PY + 34 : PY + PH - 12;
          var cost = curveHits(c0 - w / 2, y0 - 30, c0 + w / 2, y0 + 4, true) * 10 + si * 2 + yi * 3;
          if (cost < bcost) { bcost = cost; cx = c0; y = y0; }
        }
        var x0 = cx - w / 2, x1 = cx + w / 2, col = b[3] ? C.text2 : C.text3;
        txt(g, l1, cx, y - 16, { size: 12, mono: true, align: 'center', color: col }); txt(g, b[2], cx, y, { size: 12, align: 'center', color: col });
        addBox(x0, y - 30, x1, y + 4);
      });
      // where a curve leaves the top of the chart: an arrowhead, and a note if there is room
      var exits = [];
      [['lcdm', C.text2], ['dqcd', C.accent]].forEach(function (sp) {
        var c = curve(sp[0], state());
        for (var i = 0; i + 1 < c.xs.length; i++) { var a = c.ys[i] - YMAX, b = c.ys[i + 1] - YMAX; if (a * b < 0) exits.push([xOf(c.xs[i] + (c.xs[i + 1] - c.xs[i]) * a / (a - b)), sp[1], a > 0 ? -1 : 1]); }
      });
      g.globalAlpha = e;
      exits.forEach(function (x) { g.fillStyle = x[1]; g.beginPath(); g.moveTo(x[0], PY + 2); g.lineTo(x[0] - 5, PY + 10); g.lineTo(x[0] + 5, PY + 10); g.closePath(); g.fill(); addBox(x[0] - 7, PY, x[0] + 7, PY + 12); });
      g.globalAlpha = 1;

      // the cursor
      var cx = xOf(H), coarse = narrow;
      g.strokeStyle = rgba(C.accent, 0.75); g.lineWidth = 1.5; g.beginPath(); g.moveTo(cx, PY); g.lineTo(cx, PY + PH); g.stroke(); g.lineWidth = 1;
      addBox(cx - 15, PY + PH - 9, cx + 15, PY + PH);   // the grip
      var R = [['dqcd', 'dark QCD', C.accent], ['lcdm', 'ΛCDM', C.text2]].map(function (sp) {
        var c = curve(sp[0], state()), v = shown(sp[0], H), r = { sp: sp, v: v };
        if (v == null) { r.past = H > c.hi; r.bound = c.ys[r.past ? c.ys.length - 1 : 0]; r.ay = yOf(Math.min(r.bound, YMAX - 0.12)); }
        else r.ay = v > YMAX ? PY + 12 : yOf(v);
        return r;
      });
      R.forEach(function (r) {   // marks on the cursor line: a dot on the curve, an up-arrow when off the chart, an open up-triangle for "over"
        g.fillStyle = r.sp[2]; g.strokeStyle = r.sp[2]; g.lineWidth = 1.5;
        if (r.v != null && r.v <= YMAX) { g.beginPath(); g.arc(cx, r.ay, 4.5, 0, TAU); g.fill(); addBox(cx - 6, r.ay - 6, cx + 6, r.ay + 6); }
        else if (r.v != null) { g.beginPath(); g.moveTo(cx, PY + 2); g.lineTo(cx - 5, PY + 10); g.lineTo(cx + 5, PY + 10); g.closePath(); g.fill(); addBox(cx - 7, PY, cx + 7, PY + 12); }
        else { g.fillStyle = C.bg; g.beginPath(); g.moveTo(cx, r.ay - 6); g.lineTo(cx - 5, r.ay + 3); g.lineTo(cx + 5, r.ay + 3); g.closePath(); g.fill(); g.stroke(); addBox(cx - 7, r.ay - 8, cx + 7, r.ay + 5); }
        g.lineWidth = 1;
      });
      var lfs = narrow ? 12 : 13;
      R.forEach(function (r) {   // the readouts, placed clear of both curves and of each other
        var n = r.sp[1], texts;
        if (r.v != null && r.v <= YMAX) texts = [n + ' ' + r.v.toFixed(1) + 'σ'];
        else if (r.v != null) texts = [n + ' ' + r.v.toFixed(1) + 'σ, off the chart', n + ' ' + r.v.toFixed(1) + 'σ ↑'];
        else texts = [n + ' over ' + r.bound.toFixed(1) + 'σ, not computed here', n + ' over ' + r.bound.toFixed(1) + 'σ'];
        var p = place(texts, cx, r.ay, { size: lfs, mono: true }, [1, -1], OFFS); commit(p);
        if (Math.abs(p.dy) > 20) {   // a short leader back to the mark
          var ex = p.x > cx ? p.b0 + 1 : p.b1 - 1, ey = (p.c0 + p.c1) / 2;
          g.strokeStyle = rgba(r.sp[2], 0.55); g.lineWidth = 1; g.beginPath(); g.moveTo(cx + (p.x > cx ? 5 : -5), r.ay); g.lineTo(ex, ey); g.stroke();
        }
        txt(g, p.text, p.x, p.y, { size: lfs, mono: true, color: r.sp[2] });
      });
      exits.forEach(function (x) {   // unless the cursor readout already says it for that curve
        if (R.some(function (r) { return r.sp[2] === x[1] && r.v != null && r.v > YMAX; })) return;
        var p = place(['off the chart'], x[0], PY + 14, { size: 12, gap: 6 }, [x[2] < 0 ? -1 : 1], [0, 14]);
        if (p.cost < 200) { commit(p); txt(g, p.text, p.x, p.y, { size: 12, color: x[1] }); }
      });
      if (tagA > 0.01) {   // the invitation, until the first touch
        var tp = place(['drag'], cx, PY + PH - 16, { size: 12, bold: true, gap: 8 }, [1, -1], [0, -16, -32, -48]);
        g.globalAlpha = tagA; txt(g, tp.text, tp.x, tp.y, { size: 12, bold: true, color: C.accent }); g.globalAlpha = 1;
      }
      // the grip: a pill on the axis with two chevrons
      var gw = coarse ? 28 : 24, gh = coarse ? 16 : 14, gx = cx - gw / 2, gy = PY + PH - gh / 2, rr = gh / 2;
      g.fillStyle = C.accent; g.beginPath(); g.moveTo(gx + rr, gy); g.lineTo(gx + gw - rr, gy); g.arc(gx + gw - rr, gy + rr, rr, -Math.PI / 2, Math.PI / 2); g.lineTo(gx + rr, gy + gh); g.arc(gx + rr, gy + rr, rr, Math.PI / 2, Math.PI * 1.5); g.fill();
      g.strokeStyle = C.bg; g.lineWidth = 1.6; g.lineJoin = 'round'; g.beginPath();
      g.moveTo(cx - 3, gy + rr - 3.5); g.lineTo(cx - 6.5, gy + rr); g.lineTo(cx - 3, gy + rr + 3.5);
      g.moveTo(cx + 3, gy + rr - 3.5); g.lineTo(cx + 6.5, gy + rr); g.lineTo(cx + 3, gy + rr + 3.5); g.stroke(); g.lineWidth = 1;

      drawPanel();
      return (tr || sweep || (touched && tagA > 0)) ? undefined : false;
    }

    /* ---------- Details: what dark QCD changes to reach this H0 ---------- */
    function panelGeom(narrow, n) { var pad = narrow ? 10 : 14, rowH = narrow ? 44 : 30, top = pad + 22, legend = narrow ? 44 : 28; return { pad: pad, rowH: rowH, top: top, h: top + n * rowH + legend + pad }; }
    function sizePanel() {   // all parameters always reserves the SH0ES-only row, so the switch never changes the height
      if (!pstage) return; var w = pstage.clientWidth || fig.clientWidth, h = panelGeom(w < 520, rowsAll ? 7 : 3).h;
      if (h !== panelH) { panelH = h; pstage.style.height = h + 'px'; }
    }
    function drawPanel() {
      if (!P || !details()) return; var W = P.W, Hh = P.H, pg = P.ctx; if (!W || !Hh) return;
      pg.fillStyle = C.surface; pg.fillRect(0, 0, W, Hh); if (!D) return;
      var narrow = W < 520, gm = panelGeom(narrow, 0), pad = gm.pad;
      var c = curve('dqcd', state()), m = c.m, below = H < c.lo - 1e-6, outside = below || H > c.hi + 1e-6, Hc = Math.max(c.lo, Math.min(c.hi, H)), bi = c.best;
      var st = outside ? 'dark QCD not computed ' + (below ? 'below ' : 'above ') + Hc.toFixed(1) + '; showing ' + Hc.toFixed(1) : 'dark QCD’s settings at H₀ = ' + H.toFixed(1);
      txt(pg, st, pad, pad + 13, { size: 13, color: outside ? C.accent : C.text, halo: false, bold: true });
      var nameW = narrow ? 0 : 200, valW = narrow ? 0 : 150, tx = narrow ? pad : pad + nameW, tw2 = narrow ? W - 2 * pad : W - pad - tx - valW, y = gm.top;
      (rowsAll ? ALL : KEY).forEach(function (p) {
        var vals = m.cols[p[0]]; if (!vals) return;
        var lo = Infinity, hi = -Infinity; for (var i = 0; i < vals.length; i++) { if (vals[i] < lo) lo = vals[i]; if (vals[i] > hi) hi = vals[i]; }
        var v = interp1(m.cols.H0, vals, Hc), best = vals[bi], yc = narrow ? y + 31 : y + 15, unit = p[3] < 0 ? ' MeV' : '';
        function xp(x) { return tx + 6 + (hi > lo ? (x - lo) / (hi - lo) : 0.5) * (tw2 - 12); }
        pg.globalAlpha = outside ? 0.45 : 1;
        var symW = p[2] ? tw(pg, p[2], 11) + 5 : 0, ny = narrow ? y + 15 : yc + 4;
        if (narrow) { txt(pg, p[1], pad, ny, { size: 13, color: C.text, halo: false }); if (p[2]) txt(pg, p[2], pad + tw(pg, p[1], 13) + 5, ny, { size: 11, color: C.text2, halo: false }); }
        else { txt(pg, p[1], tx - 14 - symW, ny, { size: 13, color: C.text, align: 'right', halo: false }); if (p[2]) txt(pg, p[2], tx - 14, ny, { size: 11, color: C.text2, align: 'right', halo: false }); }
        pg.strokeStyle = C.borderStrong; pg.lineWidth = 1; pg.beginPath(); pg.moveTo(tx, yc + 0.5); pg.lineTo(tx + tw2, yc + 0.5); pg.stroke();
        pg.strokeStyle = C.text2; pg.lineWidth = 2; pg.beginPath(); pg.moveTo(xp(best), yc - 7); pg.lineTo(xp(best), yc + 7); pg.stroke();
        pg.strokeStyle = C.accent; pg.lineWidth = 4; pg.beginPath(); pg.moveTo(xp(best), yc + 0.5); pg.lineTo(xp(v), yc + 0.5); pg.stroke(); pg.lineWidth = 1;
        pg.fillStyle = C.accent; pg.beginPath(); pg.arc(xp(v), yc, 5, 0, TAU); pg.fill();
        var vt = (fmt(p, best) === fmt(p, v) ? '' : fmt(p, best) + ' → ') + fmt(p, v) + unit;
        txt(pg, vt, narrow ? W - pad : tx + tw2 + 14, narrow ? ny : yc + 4, { size: 12, mono: true, color: C.text, align: narrow ? 'right' : 'left', halo: false });
        pg.globalAlpha = 1; y += gm.rowH;
      });
      // the key to the rows, drawn with the marks themselves
      var ly = Hh - pad - (narrow ? 22 : 6), x = pad;
      pg.strokeStyle = C.text2; pg.lineWidth = 2; pg.beginPath(); pg.moveTo(x + 1, ly - 11); pg.lineTo(x + 1, ly + 1); pg.stroke(); x += 8;
      txt(pg, 'best fit', x, ly, { size: 12, halo: false }); x += tw(pg, 'best fit', 12) + 16;
      pg.fillStyle = C.accent; pg.beginPath(); pg.arc(x + 4, ly - 5, 4.5, 0, TAU); pg.fill(); x += 13;
      txt(pg, 'needed at this H₀', x, ly, { size: 12, halo: false }); x += tw(pg, 'needed at this H₀', 12) + 16;
      pg.strokeStyle = C.accent; pg.lineWidth = 4; pg.beginPath(); pg.moveTo(x, ly - 5); pg.lineTo(x + 14, ly - 5); pg.stroke(); pg.lineWidth = 1; x += 20;
      txt(pg, 'the change', x, ly, { size: 12, halo: false }); x += tw(pg, 'the change', 12) + 16;
      var anchor = '1 MeV ≈ 12 billion degrees';
      if (narrow || x + tw(pg, anchor, 12) > W - pad) txt(pg, anchor, pad, ly + 20, { size: 12, halo: false }); else txt(pg, anchor, x, ly, { size: 12, halo: false });
    }

    /* ---------- state and input ---------- */
    function updateKey(flash) {
      if (!D) return; var cb = D.combos[combo], a, b;
      if (shoes) { a = cb.qdmap_lcdm.toFixed(1) + 'σ'; b = cb.qdmap_dqcd.toFixed(1) + 'σ'; }
      else { var l = curve('lcdm', state()), d = curve('dqcd', state()); a = l.xs[l.best].toFixed(1); b = d.xs[d.best].toFixed(1); }
      if (lead) { var html = shoes ? LEAD_ON : LEAD_OFF; if (lead.innerHTML !== html) lead.innerHTML = html; }
      [[outL, a], [outD, b]].forEach(function (q) {
        if (!q[0] || q[0].textContent === q[1]) return; q[0].textContent = q[1];
        if (flash) { q[0].classList.remove('is-flash'); void q[0].offsetWidth; q[0].classList.add('is-flash'); }
      });
    }
    function syncH() { var s = H.toFixed(1); if (range.value !== s) range.value = s; setOut(out, s); }
    function changeState(c, sh) {
      if (c === combo && sh === shoes) return;
      var from = state(); combo = c; shoes = sh;
      if (sweep) sweep = { t: 0, from: H, back: true };   // mid-walk: glide to the new best fit rather than stop wherever it was
      tr = (RM || !run.visible()) ? null : { from: from, t: 0 };   // under reduced motion (or off screen) the new curves appear at once
      updateKey(true); if (gloss) gloss.textContent = GLOSS[combo];
      run.wake(); run.redraw();
    }
    function step(dt) {
      if (tr) { tr.t += dt; if (tr.t >= GHOST) tr = null; }
      if (sweep) {   // the intro walk: from Planck's value to SH0ES's, then back to dark QCD's best fit
        sweep.t += dt; var t = sweep.t, a = PLANCK[0], b = SHOES[0], c = bestH();
        if (sweep.back) { H = sweep.from + (c - sweep.from) * smooth(t / 0.7); if (t >= 0.7) sweep = null; }
        else { H = t < 0.5 ? a : t < 3.1 ? a + (b - a) * smooth((t - 0.5) / 2.6) : t < 3.6 ? b : t < 4.7 ? b + (c - b) * smooth((t - 3.6) / 1.1) : c; if (t >= 4.7) sweep = null; }
        syncH();
      }
      if (touched && tagA > 0) tagA = Math.max(0, tagA - dt / 0.5);
    }
    var inView = false;   // the walk starts once most of the plot is on screen, so the visitor sees it from the start
    function startSweep() { if (RM || !D || touched || swept || !inView || !run.visible()) return; swept = true; sweep = { t: 0 }; H = PLANCK[0]; syncH(); run.wake(); }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { inView = es[es.length - 1].intersectionRatio >= 0.6; if (inView) startSweep(); }, { threshold: [0, 0.6, 1] }).observe(cv);
    else inView = true;
    function setH(h) { touched = true; sweep = null; if (RM) tagA = 0; H = Math.max(XMIN, Math.min(XMAX, h)); syncH(); run.wake(); run.redraw(); }
    function hAt(clientX, el) { var r = el.getBoundingClientRect(); return hOf(clientX - r.left); }
    function bindPointer(el) {   // mouse and pen drag at once; a finger taps, or drags sideways (a vertical swipe still scrolls the page)
      var drag = false, armed = false, sx = 0, sy = 0;
      el.addEventListener('pointerdown', function (e) {
        if (!D) return;
        if (e.pointerType === 'touch') { armed = true; drag = false; sx = e.clientX; sy = e.clientY; return; }
        drag = true; try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } setH(hAt(e.clientX, el)); e.preventDefault();
      });
      el.addEventListener('pointermove', function (e) {
        if (armed && !drag) { var dx = e.clientX - sx, dy = e.clientY - sy; if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) { drag = true; try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } } else return; }
        if (drag) setH(hAt(e.clientX, el));
      });
      el.addEventListener('pointerup', function (e) { if (armed && !drag && Math.abs(e.clientX - sx) < 10 && Math.abs(e.clientY - sy) < 10) setH(hAt(e.clientX, el)); drag = false; armed = false; });
      el.addEventListener('pointercancel', function () { drag = false; armed = false; });
    }

    var details = E.more(fig, function () { sizePanel(); if (run) { run.wake(); run.redraw(); } });
    run = loop(cv, step, draw); run.onVisible(startSweep);
    S.onresize = function () { sizePanel(); run.redraw(); };
    if (P) P.onresize = function () { run.redraw(); };
    E.onTheme.push(function () { run.redraw(); });
    bindPointer(cv); if (pcv) bindPointer(pcv);
    range.addEventListener('input', function () { setH(+range.value); });
    seg(fig, 'data-combo', function (v) { changeState(+v, shoes); });
    toggle(fig.querySelector('[data-ctl="shoes"]'), function (on) { changeState(combo, on); });
    if (rowsSel) rowsSel.addEventListener('change', function () { rowsAll = rowsSel.value === 'all'; sizePanel(); run.wake(); run.redraw(); });
    sizePanel();
    enable(fig, false); note(fig, 'Loading the profiles (20 KB)…');
    whenNear(fig, function () {
      fetchJSON(fig.getAttribute('data-src')).then(function (d) {
        D = d; if (!touched) H = bestH(); syncH(); updateKey(false); if (gloss) gloss.textContent = GLOSS[combo];
        enable(fig, true); note(fig, ''); startSweep(); run.wake(); run.redraw();
      }).catch(function (err) { failed(fig, err); });
    });
    syncH();
  }

  function init() { demoProfile(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
