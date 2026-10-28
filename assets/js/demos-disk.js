/* Fig. 1 Weighing the disk with bobbing stars (split out of demos.js on 2026-10-28; final adjustment round 2026-10-28).
   Needs demos.js and demos-data.js loaded first. The model's physics and the model view's behaviour are untouched;
   this round changed words, labels, cues and the Gaia view's colour key and readout. */
(function () {
  'use strict';
  var E = window.EPDemos, H = window.EPDemosHelpers; if (!E || !H) return;
  var C = E.C, rgba = E.rgba, gauss = E.gauss, makeCanvas = E.makeCanvas, loop = E.loop, onTheme = E.onTheme;
  var label = E.label, textW = E.textW, dots = E.dots, box = E.box, twoPanels = E.twoPanels, setOut = E.setOut, KPC_KMS = E.KPC_KMS, G = E.G, R0 = E.R0;
  var TAU = Math.PI * 2, GEV = 2.6318e7;   // Msun/kpc^3 per GeV/cm^3
  var fetchJSON = H.fetchJSON, whenNear = H.whenNear, note = H.note, diverge = H.diverge;

  /* =====================================================================
     1. Weighing the disk: stars bobbing through the Galactic plane
     ===================================================================== */
  function demoDisk() {
    var fig = document.getElementById('demo-disk'); if (!fig) return;
    var cv = fig.querySelector('canvas'), S = makeCanvas(cv), g = S.ctx;
    var range = fig.querySelector('[data-ctl="rho"]'), out = fig.querySelector('[data-out="rho"]'), gloss = fig.querySelector('[data-out="rhogloss"]');
    var kickBtn = fig.querySelector('[data-ctl="nudge"]'), settleBtn = fig.querySelector('[data-ctl="reset"]'), gaiaBtn = fig.querySelector('[data-ctl="gaia"]'), ffBtn = fig.querySelector('[data-ctl="ffwd"]');
    var views = fig.querySelectorAll('[data-view]'), gaiaView = fig.querySelector('[data-view="gaia"]'), seg = gaiaView && gaiaView.parentNode;
    var outSince = fig.querySelector('[data-out="since"]'), outBin = fig.querySelector('[data-out="bin"]');

    // Baryons: MilkyWayPotential (gala; Bovy 2015), the baryonic model ClearPotential compares against.
    var MN = { M: 6.8e10, a: 3.0, b: 0.28 }, BU = { M: 5.0e9, c: 1.0 }, NU = { M: 1.71e9, c: 0.07 };
    function phiB(z) {
      var s = Math.sqrt(z * z + MN.b * MN.b), q = MN.a + s, r = Math.sqrt(R0 * R0 + z * z);
      return -G * MN.M / Math.sqrt(R0 * R0 + q * q) - G * BU.M / (r + BU.c) - G * NU.M / (r + NU.c);
    }
    var phiB0 = phiB(0);
    function azB(z) {
      var s = Math.sqrt(z * z + MN.b * MN.b), q = MN.a + s, d = R0 * R0 + q * q, r = Math.sqrt(R0 * R0 + z * z);
      return -G * MN.M * q * z / (s * d * Math.sqrt(d))
        - G * BU.M * z / (r * (r + BU.c) * (r + BU.c))
        - G * NU.M * z / (r * (r + NU.c) * (r + NU.c));
    }
    function slab(rho) { return TAU * G * rho * GEV; }          // Phi_DM = 2 pi G rho z^2 for a locally uniform halo
    function phi(z, rho) { return phiB(z) - phiB0 + slab(rho) * z * z; }
    function az(z, rho) { return azB(z) - 2 * slab(rho) * z; }
    function nu(rho) { var e = 1e-3; return Math.sqrt(-(az(e, rho) - az(-e, rho)) / (2 * e)); }   // midplane vertical frequency, km/s/kpc

    var N = window.innerWidth < 520 ? 2000 : 3000, SIG = 22, V0 = 40;   // isothermal tracers, sigma_z = 22 km/s; the followed star crosses the plane at 40 km/s
    var X = new Float32Array(N), Z = new Float32Array(N), VX = new Float32Array(N), VZ = new Float32Array(N);
    var PX = new Float32Array(N), PY = new Float32Array(N);
    var TRN = 80, TRL = new Float32Array(TRN * 2), TZT = new Float32Array(TRN), ti = 0, tlen = 0;   // trails of the followed star (z, v_z) and of its twin (z)
    var zt = 0, vt = V0, vLaunch = V0;                         // the twin: the same launch in a galaxy with no dark matter
    var rho = +range.value, rhoNow = rho, nuNow = nu(rho);
    var TRM = 240, mvz = new Float32Array(TRM), mi = 0, vzAvg = 0, asymAvg = 0, state = 'settled';
    var THR_V = 4 * SIG / Math.sqrt(N), THR_A = 4 / Math.sqrt(N);
    var SH = [0.25, 0.5, 0.8, 9], shellC = new Float32Array(4), shellS = new Float32Array(4), shellN = new Int32Array(4);

    function sample(r) {   // equilibrium f ~ exp(-E/sigma^2): density exp(-Phi/sigma^2), Gaussian velocities
      var M = 500, zmax = 2.5, cdf = new Float64Array(M + 1), acc = 0, i, k;
      for (i = 0; i <= M; i++) { acc += Math.exp(-phi(-zmax + 2 * zmax * i / M, r) / (SIG * SIG)); cdf[i] = acc; }
      for (k = 1; k < N; k++) {
        var u = Math.random() * acc, lo = 0, hi = M;
        while (lo < hi) { var m = (lo + hi) >> 1; if (cdf[m] < u) lo = m + 1; else hi = m; }
        Z[k] = -zmax + 2 * zmax * (lo + Math.random() - 0.5) / M;
        VZ[k] = SIG * gauss(); X[k] = Math.random() * 5 - 2.5; VX[k] = 25 * gauss();
      }
      X[0] = -0.6; VX[0] = 0; Z[0] = 0; VZ[0] = V0; zt = 0; vt = V0;   // the followed star and its twin start together, crossing the plane
      mvz.fill(0); tlen = 0; state = 'settled'; nuNow = nu(r);
    }
    sample(rho);

    // ---- state shared by the physics, the drawing and the controls (all assigned before the loop first draws) ----
    var view = 'model', D = null, loading = false, tKick = -1, ff = 0, cued = false, cueNow = null, hover = -1, touchHover = false, slideT = 0, dirty = true;
    var NZ = 50, NV = 50, GZ = 0.27, GV = 18.7, SPR = 6, nStars = '', GF = { x: 0, y: 0, w: 0, h: 0 }, sinceShown = '', ffShown = null, settleShown = null, gaiaShown = null;
    var layer = document.createElement('canvas'), lg = layer.getContext('2d'), bar = document.createElement('canvas'), bg2 = bar.getContext('2d');
    var STRIP = 36, ZMAX = 1.6, ZMAX_STACK = 1.75, VMAX = 90;
    var RATE = 30 / KPC_KMS, FFX = 14, FF_MAX = 700;   // 30 Myr of Galactic time per real second; Skip ahead runs 14 times faster, for at most 700 Myr

    function leap(h) {   // one leapfrog step (kick-drift-kick) of every star and of the twin
      var k;
      for (k = 0; k < N; k++) {
        var v = VZ[k] + 0.5 * h * az(Z[k], rhoNow);
        var z = Z[k] + h * v;
        v += 0.5 * h * az(z, rhoNow);
        Z[k] = z; VZ[k] = v;
        var x = X[k] + h * VX[k]; if (x > 2.5) x -= 5; else if (x < -2.5) x += 5; X[k] = x;
      }
      var vv = vt + 0.5 * h * az(zt, 0); zt += h * vv; vt = vv + 0.5 * h * az(zt, 0);
    }
    function step(dt) {
      rhoNow += (rho - rhoNow) * Math.min(1, 3 * dt);
      var nuNew = nu(rhoNow), k;
      if (Math.abs(nuNew - nuNow) > 1e-6) {   // the cloud follows the changing potential adiabatically (actions conserved), so it stays settled
        var f = Math.sqrt(nuNow / nuNew);
        for (k = 1; k < N; k++) { Z[k] *= f; VZ[k] /= f; }
        nuNow = nuNew;
      }
      var h = dt * RATE, fast = ff > 0, passes = fast ? 2 : 1, hp = fast ? h * FFX / 2 : h;
      for (var p = 0; p < passes; p++) leap(hp);
      if (!fast) { TRL[ti * 2] = Z[0]; TRL[ti * 2 + 1] = VZ[0]; TZT[ti] = zt; ti = (ti + 1) % TRN; if (tlen < TRN) tlen++; }
      // equilibrium meter: net vertical motion (1 s average), up/down balance, and coherence within amplitude shells (a wound-up spiral)
      var sv = 0, up = 0; shellC.fill(0); shellS.fill(0); shellN.fill(0);
      for (k = 1; k < N; k++) {
        sv += VZ[k]; if (Z[k] > 0) up++;
        var a = Math.sqrt(Z[k] * Z[k] + (VZ[k] / nuNow) * (VZ[k] / nuNow)), th = Math.atan2(VZ[k] / nuNow, Z[k]), si = a < SH[0] ? 0 : a < SH[1] ? 1 : a < SH[2] ? 2 : 3;
        shellC[si] += Math.cos(th); shellS[si] += Math.sin(th); shellN[si]++;
      }
      mvz[mi] = sv / (N - 1); mi = (mi + 1) % TRM;
      var a1 = 0; for (var q = 1; q <= 60; q++) a1 += mvz[(mi - q + TRM) % TRM];
      vzAvg = a1 / 60; asymAvg = (2 * up - (N - 1)) / (N - 1);
      var hot = Math.abs(vzAvg) > THR_V || Math.abs(asymAvg) > THR_A, cold = Math.abs(vzAvg) < 0.5 * THR_V && Math.abs(asymAvg) < 0.5 * THR_A;
      var wound = false, calm = true;
      for (q = 0; q < 4; q++) { if (shellN[q] < 30) continue; var coh = Math.hypot(shellC[q], shellS[q]) / shellN[q], thr = 3 / Math.sqrt(shellN[q]); if (coh > 1.3 * thr) wound = true; if (coh > 0.8 * thr) calm = false; }
      if (hot) state = 'ringing'; else if (state === 'ringing' && cold) state = wound ? 'spiral' : 'settled'; else if (state === 'spiral' && calm) state = 'settled'; else if (state === 'settled' && wound) state = 'spiral';
      if (tKick >= 0) {   // Galactic time since the last kick, Myr
        var adv = hp * passes * KPC_KMS; tKick += adv;
        if (fast) { ff -= adv; if (state === 'spiral' || ff <= 0) endFF(); }
        if (!cued && state === 'spiral' && tKick > 60) { cued = true; if (view === 'model') setCue('real'); }   // the kicked disk has wound into a spiral: point at the real stars once
      }
    }
    function endFF() {   // back to the normal clock; the 1 s average restarts from where the cloud is now; either way the real stars are the next thing to look at
      ff = 0; tlen = 0; mvz.fill(mvz[(mi + TRM - 1) % TRM]);
      if (!cued && view === 'model') { cued = true; setCue('real'); }
    }

    function reachE(E, r) {   // how high a star of vertical energy E climbs in potential r, kpc
      var lo = 0, hi = 3;
      for (var i = 0; i < 40; i++) { var m = (lo + hi) / 2; if (phi(m, r) < E) lo = m; else hi = m; }
      return (lo + hi) / 2;
    }
    function reachOf(v0, r) { return reachE(0.5 * v0 * v0, r); }
    function orbitPath(E, r, bx, by, sx, sy) {   // appends the closed curve in (z, v_z) of a star with vertical energy E in potential r to the current path
      var zm = reachE(E, r), i, sgn;
      for (sgn = 1; sgn >= -1; sgn -= 2) for (i = 0; i <= 80; i++) {
        var z = (-zm + 2 * zm * i / 80) * sgn, v2 = 2 * (E - phi(z, r)), px = bx + z * sx, py = by - sgn * Math.sqrt(v2 > 0 ? v2 : 0) * sy;
        if (sgn > 0 && i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.closePath();
    }
    function orbit(E, r, bx, by, sx, sy) { g.beginPath(); orbitPath(E, r, bx, by, sx, sy); g.stroke(); }
    function tIdx(q) { return ((ti - tlen + q) % TRN + TRN) % TRN; }   // the q-th oldest sample of the trail ring buffer
    function tail(fx, fy) {   // fading tail of the followed star from its ring buffer of (z, v_z)
      for (var q = 1; q < tlen; q++) {
        var i0 = tIdx(q - 1), i1 = tIdx(q);
        g.strokeStyle = rgba(C.accent, 0.08 + 0.7 * q / tlen); g.lineWidth = 2; g.beginPath(); g.moveTo(fx(TRL[i0 * 2], TRL[i0 * 2 + 1]), fy(TRL[i0 * 2], TRL[i0 * 2 + 1])); g.lineTo(fx(TRL[i1 * 2], TRL[i1 * 2 + 1]), fy(TRL[i1 * 2], TRL[i1 * 2 + 1])); g.stroke();
      }
      g.lineWidth = 1;
    }

    /* ---------- small drawing helpers ---------- */
    function pick(list, maxW, o) { for (var i = 0; i < list.length; i++) if (textW(g, list[i], o || { size: 12 }) <= maxW) return list[i]; return list[list.length - 1]; }
    function lab(text, x, y, o) {   // a label with a nearly opaque backing, so stars never run through the letters
      o = o || {};
      var size = o.size || 12, w = textW(g, text, { size: size, mono: o.mono }), x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
      if (o.back !== false) { g.fillStyle = rgba(o.backColor || C.bg, 0.9); g.fillRect(x0 - 3, y - size, w + 6, size + 4); }
      label(g, text, x, y, { size: size, mono: o.mono, color: o.color || C.text2, align: o.align });
    }
    function fit2(ls, rs, w) {   // a left text and a right number side by side: the longest wording of each that fits in w px
      for (var i = 0; i < ls.length; i++) for (var j = 0; j < rs.length; j++) if (textW(g, ls[i], { size: 12 }) + 14 + textW(g, rs[j], { size: 12, mono: true }) <= w) return [ls[i], rs[j]];
      return [ls[ls.length - 1], rs[rs.length - 1]];
    }
    function rrect(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function rhoGloss(v) {   // dark matter density in everyday terms, near the Sun: a proton weighs 0.938 GeV
      if (v < 0.005) return 'no dark matter at all';
      if (Math.abs(v - 0.32) < 0.005) return 'about a third of a proton\u2019s mass per cm\u00b3, near the Sun';
      var p = v / 0.938;
      return (p < 0.95 ? 'about ' + p.toFixed(2) + ' of a proton\u2019s mass' : p < 1.05 ? 'about one proton\u2019s mass' : 'about ' + p.toFixed(1) + ' proton masses') + ' per cm\u00b3, near the Sun';
    }

    function draw() {
      var W = S.W, Hh = S.H; if (!W) return;
      var now = performance.now();
      g.fillStyle = C.surface; g.fillRect(0, 0, W, Hh);
      var R = twoPanels(W, Hh, 12, 12, 0.46), A = R[0], B = R[1], stacked = Hh > W, star = rgba(C.text, 0.5), k;
      var E0 = 0.5 * vLaunch * vLaunch, Et = E0;   // the pair's launch energy: 40 km/s from the plane, 60 after a kick
      var reachNow = reachE(E0, rhoNow), reach0 = reachE(Et, 0), zm = Math.max(ZMAX, reachOf(V0, 0) + 0.25), zmL = stacked ? Math.max(ZMAX_STACK, zm) : zm;
      var gaiaOn = view === 'gaia' && !!D;

      /* ---- left: the simulated disk, edge on (a header strip, then the plot) ---- */
      box(g, A);
      var Ap = { x: A.x, y: A.y + STRIP, w: A.w, h: A.h - STRIP };
      g.strokeStyle = C.border; g.beginPath(); g.moveTo(A.x, Ap.y + 0.5); g.lineTo(A.x + A.w, Ap.y + 0.5); g.stroke();
      label(g, pick(gaiaOn ? ['Simulated Milky Way disk, edge on', 'Simulated disk, edge on'] : ['Simulated Milky Way disk, edge on · each dot a star', 'Simulated Milky Way disk, edge on', 'Simulated disk, edge on'], A.w - 20), A.x + 10, A.y + 15, { size: 12, color: C.text });
      label(g, pick(['faint lines: 1 kpc (3,300 light-years) apart', 'lines 1 kpc (3,300 light-years) apart', '1 kpc = 3,300 light-years'], A.w - 20), A.x + 10, A.y + 30, { size: 12, color: C.text2 });
      g.save(); g.beginPath(); g.rect(Ap.x, Ap.y, Ap.w, Ap.h); g.clip();
      var sc = Math.min(Ap.w / 2.4, Ap.h / (2 * zmL)), cx = Ap.x + Ap.w / 2, cy = Ap.y + Ap.h / 2, yS = reachNow * sc, yT = reach0 * sc;
      g.fillStyle = rgba(C.accent, C.dark ? 0.2 : 0.13);   // the gap between the star's reach and its twin's: what the dark matter takes off the climb
      g.fillRect(Ap.x, cy - yT, Ap.w, yT - yS); g.fillRect(Ap.x, cy + yS, Ap.w, yT - yS);
      g.strokeStyle = C.borderStrong; g.lineWidth = 1;
      [-1, 0, 1].forEach(function (zz) { g.beginPath(); g.moveTo(Ap.x, cy - zz * sc + 0.5); g.lineTo(Ap.x + Ap.w, cy - zz * sc + 0.5); g.stroke(); });
      g.strokeStyle = rgba(C.accent, 0.72); g.lineWidth = 1.25; g.setLineDash([5, 4]); g.beginPath();
      g.moveTo(Ap.x, cy - yT + 0.5); g.lineTo(Ap.x + Ap.w, cy - yT + 0.5); g.moveTo(Ap.x, cy + yT + 0.5); g.lineTo(Ap.x + Ap.w, cy + yT + 0.5); g.stroke(); g.setLineDash([]);
      g.strokeStyle = C.accent; g.lineWidth = 1.5; g.beginPath();
      g.moveTo(Ap.x, cy - yS + 0.5); g.lineTo(Ap.x + Ap.w, cy - yS + 0.5); g.moveTo(Ap.x, cy + yS + 0.5); g.lineTo(Ap.x + Ap.w, cy + yS + 0.5); g.stroke(); g.lineWidth = 1;
      for (k = 0; k < N; k++) { PX[k] = cx + X[k] * sc; PY[k] = cy - Z[k] * sc; }
      dots(g, PX, PY, N, 1.3, star);
      var fx0 = cx + X[0] * sc, tr = Math.max(yS, yT) + 8;
      g.strokeStyle = rgba(C.accent, 0.35); g.beginPath(); g.moveTo(fx0 + 0.5, cy - tr); g.lineTo(fx0 + 0.5, cy + tr); g.stroke();   // the path the star and its twin bob along: it ends at the twin's reach
      for (var q = 4; q < tlen; q += 6) {   // short tapering tails (a dozen strokes each): the bobbing reads at a glance, even in a still frame
        var j0 = tIdx(q - 6 < 0 ? 0 : q - 6), j1 = tIdx(q), fu = q / tlen, fa = 0.5 * fu * fu;
        g.strokeStyle = rgba(C.accent, fa * 0.6); g.lineWidth = 1.2 + 1.6 * fu; g.beginPath(); g.moveTo(fx0, cy - TZT[j0] * sc); g.lineTo(fx0, cy - TZT[j1] * sc); g.stroke();
        g.strokeStyle = rgba(C.accent, fa); g.lineWidth = 1.5 + 2.5 * fu; g.beginPath(); g.moveTo(fx0, cy - TRL[j0 * 2] * sc); g.lineTo(fx0, cy - TRL[j1 * 2] * sc); g.stroke();
      }
      g.lineWidth = 1;
      g.fillStyle = C.accent; g.beginPath(); g.arc(fx0, cy - Z[0] * sc, 4, 0, TAU); g.fill();
      g.strokeStyle = rgba(C.accent, 0.95); g.lineWidth = 1.75; g.beginPath(); g.arc(fx0, cy - zt * sc, 4, 0, TAU); g.stroke(); g.lineWidth = 1;
      g.fillStyle = C.text; g.beginPath(); g.arc(cx, cy - 0.0208 * sc, 3, 0, TAU); g.fill();
      lab('Sun', cx + 7, cy - 0.0208 * sc + 4, { color: C.text2 });
      var gap = reach0 > 0.001 ? Math.round(100 * (reach0 - reachNow) / reach0) : 0, nS = reachNow.toFixed(2) + ' kpc', room = Ap.w - 21 - 16;
      var fsY = cy - yS + 16, twY = Math.max(Ap.y + 14, cy - yT - 5), pale = rgba(C.accent, 0.9);
      var sT = fit2(['star climbs to', 'star'], gap >= 1 ? [nS + ', ' + gap + '% lower', nS] : [nS], room), tT = fit2(['twin, no dark matter', 'twin'], [reach0.toFixed(2) + ' kpc'], room);
      g.fillStyle = C.accent; g.beginPath(); g.arc(A.x + 13, fsY - 4, 3.5, 0, TAU); g.fill();   // filled dot: the star
      lab(sT[0], A.x + 21, fsY, { color: C.accent });
      lab(sT[1], A.x + A.w - 8, fsY, { align: 'right', color: C.accent, mono: true });
      g.strokeStyle = pale; g.lineWidth = 1.75; g.beginPath(); g.arc(A.x + 13, twY - 4, 3.5, 0, TAU); g.stroke(); g.lineWidth = 1;   // hollow dot: the twin
      lab(tT[0], A.x + 21, twY, { color: pale });
      lab(tT[1], A.x + A.w - 8, twY, { align: 'right', color: pale, mono: true });
      g.restore();

      /* ---- right: the same stars by height and vertical speed (model), or the real Gaia stars ---- */
      box(g, B);
      var Bp = { x: B.x, y: B.y + STRIP, w: B.w, h: B.h - STRIP };
      g.strokeStyle = C.border; g.beginPath(); g.moveTo(B.x, B.y + STRIP + 0.5); g.lineTo(B.x + B.w, B.y + STRIP + 0.5); g.stroke();
      if (gaiaOn) drawGaia(B, Bp, zm, now);
      else {   // the model stars
        var mw = Math.min(150, B.w * 0.4), mx0 = B.x + B.w - 10 - mw, my0 = B.y + 6, mh = STRIP - 12, hot = state !== 'settled';
        g.strokeStyle = C.border; g.beginPath(); g.moveTo(mx0, my0 + mh / 2 + 0.5); g.lineTo(mx0 + mw, my0 + mh / 2 + 0.5); g.stroke();
        g.strokeStyle = state === 'ringing' ? C.accent : C.text2; g.lineWidth = 1.4; g.beginPath();
        for (var s = 0; s < TRM; s++) { var vv = mvz[(mi + s) % TRM], px2 = mx0 + mw * s / (TRM - 1), py2 = my0 + mh / 2 - Math.max(-1, Math.min(1, vv / 20)) * mh / 2; if (s === 0) g.moveTo(px2, py2); else g.lineTo(px2, py2); }
        g.stroke(); g.lineWidth = 1;
        label(g, state, B.x + 10, B.y + 23, { color: hot ? C.accent : C.text, size: 13 });
        var avail = mx0 - 10 - (B.x + 24 + textW(g, state, { size: 13 })), ml = pick(['disk sloshing', 'sloshing'], avail);
        if (textW(g, ml, { size: 12 }) <= avail) label(g, ml, mx0 - 8, B.y + 22, { align: 'right', size: 12, color: C.text2 });
        g.save(); g.beginPath(); g.rect(Bp.x, Bp.y, Bp.w, Bp.h); g.clip();
        var sx = Bp.w / (2 * zm), sy = Bp.h / (2 * VMAX), bx = Bp.x + Bp.w / 2, by = Bp.y + Bp.h / 2;
        g.strokeStyle = C.border; g.beginPath(); g.moveTo(Bp.x, by + 0.5); g.lineTo(Bp.x + Bp.w, by + 0.5); g.moveTo(bx + 0.5, Bp.y); g.lineTo(bx + 0.5, Bp.y + Bp.h); g.stroke();
        g.fillStyle = rgba(C.accent, C.dark ? 0.2 : 0.13); g.beginPath(); orbitPath(Et, 0, bx, by, sx, sy); orbitPath(E0, rhoNow, bx, by, sx, sy); g.fill('evenodd');   // the ring between the twin's loop and the star's
        g.strokeStyle = rgba(C.accent, 0.72); g.lineWidth = 1.25; g.setLineDash([5, 4]); orbit(Et, 0, bx, by, sx, sy); g.setLineDash([]); g.lineWidth = 1;
        g.strokeStyle = C.accent; g.lineWidth = 1.5; orbit(E0, rhoNow, bx, by, sx, sy); g.lineWidth = 1;
        for (k = 0; k < N; k++) { PX[k] = bx + Z[k] * sx; PY[k] = by - VZ[k] * sy; }
        dots(g, PX, PY, N, 1.3, star);
        tail(function (z, v) { return bx + z * sx; }, function (z, v) { return by - v * sy; });
        g.fillStyle = C.accent; g.beginPath(); g.arc(PX[0], PY[0], 4, 0, TAU); g.fill();
        g.strokeStyle = rgba(C.accent, 0.95); g.lineWidth = 1.75; g.beginPath(); g.arc(bx + zt * sx, by - vt * sy, 4, 0, TAU); g.stroke(); g.lineWidth = 1;
        lab(pick(['same stars: height →, vertical speed ↑', 'same stars: height →, speed ↑'], Bp.w - 16), Bp.x + 8, Bp.y + 16, { color: C.text });
        var clk = clockText(); if (clk) lab('since kick: ' + clk, Bp.x + 8, Bp.y + 33, { color: C.text2 });   // the time-lapse clock: 30 Myr of Galactic time per second
        var l1 = pick(['solid: star, dashed: twin', 'dashed: twin'], Bp.w - 16), l1w = textW(g, l1, { size: 12 }), l2 = 'one lap = one bob';
        lab(l1, Bp.x + 8, Bp.y + Bp.h - 8, { color: C.accent });
        if (l1w + 14 + textW(g, l2, { size: 12 }) <= Bp.w - 16) lab(l2, Bp.x + 8 + l1w + 14, Bp.y + Bp.h - 8, { color: C.text2 });
        g.restore();
      }
      syncControls();
    }

    /* The Gaia view: Gaia DR3 stars with radial velocities near the Sun (assets/data/gaia_phase_spiral.json), binned 50 x 50 over
       |z| < 1 kpc, |v_z| < 60 km/s and drawn at the model's scale. Colour: each bin's median speed around the Galaxy minus its
       count-weighted average on the bin's oval (equal radius in z/sigma_z, v_z/sigma_vz): red = faster, blue = slower than similar stars. */
    function buildLayer() {   // one pixel per bin; thin bins fade (a median minus its oval average is 2 to 7 km/s of noise below a few hundred stars)
      layer.width = NZ; layer.height = NV;
      var img = lg.createImageData(NZ, NV), d = img.data, i, j, c;
      for (i = 0; i < NZ; i++) for (j = 0; j < NV; j++) {
        var o = ((NV - 1 - j) * NZ + i) * 4, n = D.cnt[i][j], r = D.spiral[i][j];
        if (r == null || n < 20) continue;
        c = diverge(r / SPR); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255 * Math.pow(Math.min(1, (n - 20) / 600), 0.8);
      }
      lg.putImageData(img, 0, 0);
      bar.width = 64; bar.height = 1; img = bg2.createImageData(64, 1); d = img.data;
      for (i = 0; i < 64; i++) { c = diverge(i / 63 * 2 - 1); d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; }
      bg2.putImageData(img, 0, 0); dirty = false;
    }
    function readBin(idx) {   // the plain-words reading of one square: how many stars, and faster or slower than similar stars
      var i = (idx / NV) | 0, j = idx % NV, n = D.cnt[i][j], r = D.spiral[i][j], l2, col;
      if (r == null || n < 20) { l2 = 'too few stars to say'; col = C.text2; }
      else if (Math.abs(r) < 0.5) { l2 = 'about the same as similar stars'; col = C.text2; }
      else { l2 = Math.abs(r).toFixed(1) + ' km/s ' + (r > 0 ? 'faster' : 'slower') + ' than similar stars'; col = r > 0 ? C.accent : H.blue(); }
      return { l1: n.toLocaleString('en-US') + (n === 1 ? ' star here' : ' stars here'), l2: l2, col: col };
    }
    function drawGaia(B, Bp, zm, now) {
      if (dirty) buildLayer();
      // the strip: what the colours mean, in words
      var wL = textW(g, SPR + ' km/s slower', { size: 12 }), wR = textW(g, SPR + ' km/s faster', { size: 12 }), bL = B.x + 10 + wL + 8, bR = B.x + B.w - 10 - wR - 8;
      label(g, pick(['speed around the Milky Way vs similar stars', 'speed vs similar stars'], B.w - 20), B.x + 10, B.y + 15, { size: 12, color: C.text });
      g.drawImage(bar, bL, B.y + 21, bR - bL, 7);
      label(g, SPR + ' km/s slower', B.x + 10, B.y + 29, { size: 12, color: H.blue() });
      label(g, SPR + ' km/s faster', B.x + B.w - 10, B.y + 29, { size: 12, color: C.accent, align: 'right' });
      // the plane at the model's scale; the data stop at their frame
      g.save(); g.beginPath(); g.rect(Bp.x, Bp.y, Bp.w, Bp.h); g.clip();
      var sx = Bp.w / (2 * zm), sy = Bp.h / (2 * VMAX), bx = Bp.x + Bp.w / 2, by = Bp.y + Bp.h / 2, ze = D.z_edges, ve = D.vz_edges;
      var x0 = bx + ze[0] * sx, x1 = bx + ze[NZ] * sx, y0 = by - ve[NV] * sy, y1 = by - ve[0] * sy;
      GF.x = x0; GF.y = y0; GF.w = x1 - x0; GF.h = y1 - y0;
      g.imageSmoothingEnabled = false; g.drawImage(layer, x0, y0, x1 - x0, y1 - y0); g.imageSmoothingEnabled = true;
      g.strokeStyle = rgba(C.text, 0.22); g.beginPath(); g.moveTo(x0, by + 0.5); g.lineTo(x1, by + 0.5); g.moveTo(bx + 0.5, y0); g.lineTo(bx + 0.5, y1); g.stroke();
      g.strokeStyle = C.borderStrong; g.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0) - 1, Math.round(y1 - y0) - 1);
      var hx = 0, hy = 0, cw = (x1 - x0) / NZ, ch = (y1 - y0) / NV;
      if (hover >= 0) {   // the square under the pointer, ringed, and the loop of similar stars its average was taken over
        var hi = (hover / NV) | 0, hj = hover % NV;
        hx = x0 + hi * cw; hy = y0 + (NV - 1 - hj) * ch;
        var zc = (ze[hi] + ze[hi + 1]) / 2, vc = (ve[hj] + ve[hj + 1]) / 2, rr = Math.sqrt(zc * zc / (GZ * GZ) + vc * vc / (GV * GV));
        g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
        g.strokeStyle = C.bg; g.lineWidth = 3.5; g.beginPath(); g.ellipse(bx, by, Math.max(1, rr * GZ * sx), Math.max(1, rr * GV * sy), 0, 0, TAU); g.stroke();
        g.strokeStyle = C.text; g.lineWidth = 1.5; g.setLineDash([5, 4]); g.beginPath(); g.ellipse(bx, by, Math.max(1, rr * GZ * sx), Math.max(1, rr * GV * sy), 0, 0, TAU); g.stroke(); g.setLineDash([]);
        g.restore();
        var ccx = hx + cw / 2, ccy = hy + ch / 2, rad = Math.max(7, cw * 1.6);
        g.strokeStyle = C.bg; g.lineWidth = 4.5; g.beginPath(); g.arc(ccx, ccy, rad, 0, TAU); g.stroke();
        g.strokeStyle = C.text; g.lineWidth = 2; g.beginPath(); g.arc(ccx, ccy, rad, 0, TAU); g.stroke(); g.lineWidth = 1;
      }
      var sl = slideT > 0 && now - slideT < 4200;   // the slider only moves the simulated disk: say so in the moment it is tried
      lab(pick([nStars + ' real stars: height →, vertical speed ↑', 'real stars: height →, vertical speed ↑', 'real stars: height →, speed ↑'], Bp.w - 16), Bp.x + 8, Bp.y + 16, { color: C.text });
      if (sl) g.globalAlpha = Math.min(1, (4200 - (now - slideT)) / 700);
      lab(sl ? pick(['the slider moves only the simulated disk', 'slider: simulated disk only'], Bp.w - 16) : pick(['the spiral: the real disk, still ringing from an old jolt', 'the spiral: still ringing from an old jolt', 'a spiral, left by an old jolt'], Bp.w - 16), Bp.x + 8, Bp.y + 33, { color: sl ? C.accent : C.text2 });
      g.globalAlpha = 1;
      var ext = '\u00b1' + ze[NZ] + ' kpc, \u00b1' + ve[NV] + ' km/s', legY = Bp.y + Bp.h - 8, extY = y1 + 16;   // the one range label: the data's own window
      var leg = hover >= 0 ? pick(['faint: few stars \u00b7 dashed loop: the similar stars', 'dashed loop: the similar stars'], Bp.w - 16) : 'faint: few stars \u00b7 ' + (coarse ? 'tap a square' : 'point at a square');
      if (extY + 5 < legY - 13) { lab(ext, x1, extY, { align: 'right', mono: true, color: C.text2 }); lab(leg, Bp.x + 8, legY, { color: C.text2 }); }
      else lab(pick([ext + ' \u00b7 faint: few stars', ext], Bp.w - 16), Bp.x + 8, legY, { color: C.text2 });   // a short panel: one line for both
      g.restore();
      if (hover >= 0) {   // the reading sits beside the square (above the finger on a touch screen)
        var rd = readBin(hover), tw = Math.max(textW(g, rd.l1, { size: 12, mono: true }), textW(g, rd.l2, { size: 12 })) + 18, th = 40, px = hx + cw / 2, py = hy + ch / 2, tx = px + 16, ty = py - th - 12;
        if (touchHover) { tx = px - tw / 2; ty = py - th - 26; } else if (tx + tw > B.x + B.w - 4) tx = px - 16 - tw;
        tx = Math.max(B.x + 4, Math.min(B.x + B.w - 4 - tw, tx)); if (ty < B.y + STRIP + 4) ty = py + (touchHover ? 28 : 18);
        g.save(); g.beginPath(); g.rect(B.x, B.y, B.w, B.h); g.clip();
        rrect(tx, ty, tw, th, 6); g.fillStyle = rgba(C.bg, 0.97); g.fill(); g.strokeStyle = C.borderStrong; g.lineWidth = 1; g.stroke();
        label(g, rd.l1, tx + 9, ty + 16, { size: 12, mono: true, color: C.text });
        label(g, rd.l2, tx + 9, ty + 32, { size: 12, color: rd.col });
        g.restore();
      }
    }

    /* ---------- the controls that follow the model's state (written to the page only when they change) ---------- */
    function clockText() { return tKick < 0 || view === 'gaia' ? '' : tKick < 10 ? 'just now' : (Math.floor(tKick / 10) * 10).toLocaleString('en-US') + ' million years'; }   // the model's clock in 10 Myr steps; hidden in the Gaia view so it never reads as the age of Gaia's spiral
    function syncControls() {
      var s = clockText();
      if (s !== sinceShown) { sinceShown = s; setOut(outSince, s ? 'since kick: ' + s : ''); }
      var wantFF = !RMstill && view === 'model' && tKick >= 0 && ff === 0 && state !== 'spiral' && tKick < FF_MAX;
      if (ffBtn && wantFF !== ffShown) { ffShown = wantFF; ffBtn.classList.toggle('is-away', !wantFF); ffBtn.disabled = !wantFF; }
      var wantSettle = tKick >= 0;
      if (settleBtn && wantSettle !== settleShown) { settleShown = wantSettle; settleBtn.disabled = !wantSettle; }
      var on = Math.abs(rho - 0.32) < 0.005;
      if (gaiaBtn && on !== gaiaShown) { gaiaShown = on; gaiaBtn.classList.toggle('is-on', on); gaiaBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    }
    function cueEl(which) { return which === 'range' ? range : which === 'kick' ? kickBtn : which === 'ffwd' ? ffBtn : which === 'real' ? seg : null; }
    function ping(el) { if (!el) return; el.classList.remove('is-ping'); void el.offsetWidth; el.classList.add('is-ping'); }   // the ring pings three times, starting now
    function setCue(which) {   // one control at a time wears the soft "try me next" ring
      cueNow = which;
      ['range', 'kick', 'ffwd', 'real'].forEach(function (k) { var el = cueEl(k); if (el) { el.classList.toggle('is-cue', k === which); if (k !== which) el.classList.remove('is-ping'); } });
      if (which && run && run.visible()) ping(cueEl(which));
    }

    var run = loop(cv, step, draw, null, { drawEvery: 2 }), RMstill = run.still;
    S.onresize = run.redraw; onTheme.push(run.redraw);
    function setRho(v) { rho = v; range.value = v.toFixed(2); setOut(out, v.toFixed(2) + ' GeV/cm³'); setOut(gloss, rhoGloss(v)); if (run.still) { rhoNow = rho; sample(rho); } else if (!run.visible()) rhoNow = rho; run.redraw(); }
    function relaunch() { vLaunch = V0; Z[0] = 0; VZ[0] = V0; zt = 0; vt = V0; tlen = 0; }   // the star and its twin start together from the plane; the twin's galaxy never changes
    function touched() { if (cueNow === 'range') setCue(kickBtn && !RMstill ? 'kick' : 'real'); }   // the slider has been tried: point at the next step
    range.addEventListener('input', function () { setRho(+range.value); touched(); if (view === 'gaia') { slideT = performance.now(); run.wake(); } });
    range.addEventListener('pointerdown', touched); range.addEventListener('keydown', touched);
    range.addEventListener('change', function () { relaunch(); run.wake(); });
    if (gaiaBtn) gaiaBtn.addEventListener('click', function () { setRho(0.32); relaunch(); touched(); });
    if (kickBtn) {
      if (RMstill) kickBtn.hidden = true;
      kickBtn.addEventListener('click', function () {   // a jolt to the whole disk; the followed pair relaunches from the plane, 20 km/s faster
        for (var k = 1; k < N; k++) VZ[k] += 20;
        vLaunch = V0 + 20; Z[0] = 0; VZ[0] = vLaunch; zt = 0; vt = vLaunch; tlen = 0; ff = 0;
        tKick = 0; cued = false; setView('model'); setCue('ffwd');   // a kick shows the model stars winding up
        if (!run.visible()) cv.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        run.wake();
      });
    }
    if (ffBtn) {
      if (RMstill) ffBtn.hidden = true;
      ffBtn.addEventListener('click', function () { if (tKick >= 0 && state !== 'spiral') { ff = FF_MAX; setCue(null); run.wake(); } });
    }
    if (settleBtn) {
      if (RMstill) settleBtn.hidden = true;
      settleBtn.addEventListener('click', function () { rhoNow = rho; sample(rho); vLaunch = V0; tKick = -1; ff = 0; cued = false; setCue(null); run.redraw(); });
    }
    setOut(out, rho.toFixed(2) + ' GeV/cm³'); setOut(gloss, rhoGloss(rho));

    // the right panel's two views
    var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    function showBin() {   // the same reading as the tooltip, for screen readers
      if (!outBin) return;
      if (hover < 0 || !D) { setOut(outBin, ''); return; }
      var rd = readBin(hover); setOut(outBin, rd.l1 + ', ' + rd.l2);
    }
    function setView(v) {
      if (v === view) return;
      view = v; hover = -1; cv.style.cursor = '';
      views.forEach(function (b) { b.setAttribute('aria-checked', b.getAttribute('data-view') === v ? 'true' : 'false'); });
      if (v === 'gaia') { setCue(tKick < 0 && !RMstill ? 'kick' : null); if (!D) { note(fig, 'Loading the real stars from Gaia (34 KB)…'); load(); } }
      else if (cueNow === 'kick') setCue(null);
      showBin(); run.wake(); run.redraw();
    }
    function load() {
      if (loading || D) return; loading = true;
      fetchJSON(fig.getAttribute('data-src')).then(function (d) {
        var n = 0, sz = 0, sv = 0, i, j;
        NZ = d.cnt.length; NV = d.cnt[0].length;
        for (i = 0; i < NZ; i++) for (j = 0; j < NV; j++) {   // the ovals' axes: the stars' spread in height and vertical speed (0.27 kpc, 18.7 km/s), as in the binning
          var c = d.cnt[i][j], zc = (d.z_edges[i] + d.z_edges[i + 1]) / 2, vc = (d.vz_edges[j] + d.vz_edges[j + 1]) / 2;
          n += c; sz += c * zc * zc; sv += c * vc * vc;
        }
        GZ = Math.sqrt(sz / n); GV = Math.sqrt(sv / n); nStars = ((d.nstars || n) / 1e6).toFixed(1) + ' million';
        D = d; dirty = true; note(fig, ''); showBin(); run.redraw();
      }).catch(function (e) { loading = false; note(fig, 'The real stars did not load (' + e.message + ').'); if (gaiaView) gaiaView.disabled = true; setView('model'); });
    }
    whenNear(fig, load);
    onTheme.push(function () { dirty = true; run.redraw(); });   // the colour scale follows the theme
    views.forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-view')); }); });
    function point(e) {
      var h = -1;
      touchHover = e.pointerType === 'touch';
      if (view === 'gaia' && D && GF.w) {
        var r = cv.getBoundingClientRect(), x = e.clientX - r.left - GF.x, y = e.clientY - r.top - GF.y;
        if (x >= 0 && y >= 0 && x < GF.w && y < GF.h) h = Math.floor(x / GF.w * NZ) * NV + (NV - 1 - Math.floor(y / GF.h * NV));
      }
      if (h === hover) return;
      hover = h; cv.style.cursor = h >= 0 ? 'crosshair' : ''; showBin(); if (run.still) run.redraw(); else run.wake();
    }
    cv.addEventListener('pointermove', point); cv.addEventListener('pointerdown', point);
    cv.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') point({ clientX: -1e4, clientY: -1e4, pointerType: 'mouse' }); });
    setCue('range');   // arrival: the slider is the first thing to try; its ring starts pinging when the figure is on screen
    var pinged = 0; run.onVisible(function () { if (pinged++ < 2 && cueNow) ping(cueEl(cueNow)); });
    syncControls(); showBin();
  }

  function init() { demoDisk(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
