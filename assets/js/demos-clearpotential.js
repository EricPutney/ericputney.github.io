/* How ClearPotential weighs the disk: a 1D toy of the paper's pipeline, with the real ingredients.
   Model stars in (height, vertical speed) → a normalizing flow (monotone coupling layers, trained by likelihood)
   learns their density f, drawn as a bell-curve ("normal") lattice bent onto the stars → a small neural network
   Φ_θ(z), the gravity well, is trained so that f obeys the balance rule (the stationary collisionless Boltzmann
   equation v ∂f/∂z − Φ′(z) ∂f/∂v = 0) → Poisson turns Φ′ into the mass within each height; the mass beyond the
   ordinary matter is dark matter. Kick (or a tap on the stars) unsettles the disk and the answer stops being real.
   Plain JavaScript on canvas; needs assets/js/demos.js. */
(function () {
  'use strict';
  var E = window.EPDemos; if (!E) return;
  var C = E.C, RM = E.RM, rgba = E.rgba, hexRGB = E.hexRGB, gauss = E.gauss, smooth = E.smooth, makeCanvas = E.makeCanvas, loop = E.loop,
      label = E.label, textW = E.textW, dots = E.dots, box = E.box, setOut = E.setOut, G = E.G, R0 = E.R0, KPC_KMS = E.KPC_KMS;
  var TAU = Math.PI * 2, GEV = 2.6318e7, LOG2PI = Math.log(TAU);

  function demoClear() {
    var fig = document.getElementById('demo-clearpotential'); if (!fig) return;
    var cv = fig.querySelector('canvas'), S = makeCanvas(cv), g = S.ctx;
    var oRes = fig.querySelector('[data-out="res"]'), oDM = fig.querySelector('[data-out="dm"]'), hRes = fig.querySelector('[data-hint="res"]'), hDM = fig.querySelector('[data-hint="dm"]');
    var kickBtn = fig.querySelector('[data-ctl="kick"]'), sampleBtn = fig.querySelector('[data-ctl="resample"]');

    /* ---- the toy's truth: Fig. 1's ordinary matter (MilkyWayPotential, Bovy 2015) plus a dark-matter slab ---- */
    var MN = { M: 6.8e10, a: 3.0, b: 0.28 }, BU = { M: 5.0e9, c: 1.0 }, NU = { M: 1.71e9, c: 0.07 };
    function phiB(z) {
      var s = Math.sqrt(z * z + MN.b * MN.b), q = MN.a + s, r = Math.sqrt(R0 * R0 + z * z);
      return -G * MN.M / Math.sqrt(R0 * R0 + q * q) - G * BU.M / (r + BU.c) - G * NU.M / (r + NU.c);
    }
    function dphiB(z) {   // dPhi_b/dz, (km/s)^2 per kpc
      var s = Math.sqrt(z * z + MN.b * MN.b), q = MN.a + s, d = R0 * R0 + q * q, r = Math.sqrt(R0 * R0 + z * z);
      return G * MN.M * q * z / (s * d * Math.sqrt(d)) + G * BU.M * z / (r * (r + BU.c) * (r + BU.c)) + G * NU.M * z / (r * (r + NU.c) * (r + NU.c));
    }
    var phiB0 = phiB(0), SIG = 22, RHO = 0.32, SLAB = TAU * G * RHO * GEV;   // slab: Phi_DM = 2 pi G rho z^2
    function phiT(z) { return phiB(z) - phiB0 + SLAB * z * z; }
    function dphiT(z) { return dphiB(z) + 2 * SLAB * z; }
    var TBN = 4001, TBZ = 4, dTab = new Float64Array(TBN);   // the true force tabulated for the kicked disk's integration
    for (var t0 = 0; t0 < TBN; t0++) dTab[t0] = dphiT(-TBZ + 2 * TBZ * t0 / (TBN - 1));
    function dphiFast(z) { var u = (z + TBZ) * (TBN - 1) / (2 * TBZ); if (u < 0 || u >= TBN - 1) return dphiT(z); var i = u | 0; return dTab[i] + (u - i) * (dTab[i + 1] - dTab[i]); }
    var SIGMA_UNIT = 1 / (TAU * G) / 1e6;   // (km/s)^2/kpc  →  Msun/pc^2 of surface density within |z|

    /* ---- stars ---- */
    var NMAX = 32000, N = 32000, Z = new Float32Array(NMAX), VZ = new Float32Array(NMAX), perm = new Int32Array(NMAX), PX = new Float32Array(NMAX), PY = new Float32Array(NMAX);
    var cdfM = 600, cdf = new Float64Array(cdfM + 1), sz = 0.3, sv = SIG;   // sz, sv: the standardization the flow works in
    (function () { var acc = 0; for (var i = 0; i <= cdfM; i++) { acc += Math.exp(-phiT(-2.5 + 5 * i / cdfM) / (SIG * SIG)); cdf[i] = acc; } })();
    function sample() {
      var s2z = 0, s2v = 0;
      for (var k = 0; k < N; k++) {
        var u = Math.random() * cdf[cdfM], lo = 0, hi = cdfM;
        while (lo < hi) { var m = (lo + hi) >> 1; if (cdf[m] < u) lo = m + 1; else hi = m; }
        Z[k] = -2.5 + 5 * (lo + Math.random() - 0.5) / cdfM; VZ[k] = SIG * gauss(); perm[k] = k; s2z += Z[k] * Z[k]; s2v += VZ[k] * VZ[k];
      }
      sz = Math.sqrt(s2z / N); sv = Math.sqrt(s2v / N);
      for (k = N - 1; k > 0; k--) { var j = (Math.random() * (k + 1)) | 0, t = perm[k]; perm[k] = perm[j]; perm[j] = t; }
    }

    /* ---- Adam, shared by both networks ---- */
    function adam(p, grad, m, v, lr, t) {
      var b1 = 0.9, b2 = 0.999, c1 = 1 - Math.pow(b1, t), c2 = 1 - Math.pow(b2, t);
      for (var i = 0; i < p.length; i++) {
        var gi = grad[i]; m[i] = b1 * m[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi;
        p[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8);
      }
    }

    /* ---- the normalizing flow: NL coupling layers in the standardized (z, v) plane. Layer l keeps one
       coordinate a and maps the other through a monotone 1D transform whose shape depends on a:
         y_b = x_b e^{s(a)} + t(a) + Σ_k w_k(a) tanh((x_b − c_k)/d),  w_k = softplus(·) ≥ 0,
       so dy_b/dx_b = D > 0 and the map is invertible. (s, t, w) come from a tiny MLP of a.
       log p(x) = log N(y) + Σ_layers log D  (the change of variables).  Trained by maximum likelihood. */
    var NL = 4, HID = 12, K = 7, CR = 2.4, KD = 0.7 * (2 * CR / (K - 1)), NO = 2 + K, BATCH = 160, LP = 2 * HID + NO * HID + NO;
    var KC = new Float64Array(K); for (var kk = 0; kk < K; kk++) KC[kk] = -CR + 2 * CR * kk / (K - 1);
    var th = new Float64Array(NL * LP), thAvg = new Float64Array(NL * LP), gth = new Float64Array(NL * LP), mth = new Float64Array(NL * LP), vth = new Float64Array(NL * LP);
    var fsteps = 0, nllEma = 0, nllHist = new Float64Array(64), fconv = false;
    var CW = HID + NO + K + 4;   // cached per sample per layer: h[HID], o[NO] (as es, t, w[K]), th[K], a, b, D, (spare)
    var cache = new Float64Array(BATCH * NL * CW), cX = new Float64Array(BATCH * 2), tmpH = new Float64Array(HID), tmpO = new Float64Array(NO), tmpT = new Float64Array(K);
    function initFlow() {
      for (var l = 0; l < NL; l++) { var o = l * LP; for (var k = 0; k < HID; k++) { th[o + k] = 0.9 * gauss(); th[o + HID + k] = 0.6 * gauss(); } for (var j = 0; j < NO * HID; j++) th[o + 2 * HID + j] = 0; for (j = 0; j < NO; j++) th[o + 2 * HID + NO * HID + j] = j < 2 ? 0 : -3; }
      thAvg.set(th); mth.fill(0); vth.fill(0); fsteps = 0; nllEma = 0; fconv = false; nllHist.fill(0);
    }
    function cond(P, l, a) {   // the conditioner MLP: tmpH = hidden, tmpO = [s, t, w_raw...]
      var o = l * LP, k, j;
      for (k = 0; k < HID; k++) tmpH[k] = Math.tanh(P[o + k] * a + P[o + HID + k]);
      for (j = 0; j < NO; j++) { var s = P[o + 2 * HID + NO * HID + j], w = o + 2 * HID + j * HID; for (k = 0; k < HID; k++) s += P[w + k] * tmpH[k]; tmpO[j] = s; }
    }
    function mapB(P, l, a, b, slot) {   // y_b for coordinate b given a; returns y, sets mapB.D; caches when slot >= 0
      cond(P, l, a);
      var es = Math.exp(tmpO[0]), t = tmpO[1], y = b * es + t, D = es, k;
      for (k = 0; k < K; k++) { var w = Math.log(1 + Math.exp(tmpO[2 + k])), u = Math.tanh((b - KC[k]) / KD); tmpT[k] = u; tmpO[2 + k] = w; y += w * u; D += w * (1 - u * u) / KD; }
      if (slot >= 0) { var c = slot * CW; for (k = 0; k < HID; k++) cache[c + k] = tmpH[k]; cache[c + HID] = es; cache[c + HID + 1] = t; for (k = 0; k < K; k++) { cache[c + HID + 2 + k] = tmpO[2 + k]; cache[c + HID + NO + k] = tmpT[k]; } cache[c + HID + NO + K] = a; cache[c + HID + NO + K + 1] = b; cache[c + HID + NO + K + 2] = D; }
      mapB.D = D; return y;
    }
    function logp(z, v) {   // log density of the (averaged) flow at a data point, up to the constant −log(sz sv)
      var x0 = z / sz, x1 = v / sv, ld = 0;
      for (var l = 0; l < NL; l++) { if (l & 1) x0 = mapB(thAvg, l, x1, x0, -1); else x1 = mapB(thAvg, l, x0, x1, -1); ld += Math.log(mapB.D); }
      return -0.5 * (x0 * x0 + x1 * x1) - LOG2PI + ld;
    }
    function invB(P, l, a, y) {   // the inverse of the monotone map by bisection (16 halvings of ±9: sub-pixel)
      var lo = -9, hi = 9;
      for (var i = 0; i < 16; i++) { var m = 0.5 * (lo + hi); if (mapB(P, l, a, m, -1) < y) lo = m; else hi = m; }
      return 0.5 * (lo + hi);
    }
    function gen(y0, y1, out) {   // base → data, for drawing the warped lattice
      for (var l = NL - 1; l >= 0; l--) { if (l & 1) y0 = invB(thAvg, l, y1, y0); else y1 = invB(thAvg, l, y0, y1); }
      out[0] = y0 * sz; out[1] = y1 * sv;
    }
    var cursor = 0;
    function flowStep(lr) {   // one Adam step of maximum likelihood on a minibatch
      gth.fill(0);
      var nb = Math.min(BATCH, N), nll = 0, i, l, k, j;
      for (i = 0; i < nb; i++) {   // forward, caching
        var idx = perm[(cursor + i) % N], x0 = Z[idx] / sz, x1 = VZ[idx] / sv, ld = 0;
        for (l = 0; l < NL; l++) { var slot = i * NL + l; if (l & 1) x0 = mapB(th, l, x1, x0, slot); else x1 = mapB(th, l, x0, x1, slot); ld += Math.log(mapB.D); }
        cX[i * 2] = x0; cX[i * 2 + 1] = x1; nll += 0.5 * (x0 * x0 + x1 * x1) + LOG2PI - ld;
      }
      cursor = (cursor + nb) % N;
      for (i = 0; i < nb; i++) {   // backward
        var g0 = cX[i * 2], g1 = cX[i * 2 + 1];   // dL/dy from the Gaussian base
        for (l = NL - 1; l >= 0; l--) {
          var c = (i * NL + l) * CW, o = l * LP, a = cache[c + HID + NO + K], b = cache[c + HID + NO + K + 1], D = cache[c + HID + NO + K + 2], es = cache[c + HID], gD = -1 / D;
          var gy = (l & 1) ? g0 : g1, ga = (l & 1) ? g1 : g0;
          tmpO[0] = gy * b * es + gD * es; tmpO[1] = gy;
          var dDdb = 0;
          for (k = 0; k < K; k++) { var w = cache[c + HID + 2 + k], u = cache[c + HID + NO + k], sq = 1 - u * u; var gw = gy * u + gD * sq / KD; tmpO[2 + k] = gw * (1 - Math.exp(-w)); dDdb += w * (-2 * u * sq) / (KD * KD); }
          var gaAcc = 0;
          for (k = 0; k < HID; k++) {
            var h = cache[c + k], gh = 0;
            for (j = 0; j < NO; j++) { gth[o + 2 * HID + j * HID + k] += tmpO[j] * h; gh += th[o + 2 * HID + j * HID + k] * tmpO[j]; }
            var gp = gh * (1 - h * h); gth[o + k] += gp * a; gth[o + HID + k] += gp; gaAcc += th[o + k] * gp;
          }
          for (j = 0; j < NO; j++) gth[o + 2 * HID + NO * HID + j] += tmpO[j];
          var gbIn = gy * D + gD * dDdb, gaIn = ga + gaAcc;
          if (l & 1) { g0 = gbIn; g1 = gaIn; } else { g1 = gbIn; g0 = gaIn; }
        }
      }
      var inv = 1 / nb; for (k = 0; k < gth.length; k++) gth[k] *= inv;
      fsteps++;
      adam(th, gth, mth, vth, lr * Math.min(1, fsteps / 60) * Math.pow(0.998, Math.max(0, fsteps - 300)), fsteps);
      if (fsteps < 200) thAvg.set(th); else for (k = 0; k < th.length; k++) thAvg[k] += 0.02 * (th[k] - thAvg[k]);   // Polyak averaging smooths the minibatch noise
      nll *= inv; nllEma = fsteps === 1 ? nll : nllEma + 0.05 * (nll - nllEma); nllHist[fsteps & 63] = nllEma;
      if (fsteps >= 700 && Math.abs(nllEma - nllHist[(fsteps - 48) & 63]) < 0.0015) fconv = true;
      if (fsteps >= 1600) fconv = true;
    }

    /* ---- the density on a grid (for contours and for the equation) ---- */
    var NZ = 40, NV = 40, ZR = 1.6, VR = 80, NG = NZ * NV, zc = new Float64Array(NZ), vc = new Float64Array(NV), DZ = 2 * ZR / NZ, DV = 2 * VR / NV;
    for (var i0 = 0; i0 < NZ; i0++) zc[i0] = -ZR + DZ * (i0 + 0.5);
    for (var j0 = 0; j0 < NV; j0++) vc[j0] = -VR + DV * (j0 + 0.5);
    var F = new Float32Array(NG), FZ = new Float32Array(NG), FV = new Float32Array(NG), RES = new Float32Array(NG), Fmax = 1, den = 1, resScale = 1, resRel = 1, gridDirty = true;
    function evalGrid() {
      var i, j, o; Fmax = 1e-30;
      for (i = 0; i < NZ; i++) for (j = 0; j < NV; j++) { o = i * NV + j; F[o] = Math.exp(logp(zc[i], vc[j])); if (F[o] > Fmax) Fmax = F[o]; }
      for (i = 0; i < NZ; i++) for (j = 0; j < NV; j++) {   // gradients by central differences (one-sided at the edges)
        o = i * NV + j;
        FZ[o] = (i === 0 ? F[o + NV] - F[o] : i === NZ - 1 ? F[o] - F[o - NV] : 0.5 * (F[o + NV] - F[o - NV])) / DZ;
        FV[o] = (j === 0 ? F[o + 1] - F[o] : j === NV - 1 ? F[o] - F[o - 1] : 0.5 * (F[o + 1] - F[o - 1])) / DV;
      }
      var sy = 0, sw = 0; den = 0;
      for (i = 0; i < NZ; i++) for (j = 0; j < NV; j++) { o = i * NV + j; var y = vc[j] * FZ[o]; den += F[o] * y * y; sy += F[o] * y * y; sw += F[o]; }
      resScale = Math.sqrt(sy / Math.max(sw, 1e-30)); if (den < 1e-30) den = 1e-30;
      gridDirty = false; pconv = false;
    }

    /* ---- the potential network Φ_θ(z) = PS [N(z/ZS) + N(−z/ZS)], N a 1 → 16 → 16 → 1 tanh MLP; trained on the equation ---- */
    var H1 = 16, H2 = 16, PS = 1500, ZSC = 1.5, HDZ = 0.01, NP = H1 + H1 + H2 * H1 + H2 + H2 + 1;
    var ph = new Float64Array(NP), gph = new Float64Array(NP), mph = new Float64Array(NP), vph = new Float64Array(NP), psteps = 0, pconv = false, resHist = new Float64Array(64);
    var OW1 = 0, OB1 = H1, OW2 = 2 * H1, OB2 = 2 * H1 + H2 * H1, OW3 = OB2 + H2, OB3 = OW3 + H2;
    var nh1 = new Float64Array(H1), nh2 = new Float64Array(H2), cH1 = new Float64Array(4 * NZ * H1), cH2 = new Float64Array(4 * NZ * H2), cU = new Float64Array(4 * NZ);
    function initNet() {
      for (var k = 0; k < H1; k++) { ph[OW1 + k] = 1.2 * gauss(); ph[OB1 + k] = 0.5 * gauss(); }
      for (var a = 0; a < H2; a++) { for (var b = 0; b < H1; b++) ph[OW2 + a * H1 + b] = gauss() / Math.sqrt(H1); ph[OB2 + a] = 0; ph[OW3 + a] = 0; }
      ph[OB3] = 0; mph.fill(0); vph.fill(0); psteps = 0; pconv = false; resHist.fill(0);
    }
    function netFwd(u, slot) {   // N(u); caches activations in slot (or none when slot < 0)
      var k, a, out = ph[OB3];
      for (k = 0; k < H1; k++) nh1[k] = Math.tanh(ph[OW1 + k] * u + ph[OB1 + k]);
      for (a = 0; a < H2; a++) { var s = ph[OB2 + a]; for (k = 0; k < H1; k++) s += ph[OW2 + a * H1 + k] * nh1[k]; nh2[a] = Math.tanh(s); out += ph[OW3 + a] * nh2[a]; }
      if (slot >= 0) { cU[slot] = u; for (k = 0; k < H1; k++) cH1[slot * H1 + k] = nh1[k]; for (a = 0; a < H2; a++) cH2[slot * H2 + a] = nh2[a]; }
      return out;
    }
    function netBwd(slot, go) {   // accumulate dL/dθ for output gradient go at the cached slot
      var k, a, u = cU[slot], o1 = slot * H1, o2 = slot * H2;
      gph[OB3] += go;
      for (k = 0; k < H1; k++) nh1[k] = 0;
      for (a = 0; a < H2; a++) {
        var h2 = cH2[o2 + a], g2 = go * ph[OW3 + a] * (1 - h2 * h2); gph[OW3 + a] += go * h2; gph[OB2 + a] += g2;
        for (k = 0; k < H1; k++) { gph[OW2 + a * H1 + k] += g2 * cH1[o1 + k]; nh1[k] += g2 * ph[OW2 + a * H1 + k]; }
      }
      for (k = 0; k < H1; k++) { var h1 = cH1[o1 + k], g1 = nh1[k] * (1 - h1 * h1); gph[OW1 + k] += g1 * u; gph[OB1 + k] += g1; }
    }
    function phiNet(z) { return PS * (netFwd(z / ZSC, -1) + netFwd(-z / ZSC, -1)); }
    function phiNet0() { return phiNet(0); }
    function forceNet(z) { return (phiNet(z + HDZ) - phiNet(z - HDZ)) / (2 * HDZ); }   // Φ′(z), (km/s)^2 per kpc
    var FP = new Float64Array(NZ);
    function pinnStep(lr, train) {   // residual of the equation on the grid; one Adam step when train is set
      var i, j, o, num = 0;
      for (i = 0; i < NZ; i++) {   // Φ′ at each grid height by a central difference of the (even) network potential, activations cached in 4 slots
        var z = zc[i], s0 = 4 * i;
        FP[i] = PS * (netFwd((z + HDZ) / ZSC, s0) + netFwd(-(z + HDZ) / ZSC, s0 + 1) - netFwd((z - HDZ) / ZSC, s0 + 2) - netFwd(-(z - HDZ) / ZSC, s0 + 3)) / (2 * HDZ);
      }
      if (train) gph.fill(0);
      for (i = 0; i < NZ; i++) {
        var gfp = 0;
        for (j = 0; j < NV; j++) { o = i * NV + j; var r = vc[j] * FZ[o] - FP[i] * FV[o]; RES[o] = r; var w = F[o]; num += w * r * r; gfp += -2 * w * r * FV[o]; }
        if (train) { var gq = gfp / den * PS / (2 * HDZ), s1 = 4 * i; netBwd(s1, gq); netBwd(s1 + 1, gq); netBwd(s1 + 2, -gq); netBwd(s1 + 3, -gq); }
      }
      resRel = Math.sqrt(num / den);
      if (train) {
        psteps++; adam(ph, gph, mph, vph, lr * Math.min(1, psteps / 20), psteps); resHist[psteps & 63] = resRel;
        if (psteps >= 160 && Math.abs(resRel - resHist[(psteps - 48) & 63]) < 0.0025) pconv = true;
        if (psteps >= 700) pconv = true;
      }
    }
    function darkMatter() {   // the dark-matter slab that best fits Φ_fit − Φ_ordinary for |z| ≤ 1 kpc, in GeV/cm^3
      var p0 = phiNet0(), num = 0, dn = 0;
      for (var i = 1; i <= 20; i++) { var z = i / 20, d = phiNet(z) - p0 - (phiB(z) - phiB0); num += d * z * z; dn += z * z * z * z; }
      return num / dn / (TAU * G) / GEV;
    }

    /* ---- the usual spread of one run's answer at each star count: mean and standard deviation of 30 runs of this
       exact pipeline (tools/stats.mjs, the reduced-motion path), true value 0.32 GeV/cm^3. At 2,000 stars the answer is
       biased low, not just noisy: too few stars in the tails. ---- */
    var SPREAD = { 2000: [0.01, 0.21], 8000: [0.27, 0.10], 32000: [0.33, 0.07] };

    /* ---- stages, time, state ---- */
    var stage = 0, auto = true, played = false, tStage = 0, sweep = 0, kicked = false, tEv = 0, starsDirty = true, tick = 0, reveal = 1, lastDM = null, recorded = false, invited = false;
    var hist = { 2000: [], 8000: [], 32000: [] }, lattice = null, latTick = -99;   // dark-matter estimates per star count, one per settled sample
    var RATE = 30 / KPC_KMS, stepMs = 0.8;   // 30 Myr per second after a kick; running cost of one flow step, ms
    var stageBtns = fig.querySelectorAll('[data-stage]'), nBtns = fig.querySelectorAll('[data-n]');
    var detailsOpen = function () { return false; };   // replaced by E.more once the loop exists
    function setStageUI() { stageBtns.forEach(function (b) { b.setAttribute('aria-checked', +b.getAttribute('data-stage') === stage ? 'true' : 'false'); }); }
    function setNUI() { nBtns.forEach(function (b) { b.setAttribute('aria-checked', +b.getAttribute('data-n') === N ? 'true' : 'false'); }); }
    function setStage(s, byUser) { if (byUser) auto = false; stage = s; tStage = 0; if (s === 3) sweep = 0; setStageUI(); updateReads(); run.wake(); run.redraw(); }
    function settledNow() { return fconv && pconv && sweep >= 1 && !kicked && viewStage() >= 3 && psteps > 0; }
    function record() {
      if (recorded || !settledNow()) return;
      recorded = true; var h = hist[N]; h.push(darkMatter()); if (h.length > 12) h.shift();
      if (!invited && kickBtn && !run.still) {   // the first settled answer: invite the payoff once
        invited = true; kickBtn.classList.add('cp-invite'); setTimeout(function () { kickBtn.classList.remove('cp-invite'); }, 4200);
      }
    }
    function restart() {   // new stars: run the pipeline again on the step the visitor is on (a walk-through in progress carries on)
      if (settledNow()) lastDM = darkMatter();
      sample(); initFlow(); initNet(); starsDirty = true; gridDirty = true; kicked = false; tEv = 0; resRel = 1; recorded = false; reveal = run.still ? 1 : 0.35; latTick = -99; flowReady = false; fig.classList.remove('is-kicked');
      tStage = 0; sweep = 0; setStageUI();
      if (run.still) stillRun();
      updateReads(); run.wake(); run.redraw();
    }
    function stillRun() { while (!fconv) flowStep(5e-3); flowReady = true; evalGrid(); while (!pconv) pinnStep(0.01, true); sweep = 1; record(); updateReads(); }   // reduced motion: everything computed at once, the step buttons choose what is shown
    var flowReady = false;   // set once the flow has converged for this sample; a kick retrains it without hiding the later stages
    function viewStage() { return (stage >= 2 && !flowReady) ? 1 : stage; }   // the gravity and mass stages wait for the flow's first convergence
    function fmt(v) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(2); }
    var lastP = [-1, -1, -1, -1];
    function setP(i, p) { p = Math.round(p * 50) / 50; if (p === lastP[i]) return; lastP[i] = p; stageBtns.forEach(function (b) { if (+b.getAttribute('data-stage') === i) b.style.setProperty('--p', p); }); }
    function updateReads() {
      var vs = viewStage(), sp = SPREAD[N], hasRes = vs >= 2 && psteps > 0, val, hint;
      setOut(oRes, hasRes ? Math.round(100 * resRel) + '%' : '—');
      setOut(hRes, hasRes ? 'lower is better' : '');
      var live = psteps > 0 && vs >= 3, settled = settledNow();
      if (live) {
        val = fmt(darkMatter()) + (settled ? ' ± ' + sp[1].toFixed(2) : '') + ' GeV/cm³';
        hint = kicked ? (tEv < 10 && !run.still ? 'not real: the disk is moving' : 'not real: disk out of balance')
             : !settled ? 'settling…' : N <= 2000 ? 'true 0.32; too few stars to weigh it' : 'true 0.32 ≈ a third of a proton’s mass per cm³';
      } else if (lastDM != null) { val = fmt(lastDM) + ' GeV/cm³'; hint = stage >= 3 ? 'previous stars; computing…' : 'previous stars'; }
      else { val = '—'; hint = kicked ? 'kicked: no real answer' : stage >= 3 ? 'computing…' : 'appears at Weigh'; }
      setOut(oDM, val); setOut(hDM, hint);
      // bounded progress on the step buttons: the flow stops at 700 to 850 steps, the gravity network at 160 to 500
      var pf = fsteps === 0 ? 0 : fconv ? 1 : Math.min(0.97, fsteps / 720), pp = psteps === 0 ? 0 : pconv ? 1 : Math.min(0.95, psteps / 400);
      setP(1, pf); setP(2, pp); setP(3, kicked ? 0 : recorded ? 1 : live ? Math.min(0.95, sweep * pp) : 0);
    }
    function step(dt) {
      tStage += dt; tick++; if (reveal < 1) reveal = Math.min(1, reveal + dt / 0.35);
      if (kicked && tEv < 10) {   // the kicked disk keeps moving in the true potential (every other step, twice the stride); everything refits live
        tEv += dt;
        if (tick & 1) { var h = 2 * dt * RATE; for (var k = 0; k < N; k++) { var v = VZ[k] - 0.5 * h * dphiFast(Z[k]), z = Z[k] + h * v; v -= 0.5 * h * dphiFast(z); Z[k] = z; VZ[k] = v; } starsDirty = true; }
        fconv = false; pconv = false; if (fsteps > 350) fsteps = 350;
      }
      if (stage >= 1 && !fconv) {   // as many flow steps as fit a 3 ms budget (1 to 3): quick on a laptop, still smooth on a slow phone
        var ns = kicked ? 1 : Math.max(1, Math.min(3, Math.floor(3 / stepMs)));
        for (var q = 0; q < ns && !fconv; q++) { var t1 = performance.now(); flowStep(5e-3); stepMs += 0.1 * (performance.now() - t1 - stepMs); }
        if ((tick % 6) === 0 || fconv) gridDirty = true; if (fconv) flowReady = true;
      }
      if (stage >= 1 && gridDirty) evalGrid();
      if (stage >= 2 && flowReady && !pconv) { pinnStep(0.01, true); pinnStep(0.01, true); if (!kicked) pinnStep(0.01, true); }
      if (stage >= 3 && flowReady && sweep < 1) sweep = Math.min(1, sweep + dt / 0.7);
      record();
      if (auto) {   // arrival: walk through the stages once
        if (stage === 0 && tStage > 0.9) setStage(1);
        else if (stage === 1 && flowReady && tStage > 2.2) setStage(2);
        else if (stage === 2 && pconv && tStage > 2.2) { setStage(3); auto = false; }
      }
      updateReads();
    }
    function kick() {
      for (var k = 0; k < N; k++) VZ[k] += 20;
      kicked = true; tEv = 0; starsDirty = true; fconv = false; pconv = false; gridDirty = true; fig.classList.add('is-kicked');
      if (kickBtn) kickBtn.classList.remove('cp-invite');
      if (stage >= 3) sweep = 1;   // the step stays where the visitor is; a walk-through in progress carries on to Weigh
      updateReads();
      if (run.still) { stillRun(); run.redraw(); }
      if (!run.visible()) cv.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      run.wake(); run.redraw();
    }

    /* ---- drawing ---- */
    var starLayer = document.createElement('canvas'), sg = starLayer.getContext('2d'), tint = document.createElement('canvas'), tg = tint.getContext('2d'), tintImg = null;
    tint.width = NZ; tint.height = NV; tintImg = tg.createImageData(NZ, NV);
    function layout(W, H) {   // phase space P, gravity Q, mass R; with Details open, the estimates strip T along the bottom
      var pad = 12, gap = 12, sh = detailsOpen() ? (W < 520 ? 58 : 54) : 0, Hm = H - (sh ? sh + gap : 0), L;
      if (Hm <= W) { var ph = Hm - 2 * pad, pw = Math.min(ph * 1.15, (W - 2 * pad - gap) * 0.54), rx = pad + pw + gap, rw = W - pad - rx, rh = (ph - gap) / 2;
        L = { P: { x: pad, y: pad, w: pw, h: ph }, Q: { x: rx, y: pad, w: rw, h: rh }, R: { x: rx, y: pad + rh + gap, w: rw, h: rh }, stacked: false }; }
      else { var th2 = (Hm - 2 * pad - gap) * 0.56, bw = (W - 2 * pad - gap) / 2, bh = Hm - 2 * pad - gap - th2;
        L = { P: { x: pad, y: pad, w: W - 2 * pad, h: th2 }, Q: { x: pad, y: pad + th2 + gap, w: bw, h: bh }, R: { x: pad + bw + gap, y: pad + th2 + gap, w: bw, h: bh }, stacked: true }; }
      L.T = sh ? { x: pad, y: H - pad - sh, w: W - 2 * pad, h: sh } : null;
      return L;
    }
    function drawStars(P) {
      var dpr = S.dpr || 1, w = Math.round(P.w * dpr), h = Math.round(P.h * dpr);
      if (starLayer.width !== w || starLayer.height !== h) { starLayer.width = w; starLayer.height = h; }
      sg.setTransform(dpr, 0, 0, dpr, 0, 0); sg.clearRect(0, 0, P.w, P.h);
      var stride = (kicked && tEv < 10 && N > 12000) ? Math.ceil(N / 12000) : 1, n = 0, sx = P.w / (2 * ZR), sy = P.h / (2 * VR);
      for (var k = 0; k < N; k += stride) { PX[n] = P.w / 2 + Z[k] * sx; PY[n] = P.h / 2 - VZ[k] * sy; n++; }
      dots(sg, PX, PY, n, N > 10000 ? 1.1 : N > 3000 ? 1.5 : 1.9, rgba(C.text, N > 10000 ? (stride > 1 ? 0.6 : 0.45) : N > 3000 ? 0.6 : 0.7));
      starsDirty = false;
    }
    function drawTint(P) {   // where the stars break the balance rule: accent tint, strongest where the stars are
      var d = tintImg.data, c = hexRGB(C.accent), sc = 0.8 * resScale, k = 0;
      for (var j = NV - 1; j >= 0; j--) for (var i = 0; i < NZ; i++) {
        var o = i * NV + j, a = Math.min(1, Math.abs(RES[o]) / sc) * Math.pow(F[o] / Fmax, 0.35) * 0.85;
        d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = (a * 255) | 0; k += 4;
      }
      tg.putImageData(tintImg, 0, 0);
      g.imageSmoothingEnabled = true; g.drawImage(tint, P.x, P.y, P.w, P.h);
    }
    function contours(P) {   // marching squares on the flow's density at four fractions of its peak
      var sx = P.w / NZ, sy = P.h / NV, lv = [0.6, 0.3, 0.12, 0.04];
      g.strokeStyle = rgba(C.text, 0.55); g.lineWidth = 1; g.beginPath();
      function px(i) { return P.x + (i + 0.5) * sx; } function py(j) { return P.y + P.h - (j + 0.5) * sy; }
      for (var l = 0; l < lv.length; l++) {
        var L = lv[l] * Fmax;
        for (var i = 0; i < NZ - 1; i++) for (var j = 0; j < NV - 1; j++) {
          var f00 = F[i * NV + j], f10 = F[(i + 1) * NV + j], f01 = F[i * NV + j + 1], f11 = F[(i + 1) * NV + j + 1];
          var code = (f00 >= L ? 1 : 0) | (f10 >= L ? 2 : 0) | (f11 >= L ? 4 : 0) | (f01 >= L ? 8 : 0);
          if (code === 0 || code === 15) continue;
          var pts = [];
          if ((code & 1) !== ((code >> 1) & 1)) pts.push([px(i) + sx * (L - f00) / (f10 - f00), py(j)]);
          if (((code >> 1) & 1) !== ((code >> 2) & 1)) pts.push([px(i + 1), py(j) - sy * (L - f10) / (f11 - f10)]);
          if (((code >> 3) & 1) !== ((code >> 2) & 1)) pts.push([px(i) + sx * (L - f01) / (f11 - f01), py(j + 1)]);
          if ((code & 1) !== ((code >> 3) & 1)) pts.push([px(i), py(j) - sy * (L - f00) / (f01 - f00)]);
          if (pts.length >= 2) { g.moveTo(pts[0][0], pts[0][1]); g.lineTo(pts[1][0], pts[1][1]); if (pts.length === 4) { g.moveTo(pts[2][0], pts[2][1]); g.lineTo(pts[3][0], pts[3][1]); } }
        }
      }
      g.stroke();
    }
    var latOut = [0, 0], LAT = 7, LATN = 21, latPts = new Float32Array(2 * LAT * LATN * 2);
    function latticeUpdate() {   // a square lattice in the base Gaussian, pushed through the flow (base → data): this is what the flow is
      var q = 0, l, i;
      for (l = 0; l < LAT; l++) {
        var c0 = -2.1 + 4.2 * l / (LAT - 1);
        for (i = 0; i < LATN; i++) { var t = -2.1 + 4.2 * i / (LATN - 1); gen(c0, t, latOut); latPts[q++] = latOut[0]; latPts[q++] = latOut[1]; }
        for (i = 0; i < LATN; i++) { t = -2.1 + 4.2 * i / (LATN - 1); gen(t, c0, latOut); latPts[q++] = latOut[0]; latPts[q++] = latOut[1]; }
      }
      latTick = tick;
    }
    function latticeDraw(P, alpha) {
      if (tick - latTick >= 6 || latTick < 0) latticeUpdate();
      var sx = P.w / (2 * ZR), sy = P.h / (2 * VR), q = 0, l, i;
      g.strokeStyle = rgba(C.accent, alpha); g.lineWidth = 1; g.beginPath();
      for (l = 0; l < 2 * LAT; l++) for (i = 0; i < LATN; i++) { var x = P.x + P.w / 2 + latPts[q++] * sx, y = P.y + P.h / 2 - latPts[q++] * sy; if (i === 0) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    /* ---- what a flow is, at a glance: a small inset in the top-left corner of the phase-space panel, the base normal
       distribution (round contours at the same fractions of the peak as the density's, the same 7 + 7 lattice lines,
       undistorted) labelled "normal (bell curve)", and an arrow "flow" into the panel. Drawn once into a cached layer
       (redrawn on resize, theme or font change); one drawImage per frame. Dropped where the corner is too small (every phone). ---- */
    var INS_MIN = 50, INS_HALF = 2.9, insR = new Float64Array([0.6, 0.3, 0.12, 0.04]);
    for (var ir = 0; ir < insR.length; ir++) insR[ir] = Math.sqrt(-2 * Math.log(insR[ir]));   // contours()' fractions of the peak → radii in sigma
    var insLayer = document.createElement('canvas'), ig = insLayer.getContext('2d'), insS = 0, insDpr = 0, insDirty = true;
    function insSize(P) { var s = Math.min(Math.round(0.15 * P.h), Math.floor(0.2 * P.w) - 16, 66); return s >= INS_MIN ? (s | 1) : 0; }   // odd side: the centre sits on a pixel; 0: no room
    function insRender(s, dpr) {
      var u = s / (2 * INS_HALF), c = s / 2, lat = Math.round(2.1 * u), lw = s + 64, lh = s + 32, w = Math.round(lw * dpr), h = Math.round(lh * dpr), i, o;
      if (insLayer.width !== w || insLayer.height !== h) { insLayer.width = w; insLayer.height = h; }
      ig.setTransform(dpr, 0, 0, dpr, 0, 0); ig.clearRect(0, 0, lw, lh);
      ig.fillStyle = rgba(C.surface, 0.92); ig.fillRect(0, 0, s, s);
      ig.strokeStyle = C.borderStrong; ig.lineWidth = 1; ig.strokeRect(0.5, 0.5, s - 1, s - 1);
      ig.strokeStyle = rgba(C.text, 0.55); ig.beginPath();   // the normal distribution's contours
      for (i = 0; i < insR.length; i++) { ig.moveTo(c + insR[i] * u, c); ig.arc(c, c, insR[i] * u, 0, TAU); }
      ig.stroke();
      ig.strokeStyle = rgba(C.accent, 0.5); ig.beginPath();   // the same lattice as the panel's, straight
      for (i = 0; i < LAT; i++) { o = Math.round((-2.1 + 4.2 * i / (LAT - 1)) * u); ig.moveTo(c + o, c - lat); ig.lineTo(c + o, c + lat); ig.moveTo(c - lat, c + o); ig.lineTo(c + lat, c + o); }
      ig.stroke();
      var ax = s + 4, ay = Math.round(0.36 * s), ux = 0.788, uy = 0.616, bx = ax + 0.5 * s * ux, by = ay + 0.5 * s * uy;   // the arrow, pointing down into the panel (its length follows the inset)
      ig.strokeStyle = ig.fillStyle = C.text2; ig.lineWidth = 1.5; ig.beginPath(); ig.moveTo(ax, ay); ig.lineTo(bx - 6 * ux, by - 6 * uy); ig.stroke();
      ig.beginPath(); ig.moveTo(bx, by); ig.lineTo(bx - 9 * ux - 4 * uy, by - 9 * uy + 4 * ux); ig.lineTo(bx - 9 * ux + 4 * uy, by - 9 * uy - 4 * ux); ig.closePath(); ig.fill();
      label(ig, 'normal', c, s + 13, { align: 'center', color: C.text2, back: true, size: 11 });   // DRAFT copy: 'normal', '(bell curve)' and 'flow'
      label(ig, '(bell curve)', c, s + 27, { align: 'center', color: C.text2, back: true, size: 11 });
      label(ig, 'flow', ax + 18, ay + 3, { color: C.text2, back: true, size: 11 });
      insS = s; insDpr = dpr; insDirty = false;
    }
    function insDraw(P, top) {
      var s = insSize(P); if (!s) return;
      var dpr = S.dpr || 1;
      if (insDirty || s !== insS || dpr !== insDpr) insRender(s, dpr);
      g.drawImage(insLayer, P.x + 8, P.y + top, insLayer.width / dpr, insLayer.height / dpr);
    }
    function netDiagram(x0, y0, w, h) {   // the gravity network: 1 → 16 → 16 → 1, edge darkness ∝ |weight|
      var cols = [1, H1, H2, 1], cx = [x0, x0 + w / 3, x0 + 2 * w / 3, x0 + w], ys = [], c, k, m1 = 1e-9, m2 = 1e-9, m3 = 1e-9;
      for (c = 0; c < 4; c++) { ys.push([]); for (k = 0; k < cols[c]; k++) ys[c].push(cols[c] === 1 ? y0 + h / 2 : y0 + h * (k + 0.5) / cols[c]); }
      for (k = 0; k < H1; k++) m1 = Math.max(m1, Math.abs(ph[OW1 + k]));
      for (k = 0; k < H2 * H1; k++) m2 = Math.max(m2, Math.abs(ph[OW2 + k]));
      for (k = 0; k < H2; k++) m3 = Math.max(m3, Math.abs(ph[OW3 + k]));
      var tc = hexRGB(C.text), ac = hexRGB(C.accent);
      function edges(ci, wts, m, n1, n2, col) {   // four alpha buckets, one path each
        for (var bk = 0; bk < 4; bk++) {
          g.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',' + (0.1 + 0.18 * bk).toFixed(2) + ')'; g.beginPath(); var any = false;
          for (var a = 0; a < n2; a++) for (var b = 0; b < n1; b++) { var wv = Math.abs(wts(a, b)) / m; if (wv < 0.1) continue; var q = Math.min(3, Math.floor(wv * 4)); if (q !== bk) continue; g.moveTo(cx[ci], ys[ci][b]); g.lineTo(cx[ci + 1], ys[ci + 1][a]); any = true; }
          if (any) g.stroke();
        }
      }
      g.lineWidth = 0.7;
      edges(0, function (a, b) { return ph[OW1 + a]; }, m1, 1, H1, tc);
      edges(1, function (a, b) { return ph[OW2 + a * H1 + b]; }, m2, H1, H2, tc);
      edges(2, function (a, b) { return ph[OW3 + b]; }, m3, H2, 1, ac);
      g.lineWidth = 1;
      for (c = 0; c < 4; c++) { g.fillStyle = c === 3 ? C.accent : C.text2; for (k = 0; k < cols[c]; k++) { g.beginPath(); g.arc(cx[c], ys[c][k], cols[c] === 1 ? 2.6 : 1.3, 0, TAU); g.fill(); } }
    }
    function curve(xs, ys, x0, x1, y0, y1, R, closeDown) {
      g.beginPath();
      for (var i = 0; i < xs.length; i++) { var px = R.x + (xs[i] - x0) / (x1 - x0) * R.w, py = R.y + R.h - (ys[i] - y0) / (y1 - y0) * R.h; if (i === 0) g.moveTo(px, py); else g.lineTo(px, py); }
      if (closeDown) { g.lineTo(R.x + (xs[xs.length - 1] - x0) / (x1 - x0) * R.w, R.y + R.h); g.lineTo(R.x + (xs[0] - x0) / (x1 - x0) * R.w, R.y + R.h); g.closePath(); }
    }
    var ZS = 61, zsArr = new Float64Array(ZS), phiTrue = new Float64Array(ZS), phiRec = new Float64Array(ZS), sigB = new Float64Array(ZS), sigTrue = new Float64Array(ZS), sigRec = new Float64Array(ZS), zsAbs = new Float64Array(ZS);
    for (var q0 = 0; q0 < ZS; q0++) { zsArr[q0] = -1.5 + 3 * q0 / (ZS - 1); phiTrue[q0] = phiT(zsArr[q0]); zsAbs[q0] = 1.5 * q0 / (ZS - 1); sigB[q0] = dphiB(zsAbs[q0]) * SIGMA_UNIT; sigTrue[q0] = dphiT(zsAbs[q0]) * SIGMA_UNIT; }
    function recCurves() {   // the network's gravity well (zeroed at the midplane) and the mass within each height from its pull
      var p0 = phiNet0();
      for (var i = 0; i < ZS; i++) { phiRec[i] = phiNet(zsArr[i]) - p0; sigRec[i] = forceNet(zsAbs[i]) * SIGMA_UNIT; }
      for (i = 1; i < ZS; i++) if (sigRec[i] < sigRec[i - 1]) sigRec[i] = sigRec[i - 1];   // mass within a height cannot fall: drawn as a running maximum
    }

    var FS = 12, FSS = 11;   // must-read labels, secondary labels (px)
    function lab(t, x, y, o) { o = o || {}; if (o.size == null) o.size = FS; if (o.color == null) o.color = C.text2; if (o.back == null) o.back = true; label(g, t, x, y, o); }
    function fit(cands, avail, size, mono) { for (var i = 0; i < cands.length; i++) if (textW(g, cands[i], { size: size || FS, mono: mono }) <= avail) return cands[i]; return ''; }
    function bandLabel(text, x, w, yc, size) {   // a label inside a narrow shaded band: one line, two lines, or turned on its side
      var words = text.split(' '), tw = textW(g, text, { size: size }), cx = x + w / 2;
      if (tw + 6 <= w) { lab(text, cx, yc + size / 2 - 1, { align: 'center', size: size, back: false }); return; }
      if (words.length === 2 && Math.max(textW(g, words[0], { size: size }), textW(g, words[1], { size: size })) + 6 <= w) {
        lab(words[0], cx, yc - 1, { align: 'center', size: size, back: false }); lab(words[1], cx, yc + size + 1, { align: 'center', size: size, back: false }); return;
      }
      if (size + 4 > w) return;
      g.save(); g.translate(cx + size / 2 - 1, yc); g.rotate(-Math.PI / 2); label(g, text, 0, 0, { align: 'center', size: size, color: C.text2 }); g.restore();
    }

    function draw() {
      var W = S.W, H = S.H; if (!W) return;
      g.fillStyle = C.surface; g.fillRect(0, 0, W, H);
      var L = layout(W, H), P = L.P, Q = L.Q, R = L.R, narrow = W < 520, stage0 = stage, vs = viewStage(), k2; stage = vs;   // draw what the prerequisites allow

      /* ---- phase space: the stars ---- */
      box(g, P);
      g.save(); g.beginPath(); g.rect(P.x + 1, P.y + 1, P.w - 2, P.h - 2); g.clip();   // inside the border: no half-dots on the frame
      g.strokeStyle = C.border; g.beginPath(); g.moveTo(P.x, P.y + P.h / 2 + 0.5); g.lineTo(P.x + P.w, P.y + P.h / 2 + 0.5); g.moveTo(P.x + P.w / 2 + 0.5, P.y); g.lineTo(P.x + P.w / 2 + 0.5, P.y + P.h); g.stroke();
      if (stage >= 2 && psteps > 0) drawTint(P);
      if (starsDirty || starLayer.width === 0) drawStars(P);
      g.globalAlpha = reveal; g.drawImage(starLayer, P.x, P.y, P.w, P.h); g.globalAlpha = 1;
      if (stage >= 1 && fsteps > 0) { if (gridDirty) evalGrid(); if (stage === 1) latticeDraw(P, 0.5); contours(P); }
      // top row: axes left, ranges right, with the light-year anchor next to the first kpc
      var axT = 'height →, vertical speed ↑', axW = textW(g, axT, { size: FS }), rTop = '±' + ZR + ' kpc', anc = '(5,200 light-years)', rx = P.x + P.w - 8;
      var oneLine = axW + textW(g, rTop + ' ' + anc, { size: FSS, mono: true }) + 28 <= P.w;
      lab(axT, P.x + 8, P.y + 17);
      if (oneLine) { var aw = textW(g, anc, { size: FSS }); lab(anc, rx, P.y + 17, { align: 'right', size: FSS }); lab(rTop, rx - aw - 5, P.y + 17, { align: 'right', mono: true, size: FSS }); lab('±' + VR + ' km/s', rx, P.y + 31, { align: 'right', mono: true, size: FSS }); }
      else { lab(rTop, rx, P.y + 17, { align: 'right', mono: true, size: FSS }); lab(anc, rx, P.y + 31, { align: 'right', size: FSS }); lab('±' + VR + ' km/s', rx, P.y + 45, { align: 'right', mono: true, size: FSS }); }
      var colW = Math.max(textW(g, oneLine ? rTop + ' ' + anc : anc, { size: FSS }), textW(g, '±' + VR + ' km/s', { size: FSS, mono: true }));
      if (stage >= 1 && fsteps > 0 && !kicked && !narrow) insDraw(P, 26);   // the normal distribution the flow starts from, and the arrow
      if (kicked) lab(fit(['kicked: the disk is out of balance; press New stars to reset', 'kicked: out of balance; New stars resets', 'kicked: out of balance', 'kicked'], P.w - colW - 28), P.x + 8, P.y + 33, { color: C.accent });
      // the rule on show, with a plain tag; grey, on a solid backing so grid and contours never run through it
      var eq = stage === 1 && fsteps > 0 ? 'log p(x) = log p₀(g(x)) + log |det ∂g/∂x|' : stage >= 2 ? 'v ∂f/∂z − Φ′(z) ∂f/∂v = 0' : '';
      if (eq) {
        var tag = stage === 1 ? 'the rule the flow follows' : 'balance: the rule the stars obey', es = narrow ? FSS : FS, ey = P.y + P.h - 28;
        var ew = Math.max(textW(g, eq, { size: es }), textW(g, tag, { size: FSS })), ex = P.x + P.w - 8;
        g.fillStyle = rgba(C.surface, 0.94); g.fillRect(ex - ew - 5, ey - es - 16, ew + 10, es + 22);
        lab(tag, ex, ey - es - 3, { align: 'right', size: FSS, back: false });
        lab(eq, ex, ey, { align: 'right', size: es, back: false });
      }
      var lg = stage >= 2 ? fit(['lines: where stars crowd; red haze: out of balance', 'red haze: out of balance'], P.w - 16)
             : stage >= 1 && fsteps > 0 ? fit(['red grid: the bell curve’s grid, bent onto the stars; lines: where stars crowd', 'red grid: bell-curve grid bent onto the stars', 'red grid: bent by the flow'], P.w - 16)
             : N.toLocaleString('en-US') + ' model stars';
      lab(lg, P.x + 8, P.y + P.h - 8);
      g.restore();

      /* ---- the gravity well ---- */
      box(g, Q);
      var yPhi = 2950, qBand = Q.w / 6;
      g.save(); g.beginPath(); g.rect(Q.x + 1, Q.y + 1, Q.w - 2, Q.h - 2); g.clip();
      g.strokeStyle = C.border; g.beginPath(); g.moveTo(Q.x + Q.w / 2 + 0.5, Q.y); g.lineTo(Q.x + Q.w / 2 + 0.5, Q.y + Q.h); g.stroke();
      var Qp = { x: Q.x, y: Q.y, w: Q.w, h: Q.h - 18 };
      g.fillStyle = rgba(C.text, 0.05); g.fillRect(Q.x, Q.y, qBand, Q.h); g.fillRect(Q.x + Q.w - qBand, Q.y, qBand, Q.h);   // beyond 1 kpc the stars run out: not trusted
      g.strokeStyle = C.text2; g.setLineDash([4, 4]); g.lineWidth = 1.2; curve(zsArr, phiTrue, -1.5, 1.5, 0, yPhi, Qp); g.stroke(); g.setLineDash([]);
      if (stage >= 2 && psteps > 0) {
        recCurves(); g.strokeStyle = C.accent; g.lineWidth = 2; curve(zsArr.subarray(10, 51), phiRec.subarray(10, 51), -1.5, 1.5, 0, yPhi, Qp); g.stroke(); g.lineWidth = 1;
        var dw = Math.min(84, Q.w * 0.34), dh = Math.min(54, Q.h * 0.3), dx = Q.x + Q.w / 2 - dw / 2, dy = Q.y + 28;
        netDiagram(dx, dy, dw, dh);
        lab('neural network', Q.x + Q.w / 2, dy + dh + 15, { align: 'center', size: FSS });
      }
      if (stage0 >= 2 && !flowReady) lab(fit(['starts once the density is learned', 'waits for the density', 'waits'], Q.w - 2 * qBand - 8, FSS), Q.x + Q.w / 2, Q.y + Q.h / 2, { align: 'center', size: FSS });
      bandLabel('not trusted', Q.x + Q.w - qBand, qBand, Q.y + Qp.h * 0.78, FSS);
      var qT = 'gravity’s well', qR = '±1.5 kpc';
      lab(qT, Q.x + 8, Q.y + 17, { back: false });   // title row and legend row hold no data: no backing (no pills over the bands)
      if (textW(g, qT, { size: FS }) + textW(g, qR, { size: FSS, mono: true }) + 28 <= Q.w) lab(qR, Q.x + Q.w - 8, Q.y + 17, { align: 'right', mono: true, size: FSS, back: false });
      lab(fit(stage >= 2 && psteps > 0 ? ['dashed: truth, red: fit', 'dashed: truth'] : ['dashed: truth'], Q.w - 16), Q.x + 8, Q.y + Q.h - 6, { back: false });
      g.restore();

      /* ---- the mass within each height ---- */
      box(g, R);
      var ySig = narrow ? 125 : 115, rBand = R.w / 3, rT = fit(['mass within each height', 'mass within height', 'mass'], R.w - 16), rR = '0 to 1.5 kpc';
      var rStack = textW(g, rT, { size: FS }) + textW(g, rR, { size: FSS, mono: true }) + 28 > R.w, rTop = rStack ? 36 : 24;
      g.save(); g.beginPath(); g.rect(R.x + 1, R.y + 1, R.w - 2, R.h - 2); g.clip();
      var Rp = { x: R.x, y: R.y, w: R.w, h: R.h - 18 };
      g.fillStyle = rgba(C.text, 0.05); g.fillRect(R.x + R.w - rBand, R.y, rBand, R.h);   // beyond 1 kpc: not trusted
      g.fillStyle = rgba(C.text, 0.1); curve(zsAbs, sigB, 0, 1.5, 0, ySig, Rp, true); g.fill();
      g.strokeStyle = C.text2; g.setLineDash([4, 4]); g.lineWidth = 1.2; curve(zsAbs, sigTrue, 0, 1.5, 0, ySig, Rp); g.stroke(); g.setLineDash([]);
      var rho = null;
      if (stage >= 3 && psteps > 0) {
        var Z1 = 41, nShow = Math.max(2, Math.round(smooth(sweep) * Z1)), slab, i;   // the fit is read to 1 kpc (index 40 of 61 over 1.5 kpc)
        rho = darkMatter(); slab = TAU * G * rho * GEV;
        g.fillStyle = rgba(C.accent, 0.18); g.beginPath();   // the dark-matter slab that explains the fit beyond the ordinary matter
        for (i = 0; i < nShow; i++) g.lineTo(Rp.x + zsAbs[i] / 1.5 * Rp.w, Rp.y + Rp.h - (sigB[i] + 2 * slab * zsAbs[i] * SIGMA_UNIT) / ySig * Rp.h);
        for (i = nShow - 1; i >= 0; i--) g.lineTo(Rp.x + zsAbs[i] / 1.5 * Rp.w, Rp.y + Rp.h - sigB[i] / ySig * Rp.h);
        g.closePath(); g.fill();
        g.strokeStyle = C.accent; g.lineWidth = 2; g.beginPath();
        for (i = 0; i < nShow; i++) { var xq = Rp.x + zsAbs[i] / 1.5 * Rp.w, yq = Rp.y + Rp.h - sigRec[i] / ySig * Rp.h; if (i === 0) g.moveTo(xq, yq); else g.lineTo(xq, yq); }
        g.stroke(); g.lineWidth = 1;
        if (sweep >= 1) {   // the answer, in the empty upper left, with a leader line into the band at 0.9 kpc
          var zl = 0.9, xm = Rp.x + zl / 1.5 * Rp.w, ym = Rp.y + Rp.h - (dphiB(zl) * SIGMA_UNIT + slab * zl * SIGMA_UNIT) / ySig * Rp.h, ax0 = R.x + 8, ay0 = R.y + rTop + 16, avail = R.w - rBand - 12;
          var l1 = kicked ? fit(['dark matter: not a real answer', 'not a real answer'], avail) : fit(['dark matter found: ' + fmt(rho) + ' GeV/cm³', 'dark matter found: ' + fmt(rho), 'dark matter: ' + fmt(rho)], avail), l2 = '';
          if (!l1) { l1 = kicked ? 'dark matter:' : 'dark matter'; l2 = kicked ? 'not real' : 'found ' + fmt(rho); }
          var lw = Math.max(textW(g, l1, { size: FS }), l2 ? textW(g, l2, { size: FS }) : 0), ly = ay0 + (l2 ? 14 : 0);
          g.strokeStyle = rgba(C.accent, 0.75); g.lineWidth = 1; g.beginPath(); g.moveTo(Math.min(ax0 + lw * 0.5, xm - 6), ly + 5); g.lineTo(xm, ym); g.stroke();
          g.fillStyle = C.accent; g.beginPath(); g.arc(xm, ym, 2.5, 0, TAU); g.fill();
          lab(l1, ax0, ay0, { color: C.accent }); if (l2) lab(l2, ax0, ay0 + 14, { color: C.accent, mono: !kicked });
        }
      }
      bandLabel('not trusted', R.x + R.w - rBand, rBand, Rp.y + Rp.h - 0.5 * dphiB(1.25) * SIGMA_UNIT / ySig * Rp.h, FSS);   // inside the grey fill: no curve ever runs there
      lab(rT, R.x + 8, R.y + 17, { back: false });
      lab(rR, R.x + R.w - 8, R.y + (rStack ? 31 : 17), { align: 'right', mono: true, size: FSS, back: false });
      lab(fit(stage >= 3 ? ['grey: ordinary matter, dashed: truth, red: fit', 'grey: ordinary, dashed: truth, red: fit', 'grey: ordinary matter', 'grey: ordinary'] : ['grey: ordinary matter, dashed: truth', 'grey: ordinary matter', 'grey: ordinary'], R.w - 16), R.x + 8, R.y + R.h - 6, { back: false });
      g.restore();

      /* ---- Details: the estimates strip, one tick per settled run at this star count ---- */
      if (L.T) {
        var T = L.T, sp = SPREAD[N], hv = hist[N], lo = -0.6, hi = 1.0, xa = T.x + 14, xb = T.x + T.w - 14, yl = T.y + 31;
        var X = function (v) { return xa + (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo) * (xb - xa); };
        box(g, T);
        g.save(); g.beginPath(); g.rect(T.x + 1, T.y + 1, T.w - 2, T.h - 2); g.clip();
        var nS = N.toLocaleString('en-US');
        lab(fit(kicked ? ['your runs at ' + nS + ' stars; kicked runs are not counted', 'runs at ' + nS + ' stars; kicked: not counted', 'runs at ' + nS + ' stars'] : ['your runs at ' + nS + ' stars, one tick each; shade: the usual range', 'your runs at ' + nS + ' stars; shade: usual range', 'runs at ' + nS + ' stars; shade: usual', 'runs at ' + nS + ' stars'], T.w - 16), T.x + 8, T.y + 16, { back: false });
        g.fillStyle = rgba(C.text, 0.1); g.fillRect(X(sp[0] - sp[1]), yl - 7, X(sp[0] + sp[1]) - X(sp[0] - sp[1]), 14);
        g.strokeStyle = C.borderStrong; g.beginPath(); g.moveTo(xa, yl + 0.5); g.lineTo(xb, yl + 0.5); g.stroke();
        g.strokeStyle = C.text2; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(X(RHO) + 0.5, yl - 9); g.lineTo(X(RHO) + 0.5, yl + 9); g.stroke(); g.setLineDash([]);
        g.strokeStyle = C.text2; g.lineWidth = 2; g.beginPath();
        for (k2 = 0; k2 < hv.length; k2++) { g.moveTo(X(hv[k2]), yl - 6); g.lineTo(X(hv[k2]), yl + 6); }
        g.stroke(); g.lineWidth = 1;
        var cur = (rho != null && !kicked) ? rho : null, yb = T.y + T.h - 7;
        if (cur != null) { g.strokeStyle = C.accent; g.lineWidth = 3; g.beginPath(); g.moveTo(X(cur), yl - 9); g.lineTo(X(cur), yl + 9); g.stroke(); g.lineWidth = 1; }
        var tL = 'true 0.32', cL = cur != null ? 'this run ' + fmt(cur) : '', right = cur == null || cur < RHO;   // the two labels lean away from each other
        lab(tL, right ? X(RHO) + 5 : X(RHO) - 5, yb, { align: right ? 'left' : 'right', mono: true, size: FSS, back: false });
        if (cL) lab(cL, right ? X(cur) - 5 : X(cur) + 5, yb, { align: right ? 'right' : 'left', mono: true, size: FSS, color: C.accent, back: false });
        g.restore();
      }

      stage = stage0;
      var moving = auto || (stage >= 1 && !fconv) || (stage >= 2 && !pconv) || (stage >= 3 && sweep < 1) || (kicked && tEv < 10) || reveal < 1;
      return moving ? undefined : false;
    }

    sample(); initFlow(); initNet(); setStageUI(); setNUI(); starsDirty = true;
    var run = loop(cv, step, draw, null, { drawEvery: 2 });
    detailsOpen = E.more(fig, function () { starsDirty = true; run.wake(); run.redraw(); });
    S.onresize = function () { starsDirty = true; run.wake(); run.redraw(); };
    E.onTheme.push(function () { starsDirty = true; insDirty = true; run.wake(); run.redraw(); });
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { insDirty = true; run.wake(); });
    if (run.still) { auto = false; stage = 3; setStageUI(); stillRun(); run.redraw(); }
    run.onVisible(function () { if (played || run.still) return; played = true; auto = true; stage = 0; tStage = 0; reveal = 1; setStageUI(); run.wake(); });
    stageBtns.forEach(function (b) { b.addEventListener('click', function () { setStage(+b.getAttribute('data-stage'), true); if (run.still) { if (!fconv || !pconv) stillRun(); run.redraw(); } }); });
    nBtns.forEach(function (b) { b.addEventListener('click', function () { var n = +b.getAttribute('data-n'); if (n === N && !kicked) return; N = n; setNUI(); restart(); }); });
    if (sampleBtn) sampleBtn.addEventListener('click', restart);
    if (kickBtn) kickBtn.addEventListener('click', kick);
    function inStars(e) { var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, P = layout(S.W, S.H).P; return x >= P.x && x <= P.x + P.w && y >= P.y && y <= P.y + P.h; }
    cv.addEventListener('click', function (e) { if (inStars(e)) kick(); });   // the stars are the natural thing to poke: a tap on them kicks the disk
    var curPtr = '';
    cv.addEventListener('pointermove', function (e) { var c = e.pointerType === 'mouse' && inStars(e) ? 'pointer' : ''; if (c !== curPtr) { curPtr = c; cv.style.cursor = c; } });
    updateReads();
  }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(demoClear); else demoClear();
})();
