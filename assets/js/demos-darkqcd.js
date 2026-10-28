/* Fig. 9: cooling the dark sector through confinement (dark QCD, arXiv:2609.16120).
   Plain JavaScript, canvas 2D, no dependencies. Uses the helpers exported by assets/js/demos.js.
   Left (top on phones): a box of dark-sector particles. Above the confinement scale a plasma of light dark
   quarks and dark gluons (plus a few heavy dark quarks); through the crossover the gluons fly into the forming
   bound states, the light quarks pair into dark pions (the dark radiation) and each heavy quark dresses into a
   heavy meson (the dark matter). Right (below on phones): the extra radiation before and after cooling.
   Behind "Details" (E.more): the lattice-shaped g(T) crossover (notes eqs. 26-28, Borsanyi et al. 2014 form,
   stitched 37 -> 3) with the BBN window on the dark-temperature axis, the 37 -> 3 count, the extra radiation
   while the first nuclei form, the confinement-scale slider and a one-sentence BBN readout. Numbers from the
   paper's draft notes and fit table; the particle animation itself is qualitative. */
(function () {
  'use strict';
  var E = window.EPDemos; if (!E) return;
  var C = E.C, RM = E.RM, rgba = E.rgba, label = E.label, textW = E.textW, setOut = E.setOut, gauss = E.gauss, smooth = E.smooth;
  var TAU = Math.PI * 2;

  /* ---- the stitched crossover: trace anomaly A(t) in the Borsanyi form (notes eq. 26), one quadrature for
     the pressure (eq. 27), energy density by eq. 28, entropy from both; tabulated once against log10(T/Tc) ---- */
  var G_UV = 37, G_IR = 3;   // 16 gluons + 21 light quarks above; 3 dark pions below (notes eqs. 17-18)
  var BOR = { h0: 0.1396, h1: -0.1800, h2: 0.0350, f0: 2.76, f1: 6.79, f2: -5.29, g1: -0.47, g2: 1.04 };   // Borsanyi et al. 2014 (2+1 flavours), t = T/Tc
  function A1(t) { return Math.exp(-BOR.h1 / t - BOR.h2 / (t * t)) * (BOR.h0 + BOR.f0 * (Math.tanh(BOR.f1 * t + BOR.f2) + 1)) / (1 + BOR.g1 * t + BOR.g2 * t * t); }
  var TN = 481, TL0 = -2, TL1 = 2, TAB_P = new Float64Array(TN), TAB_R = new Float64Array(TN), TAB_S = new Float64Array(TN);
  (function tabulate() {
    var F = new Float64Array(TN), acc = 0, i, dl = (TL1 - TL0) / (TN - 1), LN10 = Math.log(10);
    for (i = 0; i < TN; i++) { var t = Math.pow(10, TL0 + i * dl); acc += A1(t) * LN10 * dl; F[i] = acc; }   // ∫ A dt/t = ∫ A d(ln t)
    var Fmax = F[TN - 1], k = Math.PI * Math.PI / 90, N = k * (G_UV - G_IR) / Fmax;   // normalization: the pressure dof rise 3 -> 37 (eq. 27)
    for (i = 0; i < TN; i++) {
      var tt = Math.pow(10, TL0 + i * dl), gP = G_IR + (G_UV - G_IR) * F[i] / Fmax, gR = gP + (30 / (Math.PI * Math.PI)) * N * A1(tt);   // eq. 28: rho/T^4 = A + 3P/T^4
      TAB_P[i] = gP; TAB_R[i] = gR; TAB_S[i] = 0.75 * gR + 0.25 * gP;   // s/T^3 = (rho+P)/T^4
    }
  })();
  function tab(T, Tc, arr) { var l = Math.log10(T / Tc); if (l <= TL0) return arr[0]; if (l >= TL1) return arr[TN - 1]; var x = (l - TL0) / (TL1 - TL0) * (TN - 1), i = x | 0, f = x - i; return arr[i] + (arr[i + 1] - arr[i]) * f; }
  function gRho(T, Tc) { return tab(T, Tc, TAB_R); }
  function gS(T, Tc) { return tab(T, Tc, TAB_S); }

  /* ---- canvas text with real sub- and superscripts: segs = [{t: 'ΔN'}, {t: 'eff', sub: 1}] (constant arrays, reused) ---- */
  function segFont(s, size) { return (s.sub || s.sup ? Math.round(size * 0.75) : size) + 'px ' + C.sans; }
  function richW(g, segs, size) { var w = 0; for (var i = 0; i < segs.length; i++) { var s = segs[i]; g.font = segFont(s, size); s.w = g.measureText(s.t).width; w += s.w; } return w; }
  function rich(g, segs, x, y, size, color, align) {
    var w = richW(g, segs, size), x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = color;
    for (var i = 0; i < segs.length; i++) { var s = segs[i]; g.font = segFont(s, size); g.fillText(s.t, x0, y + (s.sub ? 0.28 * size : s.sup ? -0.4 * size : 0)); x0 += s.w; }
    return w;
  }
  var SEG_LD = [{ t: 'Λ' }, { t: 'd', sub: 1 }];
  var SEG_RAD = [[{ t: 'extra radiation (ΔN' }, { t: 'eff', sub: 1 }, { t: ')' }], [{ t: 'extra radiation' }]];
  var SEG_FOOT = [
    [{ t: 'ΔN' }, { t: 'eff', sub: 1 }, { t: ': extra radiation, counted in neutrino types; ×2.31 = (37/3)' }, { t: '1/3', sup: 1 }],
    [{ t: '×2.31 = (37/3)' }, { t: '1/3', sup: 1 }, { t: '; ΔN' }, { t: 'eff', sub: 1 }, { t: ' in neutrino types' }],
    [{ t: '×2.31 = (37/3)' }, { t: '1/3', sup: 1 }]
  ];
  var SEG_WIN = [[{ t: 'the grey window moves with Λ' }, { t: 'd', sub: 1 }, { t: ': clumping reheats the dark sector' }], [{ t: 'clumping reheats the dark sector, moving the window' }], [{ t: 'clumping reheats the dark sector' }]];

  function demoDarkQCD() {
    var fig = document.getElementById('demo-darkqcd'); if (!fig) return;
    var cv = fig.querySelector('canvas'), S = E.makeCanvas(cv), g = S.ctx;
    var range = fig.querySelector('[data-ctl="temp"]'), out = fig.querySelector('[data-out="temp"]'), outDeg = fig.querySelector('[data-out="deg"]'), btn = fig.querySelector('[data-ctl="cool"]');
    var rangeTc = fig.querySelector('[data-ctl="tc"]'), outTc = fig.querySelector('[data-out="tc"]'), outBBN = fig.querySelector('[data-out="bbn"]');
    var COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

    // ---- numbers from the paper ----
    var REHEAT = Math.pow(G_UV / G_IR, 1 / 3);                 // (37/3)^(1/3) = 2.31: the pions' reheating across confinement (notes eq. 19)
    var DN_AFTER = 0.54, DN_BEFORE = DN_AFTER / REHEAT;         // extra radiation after confinement (paper's fit with SH0ES, as Fig. 4) and before it (eq. 23)
    var XI_UV = Math.pow(DN_AFTER * 7 / (4 * G_IR * Math.pow(G_UV / G_IR, 4 / 3)), 0.25);   // primordial Td/Tnu that gives the fit's Delta N (eq. 22): 0.324
    var LOG_LO = -2, LOG_HI = 1;                                // dark temperature axis and slider: 0.01 .. 10 MeV
    var TC = rangeTc ? Math.pow(10, +rangeTc.value - 6) : 1;    // confinement scale in MeV from the log10(Lambda_d/eV) slider
    var BBN_HI = 0.8, BBN_LO = 0.07;                            // photon temperatures of n/p freeze-out and deuterium formation, MeV
    var K_PER_MEV = 1.1605e10;                                  // 1 MeV / k_B in kelvin: about 12 billion degrees
    function tempOf(v) { return Math.pow(10, LOG_LO + (LOG_HI - LOG_LO) * v); }
    function sOf(t) { return (Math.log10(t) - LOG_LO) / (LOG_HI - LOG_LO); }
    function boundFrac(t) { return Math.max(0, Math.min(1, (G_UV - gS(t, TC)) / (G_UV - G_IR))); }   // share of the plasma's entropy dof already gone into bound states
    // the box's share of bound states: that fraction with the last 4-6% at each end trimmed, so a hot box (g = 36 at 3 Lambda_d)
    // holds no stray bound state and a cold one (g = 4.5 at 0.3 Lambda_d) no stray free quark
    function want() { var f = boundFrac(T); return f <= 0.04 ? 0 : f >= 0.94 ? 1 : (f - 0.04) / 0.9; }
    function dNeff(Td) { return (4 / 7) * gRho(Td, TC) * Math.pow(XI_UV, 4) * Math.pow(G_UV / gS(Td, TC), 4 / 3); }   // eq. 21 with the entropy-conserving Td/Tnu
    // photon -> dark temperature: Td/Tnu = xi_UV (37/g_s,d)^(1/3) (eq. 16); Tnu/Tgamma falls from 1 to (4/11)^(1/3) as e+e- annihilate (eq. 16, SM thresholds)
    function nuOverGamma(Tg) { var frac = 0.5 * (1 + Math.tanh((Math.log10(Tg) - Math.log10(0.17)) / 0.22)); return Math.pow((2 + 3.5 * frac) / 5.5, 1 / 3); }
    function darkTempAt(Tg) {   // solve Td = Tg (Tnu/Tg) xi_UV (37/g_s(Td))^(1/3), the right side falling with Td
      var lo = 1e-4, hi = 1e3;
      for (var i = 0; i < 48; i++) { var m = Math.sqrt(lo * hi), rhs = Tg * nuOverGamma(Tg) * XI_UV * Math.pow(G_UV / gS(m, TC), 1 / 3); if (rhs > m) lo = m; else hi = m; }
      return Math.sqrt(lo * hi);
    }
    var bbn = { tdHi: 0.3, tdLo: 0.04, dnHi: 0, dnLo: 0 };
    function updateBBN() {   // the dark temperature and extra radiation at the start (n/p freeze-out) and end (deuterium) of BBN, and one plain sentence
      bbn.tdHi = darkTempAt(BBN_HI); bbn.tdLo = darkTempAt(BBN_LO); bbn.dnHi = dNeff(bbn.tdHi); bbn.dnLo = dNeff(bbn.tdLo);
      var fHi = boundFrac(bbn.tdHi), fLo = boundFrac(bbn.tdLo), a = bbn.dnHi.toFixed(2), b = bbn.dnLo.toFixed(2);
      var grow = a === b ? 'the extra radiation stays at ' + b : 'the extra radiation grows from ' + a + ' to ' + b;
      setOut(outBBN, fHi >= 0.9 ? 'Clumping is mostly over before the first nuclei form; while they form, ' + grow + '.'
        : fLo >= 0.3 ? 'Clumping happens while the first nuclei form: ' + grow + '.'
        : 'Clumping comes after the first nuclei form; while they form, ' + grow + '.');
    }

    // ---- particles (unit periodic box) ----
    var NQ = 252, NG = 192, NH = 12, V = 0.2, VPI = 1.35 * V, VG = 2.4 * V, VH = 0.012, TB = 0.45;   // light quarks, gluons, heavy quarks; speeds in box widths per second (pions hotter, gluons fly fast); binding time
    var QX = new Float32Array(NQ), QY = new Float32Array(NQ), QVX = new Float32Array(NQ), QVY = new Float32Array(NQ);
    var QS = new Int8Array(NQ), QP = new Int32Array(NQ), QT = new Float32Array(NQ), QPI = new Int32Array(NQ);   // state 0 free, 1 pairing, 2 inside a pion, 3 falling onto a heavy quark, 4 orbiting it; partner; timer; pion index
    var GX = new Float32Array(NG), GY = new Float32Array(NG), GVX = new Float32Array(NG), GVY = new Float32Array(NG), GA = new Float32Array(NG), GPH = new Float32Array(NG), GS = new Int8Array(NG), GT = new Int32Array(NG);   // gluon state 0 free, 1 flying to a target, 2 absorbed
    var HX = new Float32Array(NH), HY = new Float32Array(NH), HVX = new Float32Array(NH), HVY = new Float32Array(NH), HQ = new Int32Array(NH), HANG = new Float32Array(NH), HG = new Int32Array(NH * 3), HGN = new Int8Array(NH);
    var NPMAX = NQ >> 1, PX = new Float32Array(NPMAX), PY = new Float32Array(NPMAX), PVX = new Float32Array(NPMAX), PVY = new Float32Array(NPMAX), PA = new Int32Array(NPMAX), PB = new Int32Array(NPMAX), PG = new Int32Array(NPMAX * 3), PGN = new Int8Array(NPMAX), NP = 0;
    var NC = 12, head = new Int32Array(NC * NC), next = new Int32Array(NQ), ghead = new Int32Array(NC * NC), gnext = new Int32Array(NG);
    var DX = new Float32Array(NQ), DY = new Float32Array(NQ);
    var NF = 48, FX = new Float32Array(NF), FY = new Float32Array(NF), FA = new Float32Array(NF), FK = new Int8Array(NF), fi = 0;   // flashes: absorption (red) and emission (grey)
    var sv = +range.value, T = tempOf(sv), fb = 0, events = 0, EV = NH + ((NQ - NH) >> 1), gluonsSent = 0;
    var anim = null, fastT = 0, actT = 0, actDir = 0, boxTapped = false, scrub = null, run = null;   // actT/actDir: time left on, and direction of, the last bind or release
    var DDX = 0, DDY = 0;   // result of dxy(), the shortest periodic separation

    function rnd(v, k, vx, vy) { var th = TAU * Math.random(); vx[k] = v * Math.cos(th); vy[k] = v * Math.sin(th); }
    function flash(x, y, kind) { FX[fi] = x; FY[fi] = y; FA[fi] = 0.001; FK[fi] = kind; fi = (fi + 1) % NF; }
    function reset() {
      var k;
      for (k = 0; k < NQ; k++) { QX[k] = Math.random(); QY[k] = Math.random(); rnd(V, k, QVX, QVY); QS[k] = 0; QP[k] = -1; QT[k] = 0; QPI[k] = -1; }
      for (k = 0; k < NG; k++) { GX[k] = Math.random(); GY[k] = Math.random(); rnd(V, k, GVX, GVY); GA[k] = 1; GPH[k] = TAU * Math.random(); GS[k] = 0; GT[k] = 0; }
      for (k = 0; k < NH; k++) { HX[k] = 0.1 + 0.8 * ((k % 4) + 0.5 + 0.3 * (Math.random() - 0.5)) / 4; HY[k] = 0.1 + 0.8 * (((k / 4) | 0) + 0.5 + 0.3 * (Math.random() - 0.5)) / 3; rnd(VH, k, HVX, HVY); HQ[k] = -1; HANG[k] = TAU * Math.random(); HGN[k] = 0; }
      FA.fill(0); NP = 0; events = 0; gluonsSent = 0;
    }
    function wrap(a) { return a - Math.floor(a); }
    function dxy(x0, y0, x1, y1) { var dx = x1 - x0, dy = y1 - y0; if (dx > 0.5) dx -= 1; else if (dx < -0.5) dx += 1; if (dy > 0.5) dy -= 1; else if (dy < -0.5) dy += 1; DDX = dx; DDY = dy; }
    function rebuildGrid() { head.fill(-1); for (var k = 0; k < NQ; k++) { if (QS[k] !== 0) continue; var c = ((QY[k] * NC) | 0) * NC + ((QX[k] * NC) | 0); next[k] = head[c]; head[c] = k; } }
    function nearestFree(x, y, skip) {
      var cx = (x * NC) | 0, cy = (y * NC) | 0, best = -1, bd = Infinity;
      for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++) {
        var c = (((cy + oy + NC) % NC) * NC) + ((cx + ox + NC) % NC);
        for (var i = head[c]; i !== -1; i = next[i]) { if (i === skip || QS[i] !== 0) continue; dxy(x, y, QX[i], QY[i]); var d2 = DDX * DDX + DDY * DDY; if (d2 < bd) { bd = d2; best = i; } }
      }
      if (best === -1) for (var k = 0; k < NQ; k++) if (k !== skip && QS[k] === 0) return k;
      return best;
    }
    function sendGluons(code, x, y, n) {   // the n nearest free gluons fly to the forming bound state
      if (n <= 0) return;
      ghead.fill(-1); var k;
      for (k = 0; k < NG; k++) { if (GS[k] !== 0) continue; var c = ((GY[k] * NC) | 0) * NC + ((GX[k] * NC) | 0); gnext[k] = ghead[c]; ghead[c] = k; }
      var cx = (x * NC) | 0, cy = (y * NC) | 0;
      for (var r = 1; r <= 3 && n > 0; r++) {   // widen the search ring until enough gluons are found
        for (var oy = -r; oy <= r && n > 0; oy++) for (var ox = -r; ox <= r && n > 0; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r && r !== 1) continue;
          var c2 = (((cy + oy + NC) % NC) * NC) + ((cx + ox + NC) % NC);
          for (var i = ghead[c2]; i !== -1 && n > 0; i = gnext[i]) { if (GS[i] === 0) { GS[i] = 1; GT[i] = code; GA[i] = 1; n--; gluonsSent++; } }
        }
      }
    }
    function gluonQuota() { var w = Math.round(events * NG / EV); return Math.max(0, Math.min(2, w - gluonsSent)); }
    function bindOne() {
      rebuildGrid();
      for (var h = 0; h < NH; h++) if (HQ[h] === -1) { var q = nearestFree(HX[h], HY[h], -1); if (q === -1) return false; HQ[h] = q; QS[q] = 3; QP[q] = h; QT[q] = 0; events++; actT = 1; actDir = 1; sendGluons(-(h + 1), HX[h], HY[h], gluonQuota()); return true; }
      var a = -1; for (var k = 0; k < NQ; k++) if (QS[k] === 0) { a = k; break; }
      if (a === -1) return false;
      var tries = 0; while (tries++ < 8) { var r = (Math.random() * NQ) | 0; if (QS[r] === 0) { a = r; break; } }
      var b = nearestFree(QX[a], QY[a], a); if (b === -1) return false;
      QS[a] = 1; QS[b] = 1; QP[a] = b; QP[b] = a; QT[a] = 0; QT[b] = 0; events++; actT = 1; actDir = 1;
      sendGluons(a, QX[a], QY[a], gluonQuota()); return true;
    }
    function emit(x, y, list, off, n) { for (var j = 0; j < n; j++) { var k = list[off + j]; GS[k] = 0; GT[k] = 0; GX[k] = wrap(x + 0.01 * gauss()); GY[k] = wrap(y + 0.01 * gauss()); rnd(V, k, GVX, GVY); GA[k] = 1; gluonsSent--; } flash(x, y, 1); }
    function freeFlyers(code) { for (var k = 0; k < NG; k++) if (GS[k] === 1 && GT[k] === code) { GS[k] = 0; gluonsSent--; } }
    function releaseOne() {
      actT = 0.6; actDir = -1;
      if (NP > 0) { NP--; var a = PA[NP], b = PB[NP]; QX[a] = PX[NP]; QY[a] = PY[NP]; QX[b] = PX[NP]; QY[b] = PY[NP]; rnd(V, a, QVX, QVY); QVX[b] = -QVX[a]; QVY[b] = -QVY[a]; QS[a] = 0; QS[b] = 0; QP[a] = -1; QP[b] = -1; QPI[a] = -1; QPI[b] = -1; emit(PX[NP], PY[NP], PG, NP * 3, PGN[NP]); PGN[NP] = 0; freeFlyers(a); freeFlyers(b); events--; return true; }
      for (var k = 0; k < NQ; k++) if (QS[k] === 1) { var p = QP[k]; QS[k] = 0; QS[p] = 0; QP[k] = -1; QP[p] = -1; freeFlyers(k); freeFlyers(p); events--; return true; }
      for (var h = NH - 1; h >= 0; h--) if (HQ[h] !== -1) { var q = HQ[h]; QS[q] = 0; QP[q] = -1; rnd(V, q, QVX, QVY); HQ[h] = -1; emit(HX[h], HY[h], HG, h * 3, HGN[h]); HGN[h] = 0; freeFlyers(-(h + 1)); events--; return true; }
      return false;
    }
    function sweep() {   // safety net: with nothing bound, every gluon is free again (none may stay hidden)
      for (var k = 0; k < NG; k++) if (GS[k] !== 0) { GS[k] = 0; GT[k] = 0; GX[k] = Math.random(); GY[k] = Math.random(); rnd(V, k, GVX, GVY); GA[k] = 0; }
      gluonsSent = 0;
    }

    function step(dt) {
      if (anim) { anim.t += dt / anim.dur; var u = smooth(anim.t); sv = anim.from + (anim.to - anim.from) * u; if (anim.t >= 1) { sv = anim.to; anim = null; } range.value = sv.toFixed(3); T = tempOf(sv); showT(); updateBtn(); }
      if (fastT > 0) fastT -= dt;
      var w = want(), fast = fastT > 0;   // fast: a slider or the curve is being dragged, so the box follows within about 0.3 s
      fb += (w - fb) * Math.min(1, (fast ? 14 : 6) * dt); if (Math.abs(w - fb) < 0.003) fb = w;
      var target = Math.round(fb * EV), k, h, guard = 0;
      while (events < target && guard++ < (fast ? 10 : 6) && bindOne()) {}
      while (events > target && guard++ < 16 && releaseOne()) {}
      if (events === 0 && gluonsSent !== 0) sweep();
      var hot = fb < 0.5, tbind = fast ? 0.25 : TB; if (actT > 0) actT -= dt;
      for (k = 0; k < NQ; k++) {   // light quarks
        var st = QS[k];
        if (st === 0) { QX[k] = wrap(QX[k] + QVX[k] * dt); QY[k] = wrap(QY[k] + QVY[k] * dt); }
        else if (st === 1) {
          var p = QP[k]; if (p < k) continue;
          QT[k] += dt; dxy(QX[k], QY[k], QX[p], QY[p]); var ddx = DDX, ddy = DDY, dist = Math.hypot(ddx, ddy), tb = Math.max(tbind, dist / (2 * V)), f = Math.min(1, dt / Math.max(0.02, tb - QT[k]));
          var mx = QX[k] + 0.5 * ddx, my = QY[k] + 0.5 * ddy, vx = 0.5 * (QVX[k] + QVX[p]), vy = 0.5 * (QVY[k] + QVY[p]);
          QX[k] = wrap(QX[k] + (mx - QX[k]) * f + vx * dt); QY[k] = wrap(QY[k] + (my - QY[k]) * f + vy * dt);
          QX[p] = wrap(QX[p] - 0.5 * ddx * f + vx * dt); QY[p] = wrap(QY[p] - 0.5 * ddy * f + vy * dt);
          if (QT[k] >= tb && NP < NPMAX) { var n = Math.hypot(vx, vy); if (n < 1e-4) { var th = TAU * Math.random(); vx = Math.cos(th); vy = Math.sin(th); n = 1; } PX[NP] = QX[k]; PY[NP] = QY[k]; PVX[NP] = VPI * vx / n; PVY[NP] = VPI * vy / n; PA[NP] = k; PB[NP] = p; PGN[NP] = 0; QPI[k] = NP; QPI[p] = NP; NP++; QS[k] = 2; QS[p] = 2; }
        } else if (st === 3) {
          h = QP[k]; QT[k] += dt; dxy(QX[k], QY[k], HX[h], HY[h]); var th2 = Math.max(tbind, Math.hypot(DDX, DDY) / (2 * V)), fh = Math.min(1, dt / Math.max(0.02, th2 - QT[k]));
          QX[k] = wrap(QX[k] + DDX * fh); QY[k] = wrap(QY[k] + DDY * fh);
          if (QT[k] >= th2) QS[k] = 4;
        }
      }
      for (k = 0; k < NP; k++) { PX[k] = wrap(PX[k] + PVX[k] * dt); PY[k] = wrap(PY[k] + PVY[k] * dt); }
      for (k = 0; k < NG; k++) {   // gluons: free ones roam (and fade once the plasma is gone), flying ones home in and are absorbed
        GPH[k] += 9 * dt;
        if (GS[k] === 0) { GX[k] = wrap(GX[k] + GVX[k] * dt); GY[k] = wrap(GY[k] + GVY[k] * dt); GA[k] += ((hot ? 1 : 0) - GA[k]) * Math.min(1, 3 * dt); continue; }
        if (GS[k] !== 1) continue;
        var code = GT[k], tx, ty, alive = true, formed = true, q2 = code;
        if (code >= 0) { if (QS[q2] === 2 && QPI[q2] >= 0) { tx = PX[QPI[q2]]; ty = PY[QPI[q2]]; } else if (QS[q2] === 1) { tx = QX[q2]; ty = QY[q2]; formed = false; } else alive = false; }
        else { var hh = -code - 1; if (HQ[hh] !== -1) { tx = HX[hh]; ty = HY[hh]; } else alive = false; }
        if (!alive) { GS[k] = 0; gluonsSent--; continue; }
        dxy(GX[k], GY[k], tx, ty); var dd = Math.hypot(DDX, DDY);
        if (dd < 0.014) {
          if (!formed) { GX[k] = tx; GY[k] = ty; continue; }   // wait on the pair until it is a pion, so the gluon is stored and later re-emitted
          GS[k] = 2; GA[k] = 0; flash(tx, ty, 0);
          if (code >= 0) { var pi = QPI[q2]; if (pi >= 0 && PGN[pi] < 3) PG[pi * 3 + PGN[pi]++] = k; }
          else { var h3 = -code - 1; if (HGN[h3] < 3) HG[h3 * 3 + HGN[h3]++] = k; }
          continue;
        }
        var vg = fast ? 2 * VG : VG, sp = Math.min(vg * dt, dd); GVX[k] = VG * DDX / dd; GVY[k] = VG * DDY / dd; GX[k] = wrap(GX[k] + sp * DDX / dd); GY[k] = wrap(GY[k] + sp * DDY / dd);
      }
      for (h = 0; h < NH; h++) {
        var kick = HQ[h] !== -1 ? 0.03 * Math.sqrt(Math.min(1, T / TC)) : 0.004;
        HVX[h] = (HVX[h] + kick * gauss() * dt) * 0.995; HVY[h] = (HVY[h] + kick * gauss() * dt) * 0.995;
        HX[h] = wrap(HX[h] + HVX[h] * dt); HY[h] = wrap(HY[h] + HVY[h] * dt); HANG[h] += 2.2 * dt;
      }
      for (k = 0; k < NF; k++) if (FA[k] > 0) { FA[k] += dt; if (FA[k] > 0.4) FA[k] = 0; }
    }

    // 0 deconfined, 1 confining, 2 confined, 3 melting, 4 partly confined (parked inside the crossover)
    function phase() { var w = want(); if (Math.abs(w - fb) > 0.02) return w > fb ? 1 : 3; if (actT > 0) return actDir > 0 ? 1 : 3; return w < 0.01 ? 0 : w > 0.99 ? 2 : 4; }
    function fmtT(t) { return t >= 9.95 ? '10' : t >= 1 ? t.toFixed(1) : t >= 0.1 ? t.toFixed(2) : t.toFixed(3); }
    function fmtDeg(t) {   // the everyday anchor: 1 MeV is about 12 billion degrees; two significant figures
      var k = t * K_PER_MEV, bil = k >= 9.95e8, v = k / (bil ? 1e9 : 1e6), p = Math.pow(10, Math.floor(Math.log10(v)) - 1), r = Math.round(v / p) * p;
      return '≈ ' + (r >= 10 ? String(Math.round(r)) : r.toFixed(1)) + (bil ? ' billion' : ' million') + ' degrees';
    }
    function showT() { setOut(out, fmtT(T) + ' MeV'); setOut(outDeg, fmtDeg(T)); }
    function heating() { return anim ? anim.to > anim.from : false; }
    function updateBtn() { if (btn) setOut(btn, (anim ? anim.to < anim.from : want() > 0.5) ? 'Heat' : 'Cool'); }   // always the action a press will take

    /* ---------------- drawing ---------------- */
    var LAY = { ox: 0, oy: 0, side: 0, narrow: false, B: { x: 0, y: 0, w: 0, h: 0 } }, BOXR = { x: 0, y: 0, w: 0, h: 0 }, HIT = { on: false, x0: 0, x1: 0, y0: 0, y1: 0 };
    var RP = { x: 0, y: 0, w: 0, h: 0 }, RL = { x: 0, y: 0, w: 0, h: 0 }, RN = { x: 0, y: 0, w: 0, h: 0 }, RC = { x: 0, y: 0, w: 0, h: 0 };   // chips: phase, legend, hint, callout
    var CX0 = 0, CPW = 1, CYA = 0, CCH = 1;   // the curve's frame (Details)
    function layout(W, H) {   // side by side on wide stages, the box on top of the panel on phones
      var pad = 12, gap = 12, B = LAY.B; LAY.narrow = W < 520;
      if (H <= W) { var w = (W - 2 * pad - gap) / 2, side = Math.min(w, H - 2 * pad); LAY.side = side; LAY.ox = pad + (w - side) / 2; LAY.oy = pad + (H - 2 * pad - side) / 2; B.x = pad + w + gap; B.y = pad; B.w = w; B.h = H - 2 * pad; }
      else { var s2 = Math.min(W - 2 * pad, H - 2 * pad - gap - 140); LAY.side = s2; LAY.ox = (W - s2) / 2; LAY.oy = pad; B.x = pad; B.y = pad + s2 + gap; B.w = W - 2 * pad; B.h = H - 2 * pad - gap - s2; }
      BOXR.x = LAY.ox; BOXR.y = LAY.oy; BOXR.w = LAY.side; BOXR.h = LAY.side;
    }
    function setR(r, x, y, w, h) { r.x = x; r.y = y; r.w = w; r.h = h; return r; }
    function mix(hex, a) { var c = E.hexRGB(hex), b = E.hexRGB(C.bg); return 'rgb(' + Math.round(b[0] + (c[0] - b[0]) * a) + ',' + Math.round(b[1] + (c[1] - b[1]) * a) + ',' + Math.round(b[2] + (c[2] - b[2]) * a) + ')'; }   // an opaque fade toward the panel
    function hits(a, b) { return a.w > 0 && b.w > 0 && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
    function chip(r) { g.fillStyle = rgba(C.bg, 0.95); g.beginPath(); if (g.roundRect) g.roundRect(r.x, r.y, r.w, r.h, 4); else g.rect(r.x, r.y, r.w, r.h); g.fill(); }
    function measureChip(r, text, x, y, size, align) { var w = textW(g, text, { size: size }), x0 = align === 'right' ? x - w : x; return setR(r, x0 - 5, y - size - 2, w + 10, size + 7); }
    function flush(r, ox, oy, side) {   // an edge chip reaches the box border, so nothing peeks out between them
      if (r.x - ox < 9) { r.w += r.x - ox - 1; r.x = ox + 1; }
      if (ox + side - (r.x + r.w) < 9) r.w = ox + side - 1 - r.x;
      if (r.y - oy < 9) { r.h += r.y - oy - 1; r.y = oy + 1; }
      if (oy + side - (r.y + r.h) < 9) r.h = oy + side - 1 - r.y;
    }
    function pick(list, maxW, size, mono) { for (var i = 0; i < list.length; i++) if (textW(g, list[i], { size: size, mono: mono }) <= maxW) return list[i]; return list[list.length - 1]; }
    function pickSeg(list, maxW, size) { for (var i = 0; i < list.length; i++) if (richW(g, list[i], size) <= maxW) return list[i]; return list[list.length - 1]; }
    function drawGluons(ox, oy, side) {
      g.beginPath();
      for (var k = 0; k < NG; k++) {
        if (GA[k] < 0.03 || GS[k] === 2) continue;
        var x = ox + GX[k] * side, y = oy + GY[k] * side, n = Math.hypot(GVX[k], GVY[k]) || 1, ux = GVX[k] / n, uy = GVY[k] / n, L = 5.5, A = 1.6 * GA[k];
        for (var i = 0; i <= 4; i++) { var t = i / 4 - 0.5, w = A * Math.sin(GPH[k] + i * 1.9), px = x + ux * t * L * 2 - uy * w, py = y + uy * t * L * 2 + ux * w; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
      }
      g.stroke();
    }

    var PH = [['deconfined: quarks and gluons', 'deconfined'], ['confining: gluons feed the bound states', 'confining…'], ['confined: pions and heavy mesons', 'confined'],
              ['melting: bound states release gluons', 'melting…'], ['partly confined: some quarks still free', 'partly confined']];
    var LG = [['dots: light quarks, wiggles: gluons, big: heavy quarks', 'dots: quarks, wiggles: gluons, big: heavy quarks', 'dots: quarks, wiggles: gluons'],
              ['red line: quarks pairing, red ring: a gluon absorbed', 'red line: quarks pair, ring: gluon absorbed', 'ring: a gluon absorbed'],
              ['red: dark pions (the radiation), big: heavy mesons', 'red: dark pions, big: heavy mesons', 'red: pions, big: heavy mesons'],
              ['grey ring: a gluon released, red: dark pions', 'grey ring: gluon released, red: pions', 'ring: a gluon released'],
              ['red: dark pions, dots: free quarks, big: heavy mesons', 'red: pions, dots: free quarks, big: mesons', 'red: pions, dots: free quarks']];

    // the "heavy meson = dark matter" callout: a spot beside one dressed meson that touches no other meson and no other label
    var callH = -1, callC = 0;
    function dressed(h) { return HQ[h] !== -1 && QS[HQ[h]] === 4; }
    function callRoom(h, c, cw, ch, ox, oy, side) {   // c: 0 right of the meson, 1 left of it, 2 centred above, 3 centred below. Sets RC; returns the room to the
      var hx = ox + HX[h] * side, hy = oy + HY[h] * side;   // nearest other meson, or -1 when the spot leaves the box or covers another label
      var x = c === 0 ? hx + 20 : c === 1 ? hx - 20 - cw : hx - cw / 2, y = c < 2 ? hy - ch / 2 : c === 2 ? hy - 20 - ch : hy + 20, m = 1e9;
      setR(RC, x, y, cw, ch);
      if (x < ox + 4 || y < oy + 4 || x + cw > ox + side - 4 || y + ch > oy + side - 4) return -1;
      if (hits(RC, RP) || hits(RC, RL) || hits(RC, RN)) return -1;
      for (var j = 0; j < NH; j++) { if (j === h) continue; var jx = ox + HX[j] * side, jy = oy + HY[j] * side, nx = Math.max(x, Math.min(jx, x + cw)) - jx, ny = Math.max(y, Math.min(jy, y + ch)) - jy, d2 = nx * nx + ny * ny; if (d2 < m) m = d2; }
      return Math.sqrt(m);
    }
    function callout(ox, oy, side, narrow) {
      var l1 = narrow ? 'dark matter: a heavy quark' : 'heavy meson = dark matter', l2 = narrow ? 'holding a light one' : 'a heavy quark holding a light one';
      var cw = Math.max(textW(g, l1, { size: 12 }), textW(g, l2, { size: 11 })) + 12, ch = 34, h, c;
      var cur = callH >= 0 && dressed(callH) ? callRoom(callH, callC, cw, ch, ox, oy, side) : -1;
      if (cur < 30) {   // crowded or gone: move to the roomiest spot, a few px better than here so it does not flicker between two
        var best = cur + 4, bh = -1, bc = 0;
        for (h = 0; h < NH; h++) { if (!dressed(h)) continue; for (c = 0; c < 4; c++) { var r = callRoom(h, c, cw, ch, ox, oy, side); if (r > best) { best = r; bh = h; bc = c; } } }
        if (bh >= 0) { callH = bh; callC = bc; } else if (cur < 0) { callH = -1; return; }
      }
      callRoom(callH, callC, cw, ch, ox, oy, side);
      var hx = ox + HX[callH] * side, hy = oy + HY[callH] * side, ex = Math.max(RC.x, Math.min(hx, RC.x + RC.w)), ey = Math.max(RC.y, Math.min(hy, RC.y + RC.h)), el = Math.hypot(ex - hx, ey - hy);
      if (el > 13) { g.strokeStyle = rgba(C.text2, 0.8); g.beginPath(); g.moveTo(hx + (ex - hx) * 12.5 / el, hy + (ey - hy) * 12.5 / el); g.lineTo(ex, ey); g.stroke(); }   // a short leader from the halo to the chip
      chip(RC);
      label(g, l1, RC.x + 6, RC.y + 14, { size: 12, color: C.text });
      label(g, l2, RC.x + 6, RC.y + 28, { size: 11, color: C.text2 });
    }

    function drawBox() {
      var ox = LAY.ox, oy = LAY.oy, side = LAY.side, narrow = LAY.narrow, k, h, grey = C.text2, fs = 12, inner = side - 16;
      E.box(g, BOXR);
      g.save(); g.beginPath(); g.rect(ox, oy, side, side); g.clip();
      g.strokeStyle = rgba(C.text3, 0.9); g.lineWidth = 1.1; drawGluons(ox, oy, side); g.lineWidth = 1;
      var nq = 0; for (k = 0; k < NQ; k++) { if (QS[k] > 1) continue; DX[nq] = ox + QX[k] * side; DY[nq] = oy + QY[k] * side; nq++; }
      E.dots(g, DX, DY, nq, 2.6, grey);
      g.strokeStyle = rgba(C.accent, 0.8); g.beginPath();
      for (k = 0; k < NQ; k++) { if (QS[k] !== 1 || QP[k] < k) continue; var p = QP[k]; dxy(QX[k], QY[k], QX[p], QY[p]); if (Math.abs(DDX) < 0.12 && Math.abs(DDY) < 0.12) { g.moveTo(ox + QX[k] * side, oy + QY[k] * side); g.lineTo(ox + (QX[k] + DDX) * side, oy + (QY[k] + DDY) * side); } }
      g.stroke();
      for (k = 0; k < NP; k++) { DX[k] = ox + PX[k] * side; DY[k] = oy + PY[k] * side; }
      E.dots(g, DX, DY, NP, 3.4, C.accent);
      for (h = 0; h < NH; h++) {
        var hx = ox + HX[h] * side, hy = oy + HY[h] * side, dr = dressed(h);
        if (dr) { g.fillStyle = rgba(C.accent, 0.16); g.beginPath(); g.arc(hx, hy, 12, 0, TAU); g.fill(); }
        g.fillStyle = C.text; g.beginPath(); g.arc(hx, hy, 5.5, 0, TAU); g.fill();
        if (dr) { g.fillStyle = grey; g.beginPath(); g.arc(hx + 8 * Math.cos(HANG[h]), hy + 8 * Math.sin(HANG[h]), 1.6, 0, TAU); g.fill(); }
      }
      for (k = 0; k < NF; k++) if (FA[k] > 0) { var fa = 1 - FA[k] / 0.4, fr = (3 + 16 * (1 - fa)) * Math.max(0.6, Math.min(1, side / 400)); g.strokeStyle = rgba(FK[k] ? C.text2 : C.accent, 0.8 * fa); g.lineWidth = 1.5; g.beginPath(); g.arc(ox + FX[k] * side, oy + FY[k] * side, fr, 0, TAU); g.stroke(); }
      g.lineWidth = 1;

      // labels, each on an opaque chip so no particle runs through the text
      var ph = phase(), w = want();
      var hint = anim ? (heating() ? 'heating…' : 'cooling…') : (!boxTapped && fastT <= 0 && !scrub) ? (COARSE ? 'tap to ' : 'click or tap to ') + (w > 0.5 ? 'heat' : 'cool') : '';
      var hw = hint ? textW(g, hint, { size: fs }) : 0, pt = pick(PH[ph], inner - (hw ? hw + 20 : 0), fs), same = textW(g, pt, { size: fs }) + 20 + hw <= inner;
      var lt = pick(LG[ph], inner, fs), hy0 = oy + 19 + (same ? 0 : 22);
      flush(measureChip(RP, pt, ox + 8, oy + 19, fs, 'left'), ox, oy, side); flush(measureChip(RL, lt, ox + 8, oy + side - 10, fs, 'left'), ox, oy, side);
      if (hint) flush(measureChip(RN, hint, ox + side - 8, hy0, fs, 'right'), ox, oy, side); else RN.w = 0;
      if (fb > 0.3) callout(ox, oy, side, narrow); else callH = -1;
      chip(RP); label(g, pt, ox + 8, oy + 19, { size: fs, color: ph === 0 ? C.text2 : C.accent });
      chip(RL); label(g, lt, ox + 8, oy + side - 10, { size: fs, color: C.text2 });
      if (hint) { chip(RN); label(g, hint, ox + side - 8, hy0, { size: fs, color: anim ? C.accent : C.text2, align: 'right' }); }
      g.restore();
    }

    // default view: the one before/after pair of extra radiation
    var GLOSS = ['it speeds up the young universe’s expansion', 'it speeds up the young universe', 'it speeds up expansion'];
    function drawBig(B, narrow) {
      var px0 = B.x + 16, pw = B.w - 32, ts = narrow ? 13 : 14, y1 = B.y + (narrow ? 23 : 30);
      label(g, pick(['extra radiation in the early universe', 'extra radiation, early universe'], pw, ts), px0, y1, { size: ts, color: C.text });
      label(g, pick(GLOSS, pw, 12), px0, y1 + 18, { size: 12, color: C.text2 });
      var bot = B.y + B.h - (narrow ? 30 : 44), top = y1 + (narrow ? 52 : 74), hmax = Math.max(40, Math.min(narrow ? 200 : 250, bot - top));
      var bw = Math.min(narrow ? 46 : 62, pw * 0.2), cxB = px0 + pw * (narrow ? 0.2 : 0.24), cxA = px0 + pw * (narrow ? 0.8 : 0.76), xb = cxB - bw / 2, xa = cxA - bw / 2;
      var aB = 1 - 0.7 * fb, aA = 0.3 + 0.7 * fb, hb = hmax * DN_BEFORE / DN_AFTER, ha = hmax, vs = narrow ? 14 : 16, ns = narrow ? 12 : 13;
      g.strokeStyle = C.border; g.beginPath(); g.moveTo(px0, bot + 0.5); g.lineTo(px0 + pw, bot + 0.5); g.stroke();
      g.fillStyle = mix(C.text2, 0.85 * aB); g.fillRect(xb, bot - hb, bw, hb);
      g.fillStyle = mix(C.accent, aA); g.fillRect(xa, bot - ha, bw, ha);
      label(g, DN_BEFORE.toFixed(2), cxB, bot - hb - 8, { size: vs, mono: true, color: C.text, align: 'center' });
      label(g, DN_AFTER.toFixed(2), cxA, bot - ha - 8, { size: vs, mono: true, color: C.accent, align: 'center' });
      label(g, 'before cooling', cxB, bot + (narrow ? 18 : 22), { size: ns, color: C.text2, align: 'center' });
      label(g, 'after cooling', cxA, bot + (narrow ? 18 : 22), { size: ns, color: C.text2, align: 'center' });
      // the reheat: an arrow from the before level up to the after level
      var x0 = xb + bw + 12, x1 = xa - 12, yb = bot - hb, yt = bot - ha + 10;
      g.strokeStyle = rgba(C.accent, 0.9); g.lineWidth = 1.5; g.beginPath(); g.moveTo(x0, yb); g.quadraticCurveTo(x1 - 6, yb, x1 - 2, yt + 2); g.stroke();
      g.fillStyle = rgba(C.accent, 0.9); g.beginPath(); g.moveTo(x1 - 2, yt - 3); g.lineTo(x1 - 7, yt + 7); g.lineTo(x1 + 3, yt + 6); g.closePath(); g.fill(); g.lineWidth = 1;
      var mxp = (x0 + x1) / 2 - (narrow ? 12 : 8), l2y = narrow ? Math.min(yb - 16, yt + 16) : Math.min(yb - 12, yt + 40), l1y = l2y - (narrow ? 17 : 20);   // the curve hugs the before level, so the words sit above it
      label(g, '×' + REHEAT.toFixed(2), mxp, l1y, { size: narrow ? 14 : 16, mono: true, color: C.accent, align: 'center' });
      label(g, 'pions reheated', mxp, l2y, { size: 12, color: C.text2, align: 'center' });
    }

    function xT(t) { return CX0 + sOf(t) * CPW; }
    function yG(gg) { return CYA - 4 - CCH * (gg / 40); }
    var TICKS = [[0.01, '0.01', 'left'], [0.1, '0.1', 'center'], [1, '1', 'center'], [10, '10 MeV', 'right']];
    function tickSpan(i) { var t = TICKS[i], w = textW(g, t[1], { size: 11, mono: true }), x = xT(t[0]); return t[2] === 'left' ? [x, x + w] : t[2] === 'right' ? [x - w, x] : [x - w / 2, x + w / 2]; }
    // Details: the g(T) curve with the BBN window, the 37 -> 3 count and the extra radiation with its value while the first nuclei form
    function drawDetails(B, narrow) {
      var px0 = B.x + 14, pw = B.w - 28, fs = 12, curveH = narrow ? 32 : 42, yTop = B.y + 20, yc0 = yTop + 12, ya = yc0 + curveH + 4, cold = fb > 0.5, i;
      CX0 = px0 + 24; CPW = pw - 24; CYA = ya; CCH = curveH;   // the curve leaves room on its left for the g scale (37 and 3)
      label(g, narrow ? 'pions + mesons' : 'pions + heavy mesons', px0, yTop, { size: fs, color: cold ? C.accent : C.text2 });
      label(g, 'quarks + gluons', px0 + pw, yTop, { size: fs, color: cold ? C.text2 : C.text, align: 'right' });
      // BBN window on the dark-temperature axis, with a bracket and its name under the tick labels
      var bx0 = xT(bbn.tdLo), bx1 = xT(bbn.tdHi), BAND = rgba(C.text3, C.dark ? 0.22 : 0.16);
      g.fillStyle = BAND; g.fillRect(bx0, yc0 - 2, bx1 - bx0, ya - yc0 + 2);
      var yk = ya + 21; g.strokeStyle = C.text3; g.beginPath(); g.moveTo(bx0 + 0.5, yk - 4); g.lineTo(bx0 + 0.5, yk + 0.5); g.lineTo(bx1 + 0.5, yk + 0.5); g.lineTo(bx1 + 0.5, yk - 4); g.stroke();
      var bl = 'first nuclei form (BBN)', blw = textW(g, bl, { size: fs }), blx = Math.max(CX0 + blw / 2, Math.min(px0 + pw - blw / 2, (bx0 + bx1) / 2));
      label(g, bl, blx, yk + 15, { size: fs, color: C.text2, align: 'center' });
      // the stitched crossover g(T)
      g.strokeStyle = rgba(C.text2, 0.95); g.lineWidth = 1.5; g.beginPath();
      for (var ci = 0; ci <= 120; ci++) { var tt = tempOf(ci / 120), gy = yG(gRho(tt, TC)); if (ci === 0) g.moveTo(xT(tt), gy); else g.lineTo(xT(tt), gy); }
      g.stroke(); g.lineWidth = 1;
      g.strokeStyle = C.borderStrong; g.beginPath(); g.moveTo(CX0, ya + 0.5); g.lineTo(px0 + pw, ya + 0.5); g.stroke();
      label(g, '37', CX0 - 10, yG(G_UV) + 4, { size: 11, mono: true, color: C.text2, align: 'right' }); label(g, '3', CX0 - 10, yG(G_IR) + 3, { size: 11, mono: true, color: C.text2, align: 'right' });
      [0.01, 0.03, 0.1, 0.3, 1, 3, 10].forEach(function (t) { g.beginPath(); g.moveTo(xT(t) + 0.5, ya - 3); g.lineTo(xT(t) + 0.5, ya + 3); g.stroke(); });
      var lx = xT(TC);
      g.strokeStyle = C.text2; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(lx + 0.5, yc0 - 4); g.lineTo(lx + 0.5, ya + 4); g.stroke(); g.setLineDash([]);
      // the Λd name sits under its dashed line, nudged left or right of it before any tick label is dropped
      var lw = richW(g, SEG_LD, fs), cands = [lx - lw / 2, lx - lw - 3, lx + 3], best = -1, l0 = 0;
      for (var c = 0; c < 3 && best < 0; c++) { var a0 = Math.max(CX0, Math.min(px0 + pw - lw, cands[c])), clash = false; for (i = 0; i < TICKS.length; i++) { var sp = tickSpan(i); if (a0 - 4 < sp[1] && sp[0] < a0 + lw + 4) clash = true; } if (!clash) { best = c; l0 = a0; } }
      if (best < 0) l0 = Math.max(CX0, Math.min(px0 + pw - lw, cands[0]));
      for (i = 0; i < TICKS.length; i++) { var s2 = tickSpan(i); if (l0 - 4 < s2[1] && s2[0] < l0 + lw + 4) continue; label(g, TICKS[i][1], xT(TICKS[i][0]), ya + 15, { size: 11, mono: true, color: C.text2, align: TICKS[i][2] }); }
      rich(g, SEG_LD, l0, ya + 15, fs, C.text, 'left');
      // the marker: where the box is now (drag along the curve to set the temperature)
      var gr = gRho(T, TC), mx = xT(T), my = yG(gr);
      g.fillStyle = C.accent; g.beginPath(); g.arc(mx, my, 4.5, 0, TAU); g.fill();
      var gl = 'g = ' + Math.round(gr), glw = textW(g, gl, { size: fs, mono: true }), left = mx < lx;
      if (left && mx - 9 - glw < CX0) left = false; else if (!left && mx + 9 + glw > px0 + pw) left = true;
      var glx = left ? mx - 9 : mx + 9, gly = my < ya - curveH / 2 ? my + 16 : my - 8;
      setR(RC, (left ? glx - glw : glx) - 4, gly - fs - 1, glw + 8, fs + 5); g.fillStyle = rgba(C.bg, 0.95); g.fillRect(RC.x, RC.y, RC.w, RC.h);
      label(g, gl, glx, gly, { size: fs, mono: true, color: C.accent, align: left ? 'right' : 'left' });
      HIT.on = true; HIT.x0 = CX0; HIT.x1 = CX0 + CPW; HIT.y0 = yc0 - 10; HIT.y1 = ya + 8;

      // the two counts: kinds sharing the heat (g) and the extra radiation, before and after cooling
      var yb0 = ya + (narrow ? 58 : 62), bot = B.y + B.h - (narrow ? 66 : 70), top = yb0 + 36, hmax = Math.max(30, bot - top);
      var aB = 1 - 0.7 * fb, aA = 0.3 + 0.7 * fb, g1w = pw * 0.56, gx2 = px0 + pw * 0.6, g2w = pw * 0.4;
      label(g, pick(['kinds of particle sharing the heat, g', 'kinds sharing the heat, g'], g1w - 4, fs), px0, yb0, { size: fs, color: C.text });
      label(g, pick(['heavy mesons: too heavy to count', 'heavy mesons don’t count'], g1w - 4, 11), px0, yb0 + 15, { size: 11, color: C.text2 });
      var bw1 = Math.min(34, g1w * 0.17), xb1 = px0 + g1w * 0.04, xa1 = px0 + g1w * 0.62, h0 = hmax * 16 / G_UV, h1 = hmax * 21 / G_UV, h3 = Math.max(2, hmax * G_IR / G_UV);
      g.strokeStyle = C.border; g.beginPath(); g.moveTo(px0, bot + 0.5); g.lineTo(px0 + g1w, bot + 0.5); g.stroke();
      g.fillStyle = mix(C.text3, 0.12 + 0.5 * aB); g.fillRect(xb1, bot - h0, bw1, h0);
      g.fillStyle = mix(C.text2, 0.12 + 0.7 * aB); g.fillRect(xb1, bot - h0 - h1, bw1, h1);
      label(g, '37', xb1 + bw1 / 2, bot - hmax - 6, { size: fs, mono: true, color: C.text, align: 'center' });
      if (hmax > 56) { label(g, '21 quarks', xb1 + bw1 + 5, bot - h0 - h1 / 2 + 4, { size: 11, color: C.text2 }); label(g, '16 gluons', xb1 + bw1 + 5, bot - h0 / 2 + 4, { size: 11, color: C.text2 }); }
      g.fillStyle = mix(C.accent, aA); g.fillRect(xa1, bot - h3, bw1, h3);
      label(g, '3', xa1 + bw1 / 2, bot - h3 - 6, { size: fs, mono: true, color: C.accent, align: 'center' });
      label(g, 'pions', xa1 + bw1 + 5, bot - 1, { size: 11, color: C.text2 });
      // extra radiation, with the band of values while the first nuclei form (the same grey as the window above)
      rich(g, pickSeg(SEG_RAD, g2w, fs), gx2, yb0, fs, C.text, 'left');
      label(g, pick(['pions reheated ×' + REHEAT.toFixed(2), 'reheated ×' + REHEAT.toFixed(2)], g2w, 11), gx2, yb0 + 15, { size: 11, color: C.accent });
      var bw2 = Math.min(34, g2w * 0.22), xb2 = gx2 + g2w * 0.04, xa2 = gx2 + g2w * 0.46, sc = hmax / (DN_AFTER * 1.05);
      var yv0 = bot - bbn.dnLo * sc, yv1 = bot - bbn.dnHi * sc; if (yv1 - yv0 < 3) { var ym = (yv0 + yv1) / 2; yv0 = ym - 1.5; yv1 = ym + 1.5; }
      g.fillStyle = BAND; g.fillRect(xb2 - 6, yv0, xa2 + bw2 + 3 - (xb2 - 6), yv1 - yv0);
      g.strokeStyle = C.border; g.beginPath(); g.moveTo(gx2, bot + 0.5); g.lineTo(gx2 + g2w, bot + 0.5); g.stroke();
      g.fillStyle = mix(C.text2, 0.12 + 0.73 * aB); g.fillRect(xb2, bot - DN_BEFORE * sc, bw2, DN_BEFORE * sc);
      g.fillStyle = mix(C.accent, aA); g.fillRect(xa2, bot - DN_AFTER * sc, bw2, DN_AFTER * sc);
      label(g, DN_BEFORE.toFixed(2), xb2 + bw2 / 2, bot - DN_BEFORE * sc - 6, { size: fs, mono: true, color: C.text, align: 'center' });
      label(g, DN_AFTER.toFixed(2), xa2 + bw2 / 2, bot - DN_AFTER * sc - 6, { size: fs, mono: true, color: C.accent, align: 'center' });
      label(g, 'BBN', xa2 + bw2 + 5, Math.max(bot - DN_AFTER * sc + 4, Math.min(bot - 4, (yv0 + yv1) / 2 + 4)), { size: 11, color: C.text2 });
      // names under the four bars
      var n1 = bot + 15, n2 = bot + 28;
      [xb1 + bw1 / 2, xa1 + bw1 / 2, xb2 + bw2 / 2, xa2 + bw2 / 2].forEach(function (x, j) { label(g, j % 2 ? 'after' : 'before', x, n1, { size: fs, color: C.text2, align: 'center' }); label(g, 'cooling', x, n2, { size: fs, color: C.text2, align: 'center' }); });
      rich(g, pickSeg(SEG_FOOT, pw, 11), px0, B.y + B.h - 23, 11, C.text2, 'left');
      rich(g, pickSeg(SEG_WIN, pw, 11), px0, B.y + B.h - 9, 11, C.text2, 'left');
    }

    function draw() {
      var W = S.W, H = S.H; if (!W) return;
      g.fillStyle = C.surface; g.fillRect(0, 0, W, H);
      layout(W, H);
      drawBox();
      E.box(g, LAY.B);
      HIT.on = false;
      if (detailsOpen()) drawDetails(LAY.B, LAY.narrow); else drawBig(LAY.B, LAY.narrow);
    }

    /* ---------------- controls ---------------- */
    function stillRun() { for (var i = 0; i < 240; i++) step(1 / 60); if (run) run.redraw(); }
    function setS(v) { sv = Math.max(0, Math.min(1, v)); T = tempOf(sv); range.value = sv.toFixed(3); showT(); updateBtn(); if (RM) stillRun(); else if (run) { run.wake(); run.redraw(); } }
    function coolTo() { return Math.max(0.01, Math.min(0.1, TC / 10)); }   // cool well below Lambda_d, so every scale ends confined
    function toggle() {   // heat or cool; pressed mid-animation it reverses
      var heat = anim ? anim.to < anim.from : want() > 0.5, to = heat ? 1 : sOf(coolTo());
      actT = 0;   // the label follows the new direction at once
      if (RM) { anim = null; setS(to); return; }
      anim = { from: sv, to: to, t: 0, dur: Math.max(1, 3 * Math.abs(to - sv) / 0.67) };
      updateBtn(); if (run) run.wake();
    }
    var detailsOpen = E.more(fig, function () { if (run) { run.wake(); run.redraw(); } });

    reset(); updateBBN();
    run = E.loop(cv, step, draw, function () { if (!RM) { anim = { from: sv, to: sOf(coolTo()), t: -0.25, dur: 6 }; updateBtn(); } }, { drawEvery: 2 });   // arrival: a slow cool from 10 MeV through Lambda_d
    S.onresize = function () { run.wake(); run.redraw(); }; E.onTheme.push(run.redraw);
    range.addEventListener('input', function () { anim = null; fastT = 0.5; setS(+range.value); });
    if (rangeTc) rangeTc.addEventListener('input', function () { TC = Math.pow(10, +rangeTc.value - 6); setOut(outTc, fmtT(TC) + ' MeV'); fastT = 0.5; updateBBN(); updateBtn(); if (RM) stillRun(); else { run.wake(); run.redraw(); } });
    if (btn) btn.addEventListener('click', toggle);

    // pointer: a tap on the box heats or cools it; with Details open, a press or a sideways drag on the curve sets the temperature
    var tap = null, lastToggle = -1e9, PT = { x: 0, y: 0 };
    function local(e) { var r = cv.getBoundingClientRect(); PT.x = e.clientX - r.left; PT.y = e.clientY - r.top; return PT; }
    function inBox(p) { return p.x >= LAY.ox && p.x <= LAY.ox + LAY.side && p.y >= LAY.oy && p.y <= LAY.oy + LAY.side; }
    function onCurve(p) { return HIT.on && detailsOpen() && p.x >= HIT.x0 - 8 && p.x <= HIT.x1 + 8 && p.y >= HIT.y0 && p.y <= HIT.y1; }
    function scrubTo(x) { anim = null; fastT = 0.5; setS((x - HIT.x0) / (HIT.x1 - HIT.x0)); }
    function boxTap() { var now = performance.now(); if (now - lastToggle < 400) return; lastToggle = now; boxTapped = true; toggle(); }
    cv.addEventListener('pointerdown', function (e) {
      var p = local(e); tap = [e.clientX, e.clientY, performance.now()];
      if (onCurve(p)) { scrub = { x: e.clientX, y: e.clientY, on: e.pointerType === 'mouse' }; if (scrub.on) { scrubTo(p.x); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ } } }
      run.wake();
    });
    cv.addEventListener('pointermove', function (e) {
      var p = local(e);
      if (scrub) {
        var ax = Math.abs(e.clientX - scrub.x), ay = Math.abs(e.clientY - scrub.y);
        if (!scrub.on && ax > 6 && ax > ay) { scrub.on = true; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ } }
        if (scrub.on) { scrubTo(p.x); return; }
      }
      if (e.pointerType === 'mouse') cv.style.cursor = onCurve(p) ? 'ew-resize' : inBox(p) ? 'pointer' : '';
    });
    cv.addEventListener('pointerup', function (e) {
      var p = local(e), sc = scrub; scrub = null;
      if (!tap) return; var moved = Math.hypot(e.clientX - tap[0], e.clientY - tap[1]), dtms = performance.now() - tap[2]; tap = null;
      if (sc) { if (!sc.on && moved <= 8) scrubTo(p.x); return; }
      if (moved <= 8 && dtms <= 600 && inBox(p)) boxTap();
    });
    cv.addEventListener('click', function (e) { if (inBox(local(e))) boxTap(); });   // a plain click works too (de-duplicated with the tap)
    cv.addEventListener('pointercancel', function () { tap = null; scrub = null; });
    showT(); setOut(outTc, fmtT(TC) + ' MeV'); updateBtn();
    if (RM) stillRun();
  }

  function init() { demoDarkQCD(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
