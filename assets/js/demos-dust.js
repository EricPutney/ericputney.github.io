/* Fig. 2 Sweeping the dust away. Model stars drift around the Sun; the real 3D dust map (Lallement et al. 2022) and any dust the
   visitor paints hide the stars behind it. Views: from above, the whole sky (Mollweide, Galactic centre in the middle, longitude
   growing to the left), and a close-up of one real cloud with the same stars by distance. Modes: what Gaia sees; the dust found
   from the missing stars (under Details); the dust swept away, with the hidden stars put back in red.
   Final round (2026-10-28): plain-word labels in light-years (no l/b), a bold arrival stroke that leaves a pulsing brush with its
   hint, the close-up in the first row of controls (the cloud choice and "Find the dust" under Details), readouts that count the
   close-up's own stars, a reveal that shows within half a second and is now drawn the right way round (it was rotated 180 degrees,
   its outline transposed), smooth sky tints, and a disc framed clear of the panel.
   Needs demos.js and demos-data.js loaded first. */
(function () {
  'use strict';
  var E = window.EPDemos, H = window.EPDemosHelpers; if (!E || !H) return;
  var C = E.C, RM = E.RM, rgba = E.rgba, gauss = E.gauss, makeCanvas = E.makeCanvas, loop = E.loop;
  var label = E.label, textW = E.textW, box = E.box, setOut = E.setOut, KPC_KMS = E.KPC_KMS;
  var TAU = Math.PI * 2, DEG = Math.PI / 180;
  var fetchJSON = H.fetchJSON, whenNear = H.whenNear, note = H.note, failed = H.failed, enable = H.enable, interp1 = H.interp1, seg = H.seg, topDown = H.topDown, dustRGB = H.dustRGB;

  function demoDust() {
    var fig = document.getElementById('demo-dust'); if (!fig) return;
    var cv = fig.querySelector('canvas'), S = makeCanvas(cv), g = S.ctx, stage = fig.querySelector('.demo__stage');
    var outSeen = fig.querySelector('[data-out="seen"]'), outHid = fig.querySelector('[data-out="hid"]'), clearBtn = fig.querySelector('[data-ctl="clear"]');
    var small = window.innerWidth < 520, coarse = matchMedia('(pointer: coarse)').matches;
    var HALF = 2.5, PAD = 12, N = small ? 10000 : 16000, k, tick = 0;
    var X = new Float32Array(N), Y = new Float32Array(N), Z = new Float32Array(N), VX = new Float32Array(N), VY = new Float32Array(N), U = new Float32Array(N);
    var PX = new Float32Array(N), PY = new Float32Array(N), VIS = new Uint8Array(N), LL = new Float32Array(N), BB = new Float32Array(N);
    function spawn(k) {   // a thin disk population inside the 2.5 kpc ball, 70 pc scale height, moving in the plane
      do { X[k] = (Math.random() * 2 - 1) * HALF; Y[k] = (Math.random() * 2 - 1) * HALF; } while (X[k] * X[k] + Y[k] * Y[k] > HALF * HALF);
      Z[k] = (Math.random() < 0.5 ? -1 : 1) * Math.min(0.5, 0.07 * -Math.log(1 - Math.random()));
      VX[k] = 30 * gauss(); VY[k] = 30 * gauss(); U[k] = Math.random();
    }
    for (k = 0; k < N; k++) spawn(k);
    // Brightness: a star survives dimming while its margin U stays below the kept fraction, so a small U is a bright star.
    // Three classes drawn at three sizes, so that under heavy dust only the big dots remain and the picture explains itself.
    function classOf(u) { return u < 0.15 ? 2 : u < 0.5 ? 1 : 0; }
    function classIdx(Us, n) { var a = [[], [], []]; for (var i = 0; i < n; i++) a[classOf(Us[i])].push(i); return a.map(function (x) { return Int32Array.from(x); }); }
    var IDX = classIdx(U, N), SIZE_TOP = [1.0, 1.5, 2.3], SIZE_SKY = small ? [1.2, 1.8, 2.6] : [1.3, 2.0, 2.9], SIZE_ZOOM = small ? [1.6, 2.3, 3.2] : [1.8, 2.6, 3.6], ALPHA = [0.32, 0.55, 0.85];
    var fadeSwept = 0, fadeReveal = 0, revealAge = 99, demoStroke = null, park = null, DB = [0, 0];
    function dotsCls(idx, xs, ys, vis, want, size, every) {   // one path per class: the stars whose visibility is `want`
      var n = idx.length, h = size / 2, i, st = every || 1;
      g.beginPath();
      for (i = 0; i < n; i += st) { var q = idx[i]; if (vis[q] !== want) continue; g.rect(xs[q] - h, ys[q] - h, size, size); }
      g.fill();
    }
    function drawStars(idx, xs, ys, vis, sizes, every) {
      var c, dim = 1 - 0.45 * fadeSwept;   // with the dust swept away the seen stars step back, so the red reads
      for (c = 0; c < 3; c++) { g.fillStyle = rgba(C.text, ALPHA[c] * dim); dotsCls(idx[c], xs, ys, vis, 1, sizes[c], every); }
      if (fadeSwept > 0) {   // the stars the dust hid, put back in red (no halo: the dust is swept back to a ghost in this mode)
        g.globalAlpha = 0.85 * fadeSwept; g.fillStyle = C.accent;
        for (c = 0; c < 3; c++) dotsCls(idx[c], xs, ys, vis, 0, sizes[c] + 0.5, every);
        g.globalAlpha = 1;
      }
    }

    // ---- painted dust. From above: a polar grid around the Sun (magnitudes per cell, summed outward into CUM) so it shadows
    // everything behind it. On the sky: a 1-degree (l, b) grid holding magnitudes and the distance of the paint.
    var A_MAX = 20;   // painted dimming saturates at 20 mag (RVS band), like a dense cloud core; enough to hide every model star
    var NA = 180, ND = 50, DR = HALF / ND, PT = new Float32Array(NA * ND), CUM = new Float32Array(NA * ND), painted = false;
    var SKA = new Float32Array(360 * 180), SKD = new Float32Array(360 * 180), skyPainted = false;
    var PASS = 2.5, RHO_T = 0.2, STEP_T = 0.04, SIG_ALL = 5 * DEG, SIG_ZOOM = 2 * DEG, PAINT_D = 0.25;   // magnitudes per pass at a stroke's centre; brush sizes; sky paint 250 pc out
    var D = null, G3 = null, mode = 'observed', view = 'top', cloudKey = 'California', dirty = true, skyDirty = true, dirtyP = true, dirtyZ = true, hidden = 0, hiddenZ = 0;
    var brush = null, hover = null, hoverSky = null, hoverZ = null, painting = null, armed = false, armedAt = 0, usedTop = false, usedSky = false, usedZoom = false;
    var ZS = [0.02, 0.06, 0.12, 0.2, 0.32], WS = [0.33, 0.27, 0.2, 0.13, 0.07];   // the population's heights and their weights, for expected hidden fractions
    var EA = null, EE = null, AJ = 2, EJ = 0.35, SLOPE = 0.55;   // the dust map's own relation between dimming A (mag) and the fraction kept, measured at load
    var AN = 101, layer = document.createElement('canvas'); layer.width = AN; layer.height = AN; var lg = layer.getContext('2d'), img = lg.createImageData(AN, AN);
    var layerP = document.createElement('canvas'); layerP.width = AN; layerP.height = AN; var lgp = layerP.getContext('2d'), imgP = lgp.createImageData(AN, AN), TOPS = new Float32Array(AN * AN);
    var RG = 25, seenT = new Float32Array(RG * RG), allT = new Float32Array(RG * RG), expT = new Float32Array(RG * RG), rev = document.createElement('canvas'); rev.width = RG; rev.height = RG; var rg = rev.getContext('2d'), rimg = rg.createImageData(RG, RG);
    var SGX = 48, SGY = 24, seenS = new Float32Array(SGX * SGY), allS = new Float32Array(SGX * SGY), RVS = new Float32Array(SGX * SGY);
    var LAMB = 0.997, KW = 40, revAt = [0, 0, 0];   // memory of the reveal maps and the confidence weight; when each reveal image was last rebuilt
    var MS = [[], [3, 0], [0, 1], [3, 1], [1, 2], [3, 0, 1, 2], [0, 2], [3, 2], [2, 3], [0, 2], [0, 1, 2, 3], [1, 2], [1, 3], [0, 1], [0, 3], []];   // marching squares: edge pairs per corner case
    var DASH = [4, 3], SOLID = [], DOTS = [3, 4];

    // ---- the Mollweide sky: equal-area, Galactic centre in the middle, longitude growing to the left
    var TN = 2048, CT = new Float32Array(TN), ST = new Float32Array(TN);   // cos and sin of the Mollweide angle, tabulated against sin(latitude)
    (function () {
      for (var i = 0; i < TN; i++) {
        var s = -1 + 2 * i / (TN - 1), th = Math.asin(Math.max(-1, Math.min(1, s)));
        for (var it = 0; it < 8; it++) { var df = 2 + 2 * Math.cos(2 * th); if (Math.abs(df) < 1e-6) break; th -= (2 * th + Math.sin(2 * th) - Math.PI * s) / df; }
        CT[i] = Math.cos(th); ST[i] = Math.sin(th);
      }
    })();
    function skyGeom(p) { var m = 4, ay = Math.min(p.h / 2 - m, p.w / 4 - m), ax = 2 * ay; return { cx: p.x + p.w / 2, cy: p.y + p.h / 2, ax: ax, ay: ay }; }
    function proj(Gm, l, sinb, out, o) {   // longitude in radians (any range), sine of latitude -> screen
      if (l > Math.PI) l -= TAU; if (l < -Math.PI) l += TAU;
      var ti = ((sinb + 1) * 0.5 * (TN - 1) + 0.5) | 0; if (ti < 0) ti = 0; if (ti >= TN) ti = TN - 1;
      out[o] = Gm.cx - (l / Math.PI) * CT[ti] * Gm.ax; out[o + 1] = Gm.cy - ST[ti] * Gm.ay;
    }
    var P2 = new Float32Array(2);
    function unproj(Gm, px, py) {   // screen -> [longitude, latitude] in radians, or null outside the sky
      var x = -(px - Gm.cx) / Gm.ax, y = (Gm.cy - py) / Gm.ay; if (x * x + y * y > 1) return null;
      var th = Math.asin(Math.max(-1, Math.min(1, y))), phi = Math.asin(Math.max(-1, Math.min(1, (2 * th + Math.sin(2 * th)) / Math.PI))), ct = Math.cos(th);
      var lam = ct > 1e-6 ? Math.PI * x / ct : 0; if (Math.abs(lam) > Math.PI) return null;
      return [lam, phi];
    }
    function skyCell(l, b) {   // the 1-degree paint cell of a direction
      var i = Math.floor((((l % TAU) + TAU) % TAU) / DEG) % 360, j = Math.floor((b + Math.PI / 2) / DEG); if (j < 0) j = 0; if (j > 179) j = 179;
      return j * 360 + i;
    }
    // sky images: a pixel lookup of the sky's (l, b), built once; the dust tint, the painted tint and the stars' reveal map draw through it
    var SW = 256, SH = 128, SL = new Float32Array(SW * SH), SB = new Float32Array(SW * SH), SIN = new Uint8Array(SW * SH), SKC = new Int32Array(SW * SH), SFX = new Float32Array(SW * SH), SFY = new Float32Array(SW * SH);
    (function () {
      var Gm = { cx: SW / 2, cy: SH / 2, ax: SW / 2, ay: SH / 2 };
      for (var j = 0; j < SH; j++) for (var i = 0; i < SW; i++) {
        var lb = unproj(Gm, i + 0.5, j + 0.5), o = j * SW + i;
        if (!lb) { SIN[o] = 0; continue; }
        SIN[o] = 1; SL[o] = lb[0]; SB[o] = lb[1]; SKC[o] = skyCell(lb[0], lb[1]);
        SFX[o] = (0.5 - lb[0] / TAU) * SGX - 0.5; SFY[o] = (0.5 - lb[1] / Math.PI) * SGY - 0.5;   // fractional reveal cell, for a smooth (bilinear) sky reveal
      }
    })();
    function offCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
    var sky = offCanvas(SW, SH), sg = sky.getContext('2d'), simg = sg.createImageData(SW, SH);
    var skyP = offCanvas(SW, SH), spg = skyP.getContext('2d'), spimg = spg.createImageData(SW, SH);
    var revS = offCanvas(SW, SH), rsg = revS.getContext('2d'), rsimg = rsg.createImageData(SW, SH);

    function eps3(u, v, w) {   // dust-map efficiency (fraction of the sample Gaia keeps) at a Sun-centred point, nearest 100 pc voxel
      if (!G3) return 1;
      var i = Math.round((u + HALF) / 0.1), j = Math.round((v + HALF) / 0.1), q = Math.round((w + HALF) / 0.1);
      if (i < 0 || j < 0 || q < 0 || i > 49 || j > 49 || q > 49) return 1;
      var b = G3[i * 2500 + j * 50 + q]; return b ? (b - 1) / 254 : 1;
    }
    function eps3s(u, v, w) {   // the same, interpolated between voxels (the sky and the close-ups would show the voxels otherwise)
      if (!G3) return 1;
      var fi = (u + HALF) / 0.1, fj = (v + HALF) / 0.1, fq = (w + HALF) / 0.1, i0 = Math.floor(fi), j0 = Math.floor(fj), q0 = Math.floor(fq);
      var tx = fi - i0, ty = fj - j0, tz = fq - q0, s = 0;
      for (var c = 0; c < 8; c++) {
        var di = c & 1, dj = (c >> 1) & 1, dq = c >> 2, i = i0 + di, j = j0 + dj, q = q0 + dq, e = 1;
        if (i >= 0 && j >= 0 && q >= 0 && i < 50 && j < 50 && q < 50) { var b = G3[i * 2500 + j * 50 + q]; if (b) e = (b - 1) / 254; }
        s += (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dq ? tz : 1 - tz) * e;
      }
      return s;
    }
    // painted dimming -> fraction kept: the map's own relation where it is measured, then its fitted exponential tail, no floor
    function epsOfPaint(A) {
      if (A <= 0) return 1; if (A > A_MAX) A = A_MAX;
      if (!EA) return Math.exp(-SLOPE * A);
      if (A <= EA[0]) return 1;
      if (A <= AJ) return interp1(EA, EE, A) / EE[0];
      return EJ * Math.exp(-SLOPE * (A - AJ));
    }
    function polarIdx(u, v) { var a = Math.floor((Math.atan2(v, u) + Math.PI) / TAU * NA) % NA, d = Math.min(ND - 1, Math.floor(Math.hypot(u, v) / DR)); return a * ND + d; }
    function paintAt(u, v) { return painted ? CUM[polarIdx(u, v)] : 0; }
    function skyPaintAs(l, b, d) {   // the sky paint in front of distance d, interpolated between the 1-degree cells, for the close-up
      if (!skyPainted) return 0;
      var fx = (((l % TAU) + TAU) % TAU) / DEG - 0.5, fy = (b + Math.PI / 2) / DEG - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fy), tx = fx - i0, ty = fy - j0, s = 0;
      for (var c = 0; c < 4; c++) {
        var di = c & 1, dj = c >> 1, o = Math.max(0, Math.min(179, j0 + dj)) * 360 + (((i0 + di) % 360) + 360) % 360;
        if (d > SKD[o]) s += (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * SKA[o];
      }
      return s;
    }
    function touched() { if (clearBtn) clearBtn.hidden = false; dirtyP = true; dirtyZ = true; }
    function dab(u, v, amt, rad) {   // one Gaussian dab into the polar grid; amt in magnitudes per cell at the centre
      var r = Math.hypot(u, v); if (r < 0.1 || r > HALF) return;
      var a0 = Math.atan2(v, u), da = Math.min(Math.PI, 2.5 * rad / r);
      var ia0 = Math.floor((a0 - da + Math.PI) / TAU * NA), ia1 = Math.ceil((a0 + da + Math.PI) / TAU * NA);
      var id0 = Math.max(0, Math.floor((r - 2.5 * rad) / DR)), id1 = Math.min(ND - 1, Math.ceil((r + 2.5 * rad) / DR));
      for (var ia = ia0; ia <= ia1; ia++) {
        var a = ((ia % NA) + NA) % NA, ang = -Math.PI + (a + 0.5) * TAU / NA, id, acc = 0;
        for (id = id0; id <= id1; id++) {
          var rr = (id + 0.5) * DR, dx = rr * Math.cos(ang) - u, dy = rr * Math.sin(ang) - v, w = amt * Math.exp(-(dx * dx + dy * dy) / (2 * rad * rad));
          if (w > 1e-5) { var o = a * ND + id; PT[o] = Math.min(A_MAX, PT[o] + w); }
        }
        for (id = 0; id < ND; id++) { acc += PT[a * ND + id]; CUM[a * ND + id] = Math.min(A_MAX, acc); }
      }
      painted = true; psDirty = true; touched();
    }
    // a stroke lays dabs at a fixed spacing, sized so one pass adds PASS magnitudes on the line of sight through its centre
    var AMT_T = PASS * STEP_T * DR / (TAU * RHO_T * RHO_T), carryT = 0, carryS = 0;
    function strokeTop(u0, v0, u1, v1, pass) {
      var du = u1 - u0, dv = v1 - v0, L = Math.hypot(du, dv), a = AMT_T * pass / PASS, t = STEP_T - carryT;
      while (t <= L) { dab(u0 + du * t / L, v0 + dv * t / L, a, RHO_T); t += STEP_T; }
      carryT = L - (t - STEP_T);
    }
    function dabSky(l0, b0, amt, sig, dist) {   // one Gaussian dab on the sky, amt in magnitudes at the centre, at a distance
      var R = 3 * sig, c2 = Math.cos(R), sb0 = Math.sin(b0), cb0 = Math.cos(b0);
      var j0 = Math.max(0, Math.floor((b0 - R + Math.PI / 2) / DEG)), j1 = Math.min(179, Math.floor((b0 + R + Math.PI / 2) / DEG));
      for (var j = j0; j <= j1; j++) {
        var b = -Math.PI / 2 + (j + 0.5) * DEG, cb = Math.cos(b), sb = Math.sin(b), dl = cb > 0.05 ? Math.min(Math.PI, R / cb) : Math.PI;
        var i0 = Math.floor((l0 - dl) / DEG), i1 = Math.floor((l0 + dl) / DEG);
        for (var ii = i0; ii <= i1; ii++) {
          var cosd = sb * sb0 + cb * cb0 * Math.cos((ii + 0.5) * DEG - l0); if (cosd < c2) continue;
          var th = Math.acos(Math.min(1, cosd)), w = amt * Math.exp(-th * th / (2 * sig * sig)), o = j * 360 + (((ii % 360) + 360) % 360);
          var A0 = SKA[o], A1 = Math.min(A_MAX, A0 + w); if (A1 <= A0) continue;
          SKD[o] = A0 > 0 ? (SKD[o] * A0 + dist * (A1 - A0)) / A1 : dist; SKA[o] = A1;
        }
      }
      skyPainted = true; touched();
    }
    function strokeSky(l0, b0, l1, b1, pass, sig, dist) {
      var dl = l1 - l0; if (dl > Math.PI) dl -= TAU; if (dl < -Math.PI) dl += TAU;
      var cb = Math.cos(0.5 * (b0 + b1)), db = b1 - b0, L = Math.hypot(dl * cb, db), st = sig / 3, a = pass * st / (Math.sqrt(TAU) * sig), t = st - carryS;
      while (t <= L) { dabSky(l0 + dl * t / L, b0 + db * t / L, a, sig, dist); t += st; }
      carryS = L - (t - st);
    }
    function clearPaint() { PT.fill(0); CUM.fill(0); SKA.fill(0); SKD.fill(0); painted = false; skyPainted = false; dirtyP = true; dirtyZ = true; psDirty = true; if (clearBtn) clearBtn.hidden = true; }
    function updateVis() {   // which stars Gaia keeps; the (l, b) of each only when the sky needs it
      hidden = 0;
      var lb = view === 'sky' || skyPainted;
      for (var k = 0; k < N; k++) {
        var x = X[k], y = Y[k], z = Z[k], e = eps3(x, y, z), A = 0;
        if (lb) {
          var rr = Math.sqrt(x * x + y * y), l = Math.atan2(y, -x), b = Math.atan2(z, rr); LL[k] = l; BB[k] = b;
          if (skyPainted) { var o = skyCell(l, b); if (Math.sqrt(rr * rr + z * z) > SKD[o]) A += SKA[o]; }
        }
        if (painted) A += CUM[polarIdx(x, y)];
        if (A > 0) e *= epsOfPaint(A);
        VIS[k] = U[k] < e ? 1 : 0; if (!VIS[k]) hidden++;
      }
    }
    function tintRGBA(d, o, a) { var base = dustRGB(); d[o] = base[0]; d[o + 1] = base[1]; d[o + 2] = base[2]; d[o + 3] = Math.max(0, Math.min(255, a * 255)) | 0; }
    function paintTint(A) { return 0.9 * (1 - Math.exp(-A / 3)); }   // darker with every pass, never opaque
    function buildLayer() {   // from above: the expected hidden fraction per 50 pc pixel from the 3D map, with the population's heights, soft at the disc edge
      var d = img.data, i, j, q;
      for (i = 0; i < AN; i++) for (j = 0; j < AN; j++) {
        var u = -HALF + 0.05 * i, v = -HALF + 0.05 * j, r = Math.hypot(u, v), a = 0;
        if (D && r < HALF) { var sum = 0; for (q = 0; q < 5; q++) sum += WS[q] * 0.5 * (eps3s(u, v, ZS[q]) + eps3s(u, v, -ZS[q])); a = Math.min(0.8, 1.1 * (1 - sum)) * Math.min(1, (HALF - r) / 0.2); }   // interpolated: no 100 pc steps
        tintRGBA(d, (i * AN + (AN - 1 - j)) * 4, a);   // row: u (down, away from the Galactic centre); column: v flipped (l = 90 to the left)
      }
      lg.putImageData(img, 0, 0); dirty = false;
    }
    function buildPainted() {   // whatever the visitor painted, shown in every view: from above, and on the sky
      var d = imgP.data, i, j, o;
      TOPS.fill(0);
      if (skyPainted) for (o = 0; o < 360 * 180; o++) {   // sky paint seen from above: at its distance, in its direction
        if (SKA[o] <= 0) continue;
        var bl = -Math.PI / 2 + ((o / 360 | 0) + 0.5) * DEG, ll = ((o % 360) + 0.5) * DEG, rr = SKD[o] * Math.cos(bl);
        var ti = Math.round((-rr * Math.cos(ll) + HALF) / 0.05), tj = Math.round((rr * Math.sin(ll) + HALF) / 0.05);
        for (var di = -1; di <= 1; di++) for (var dj = -1; dj <= 1; dj++) { var a2 = ti + di, b2 = tj + dj; if (a2 >= 0 && b2 >= 0 && a2 < AN && b2 < AN) { var t = a2 * AN + b2; if (SKA[o] > TOPS[t]) TOPS[t] = SKA[o]; } }
      }
      for (i = 0; i < AN; i++) for (j = 0; j < AN; j++) {
        var u = -HALF + 0.05 * i, v = -HALF + 0.05 * j, rim = Math.max(0, Math.min(1, (HALF + 0.025 - Math.hypot(u, v)) / 0.05));   // masked to the disc, so it needs no clip
        tintRGBA(d, (i * AN + (AN - 1 - j)) * 4, rim * Math.max(painted ? 0.85 * (1 - Math.exp(-PT[polarIdx(u, v)] / 0.6)) : 0, paintTint(TOPS[i * AN + j])));
      }
      lgp.putImageData(imgP, 0, 0);
      var ds = spimg.data, tot = new Float32Array(NA), sig = new Float32Array(NA), aa, id;
      if (painted) for (aa = 0; aa < NA; aa++) {   // per longitude: the total painted extinction and the mean distance of the paint (sets how tall the cloud looks)
        var t2 = 0, m = 0; for (id = 0; id < ND; id++) { var w = PT[aa * ND + id]; t2 += w; m += w * (id + 0.5) * DR; }
        tot[aa] = t2; sig[aa] = t2 > 0 ? Math.max(0.06, Math.atan(0.1 / (m / t2))) : 0.1;
      }
      for (o = 0; o < SW * SH; o++) {
        var a = 0;
        if (SIN[o]) {
          if (painted) { var l = SL[o], ang = Math.floor((Math.atan2(Math.sin(l), -Math.cos(l)) + Math.PI) / TAU * NA) % NA, sg3 = sig[ang]; a = paintTint(tot[ang]) * Math.exp(-(SB[o] * SB[o]) / (2 * sg3 * sg3)); }
          if (skyPainted) a = Math.max(a, paintTint(SKA[SKC[o]]));
        }
        tintRGBA(ds, o * 4, a);
      }
      spg.putImageData(spimg, 0, 0); dirtyP = false;
    }
    function buildSky() {   // on the sky: the efficiency 1 kpc out in every direction, as a tint (interpolated, so no voxel blocks)
      var d = simg.data;
      for (var o = 0; o < SW * SH; o++) {
        if (!SIN[o]) { d[o * 4 + 3] = 0; continue; }
        var l = SL[o], b = SB[o], cb = Math.cos(b);
        tintRGBA(d, o * 4, 1.15 * (1 - eps3s(-cb * Math.cos(l), cb * Math.sin(l), Math.sin(b))));
      }
      sg.putImageData(simg, 0, 0); skyDirty = false;
    }
    // the dust as the stars reveal it: where fewer stars are seen than counted, weighted by confidence.
    // 0: from above, 1: the sky (bilinear between cells), 2: the close-up (its own stars). Rebuilt at most every 150 ms: the counts change slowly.
    function buildReveal(which) {
      var now = performance.now(); if (now - revAt[which] < 150) return; revAt[which] = now;
      var i, j, o, d, c;
      if (which === 0) {
        d = rimg.data;
        for (j = 0; j < RG; j++) for (i = 0; i < RG; i++) {   // pixel (column i, row j): u index j (down), v index RG-1-i (l = 90 to the left), as the stars are drawn
          c = (RG - 1 - i) * RG + j; tintRGBA(d, (j * RG + i) * 4, Math.min(0.8, 1.1 * (allT[c] - seenT[c]) / (allT[c] + KW)));
        }
        rg.putImageData(rimg, 0, 0);
      } else if (which === 1) {
        for (o = 0; o < SGX * SGY; o++) RVS[o] = Math.min(0.8, 1.1 * (allS[o] - seenS[o]) / (allS[o] + KW));
        d = rsimg.data;
        for (o = 0; o < SW * SH; o++) {
          if (!SIN[o]) { d[o * 4 + 3] = 0; continue; }
          var fx = SFX[o], fy = SFY[o], x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
          var xa = (x0 + SGX) % SGX, xb = (x0 + 1) % SGX, ya = y0 < 0 ? 0 : y0, yb = y0 + 1 > SGY - 1 ? SGY - 1 : y0 + 1;
          tintRGBA(d, o * 4, (1 - ty) * ((1 - tx) * RVS[ya * SGX + xa] + tx * RVS[ya * SGX + xb]) + ty * ((1 - tx) * RVS[yb * SGX + xa] + tx * RVS[yb * SGX + xb]));
        }
        rsg.putImageData(rsimg, 0, 0);
      } else {
        d = zrvd.data;
        for (o = 0; o < NZX * NZY; o++) tintRGBA(d, o * 4, Math.min(0.8, 1.1 * (zAll[o] - zSeen[o]) / (zAll[o] + KWZ)));
        zrvc.putImageData(zrvd, 0, 0);
      }
    }
    function accumulate() {
      var k, i;
      for (i = 0; i < RG * RG; i++) { seenT[i] *= LAMB; allT[i] *= LAMB; }
      var sk = view === 'sky';   // each view counts its own reveal map
      if (sk) for (i = 0; i < SGX * SGY; i++) { seenS[i] *= LAMB; allS[i] *= LAMB; }
      for (k = 0; k < N; k++) {
        var ci = Math.min(RG - 1, ((X[k] + HALF) / (2 * HALF) * RG) | 0), cj = Math.min(RG - 1, ((Y[k] + HALF) / (2 * HALF) * RG) | 0), ct = cj * RG + ci;
        allT[ct] += 1; seenT[ct] += VIS[k];
        if (!sk) continue;
        var si = Math.min(SGX - 1, Math.max(0, ((0.5 - LL[k] / TAU) * SGX) | 0)), sj = Math.min(SGY - 1, Math.max(0, ((0.5 - BB[k] / Math.PI) * SGY) | 0)), cs = sj * SGX + si;
        allS[cs] += 1; seenS[cs] += VIS[k];
      }
    }

    // ---- the close-up of one cloud: a field of stars drifting slowly past it (illustrative), at distances from a third to three times
    // the cloud's; each is dimmed by the 3D map (and any paint) at its own position, so the ones behind the dust fade and the nearer ones stay
    var ZN = small ? 700 : 1100, ZLo = new Float32Array(ZN), ZB = new Float32Array(ZN), ZD = new Float32Array(ZN), ZU = new Float32Array(ZN), ZW = new Float32Array(ZN);
    var ZA = new Float32Array(ZN), ZV = new Uint8Array(ZN), ZPX = new Float32Array(ZN), ZPY = new Float32Array(ZN), ZSY = new Float32Array(ZN), ZQ = new Uint8Array(ZN);
    for (k = 0; k < ZN; k++) ZU[k] = Math.random();
    var ZIDX = classIdx(ZU, ZN), Z0 = null, zThrottle = 0, CL = null, clPending = null, PSIG = new Float32Array(NA), psDirty = true;   // CL: the 50 pc cut-outs around the close-up clouds, by key
    var ZIW = 112, zimg = offCanvas(ZIW, 48), zctx = zimg.getContext('2d'), zdat = null, ZSW = 112, ZSH = 28, zstr = offCanvas(ZSW, ZSH), zsctx = zstr.getContext('2d'), zsdat = zsctx.createImageData(ZSW, ZSH);
    var NZX = 18, NZY = 8, KWZ = 15, zSeen = new Float32Array(NZX * NZY), zAll = new Float32Array(NZX * NZY), zrv = offCanvas(NZX, NZY), zrvc = zrv.getContext('2d'), zrvd = zrvc.createImageData(NZX, NZY);   // the close-up's own reveal grid
    var FALLBACK = { 'California': [0.47, 30], 'Vela A': [0.68, 24], 'Cygnus X North': [1.4, 24] };   // distance (kpc) and half-width (deg) if the cut-outs do not load
    var NAMES = { 'Cygnus X North': 'Cygnus X' };
    function zoomGeom(p) {
      var sh = Math.round(p.h * (p.w < 460 ? 0.32 : 0.27)), gap = 8, fh = p.h - sh - gap, f = { x: p.x, y: p.y, w: p.w, h: fh };
      return { f: f, s: { x: p.x, y: p.y + fh + gap, w: p.w, h: sh }, kx: (f.w / 2) / Z0.hw, cx: f.x + f.w / 2, cy: f.y + fh / 2, hh: Z0.hw * fh / f.w };
    }
    function cutA(c, u, v, w) {   // cumulative A (mag) from a 50 pc cut-out, trilinear; above or below the dust slab, the point where the sightline leaves it
      var top = c.w0 + 0.05 * (c.nz - 1), f;
      if (w > top) { f = top / w; u *= f; v *= f; w = top; } else if (w < c.w0) { f = c.w0 / w; u *= f; v *= f; w = c.w0; }
      var fi = (u - c.u0) / 0.05, fj = (v - c.v0) / 0.05, fk = (w - c.w0) / 0.05, i0 = Math.floor(fi), j0 = Math.floor(fj), k0 = Math.floor(fk), tx = fi - i0, ty = fj - j0, tz = fk - k0, s = 0;
      for (var q = 0; q < 8; q++) {
        var di = q & 1, dj = (q >> 1) & 1, dk = q >> 2;
        var i = Math.min(c.nx - 1, Math.max(0, i0 + di)), j = Math.min(c.ny - 1, Math.max(0, j0 + dj)), k = Math.min(c.nz - 1, Math.max(0, k0 + dk));
        s += (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz) * c.data[(i * c.ny + j) * c.nz + k];
      }
      return s * c.unit;
    }
    function zEps(l, b, d) {   // what the dust and the paint leave of a star at (l, b, d): the 50 pc cut-out where there is one, else the 100 pc map
      var cb = Math.cos(b), u = -d * cb * Math.cos(l), v = d * cb * Math.sin(l), w = d * Math.sin(b), A = 0, e = 1;
      if (Z0 && Z0.cut) A = cutA(Z0.cut, u, v, w); else e = eps3s(u, v, w);
      if (painted) { var pi = polarIdx(u, v), sgp = PSIG[(pi / ND) | 0]; A += CUM[pi] * Math.exp(-b * b / (2 * sgp * sgp)); }   // dust painted from above is a band about the plane, as the sky draws it
      if (skyPainted) A += skyPaintAs(l, b, d);
      return A > 0 ? e * epsOfPaint(A) : e;
    }
    function zSpawn(k) { ZB[k] = Z0.b + (Math.random() * 2 - 1) * Z0.hh; ZD[k] = Z0.dmin * Math.pow(Z0.dmax / Z0.dmin, Math.pow(Math.random(), 0.6)); ZW[k] = Math.max(0.35, Math.min(2.5, Z0.d / ZD[k])); }
    function polarSig() {   // per longitude, the latitude half-width of the dust painted from above: 100 pc thick at its mean distance
      for (var a = 0; a < NA; a++) { var t = 0, m = 0; for (var id = 0; id < ND; id++) { var w = PT[a * ND + id]; t += w; m += w * (id + 0.5) * DR; } PSIG[a] = t > 0 ? Math.max(0.06, Math.atan(0.1 / (m / t))) : 0.1; }
      psDirty = false;
    }
    function zVis(snap) {
      if (psDirty) polarSig();
      var h = 0; for (var k = 0; k < ZN; k++) { ZV[k] = ZU[k] < zEps(Z0.l + ZLo[k], ZB[k], ZD[k]) ? 1 : 0; if (!ZV[k]) h++; if (snap) ZA[k] = ZV[k]; }
      hiddenZ = h;
    }
    function zAccum() {   // the close-up's reveal: its own stars, seen and counted, on a coarse grid over the field
      var i, k;
      for (i = 0; i < NZX * NZY; i++) { zSeen[i] *= LAMB; zAll[i] *= LAMB; }
      for (k = 0; k < ZN; k++) {
        var ix = ((0.5 - ZLo[k] / (2 * Z0.hwl)) * NZX) | 0, iy = ((0.5 - (ZB[k] - Z0.b) / (2 * Z0.hh)) * NZY) | 0;
        if (ix < 0 || iy < 0 || ix >= NZX || iy >= NZY) continue;
        i = iy * NZX + ix; zAll[i] += 1; zSeen[i] += ZV[k];
      }
    }
    function cloudInfo(key) {   // a close-up cloud: the cut-out's entry, or the sky list with a fallback distance
      var cut = CL && CL[key], c = null;
      if (cut) return { key: key, name: cut.name, l: cut.l, b: cut.b, d: cut.d_kpc, hw: cut.hw_deg, cut: cut };
      if (D && FALLBACK[key]) D.clouds_sky.forEach(function (x) { if (x.name === key) c = { key: key, name: NAMES[key] || key, l: x.l, b: x.b, d: FALLBACK[key][0], hw: FALLBACK[key][1], cut: null }; });
      return c;
    }
    var CLOUDS = null;   // the three close-up clouds, also marked from above and on the sky: name, (l, b) in radians, distance in kpc
    function clouds() {
      if (CLOUDS) return CLOUDS;
      if (!D) return [];
      var out = [];
      ['California', 'Vela A', 'Cygnus X North'].forEach(function (key) { var c = cloudInfo(key); if (c) out.push({ name: c.name, l: c.l * DEG, b: c.b * DEG, d: c.d }); });
      if (CL || clPending === false) CLOUDS = out;   // final once the cut-outs have landed or failed
      return out;
    }
    function zoomTo(key) {
      if (CL === null && clPending !== false) { clPending = key; return; }   // the cut-outs are still loading: zoom when they land
      var c = cloudInfo(key);
      if (!c) { Z0 = null; } else {
        var hw = (c.hw || 30) * DEG, d = c.d;
        Z0 = { key: key, name: c.name, l: c.l * DEG, b: c.b * DEG, d: d, hw: hw, hwl: hw / Math.cos(c.b * DEG), hh: hw * 0.4, dmin: d / 3, dmax: Math.min(2.4, 3 * d), sp: 2 * hw / 20, cut: c.cut };
        for (var k = 0; k < ZN; k++) { ZLo[k] = (Math.random() * 2 - 1) * Z0.hwl; zSpawn(k); }
        zVis(true); dirtyZ = true; zdat = null; zSeen.fill(0); zAll.fill(0);
        if (mode === 'reveal' && view === 'zoom') primeReveal();
      }
      stageClass(); run.redraw();
    }
    function zoomStep(dt) {
      var lim = Z0.hwl * 1.02, k;
      if (!RM) for (k = 0; k < ZN; k++) {   // drift toward lower longitude (to the right on the sky); nearer stars cross faster
        ZLo[k] -= Z0.sp * ZW[k] * dt;
        if (ZLo[k] < -lim) { ZLo[k] += 2 * lim; zSpawn(k); ZV[k] = ZU[k] < zEps(Z0.l + ZLo[k], ZB[k], ZD[k]) ? 1 : 0; ZA[k] = ZV[k]; }
      }
      if ((tick % 3) === 1 || painting) { zVis(false); zAccum(); }
      var f = 1 - Math.exp(-dt / 0.3); for (k = 0; k < ZN; k++) ZA[k] += (ZV[k] - ZA[k]) * f;
    }
    function buildZoom(zg) {   // the field's tint (map and paint to the farthest stars) and the strip's (dimming by distance at the cloud's latitude)
      var f = zg.f, zh = Math.max(16, Math.min(96, Math.round(ZIW * f.h / f.w))), i, j, o;
      if (psDirty) polarSig();
      if (!zdat || zimg.height !== zh) { zimg.height = zh; zdat = zctx.createImageData(ZIW, zh); }
      var dd = zdat.data, cb = Math.cos(Z0.b), lnr = Math.log(Z0.dmax / Z0.dmin);
      for (j = 0; j < zh; j++) for (i = 0; i < ZIW; i++) {
        var l = Z0.l + ((ZIW / 2 - i - 0.5) / ZIW) * 2 * Z0.hw / cb, b = Z0.b + ((zh / 2 - j - 0.5) / zh) * 2 * zg.hh;
        tintRGBA(dd, (j * ZIW + i) * 4, Math.min(0.9, 1.8 * (1 - zEps(l, b, Z0.dmax))));
      }
      zctx.putImageData(zdat, 0, 0);
      var sd = zsdat.data;
      for (j = 0; j < ZSH; j++) for (i = 0; i < ZSW; i++) {
        var l2 = Z0.l + ((ZSW / 2 - i - 0.5) / ZSW) * 2 * Z0.hw / cb, d2 = Z0.dmin * Math.exp(lnr * (ZSH - j - 0.5) / ZSH);
        o = (j * ZSW + i) * 4; tintRGBA(sd, o, Math.min(0.9, 1.8 * (1 - zEps(l2, Z0.b, d2))));
      }
      zsctx.putImageData(zsdat, 0, 0); dirtyZ = false;
    }
    function primeReveal() {   // a fresh count, seeded at once from the stars on screen, so the found dust shows within half a second
      seenT.fill(0); allT.fill(0); seenS.fill(0); allS.fill(0); zSeen.fill(0); zAll.fill(0);
      for (var i = 0; i < 8; i++) { accumulate(); if (Z0 && view === 'zoom') zAccum(); }
      revealAge = RM ? 99 : 0; revAt[0] = revAt[1] = revAt[2] = 0;
    }

    // the arrival: a bold stroke beside the Sun lays a dust cloud whose shadow empties a wedge of stars; the brush then waits there, pulsing
    var DEMO = { u0: 0.25, v0: -1.0, u1: 0.95, v1: -0.35, T: 1.1, pass: 9 };
    var RATE = 3.5 / KPC_KMS, HOLD_T = PASS / 60 / (Math.sqrt(TAU) * RHO_T / DR), HOLD_S = PASS / 60;   // a calm drift; holding the brush still adds about one pass per second
    function step(dt) {
      var h = dt * RATE, k;
      for (k = 0; k < N; k++) {
        var x = X[k] + h * VX[k], y = Y[k] + h * VY[k];
        if (x * x + y * y > HALF * HALF) { x = -x * 0.985; y = -y * 0.985; }   // re-enter from the opposite side, still moving inward
        X[k] = x; Y[k] = y;
      }
      if (painting) {   // an airbrush: holding still keeps adding dust
        if (painting.v === 'top') dab(painting.a, painting.b, HOLD_T, RHO_T);
        else dabSky(painting.a, painting.b, HOLD_S, painting.sig, painting.dist);
      }
      if ((tick++ % 3) === 0 || painting) { updateVis(); accumulate(); }   // visibility changes slowly: refresh it every third step
      if (Z0 && view === 'zoom') zoomStep(dt);
      revealAge += dt;
      if (demoStroke) {
        var f0 = E.smooth(Math.min(1, demoStroke.t / DEMO.T)); demoStroke.t += dt; var f1 = E.smooth(Math.min(1, demoStroke.t / DEMO.T));
        DB[0] = DEMO.u0 + (DEMO.u1 - DEMO.u0) * f1; DB[1] = DEMO.v0 + (DEMO.v1 - DEMO.v0) * f1;
        strokeTop(DEMO.u0 + (DEMO.u1 - DEMO.u0) * f0, DEMO.v0 + (DEMO.v1 - DEMO.v0) * f0, DB[0], DB[1], DEMO.pass); brush = DB;
        if (demoStroke.t >= DEMO.T) { demoStroke = null; carryT = 0; brush = hover && view === 'top' && !coarse ? hover : null; }
      }
      if (armed && !painting && performance.now() - armedAt > 8000) { armed = false; stage.classList.remove('is-armed'); }
    }
    updateVis();
    function panelOf(W, H) { return { x: PAD, y: PAD, w: W - 2 * PAD, h: H - 2 * PAD }; }
    function topGeom(p) {   // the disc, framed clear of the panel's edges, with room above and below it for the labels
      var nar = p.w < 460, side = Math.min(p.w - (nar ? 12 : 20), p.h - (nar ? 54 : 44));
      return { x: p.x + (p.w - side) / 2, y: p.y + (p.h - side) / 2, w: side, h: side };
    }
    function ly(kpc) { var y = kpc * 3262, r = y < 10000 ? Math.round(y / 100) * 100 : Math.round(y / 1000) * 1000; return r.toLocaleString('en-US'); }   // kpc -> light-years, rounded
    function wrapPi(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }

    // ---- labels: 12 px on a backing by default; each records its box so the brush's hint and reading can be placed clear of them
    var OCC = new Float32Array(4 * 48), nOcc = 0, LO = { size: 12, color: '', align: 'left', back: true, mono: false };
    function free(x, y, w, h) { for (var i = 0; i < nOcc; i++) { var o = 4 * i; if (x < OCC[o] + OCC[o + 2] && x + w > OCC[o] && y < OCC[o + 1] + OCC[o + 3] && y + h > OCC[o + 1]) return false; } return true; }
    function occupy(x, y, w, h) { if (nOcc < 48) { var o = 4 * nOcc++; OCC[o] = x; OCC[o + 1] = y; OCC[o + 2] = w; OCC[o + 3] = h; } }
    function lab(text, x, y, size, color, align) {
      LO.size = size || 12; LO.color = color || C.text2; LO.align = align || 'left';
      var w = textW(g, text, LO), x0 = LO.align === 'right' ? x - w : LO.align === 'center' ? x - w / 2 : x;
      occupy(x0 - 3, y - LO.size, w + 6, LO.size + 4);
      label(g, text, x, y, LO);
    }
    function beside(text, x, y, r, size, color, bx) {   // a label beside a ring: right, left, above or below, inside bx and clear of the labels placed
      LO.size = size; LO.align = 'left'; var w = textW(g, text, LO), found = false, fx = 0, fy = 0, have = false;
      for (var i = 0; i < 4 && !found; i++) {
        var x0 = i === 0 ? x + r + 8 : i === 1 ? x - r - 8 - w : x - w / 2, y0 = i === 2 ? y - r - 7 : i === 3 ? y + r + size + 5 : y + size / 2 - 2;
        if (x0 - 3 < bx.x + 2 || x0 + w + 3 > bx.x + bx.w - 2 || y0 - size < bx.y + 2 || y0 + 4 > bx.y + bx.h - 2) continue;
        if (!have) { have = true; fx = x0; fy = y0; }
        if (free(x0 - 3, y0 - size, w + 6, size + 4)) { found = true; fx = x0; fy = y0; }
      }
      if (!have) { fx = Math.max(bx.x + 6, Math.min(bx.x + bx.w - 6 - w, x + r + 8)); fy = Math.max(bx.y + size + 4, Math.min(bx.y + bx.h - 6, y + size / 2 - 2)); }
      lab(text, fx, fy, size, color);
    }
    function legend(bx, text) {   // bottom-left of a panel; on two lines when one would not fit
      LO.size = 12; var i = text.indexOf(' · ');
      if (i > 0 && textW(g, text, LO) > bx.w - 20) { lab(text.slice(0, i), bx.x + 8, bx.y + bx.h - 24); lab(text.slice(i + 3), bx.x + 8, bx.y + bx.h - 8); }
      else lab(text, bx.x + 8, bx.y + bx.h - 8);
    }
    function cloudMark(name, px, py, bx, size, dy) {   // a named cloud: a small ring, its name beside it (left of it, or none, rather than overprint); dy lifts the name
      g.strokeStyle = C.text2; g.lineWidth = 1.3; g.beginPath(); g.arc(px, py, 4.5, 0, TAU); g.stroke(); g.lineWidth = 1;
      LO.size = size; var w = textW(g, name, LO), x0 = px + (dy ? 4 : 9), y0 = py + size / 2 - 2 + (dy || 0);
      if (x0 + w + 3 > bx.x + bx.w - 2 || !free(x0 - 3, y0 - size, w + 6, size + 4)) x0 = px - 9 - w;
      if (x0 - 3 < bx.x + 2 || !free(x0 - 3, y0 - size, w + 6, size + 4)) return;
      lab(name, x0, y0, size, C.text2);
    }
    function pulse() { return RM ? 0 : Math.sin(performance.now() / 1000 * TAU / 1.6); }
    function ring(x, y, r, st) {   // the brush: dashed while hovering, solid while painting, pulsing while it waits (st 2)
      var ph = st === 2 ? pulse() : 0, rr = r * (1 + 0.07 * ph);
      g.globalAlpha = st === 2 ? 0.75 + 0.25 * ph : 1; g.strokeStyle = C.accent; g.lineWidth = st ? 2 : 1.5; g.setLineDash(st ? SOLID : DASH);
      g.beginPath(); g.arc(x, y, rr, 0, TAU); g.stroke(); g.setLineDash(SOLID); g.lineWidth = 1;
      g.fillStyle = C.accent; g.fillRect(x - 1.5, y - 1.5, 3, 3); g.globalAlpha = 1;
    }
    function ringSky(Gm, l, b, r, st) {   // the sky's brush: a true circle on the sphere, projected
      var ph = st === 2 ? pulse() : 0, rr = r * (1 + 0.07 * ph);
      g.globalAlpha = st === 2 ? 0.75 + 0.25 * ph : 1; g.strokeStyle = C.accent; g.lineWidth = st ? 2 : 1.5; g.setLineDash(st ? SOLID : DASH); g.beginPath();
      var sb = Math.sin(b), cb = Math.cos(b), cr = Math.cos(rr), sr = Math.sin(rr), px0 = 0, has = false;
      for (var i = 0; i <= 32; i++) {
        var ph2 = TAU * i / 32, b2 = Math.asin(sb * cr + cb * sr * Math.cos(ph2)), l2 = l + Math.atan2(Math.sin(ph2) * sr * cb, cr - sb * Math.sin(b2));
        proj(Gm, l2, Math.sin(b2), P2, 0);
        if (!has || Math.abs(P2[0] - px0) > Gm.ax) g.moveTo(P2[0], P2[1]); else g.lineTo(P2[0], P2[1]); px0 = P2[0]; has = true;
      }
      g.stroke(); g.setLineDash(SOLID); g.lineWidth = 1; g.globalAlpha = 1;
    }
    function hintText(where, narrow) {   // the call to action beside the brush, until the first stroke in that view (and while armed on a phone)
      if (!armed && (where === 'top' ? usedTop : where === 'zoom' ? usedZoom : usedSky)) return '';
      var base = where === 'zoom' ? 'drag to add dust to the cloud' : where === 'sky' && !narrow ? 'drag to paint dust ' + ly(PAINT_D) + ' light-years away' : 'drag to paint dust';
      return armed || !coarse ? base : 'tap, then ' + base;
    }
    var LEG = { observed: 'brown: dust · big dots: bright stars', swept: 'red: stars the dust hid · grey: stars Gaia sees', reveal: 'brown: where stars are missing' };

    function drawTop(p, narrow) {
      var sq = topGeom(p), V = topDown(sq.w, sq.x, sq.y, HALF), cx = sq.x + sq.w / 2, cy = sq.y + sq.h / 2, R = HALF * V.sc, k;
      if (dirty) buildLayer(); if (dirtyP) buildPainted();
      var keep = 1 - 0.75 * fadeSwept, realA = 0.55 * (1 - fadeReveal) * keep, paintA = (1 - fadeReveal) * keep, ra = fadeReveal * Math.min(1, revealAge / 0.5);
      g.imageSmoothingEnabled = true;
      if (D && realA > 0.01) { g.globalAlpha = realA; g.drawImage(layer, sq.x, sq.y, sq.w, sq.h); }   // the real dust (both tints are masked to the disc)
      if ((painted || skyPainted) && paintA > 0.01) { g.globalAlpha = paintA; g.drawImage(layerP, sq.x, sq.y, sq.w, sq.h); }   // the painted dust
      g.globalAlpha = 1;
      var mark = null;
      if (ra > 0) { g.save(); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip(); buildReveal(0); g.globalAlpha = ra; g.drawImage(rev, sq.x, sq.y, sq.w, sq.h); g.globalAlpha = 1; }   // the dust found from the missing stars
      if (ra > 0 && D) {   // the real map's outline (where it hides 30% of these stars), smoothed, for the found dust to be checked against
        var L = 0.3, cw = sq.w / RG, chh = sq.h / RG, ci, cj, tx = cx + 0.42 * R, ty = cy - 0.5 * R, bd = 1e18;
        // grid column ci (left to right) is v index RG-1-ci; row cj counted from the bottom is u index RG-1-cj: the stars' own orientation
        var hf = function (i, j) { return 1 - expT[(RG - 1 - i) * RG + (RG - 1 - j)]; }, fr = function (v0, v1) { return v1 === v0 ? 0.5 : (L - v0) / (v1 - v0); };
        g.globalAlpha = ra; g.strokeStyle = rgba(C.text, 0.85); g.lineWidth = 1.7; g.beginPath();
        for (ci = 0; ci < RG - 1; ci++) for (cj = 0; cj < RG - 1; cj++) {
          var a = hf(ci, cj), b = hf(ci + 1, cj), c2 = hf(ci + 1, cj + 1), d2 = hf(ci, cj + 1);
          var idx = (a >= L ? 1 : 0) | (b >= L ? 2 : 0) | (c2 >= L ? 4 : 0) | (d2 >= L ? 8 : 0);
          if (idx === 0 || idx === 15) continue;
          var x0 = sq.x + (ci + 0.5) * cw, x1 = x0 + cw, y0 = sq.y + sq.h - (cj + 0.5) * chh, y1 = y0 - chh;
          var Ed = [[x0 + cw * fr(a, b), y0], [x1, y0 - chh * fr(b, c2)], [x0 + cw * fr(d2, c2), y1], [x0, y0 - chh * fr(a, d2)]], sgm = MS[idx];
          for (var q2 = 0; q2 < sgm.length; q2 += 2) {
            var e0 = Ed[sgm[q2]], e1 = Ed[sgm[q2 + 1]]; g.moveTo(e0[0], e0[1]); g.lineTo(e1[0], e1[1]);
            var mx = (e0[0] + e1[0]) / 2, my = (e0[1] + e1[1]) / 2, dd = (mx - tx) * (mx - tx) + (my - ty) * (my - ty);
            if (dd < bd && Math.hypot(mx - cx, my - cy) < 0.85 * R) { bd = dd; mark = [mx, my]; }
          }
        }
        g.stroke(); g.lineWidth = 1; g.globalAlpha = 1;
      }
      if (ra > 0) g.restore();
      g.strokeStyle = C.border; g.setLineDash(DOTS); g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke(); g.setLineDash(SOLID);
      for (k = 0; k < N; k++) { PX[k] = V.px(X[k], Y[k]); PY[k] = V.py(X[k], Y[k]); }
      drawStars(IDX, PX, PY, VIS, SIZE_TOP);
      // labels: the fixed ones first, then the brush's hint or reading, placed clear of them
      legend(p, LEG[mode]);
      lab(ly(2 * HALF) + ' light-years across', p.x + 8, p.y + 17);
      lab('Galactic centre ↑', p.x + p.w - 8, p.y + 17, 12, C.text2, 'right');
      g.fillStyle = C.text; g.beginPath(); g.arc(cx, cy, 3.5, 0, TAU); g.fill();
      lab('Sun', cx + 7, cy - 6, 12, C.text);
      if (mark) { g.globalAlpha = ra; g.fillStyle = C.text; g.beginPath(); g.arc(mark[0], mark[1], 2.5, 0, TAU); g.fill(); beside('real dust map', mark[0], mark[1], 2, 12, C.text, p); g.globalAlpha = 1; }
      if (fadeReveal < 0.5) clouds().forEach(function (c) { var cbb = Math.cos(c.b), u = -c.d * cbb * Math.cos(c.l), v = c.d * cbb * Math.sin(c.l); cloudMark(c.name, V.px(u, v), V.py(u, v), p, narrow ? 11 : 12); });
      var rr = 2 * RHO_T * V.sc, bx = 0, by = 0, st = -1;
      if (brush) { bx = V.px(brush[0], brush[1]); by = V.py(brush[0], brush[1]); st = painting || demoStroke ? 1 : 0; }
      else if (park && !usedTop) { bx = V.px(park[0], park[1]); by = V.py(park[0], park[1]); st = 2; }
      if (st >= 0) ring(bx, by, rr, st);
      var ht = demoStroke ? '' : hintText('top', narrow);
      if (ht && st >= 0) beside(ht, bx, by, rr, 13, C.accent, p);
      else if (hover && !demoStroke && (usedTop || painting)) {   // the reading under the brush: the stars here that Gaia still sees
        var kept = Math.round(100 * eps3(hover[0], hover[1], 0) * epsOfPaint(paintAt(hover[0], hover[1])));
        beside('here: ' + kept + '% of stars seen', V.px(hover[0], hover[1]), V.py(hover[0], hover[1]), rr, 12, C.text, p);
      }
    }
    var SKY_PARK = [-40 * DEG, 30 * DEG];   // where the sky's brush waits for the visitor: the empty sky above the band and its labels
    function drawSky(p, narrow) {
      var Gm = skyGeom(p), ix = Gm.cx - Gm.ax, iy = Gm.cy - Gm.ay, iw = 2 * Gm.ax, ih = 2 * Gm.ay, k;
      if (D && skyDirty) buildSky(); if (dirtyP) buildPainted();
      var keep = 1 - 0.75 * fadeSwept, realA = 0.8 * (1 - fadeReveal) * keep, paintA = (1 - fadeReveal) * keep, ra = fadeReveal * Math.min(1, revealAge / 0.5);
      g.imageSmoothingEnabled = true;
      if (D && realA > 0.01) { g.globalAlpha = realA; g.drawImage(sky, ix, iy, iw, ih); }
      if ((painted || skyPainted) && paintA > 0.01) { g.globalAlpha = paintA; g.drawImage(skyP, ix, iy, iw, ih); }
      if (ra > 0) { buildReveal(1); g.globalAlpha = ra; g.drawImage(revS, ix, iy, iw, ih); }
      g.globalAlpha = 1;
      g.strokeStyle = C.border; g.lineWidth = 1;
      g.beginPath(); g.ellipse(Gm.cx, Gm.cy, Gm.ax, Gm.ay, 0, 0, TAU); g.stroke();
      g.beginPath(); g.moveTo(Gm.cx - Gm.ax, Gm.cy + 0.5); g.lineTo(Gm.cx + Gm.ax, Gm.cy + 0.5); g.stroke();
      for (k = 0; k < N; k++) { var x = X[k], y = Y[k], z = Z[k], r = Math.sqrt(x * x + y * y + z * z); proj(Gm, Math.atan2(y, -x), r > 0 ? z / r : 0, P2, 0); PX[k] = P2[0]; PY[k] = P2[1]; }
      drawStars(IDX, PX, PY, VIS, SIZE_SKY, narrow ? 3 : 2);
      legend(p, LEG[mode]);
      lab('Galactic plane', Gm.cx + Gm.ax - 8, Gm.cy - (narrow ? 12 : 20), narrow ? 11 : 12, C.text2, 'right');
      lab('↑ Galactic centre', Gm.cx, Gm.cy + (narrow ? 22 : 30), narrow ? 11 : 12, C.text2, 'center');
      clouds().forEach(function (c) { proj(Gm, c.l, Math.sin(c.b), P2, 0); cloudMark(c.name, P2[0], P2[1], p, narrow ? 11 : 12, Math.abs(c.b) < 4 * DEG ? (narrow ? -11 : -15) : 0); });   // names lifted off the dense band
      if (!D) return;
      var bl = 0, bb = 0, st = -1;
      if (painting && painting.v === 'sky') { bl = painting.a; bb = painting.b; st = 1; } else if (hoverSky) { bl = hoverSky[0]; bb = hoverSky[1]; st = 0; } else if (!usedSky) { bl = SKY_PARK[0]; bb = SKY_PARK[1]; st = 2; }
      if (st < 0) return;
      ringSky(Gm, bl, bb, 2 * SIG_ALL, st);
      var ht = hintText('sky', narrow); if (!ht) return;
      proj(Gm, bl, Math.sin(bb), P2, 0); var hx = P2[0], hy = P2[1]; proj(Gm, bl, Math.sin(Math.min(Math.PI / 2, bb + 2 * SIG_ALL)), P2, 0);
      beside(ht, hx, hy, Math.abs(hy - P2[1]) * 1.1, 13, C.accent, p);
    }
    function drawZoom(p, narrow) {
      var zg = zoomGeom(p), f = zg.f, s = zg.s, cb = Math.cos(Z0.b), k;
      if (Math.abs(zg.hh - Z0.hh) > 0.02 * Z0.hh) {   // the stage changed shape: stretch the field's latitudes to fit
        for (k = 0; k < ZN; k++) ZB[k] = Z0.b + (ZB[k] - Z0.b) * zg.hh / Z0.hh;
        Z0.hh = zg.hh; dirtyZ = true; zdat = null;
      }
      if (dirtyZ && (!painting || (zThrottle++ & 3) === 0)) buildZoom(zg);
      var lnr = Math.log(Z0.dmax / Z0.dmin), keep = 1 - 0.75 * fadeSwept, realA = 0.85 * (1 - fadeReveal) * keep, ra = fadeReveal * Math.min(1, revealAge / 0.5);
      for (k = 0; k < ZN; k++) {
        ZPX[k] = zg.cx - ZLo[k] * cb * zg.kx; ZPY[k] = zg.cy - (ZB[k] - Z0.b) * zg.kx;
        ZSY[k] = s.y + s.h - 4 - (s.h - 8) * Math.log(ZD[k] / Z0.dmin) / lnr;
        ZQ[k] = Math.round(ZA[k] * 4);
      }
      // the field
      g.save(); g.beginPath(); g.rect(f.x, f.y, f.w, f.h); g.clip();
      g.imageSmoothingEnabled = true;
      if (zdat && realA > 0.01) { g.globalAlpha = realA; g.drawImage(zimg, f.x, f.y, f.w, f.h); }
      if (ra > 0) { buildReveal(2); g.globalAlpha = ra; g.drawImage(zrv, f.x, f.y, f.w, f.h); }
      g.globalAlpha = 1;
      var py0 = zg.cy + Z0.b * zg.kx, plane = py0 > f.y + 4 && py0 < f.y + f.h - 4;   // the Galactic plane, when it is in the field
      if (plane) { g.strokeStyle = C.border; g.beginPath(); g.moveTo(f.x, py0 + 0.5); g.lineTo(f.x + f.w, py0 + 0.5); g.stroke(); }
      zStars(ZPY, SIZE_ZOOM);
      legend(f, LEG[mode]);
      cloudMark(Z0.name, zg.cx, zg.cy, f, narrow ? 12 : 13);
      if (plane) lab('Galactic plane', f.x + f.w - 8, py0 - 5, 11, C.text2, 'right');
      var rz = 2 * SIG_ZOOM * zg.kx, bx = 0, by = 0, st = -1;
      if (painting && painting.v === 'sky') { bx = zg.cx - wrapPi(painting.a - Z0.l) * cb * zg.kx; by = zg.cy - (painting.b - Z0.b) * zg.kx; st = 1; }
      else if (hoverZ) { bx = zg.cx - wrapPi(hoverZ[0] - Z0.l) * cb * zg.kx; by = zg.cy - (hoverZ[1] - Z0.b) * zg.kx; st = 0; }
      else if (!usedZoom) { bx = f.x + 0.76 * f.w; by = f.y + (py0 < zg.cy ? 0.68 : 0.3) * f.h; st = 2; }   // the waiting brush: on the side of the cloud away from the plane and its label
      if (st >= 0) { ring(bx, by, rz, st); var ht = hintText('zoom', narrow); if (ht) beside(ht, bx, by, rz, 13, C.accent, f); }
      g.restore();
      // the strip: the same stars by distance, seen edge-on, with the map's dimming at the cloud's latitude
      g.save(); g.beginPath(); g.rect(s.x, s.y, s.w, s.h); g.clip();
      g.fillStyle = C.bg; g.fillRect(s.x, s.y, s.w, s.h);
      g.imageSmoothingEnabled = true; if (zdat) { g.globalAlpha = 0.85 * keep; g.drawImage(zstr, s.x, s.y, s.w, s.h); g.globalAlpha = 1; }
      var yc = s.y + s.h - 4 - (s.h - 8) * Math.log(Z0.d / Z0.dmin) / lnr;
      g.strokeStyle = C.text2; g.lineWidth = 1; g.beginPath(); g.moveTo(s.x, yc + 0.5); g.lineTo(s.x + s.w, yc + 0.5); g.stroke();
      zStars(ZSY, SIZE_TOP);
      lab(narrow ? 'the same stars by distance' : 'the same stars, by distance from us', s.x + 8, s.y + 16, 12, C.text2);
      var cl = Z0.name + ' cloud, ' + ly(Z0.d) + ' light-years away'; LO.size = 12; if (textW(g, cl, LO) > s.w - 150) cl = Z0.name + ', ' + ly(Z0.d) + ' light-years';
      var up = yc - 18 > s.y + 22;   // the cloud's name above its line, unless the strip's title is in the way
      lab(cl, s.x + 8, up ? yc - 6 : yc + 17, 12, C.text);
      lab('behind the cloud', s.x + s.w - 8, yc - 6, 12, C.text2, 'right');
      lab('in front', s.x + s.w - 8, yc + 17, 12, C.text2, 'right');
      g.restore();
      g.strokeStyle = C.border; g.beginPath(); g.moveTo(p.x, s.y - 4 + 0.5); g.lineTo(p.x + p.w, s.y - 4 + 0.5); g.stroke();
    }
    function zStars(ys, sizes) {   // the close-up's stars by class and fade level; the fading and hidden ones in red when the dust is swept away
      var c, lv, i, idx, h, q, dim = 1 - 0.45 * fadeSwept;
      for (c = 0; c < 3; c++) for (lv = 1; lv <= 4; lv++) {
        idx = ZIDX[c]; h = sizes[c] / 2; g.fillStyle = rgba(C.text, ALPHA[c] * dim * lv / 4); g.beginPath();
        for (i = 0; i < idx.length; i++) { q = idx[i]; if (ZQ[q] !== lv) continue; g.rect(ZPX[q] - h, ys[q] - h, sizes[c], sizes[c]); }
        g.fill();
      }
      if (fadeSwept > 0) {
        g.globalAlpha = 0.85 * fadeSwept; g.fillStyle = C.accent;
        for (c = 0; c < 3; c++) {
          idx = ZIDX[c]; var sz = sizes[c] + 0.5; h = sz / 2; g.beginPath();
          for (i = 0; i < idx.length; i++) { q = idx[i]; if (ZQ[q] > 2) continue; g.rect(ZPX[q] - h, ys[q] - h, sz, sz); }
          g.fill();
        }
        g.globalAlpha = 1;
      }
    }
    function draw() {
      var W = S.W, H = S.H; if (!W) return;
      g.fillStyle = C.surface; g.fillRect(0, 0, W, H);
      var p = panelOf(W, H), narrow = p.w < 460;
      box(g, p);
      if (RM) { fadeSwept = mode === 'swept' ? 1 : 0; fadeReveal = mode === 'reveal' ? 1 : 0; }
      else { fadeSwept += ((mode === 'swept' ? 1 : 0) - fadeSwept) * 0.18; fadeReveal += ((mode === 'reveal' ? 1 : 0) - fadeReveal) * 0.18; if (fadeSwept < 0.01) fadeSwept = 0; if (fadeReveal < 0.01) fadeReveal = 0; }
      nOcc = 0;
      g.save(); g.beginPath(); g.rect(p.x, p.y, p.w, p.h); g.clip();
      if (view === 'zoom' && Z0) drawZoom(p, narrow); else if (view === 'top') drawTop(p, narrow); else drawSky(p, narrow);
      g.restore();
      g.strokeStyle = C.border; g.lineWidth = 1; g.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      if (D) { var pct = Math.round(100 * (view === 'zoom' && Z0 ? hiddenZ / ZN : hidden / N)); setOut(outSeen, (100 - pct) + '%'); setOut(outHid, pct + '%'); }
    }

    var strokeDone = false;
    function startStroke() {
      if (!D || painted || strokeDone || !run.visible()) return;
      strokeDone = true; carryT = 0; park = [DEMO.u1, DEMO.v1];
      if (RM) { strokeTop(DEMO.u0, DEMO.v0, DEMO.u1, DEMO.v1, DEMO.pass); carryT = 0; updateVis(); run.redraw(); return; }   // reduced motion: the same cloud, at once
      demoStroke = { t: 0 }; run.wake();
    }
    var run = loop(cv, step, draw, null, { drawEvery: 2 }); run.onVisible(startStroke);
    S.onresize = run.redraw; E.onTheme.push(function () { dirty = true; skyDirty = true; dirtyP = true; dirtyZ = true; revAt[0] = revAt[1] = revAt[2] = 0; run.redraw(); });
    enable(fig, false); note(fig, 'Loading the dust map (about 60 KB)…');
    whenNear(fig, function () {
      var slow = setTimeout(function () { if (!D) note(fig, 'The dust map is slow to arrive; the figure starts as soon as it does.'); }, 12000);
      fetchJSON(fig.getAttribute('data-src')).then(function (d) {
        clearTimeout(slow);
        var bin = atob(d.eps3d.b64), n = bin.length, out = new Uint8Array(n), i, j, q; for (i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
        G3 = out; D = { A: d.A, clouds: d.clouds, clouds_sky: d.clouds_sky };
        // the map's own (dimming, kept) relation, for the painted dust; past its last well-sampled bin it continues
        // as the exponential fitted to it, so stacked paint keeps working on the brightest stars
        var sumE = new Float64Array(14), cnt = new Float64Array(14);
        for (i = 0; i < AN; i++) for (j = 0; j < AN; j++) { var A = d.A[i][j] * 0.02, e = eps3(-HALF + 0.05 * i, -HALF + 0.05 * j, 0), b = Math.min(13, Math.floor(A / 0.25)); if (e < 1) { sumE[b] += e; cnt[b] += 1; } }
        var ea = [], ee = [];
        for (q = 0; q < 14; q++) if (cnt[q] >= 100) { ea.push(0.25 * q + 0.125); ee.push(sumE[q] / cnt[q]); }
        for (q = 1; q < ee.length; q++) if (ee[q] > ee[q - 1]) ee[q] = ee[q - 1];   // keep it monotonic
        var sx = 0, sy = 0, sxx = 0, sxy = 0, m = ea.length;
        for (q = 0; q < m; q++) { var lx = ea[q], lyy = Math.log(ee[q] / ee[0]); sx += lx; sy += lyy; sxx += lx * lx; sxy += lx * lyy; }
        if (m >= 3) { SLOPE = -(m * sxy - sx * sy) / (m * sxx - sx * sx); EA = ea; EE = ee; AJ = ea[m - 1]; EJ = ee[m - 1] / ee[0]; }
        // the expected hidden fraction per reveal cell, from the map with the population's height distribution, smoothed for a clean outline
        var tmp = new Float32Array(RG * RG);
        for (i = 0; i < RG; i++) for (j = 0; j < RG; j++) { var u = -HALF + (i + 0.5) * 2 * HALF / RG, v = -HALF + (j + 0.5) * 2 * HALF / RG, s = 0, wsum = 0; for (q = 0; q < 5; q++) { s += WS[q] * 0.5 * (eps3(u, v, ZS[q]) + eps3(u, v, -ZS[q])); wsum += WS[q]; } expT[j * RG + i] = s / wsum; }
        for (var it = 0; it < 2; it++) {
          for (j = 0; j < RG; j++) for (i = 0; i < RG; i++) { var s2 = 0, w2 = 0; for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) { var ii = Math.max(0, Math.min(RG - 1, i + di)), jj = Math.max(0, Math.min(RG - 1, j + dj)), ww = (di ? 1 : 2) * (dj ? 1 : 2); s2 += ww * expT[jj * RG + ii]; w2 += ww; } tmp[j * RG + i] = s2 / w2; }
          expT.set(tmp);
        }
        dirty = true; skyDirty = true; updateVis(); enable(fig, true); note(fig, ''); if (clearBtn) clearBtn.hidden = true; startStroke(); run.redraw();
        var cs = fig.getAttribute('data-src-clouds');
        if (!cs) clPending = false;
        else fetchJSON(cs).then(function (o) {   // the 50 pc cut-outs around the close-up clouds (about 60 KB over the wire)
          CL = {}; o.clouds.forEach(function (c) { var bs = atob(c.b64), a = new Uint8Array(bs.length); for (var q = 0; q < bs.length; q++) a[q] = bs.charCodeAt(q); c.data = a; c.nx = c.n[0]; c.ny = c.n[1]; c.nz = c.n[2]; c.unit = o.unit; CL[c.key] = c; });
          CLOUDS = null; if (clPending) { var nm = clPending; clPending = null; zoomTo(nm); } run.redraw();
        }).catch(function () { var nm = clPending; clPending = false; CLOUDS = null; if (typeof nm === 'string') zoomTo(nm); });   // without them the close-up falls back to the 100 pc map
      }).catch(function (e) { clearTimeout(slow); failed(fig, e); });
    });
    function world(e) {   // pointer -> [u, v] kpc from above, [l, b] radians on the sky or in the close-up; null off the map
      var r = cv.getBoundingClientRect(), p = panelOf(r.width, r.height), px = e.clientX - r.left, py = e.clientY - r.top;
      if (view === 'zoom' && Z0) {
        var zg = zoomGeom(p), f = zg.f; if (px < f.x || px > f.x + f.w || py < f.y || py > f.y + f.h) return null;
        return [Z0.l - (px - zg.cx) / (zg.kx * Math.cos(Z0.b)), Z0.b - (py - zg.cy) / zg.kx];
      }
      if (view !== 'top') return unproj(skyGeom(p), px, py);
      var sq = topGeom(p), V = topDown(sq.w, sq.x, sq.y, HALF), u = V.u(py), v = V.v(px); return (u * u + v * v > HALF * HALF) ? null : [u, v];
    }
    function still() { if (run.still) { updateVis(); accumulate(); if (Z0) { zVis(true); zAccum(); } run.redraw(); } }
    function begin(w) {   // start a stroke where the pointer went down
      demoStroke = null; carryT = 0; carryS = 0;
      if (view === 'top') { usedTop = true; painting = { v: 'top', a: w[0], b: w[1] }; brush = w; dab(w[0], w[1], AMT_T, RHO_T); }
      else { var zs = view === 'zoom' && !!Z0; if (zs) usedZoom = true; else usedSky = true; painting = { v: 'sky', a: w[0], b: w[1], sig: zs ? SIG_ZOOM : SIG_ALL, dist: zs ? Z0.d : PAINT_D }; dabSky(w[0], w[1], PASS * (1 / 3) / Math.sqrt(TAU), painting.sig, painting.dist); }
    }
    cv.addEventListener('pointerdown', function (e) {
      if (!D || (e.pointerType === 'mouse' && e.button !== 0)) return; var w = world(e); if (!w) return;
      if (e.pointerType !== 'mouse' && !armed) { armed = true; armedAt = performance.now(); stage.classList.add('is-armed'); run.wake(); run.redraw(); return; }   // phones: a tap arms the brush, so the page still scrolls
      if (armed) armedAt = performance.now();
      begin(w); try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not an active pointer */ } still(); run.wake(); e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      var w = world(e);
      if (view === 'top') { hover = w; hoverSky = hoverZ = null; if (!painting && !demoStroke) brush = e.pointerType === 'mouse' ? w : null; }
      else if (view === 'zoom' && Z0) { hoverZ = w; hover = hoverSky = null; } else { hoverSky = w; hover = hoverZ = null; }
      if (painting && w) {
        if (painting.v === 'top') { strokeTop(painting.a, painting.b, w[0], w[1], PASS); brush = w; }
        else strokeSky(painting.a, painting.b, w[0], w[1], PASS, painting.sig, painting.dist);
        painting.a = w[0]; painting.b = w[1]; if (armed) armedAt = performance.now();
      }
      if (run.still) still(); else run.wake();
    });
    function stop() { painting = null; if (view === 'top') brush = hover && !coarse ? hover : null; if (run.still) still(); }
    cv.addEventListener('pointerup', stop); cv.addEventListener('pointercancel', stop);
    cv.addEventListener('pointerleave', function () { hover = hoverSky = hoverZ = null; painting = null; if (!demoStroke) brush = null; if (run.still) run.redraw(); });
    if (clearBtn) clearBtn.hidden = true;
    function stageClass() {   // phones give each view its own stage shape
      stage.classList.toggle('is-sky', view === 'sky' || (view === 'zoom' && !Z0)); stage.classList.toggle('is-zoom', view === 'zoom' && !!Z0);
    }
    function setChecked(attr, val) { fig.querySelectorAll('[' + attr + ']').forEach(function (b) { b.setAttribute('aria-checked', b.getAttribute(attr) === val ? 'true' : 'false'); }); }
    seg(fig, 'data-mode', function (m) { mode = m; if (m === 'reveal') primeReveal(); still(); run.redraw(); });
    seg(fig, 'data-view', function (v) {
      view = v; hover = hoverSky = hoverZ = null; if (!demoStroke) brush = null; painting = null; updateVis();
      if (v === 'zoom' && (!Z0 || Z0.key !== cloudKey)) zoomTo(cloudKey);
      if (mode === 'reveal') primeReveal();
      stageClass(); run.redraw();
    });
    seg(fig, 'data-cloud', function (c) {   // under Details: which cloud the close-up shows; choosing one opens the close-up
      cloudKey = c; hoverSky = hoverZ = null; painting = null;
      if (view !== 'zoom') { view = 'zoom'; setChecked('data-view', 'zoom'); updateVis(); }
      zoomTo(c); if (mode === 'reveal') primeReveal();
    });
    if (clearBtn) clearBtn.addEventListener('click', function () { clearPaint(); still(); run.redraw(); });
    E.more(fig, function (open) { if (!open && mode === 'reveal') { mode = 'observed'; setChecked('data-mode', 'observed'); } run.redraw(); });
    stageClass();
  }

  function init() { demoDust(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
