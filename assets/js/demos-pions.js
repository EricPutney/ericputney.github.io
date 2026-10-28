/* Fig. 3 Dark radiation sticks together (final round, 2026-10-28). Needs demos.js loaded first. */
(function () {
  'use strict';
  var E = window.EPDemos; if (!E) return;
  var C = E.C, RM = E.RM, onTheme = E.onTheme, rgba = E.rgba, hexRGB = E.hexRGB, gauss = E.gauss, makeCanvas = E.makeCanvas, loop = E.loop, smooth = E.smooth;
  var box = E.box, setOut = E.setOut;
  var TAU = Math.PI * 2;

  /* =====================================================================
     3. Dark radiation sticks together: free streaming versus a viscous fluid.
     Model: a 2D ideal gas in a periodic box, perturbed along x only, with BGK collisions
     (each particle's velocity is redrawn from the local Maxwellian at rate 1/tau; tau = infinity
     for neutrinos, from the slider for dark pions).
     The tint, the curves, the big-wave trace and the ripple chart come from linear kinetic theory,
     solved without noise per Fourier mode m = 1..24 (Hermite expansion in v_x, the v_y energy
     carried as a second moment, an absorbing layer at high Hermite order against recurrence).
     The neutrino box uses the exact free-streaming solution. The particles are a random sample of
     the same model: they stream, and the pions redraw their velocities from the solver's local
     density, flow and temperature, so on average they follow the tint.
     Layout: two canvases. The boxes come first (the controls sit right under them in the HTML),
     then the two charts.
     ===================================================================== */
  function demoPions() {
    var fig = document.getElementById('demo-pions'); if (!fig) return;
    var cvs = fig.querySelectorAll('canvas'); if (cvs.length < 2) return;
    var cvA = cvs[0], cvB = cvs[1], SA = makeCanvas(cvA), SB = makeCanvas(cvB), ga = SA.ctx, gb = SB.ctx;
    var range = fig.querySelector('[data-ctl="stick"]'), out = fig.querySelector('[data-out="stick"]'), btn = fig.querySelector('[data-ctl="pluck"]');
    var MQ = window.matchMedia('(max-width: 519px)');   // the same switch as the stage aspect in demos-pions.css

    var SIG = 0.212;                 // thermal speed per direction, box widths per second
    var CS = SIG * Math.SQRT2;       // sound speed of a 2D monatomic gas (gamma = 2), equal to the rms speed
    var TCROSS = 1 / CS;             // one box crossing at the rms speed: 3.3 s
    var M = 24, NH = 40, LH = 2 * NH, NX = 128, NU = 1024, TR = 480, NPMAX = 5000, FLOOR = 6;
    var SQ2 = Math.SQRT2, REPLAY = 9, ARR = 1.5;   // an automatic squeeze every 9 s until the visitor's first; the squeeze arrows last 1.5 s

    // ---- the squeeze: a box-wide squeeze toward the middle plus ripples at every smaller scale (fixed phases, so every squeeze is the same)
    var WM = new Float64Array(M), UR = new Float64Array(M), UI = new Float64Array(M), UA2 = new Float64Array(M), KM = new Float64Array(M), UX = new Float32Array(NU);
    var COSX = new Float32Array(M * NX), SINX = new Float32Array(M * NX);
    (function () {
      var m, j, x, u, umax = 0, seed = 7;
      function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      for (m = 1; m <= M; m++) {
        WM[m - 1] = m === 1 ? 1 : 0.6 / Math.sqrt(m) * (m <= 18 ? 1 : 0.5 * (1 + Math.cos(Math.PI * (m - 18) / 7)));
        var ph = m === 1 ? 0 : TAU * rnd();
        UR[m - 1] = 0.5 * WM[m - 1] * Math.sin(ph); UI[m - 1] = -0.5 * WM[m - 1] * Math.cos(ph);   // m = 1: U(x) = sin(2 pi x), a squeeze toward x = 1/2
        KM[m - 1] = TAU * m;
      }
      for (m = 0; m < M; m++) for (j = 0; j < NX; j++) { x = (j + 0.5) / NX; COSX[m * NX + j] = Math.cos(KM[m] * x); SINX[m * NX + j] = Math.sin(KM[m] * x); }
      for (j = 0; j < NU; j++) { x = (j + 0.5) / NU; u = 0; for (m = 0; m < M; m++) u += 2 * (UR[m] * Math.cos(KM[m] * x) - UI[m] * Math.sin(KM[m] * x)); UX[j] = u; umax = Math.max(umax, Math.abs(u)); }
      var A = 0.6 * SIG / umax;   // fastest push 0.6 thermal speeds
      for (j = 0; j < NU; j++) UX[j] *= A;
      for (m = 0; m < M; m++) { UR[m] *= A; UI[m] *= A; UA2[m] = UR[m] * UR[m] + UI[m] * UI[m]; }
    })();

    // ---- the linear kinetic solver for the dark pion box (per mode: a_n for g = int f dv_y, b_n for h = int v_y^2 f dv_y)
    var YR = new Float64Array(M * LH), YI = new Float64Array(M * LH);
    var K1R = new Float64Array(LH), K1I = new Float64Array(LH), K2R = new Float64Array(LH), K2I = new Float64Array(LH);
    var K3R = new Float64Array(LH), K3I = new Float64Array(LH), K4R = new Float64Array(LH), K4I = new Float64Array(LH);
    var TRR = new Float64Array(LH), TRI = new Float64Array(LH), SQN = new Float64Array(NH + 1), HYP = new Float64Array(NH), NSUB = new Int32Array(M);
    (function () { var n, n0 = Math.floor(0.3 * NH); for (n = 0; n <= NH; n++) SQN[n] = Math.sqrt(n); for (n = 0; n < NH; n++) HYP[n] = n > n0 ? Math.pow((n - n0) / (NH - 1 - n0), 4) : 0; })();
    var nu = 0;
    function setTau(t) {
      nu = isFinite(t) ? 1 / t : 0;
      for (var m = 0; m < M; m++) NSUB[m] = Math.max(1, Math.ceil((1 / 60) * (nu + 4 * KM[m] * SIG * Math.sqrt(NH)) / 2.6));   // RK4 inside its stability region
    }
    function rhs(K, hH, yr, yi, o, oR, oI) {
      var thr = (SQ2 * yr[o + 2] + yr[o + NH] - yr[o]) / 2, thi = (SQ2 * yi[o + 2] + yi[o + NH] - yi[o]) / 2;   // temperature perturbation
      for (var blk = 0; blk < 2; blk++) {
        var ob = o + blk * NH, w = blk * NH;
        for (var n = 0; n < NH; n++) {
          var sr = 0, si = 0;
          if (n > 0) { sr += SQN[n] * yr[ob + n - 1]; si += SQN[n] * yi[ob + n - 1]; }
          if (n < NH - 1) { sr += SQN[n + 1] * yr[ob + n + 1]; si += SQN[n + 1] * yi[ob + n + 1]; }
          var dr = K * si, di = -K * sr, er = 0, ei = 0;   // streaming: -i k v
          if (n === 0) { er = yr[o] + (blk ? thr : 0); ei = yi[o] + (blk ? thi : 0); }   // collisions relax toward the local Maxwellian
          else if (n === 1) { er = yr[o + 1]; ei = yi[o + 1]; }
          else if (n === 2) { er = thr / SQ2; ei = thi / SQ2; }
          var y0 = yr[ob + n], y1 = yi[ob + n], damp = hH * HYP[n];
          oR[w + n] = dr - nu * (y0 - er) - damp * y0; oI[w + n] = di - nu * (y1 - ei) - damp * y1;
        }
      }
    }
    function solverStep(dt) {
      for (var m = 0; m < M; m++) {
        var K = KM[m] * SIG, ns = NSUB[m], h = dt / ns, hH = 2 * K * Math.sqrt(NH), o = m * LH, j;
        for (var s = 0; s < ns; s++) {
          rhs(K, hH, YR, YI, o, K1R, K1I);
          for (j = 0; j < LH; j++) { TRR[j] = YR[o + j] + 0.5 * h * K1R[j]; TRI[j] = YI[o + j] + 0.5 * h * K1I[j]; }
          rhs(K, hH, TRR, TRI, 0, K2R, K2I);
          for (j = 0; j < LH; j++) { TRR[j] = YR[o + j] + 0.5 * h * K2R[j]; TRI[j] = YI[o + j] + 0.5 * h * K2I[j]; }
          rhs(K, hH, TRR, TRI, 0, K3R, K3I);
          for (j = 0; j < LH; j++) { TRR[j] = YR[o + j] + h * K3R[j]; TRI[j] = YI[o + j] + h * K3I[j]; }
          rhs(K, hH, TRR, TRI, 0, K4R, K4I);
          for (j = 0; j < LH; j++) { YR[o + j] += h / 6 * (K1R[j] + 2 * K2R[j] + 2 * K3R[j] + K4R[j]); YI[o + j] += h / 6 * (K1I[j] + 2 * K2I[j] + 2 * K3I[j] + K4I[j]); }
        }
      }
    }

    // ---- fields on the grid, what is left of each ripple, the big-wave trace (index 0: neutrinos, 1: dark pions)
    var DN = [new Float32Array(NX), new Float32Array(NX)], UF = new Float32Array(NX), TF = new Float32Array(NX);
    var SP = [new Float32Array(M), new Float32Array(M)], TRC = [new Float32Array(TR), new Float32Array(TR)];
    var MDR = new Float64Array(M), MDI = new Float64Array(M), MUR = new Float64Array(M), MUI = new Float64Array(M), MTR = new Float64Array(M), MTI = new Float64Array(M);
    var since = 0, fired = false, tn = TR;   // time since the last squeeze; tn = samples of the trace recorded since it (the trace restarts at every squeeze)
    function lg(E) { return Math.max(-FLOOR - 0.3, Math.min(0.15, Math.log(Math.max(E, 1e-30)) / Math.LN10)); }
    function synth(D, dr, di) { D.fill(0); for (var m = 0; m < M; m++) { var a = 2 * dr[m], b = 2 * di[m], o = m * NX; if (a === 0 && b === 0) continue; for (var j = 0; j < NX; j++) D[j] += a * COSX[o + j] - b * SINX[o + j]; } }
    function fields() {
      var m, t = fired ? since : 1e3, o, rec = tn < TR;
      // neutrinos, exact free streaming of the kick: dn = -i k t U e^{-a^2/2}, u = U (1 - a^2) e^{-a^2/2}, a = k sigma t, U = i UI
      for (m = 0; m < M; m++) {
        var a = KM[m] * SIG * t, ex = Math.exp(-0.5 * a * a), f = (1 - a * a) * ex;
        MDR[m] = KM[m] * t * ex * UI[m]; MDI[m] = -KM[m] * t * ex * UR[m]; MUR[m] = UR[m] * f; MUI[m] = UI[m] * f;
        SP[0][m] = lg((MDR[m] * MDR[m] + MDI[m] * MDI[m] + (MUR[m] * MUR[m] + MUI[m] * MUI[m]) / (CS * CS)) * CS * CS / UA2[m]);
      }
      synth(DN[0], MDR, MDI);
      if (rec) TRC[0][tn] = CS * (MDR[0] * UI[0] - MDI[0] * UR[0]) / UA2[0];   // box-wide density along the squeeze's own phase (+: crowded in the middle)
      // dark pions, from the solver
      for (m = 0; m < M; m++) {
        o = m * LH;
        MDR[m] = YR[o]; MDI[m] = YI[o]; MUR[m] = SIG * YR[o + 1]; MUI[m] = SIG * YI[o + 1];
        MTR[m] = (SQ2 * YR[o + 2] + YR[o + NH] - YR[o]) / 2; MTI[m] = (SQ2 * YI[o + 2] + YI[o + NH] - YI[o]) / 2;
        SP[1][m] = lg((MDR[m] * MDR[m] + MDI[m] * MDI[m] + (MUR[m] * MUR[m] + MUI[m] * MUI[m]) / (CS * CS)) * CS * CS / UA2[m]);
      }
      synth(DN[1], MDR, MDI); synth(UF, MUR, MUI); synth(TF, MTR, MTI);
      if (rec) { TRC[1][tn] = CS * (MDR[0] * UI[0] - MDI[0] * UR[0]) / UA2[0]; tn++; }
    }

    // ---- particles: a random sample of the same model, drifting from the first frame
    var NP = MQ.matches ? 2000 : NPMAX, GT = new Float32Array(8192);
    for (var gi = 0; gi < GT.length; gi++) GT[gi] = gauss();
    function mkP() { return { X: new Float32Array(NPMAX), Y: new Float32Array(NPMAX), VX: new Float32Array(NPMAX), VY: new Float32Array(NPMAX) }; }
    var P = [mkP(), mkP()];
    function gr() { return GT[(Math.random() * 8192) | 0]; }
    function freshGas(b) { for (var k = 0; k < NP; k++) { b.X[k] = Math.random(); b.Y[k] = Math.random(); b.VX[k] = SIG * gr(); b.VY[k] = SIG * gr(); } }
    freshGas(P[0]); freshGas(P[1]);
    function moveParticles(dt) {
      for (var i = 0; i < 2; i++) {
        var b = P[i], X = b.X, Y = b.Y, VX = b.VX, VY = b.VY, k;
        if (i === 1 && nu > 0) {   // dark pions: velocity redrawn from the local Maxwellian at rate 1/tau
          var q = 1 - Math.exp(-dt * nu);
          for (k = 0; k < NP; k++) {
            if (Math.random() >= q) continue;
            var j = (X[k] * NX) | 0, sd = SIG * Math.sqrt(Math.max(0.2, 1 + TF[j]));
            VX[k] = UF[j] + sd * gr(); VY[k] = sd * gr();
          }
        }
        for (k = 0; k < NP; k++) { var x = X[k] + dt * VX[k], y = Y[k] + dt * VY[k]; X[k] = x - Math.floor(x); Y[k] = y - Math.floor(y); }
      }
    }

    // ---- squeezes, slider, timing
    var userSqueezed = false, run;
    function squeeze(auto) {
      YR.fill(0); YI.fill(0);
      for (var m = 0; m < M; m++) { YR[m * LH + 1] = YR[m * LH + NH + 1] = UR[m] / SIG; YI[m * LH + 1] = YI[m * LH + NH + 1] = UI[m] / SIG; }   // the kick: u_m += U_m in both v_x moments
      for (var i = 0; i < 2; i++) { var b = P[i]; freshGas(b); for (var k = 0; k < NP; k++) b.VX[k] += UX[(b.X[k] * NU) | 0]; }
      since = 0; tn = 0; fired = true;
      if (auto) pulse();
    }
    function pulse() {   // each automatic squeeze rings the Squeeze button once, until the visitor's first squeeze
      if (RM || userSqueezed || !btn || !btn.animate) return;
      btn.animate([{ boxShadow: '0 0 0 0 ' + rgba(C.accent, 0.55) }, { boxShadow: '0 0 0 10px ' + rgba(C.accent, 0) }], { duration: 1100, easing: 'ease-out' });
    }
    // slider: 0 = no collisions; otherwise 10^(3 s - 0.49) collisions per particle per box crossing (log scale, 0.33 to 320; 100 at s = 0.83)
    function perCrossing(s) { return s <= 0.004 ? 0 : Math.pow(10, 3 * s - 0.49); }
    function tauOf(s) { var n = perCrossing(s); return n > 0 ? TCROSS / n : Infinity; }
    function readout(s) {
      var n = perCrossing(s), txt;
      if (n <= 0) txt = 'none (like neutrinos)';
      else if (n < 9.95) txt = '~' + n.toFixed(1) + ' per trip across the box';
      else if (n < 99.5) txt = '~' + Math.round(n) + ' per trip across the box';
      else txt = '~' + Math.round(n / 10) * 10 + ' per trip across the box';
      setOut(out, txt);
    }
    setTau(tauOf(+range.value)); readout(+range.value);

    function step(dt) {
      solverStep(dt); since += dt;
      fields(); moveParticles(dt);
      if (fired && !userSqueezed && since > REPLAY) squeeze(true);   // attract mode: replay until the visitor squeezes
    }

    // ---- drawing (no allocation per frame: prebuilt fonts and colours, reused rects and dash arrays, cached label choices)
    var TC = [document.createElement('canvas'), document.createElement('canvas')], TX = [], TD = [], TCOL = ['', ''];
    for (var tci = 0; tci < 2; tci++) { TC[tci].width = NX; TC[tci].height = 1; TX.push(TC[tci].getContext('2d')); TD.push(TX[tci].createImageData(NX, 1)); }
    var col = ['', ''], pcol = ['', ''], lcol = ['', ''], afill = ['', ''], shade = '', back = '';
    var F = { name: '', name13: '', name12: '', t: '', tb: '', sans: '' };
    var R = { x: 0, y: 0, w: 0, h: 0 }, DASH = [5, 4], DOT = [2, 3], SOLID = [];
    var NAME = ['neutrinos: never collide', 'dark pions: collide'], GLOSS = ['real, ghostly particles', 'hypothetical particles'];
    var LA = { w: -1, h: -1, n: false, two: false, labH: 26, nameF: ['', ''], nameW: [0, 0], glossFit: [false, false], note: '', sqW: 0 };
    var LB = { w: -1, n: false, hint: '', ptitle: '', tickW: 0, legW: 0, ig: 18, lw: [0, 0, 0] };
    var LEG = ['neutrinos', 'dark pions', 'kept by collisions'];
    var PL = 0, PR = 1, PT = 0, PB = 1, LM = Math.log(M);
    function yOf(v) { return PT + (PB - PT) * Math.min(1, Math.max(-0.05, -v / FLOOR)); }
    function xOf(m) { return PL + (PR - PL) * Math.log(m) / LM; }
    function rect(x, y, w, h) { R.x = x; R.y = y; R.w = w; R.h = h; return R; }
    function put(g, s, x, y, font, color, align) { g.font = font; g.textAlign = align || 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = color; g.fillText(s, x, y); }
    function wOf(g, s, font) { g.font = font; return g.measureText(s).width; }
    function theme() {
      col[0] = C.text3; col[1] = C.accent; lcol[0] = C.text2; lcol[1] = C.accent;
      pcol[0] = rgba(C.text3, C.dark ? 0.85 : 0.75); pcol[1] = rgba(C.accent, C.dark ? 0.85 : 0.75);
      afill[0] = rgba(C.text3, C.dark ? 0.22 : 0.16); afill[1] = rgba(C.accent, C.dark ? 0.2 : 0.13);
      shade = rgba(C.accent, C.dark ? 0.2 : 0.12); back = rgba(C.bg, 0.85);
      F.sans = C.sans; F.name = '600 14px ' + C.sans; F.name13 = '600 13px ' + C.sans; F.name12 = '600 12px ' + C.sans; F.t = '12px ' + C.sans; F.tb = '600 12px ' + C.sans;
      for (var i = 0; i < 2; i++) { var c = hexRGB(col[i]), d = TD[i].data; for (var j = 0; j < NX; j++) { d[4 * j] = c[0]; d[4 * j + 1] = c[1]; d[4 * j + 2] = c[2]; } TCOL[i] = col[i]; }
      LA.w = -1; LB.w = -1;
    }
    theme();
    function tint(g, i, ox, oy, side) {
      var d = TD[i].data, D = DN[i], gain = C.dark ? 2.6 : 2.1;
      for (var j = 0; j < NX; j++) d[4 * j + 3] = Math.round(255 * Math.max(0, Math.min(0.42, D[j] * gain)));
      TX[i].putImageData(TD[i], 0, 0);
      g.imageSmoothingEnabled = true; g.drawImage(TC[i], 0, 0, NX, 1, ox, oy, side, side);
    }
    function arrow(g, tip, dir, y, len, halo) {   // a shaft and a head pointing dir (+1 right, -1 left), tip at x = tip
      g.beginPath(); g.moveTo(tip - dir * len, y); g.lineTo(tip - dir * 9, y); g.stroke();
      g.beginPath(); g.moveTo(tip, y); g.lineTo(tip - dir * 12, y - 7); g.lineTo(tip - dir * 12, y + 7); g.closePath();
      if (halo) g.stroke(); g.fill();
    }

    function sideFor(W, H, pad, gap, below, lh) { return Math.floor(Math.min((W - 2 * pad - gap) / 2, H - pad - lh - 4 - below)); }   // box side for a label band lh
    // the boxes: labels, particles over their smooth average density, the squeeze arrows, and the side view under each box
    function drawA() {
      var W = SA.W, H = SA.H; if (!W) return;
      var g = ga, narrow = MQ.matches, i, j, k;
      g.fillStyle = C.surface; g.fillRect(0, 0, W, H);
      var pad = narrow ? 10 : 14, gap = narrow ? 10 : 28, stripH = narrow ? 26 : 34, noteH = 22;
      if (LA.w !== W || LA.h !== H || LA.n !== narrow) {   // labels on one line (name, then gloss) when both fit, else two lines for both boxes
        LA.w = W; LA.h = H; LA.n = narrow;
        var s1 = sideFor(W, H, pad, gap, stripH + noteH, 26), two = narrow, room;
        for (i = 0; i < 2 && !two; i++) if (wOf(g, NAME[i], F.name) + 10 + wOf(g, GLOSS[i], F.t) > s1 + (i ? pad - 4 : gap / 2)) two = true;   // the left label keeps half the gap clear
        LA.two = two; LA.labH = two ? 40 : 26;
        var s2 = sideFor(W, H, pad, gap, stripH + noteH, LA.labH);
        for (i = 0; i < 2; i++) {
          room = s2 + (i ? pad - 4 : gap / 2);
          LA.nameF[i] = wOf(g, NAME[i], F.name) <= room ? F.name : wOf(g, NAME[i], F.name13) <= room ? F.name13 : F.name12;
          LA.nameW[i] = wOf(g, NAME[i], LA.nameF[i]);
          LA.glossFit[i] = two ? wOf(g, GLOSS[i], F.t) <= room : true;
        }
        LA.note = wOf(g, 'shading and curves: how crowded the particles are', F.t) <= W - 2 * pad ? 'shading and curves: how crowded the particles are' : 'shading, curves: how crowded';
        LA.sqW = wOf(g, 'squeeze', F.tb);
      }
      var side = sideFor(W, H, pad, gap, stripH + noteH, LA.labH), ox0 = Math.round((W - (2 * side + gap)) / 2), oy = pad + LA.labH;
      for (i = 0; i < 2; i++) {
        var ox = ox0 + i * (side + gap);
        if (LA.two) { put(g, NAME[i], ox, oy - 23, LA.nameF[i], lcol[i]); if (LA.glossFit[i]) put(g, GLOSS[i], ox, oy - 8, F.t, C.text2); }
        else { put(g, NAME[i], ox, oy - 9, LA.nameF[i], lcol[i]); if (LA.glossFit[i]) put(g, GLOSS[i], ox + LA.nameW[i] + 10, oy - 9, F.t, C.text2); }
        box(g, rect(ox, oy, side, side));
        if (fired) tint(g, i, ox + 1, oy + 1, side - 2);
        // particles as small dots, one path per box
        var b = P[i], X = b.X, Y = b.Y, r = narrow ? 0.65 : 0.8, d2 = 2 * r;
        g.fillStyle = pcol[i]; g.beginPath();
        for (k = 0; k < NP; k++) g.rect(ox + 1 + X[k] * (side - 2) - r, oy + 1 + Y[k] * (side - 2) - r, d2, d2);
        g.fill();
        // the squeeze: two arrows slide in from the sides, tagged, then fade (drawn over the dots, on a soft halo)
        if (fired && since < ARR) {
          var al = since < 1 ? 1 : (ARR - since) / (ARR - 1), mv = smooth(Math.min(1, since / 0.5));
          var AL = Math.max(16, Math.round(side * 0.12)), ay = Math.round(oy + side / 2) + 0.5, lw = narrow ? 2.5 : 3, dx = mv * side * 0.1;
          var tl = ox + 8 + AL + dx, trr = ox + side - 8 - AL - dx;
          if (since < 0.5) { g.globalAlpha = 0.9 * (0.5 - since) / 0.5; g.strokeStyle = lcol[i]; g.lineWidth = 2; g.strokeRect(ox + 1, oy + 1, side - 2, side - 2); }
          var cx = ox + side / 2;
          g.globalAlpha = al * al * al; g.lineJoin = 'round'; g.lineCap = 'round';   // the soft halo fades faster than the arrows, so no pale ghost is left
          g.strokeStyle = back; g.fillStyle = back; g.lineWidth = lw + 4; arrow(g, tl, 1, ay, AL, true); arrow(g, trr, -1, ay, AL, true);
          g.fillRect(cx - LA.sqW / 2 - 5, ay - 11, LA.sqW + 10, 18);
          g.globalAlpha = al;
          g.strokeStyle = lcol[i]; g.fillStyle = lcol[i]; g.lineWidth = lw; arrow(g, tl, 1, ay, AL, false); arrow(g, trr, -1, ay, AL, false);
          put(g, 'squeeze', cx, ay + 3.5, F.tb, lcol[i], 'center');
          g.globalAlpha = 1; g.lineJoin = 'miter'; g.lineCap = 'butt'; g.lineWidth = 1;
        }
        // side view under the box: how crowded each column is (the same smooth average as the shading)
        var sy = oy + side + 4, smid = Math.round(sy + stripH / 2) + 0.5, sa = stripH / 2 - 3, D = DN[i], fx, fv;
        g.fillStyle = C.bg; g.fillRect(ox, sy, side, stripH);
        g.strokeStyle = C.border; g.lineWidth = 1; g.strokeRect(ox + 0.5, sy + 0.5, side - 1, stripH - 1);
        g.beginPath(); g.moveTo(ox + 1, smid); g.lineTo(ox + side - 1, smid); g.stroke();
        if (fired) {
          g.beginPath(); g.moveTo(ox + 1, smid);
          for (j = 0; j < NX; j++) { fx = ox + 1 + (j + 0.5) / NX * (side - 2); fv = Math.max(-sa, Math.min(sa, D[j] * sa / 0.3)); g.lineTo(fx, smid - fv); }
          g.lineTo(ox + side - 1, smid); g.closePath(); g.fillStyle = afill[i]; g.fill();
          g.beginPath();
          for (j = 0; j < NX; j++) { fx = ox + 1 + (j + 0.5) / NX * (side - 2); fv = Math.max(-sa, Math.min(sa, D[j] * sa / 0.3)); if (j === 0) g.moveTo(fx, smid - fv); else g.lineTo(fx, smid - fv); }
          g.strokeStyle = col[i]; g.lineWidth = 1.6; g.stroke(); g.lineWidth = 1;
        }
      }
      put(g, LA.note, W / 2, oy + side + 4 + stripH + 16, F.t, C.text2, 'center');
    }

    // the big wave over the 8 s after the squeeze (a sweep that restarts at every squeeze)
    function drawTrace(g, x0, y0, w, h) {
      box(g, rect(x0, y0, w, h));
      put(g, 'the big wave over time', x0 + 8, y0 + 17, F.tb, C.text2);
      if (LB.hint) put(g, LB.hint, x0 + w - 8, y0 + 17, F.t, C.text2, 'right');
      var top = y0 + 26, bot = y0 + h - 6, mid = Math.round((top + bot) / 2) + 0.5, amp = (bot - top) / 2 / 1.12, i, s, v, x, y;
      g.strokeStyle = C.border; g.lineWidth = 1; g.beginPath(); g.moveTo(x0 + 1, mid); g.lineTo(x0 + w - 1, mid); g.stroke();
      if (fired && tn > 1) {
        g.lineJoin = 'round';
        for (i = 1; i >= 0; i--) {   // red first, then the dashed grey on top so it stays visible where they coincide
          var T = TRC[i];
          g.strokeStyle = col[i]; g.lineWidth = i ? 2 : 1.6; g.setLineDash(i ? SOLID : DASH); g.beginPath();
          for (s = 0; s < tn; s += 2) { v = Math.max(-1.1, Math.min(1.1, T[s])); x = x0 + 1 + (w - 2) * s / (TR - 1); y = mid - v * amp; if (s === 0) g.moveTo(x, y); else g.lineTo(x, y); }
          s = tn - 1; v = Math.max(-1.1, Math.min(1.1, T[s])); g.lineTo(x0 + 1 + (w - 2) * s / (TR - 1), mid - v * amp);
          g.stroke(); g.setLineDash(SOLID);
        }
        if (tn < TR) for (i = 1; i >= 0; i--) {   // the sweep's head
          s = tn - 1; v = Math.max(-1.1, Math.min(1.1, TRC[i][s]));
          g.fillStyle = col[i]; g.beginPath(); g.arc(x0 + 1 + (w - 2) * s / (TR - 1), mid - v * amp, i ? 3 : 2.5, 0, TAU); g.fill();
        }
        g.lineJoin = 'miter'; g.lineWidth = 1;
      }
      put(g, 'squeeze', x0, y0 + h + 14, F.t, C.text2, 'left');
      put(g, '8 s later', x0 + w, y0 + h + 14, F.t, C.text2, 'right');
    }
    function curve(g, arr) { for (var k = 1; k <= M; k++) { if (k === 1) g.moveTo(xOf(k), yOf(arr[k - 1])); else g.lineTo(xOf(k), yOf(arr[k - 1])); } }
    // how much of each ripple is left, from the box-wide wave (left) to ripples 1/24 of the box (right), log scale
    function drawPower(g, x0, y0, w, h) {
      box(g, rect(x0, y0, w, h));
      put(g, LB.ptitle, x0 + 8, y0 + 17, F.tb, C.text2);
      PL = Math.round(x0 + 14 + LB.tickW); PR = x0 + w - 12; PT = y0 + 34; PB = y0 + h - 10;
      var j, k, i, yg;
      g.strokeStyle = C.border; g.lineWidth = 1;
      for (j = 3; j <= FLOOR; j += 3) { yg = Math.round(yOf(-j)) + 0.5; g.beginPath(); g.moveTo(PL, yg); g.lineTo(PR, yg); g.stroke(); }
      g.strokeStyle = C.borderStrong; g.setLineDash(DOT); yg = Math.round(yOf(0)) + 0.5; g.beginPath(); g.moveTo(PL, yg); g.lineTo(PR, yg); g.stroke(); g.setLineDash(SOLID);
      put(g, 'start', PL - 6, yOf(0) + 4, F.t, C.text2, 'right');
      put(g, 'a thousandth', PL - 6, yOf(-3) + 4, F.t, C.text2, 'right');
      put(g, 'a millionth', PL - 6, yOf(-6) + 4, F.t, C.text2, 'right');
      if (fired) {
        g.fillStyle = shade; g.beginPath(); curve(g, SP[1]);   // shaded: what the colliding gas keeps that free streaming loses
        for (k = M; k >= 1; k--) g.lineTo(xOf(k), yOf(SP[0][k - 1]));
        g.closePath(); g.fill();
        g.lineJoin = 'round';
        for (i = 1; i >= 0; i--) { g.strokeStyle = col[i]; g.lineWidth = i ? 2.2 : 1.6; g.setLineDash(i ? SOLID : DASH); g.beginPath(); curve(g, SP[i]); g.stroke(); }
        g.setLineDash(SOLID); g.lineWidth = 1; g.lineJoin = 'miter';
      }
      put(g, '← big waves', PL, y0 + h + 14, F.t, C.text2, 'left');
      put(g, 'tiny ripples →', PR, y0 + h + 14, F.t, C.text2, 'right');
    }
    function legend(g, cx, y) {   // one shared key for both charts: dashed grey, red, shade
      var x = Math.round(cx - LB.legW / 2), sw = 18, sg = 6, ig = LB.ig;
      g.strokeStyle = col[0]; g.lineWidth = 1.6; g.setLineDash(DASH); g.beginPath(); g.moveTo(x, y - 4.5); g.lineTo(x + sw, y - 4.5); g.stroke(); g.setLineDash(SOLID);
      x += sw + sg; put(g, LEG[0], x, y, F.t, C.text2); x += LB.lw[0] + ig;
      g.strokeStyle = col[1]; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, y - 4.5); g.lineTo(x + sw, y - 4.5); g.stroke(); g.lineWidth = 1;
      x += sw + sg; put(g, LEG[1], x, y, F.t, C.text2); x += LB.lw[1] + ig;
      g.fillStyle = shade; g.fillRect(x, y - 10, sw, 11); g.strokeStyle = afill[1]; g.strokeRect(x + 0.5, y - 9.5, sw - 1, 10);
      x += sw + sg; put(g, LEG[2], x, y, F.t, C.text2);
    }
    function drawB() {
      var W = SB.W, H = SB.H; if (!W) return;
      var g = gb, narrow = MQ.matches, pad = narrow ? 10 : 14, axH = 18, legH = 22, tx, ty, tw, th, px, py, pw, ph;
      g.fillStyle = C.surface; g.fillRect(0, 0, W, H);
      if (narrow) { tw = pw = W - 2 * pad; tx = px = pad; var av = H - pad - 2 * axH - 8 - legH - 2; th = Math.round(av * 0.4); ph = av - th; ty = pad; py = ty + th + axH + 8; }
      else { var cw = W - 2 * pad, cg = 20; tw = Math.round((cw - cg) * 0.42); pw = cw - cg - tw; tx = pad; px = pad + tw + cg; ty = py = pad; th = ph = H - pad - axH - legH - 2; }
      if (LB.w !== W || LB.n !== narrow) {
        LB.w = W; LB.n = narrow;
        var used = wOf(g, 'the big wave over time', F.tb) + 24;
        LB.hint = wOf(g, '↑ crowded in the middle', F.t) <= tw - used ? '↑ crowded in the middle' : wOf(g, '↑ crowded middle', F.t) <= tw - used ? '↑ crowded middle' : '';
        LB.ptitle = wOf(g, 'how much of each ripple is left', F.tb) <= pw - 16 ? 'how much of each ripple is left' : 'how much is left';
        LB.tickW = Math.max(wOf(g, 'a thousandth', F.t), wOf(g, 'a millionth', F.t));
        LB.lw[0] = wOf(g, LEG[0], F.t); LB.lw[1] = wOf(g, LEG[1], F.t); LB.lw[2] = wOf(g, LEG[2], F.t);
        var core = LB.lw[0] + LB.lw[1] + LB.lw[2] + 3 * (18 + 6);
        LB.ig = Math.max(8, Math.min(18, (W - 2 * pad - core) / 2)); LB.legW = core + 2 * LB.ig;   // the gaps shrink on very narrow screens
      }
      drawTrace(g, tx, ty, tw, th);
      drawPower(g, px, py, pw, ph);
      legend(g, W / 2, H - 9);
    }
    function draw() {
      if (TCOL[1] !== C.accent || TCOL[0] !== C.text3 || F.sans !== C.sans) theme();
      drawA(); drawB();
      return true;
    }

    // ---- input: every squeeze is immediate; the slider re-squeezes when released (or when the thumb rests mid-drag)
    function stillRun() { squeeze(false); for (var i = 0; i < 150; i++) step(1 / 60); draw(); }
    var tmr = 0, dragging = false, down = false;
    function userSqueeze() {
      clearTimeout(tmr); tmr = 0; dragging = false; userSqueezed = true;
      if (RM) stillRun(); else { squeeze(false); run.wake(); }
    }
    run = loop(fig, step, draw, function () { if (RM) stillRun(); else squeeze(true); }, { drawEvery: 2 });   // the whole figure gates the loop: both canvases animate while any part is on screen
    run.onVisible(function () { if (!RM && fired && !userSqueezed && since > 2.5) { squeeze(true); run.wake(); } });   // a fresh squeeze each time it comes back into view
    SA.onresize = SB.onresize = function () { draw(); };
    onTheme.push(function () { theme(); draw(); });
    range.addEventListener('pointerdown', function () { dragging = true; });
    range.addEventListener('input', function () {
      setTau(tauOf(+range.value)); readout(+range.value);
      clearTimeout(tmr); tmr = setTimeout(userSqueeze, dragging ? 260 : 80);
    });
    range.addEventListener('change', userSqueeze);
    if (btn) btn.addEventListener('click', userSqueeze);
    // a tap, click or drag on the boxes squeezes both (a scroll gesture on touch cancels the pointer instead)
    cvA.addEventListener('pointerdown', function () { down = true; });
    cvA.addEventListener('pointerup', function () { if (down) { down = false; userSqueeze(); } });
    cvA.addEventListener('pointercancel', function () { down = false; });
  }

  function init() { demoPions(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
