/* Fig. 6 Flick a star through the Milky Way's gravity. Needs demos.js and demos-data.js loaded first.
   Round 7 (2026-10-28): the picture is shown for the turning frame it is (a small Galaxy inset carries the map round the Sun's
   orbit), every speed names its reference, the potential is a single-hue ramp, and the frame loop creates no arrays, objects, closures or strings
   (canvas calls get whole-pixel arguments, because V8 boxes every fractional number it hands to a DOM method).
   Round 7b: a switch between the Sun's frame (the one the stars are integrated in) and the Galactic frame (the centre fixed, everything
   orbiting it). The stars are the same and are integrated once; only the drawing changes, and each trail vertex also keeps its inertial position.
   Final round (2026-10-28), for a regular reader. The physics is untouched; the drawing and the words are not:
   - plain words: "gravity" for the potential ("darker = deeper in gravity's well"), light-years next to kpc, "million years" for Myr,
     "its orbit" for the guiding circle; the word "frame" stays and is supported in place (the inset note, a note in the Galactic frame);
   - a header band above the square map (the stage is a little taller than wide) holds the scale, the inset and its note, so no label is
     printed over the map; map labels are text with a halo, never a hard box; no label is smaller than 12 px or paler than C.text2;
   - the Sun is the astronomers' symbol (a ring round a dot); the invitation to flick is a "ghost" drag that launches a red star, plus a
     plain sentence next to the Sun; Clear brings it back; after the first flick the Galactic frame button pulses once;
   - a press in the Galactic frame goes back to the Sun's frame and starts the flick there (on a touch screen a tap does, and arms the map);
   - the Sun's path since the flick is drawn in the Sun's own ink (a fading tail), never in the red of the flicked stars;
   - the swap between frames fades one set of labels out before the other fades in; contour lines are anti-aliased (also in the small
     rotating map); the pointer's orbit speed and the model's fine print sit behind Details. */
(function () {
  'use strict';
  var E = window.EPDemos, H = window.EPDemosHelpers; if (!E || !H) return;
  var C = E.C, RM = E.RM, rgba = E.rgba, makeCanvas = E.makeCanvas, loop = E.loop, setOut = E.setOut, KPC_KMS = E.KPC_KMS, R0 = E.R0;
  var fetchJSON = H.fetchJSON, whenNear = H.whenNear, note = H.note, failed = H.failed, enable = H.enable, seg = H.seg;
  var TAU = Math.PI * 2, HALFPI = Math.PI / 2, DASH5 = [5, 5], DASH3 = [3, 3], NODASH = [];

  // Depth of the well: one hue, nine stops from deep (dark) to shallow (light), built in OKLCH so lightness steps are even.
  // The light-mode ramp runs from L 0.55 to 0.96 and the dark-mode ramp from 0.25 to 0.52, so the page's red (the flicked stars)
  // keeps its contrast against the map in both themes (WCAG ratio 1.5 at the extreme deep end, about 3.3 near the Sun's orbit).
  var PALS = {
    slate: { light: [[99, 115, 134], [111, 130, 152], [125, 146, 170], [138, 161, 188], [154, 177, 204], [173, 193, 215], [193, 209, 227], [213, 225, 238], [234, 241, 250]],
      dark: [[23, 35, 48], [29, 43, 58], [36, 51, 69], [43, 60, 80], [52, 69, 89], [64, 78, 94], [76, 87, 100], [88, 96, 106], [100, 105, 112]] }
  };

  /* =====================================================================
     6. Flick a star through the Milky Way's gravity
     ===================================================================== */
  function demoOrbit() {
    var fig = document.getElementById('demo-orbit'); if (!fig) return;
    function hyp(a, b) { return Math.sqrt(a * a + b * b); }   // Math.hypot allocates a number on every call; sqrt does not
    function sstep(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
    function rd(v) { return ((v + 4096.5) | 0) - 4096; }   // round to a whole pixel as an int32: canvas calls given ints allocate nothing, fractional numbers are boxed
    var cv = fig.querySelector('canvas'), S = makeCanvas(cv), g = S.ctx, stage = fig.querySelector('.demo__stage'), outVc = fig.querySelector('[data-out="vc"]'), outVp = fig.querySelector('[data-out="vp"]'), outT = fig.querySelector('[data-out="t"]'),
        clearBtn = fig.querySelector('[data-ctl="clear"]'), frameBtns = fig.querySelectorAll('[data-frame]'), galBtn = fig.querySelector('[data-frame="gal"]');
    E.more(fig);   // Details: the pointer's orbit speed and the model's fine print (CSS hides .demo__adv until it is open)
    var D = null, n = 0, x0 = 0, y0 = 0, dx = 1, GX = null, GY = null, OK = null, PHI = null, OMEGA = 0, VC0 = 0, run;
    var HALF = 3.6, PAD = 12, BANDMIN = 54, stars = [], drag = null, MAXSTARS = 14, TRAIL = 200, STRIDE = 3, pressed = false, LEVEL = 3000, RDISC = 3.38;   // the map's edge sits just inside the grid's valid cells, so the rim is a clean circle
    var T = { el: 0.5, fa: 0.5, demo: -99.5, fb: 0.5 }; T.el = 0; T.fa = 0; T.demo = -99; T.fb = 0;   // clock (Myr), angle the Sun's frame has turned (rad), the demo timer (s), and the blend between the frames (0 Sun's, 1 Galactic): double fields, updated in place
    var A = { v: 1, la: 1 };   // alpha of the layer being drawn, and of its labels (a swap fades one frame's labels out before the other's fade in)
    var vpShown = -2, tShown = -2, clearOff = -1, kickShown = -1;
    var layer = document.createElement('canvas'), lg = layer.getContext('2d'), layerG = document.createElement('canvas'), lgG = layerG.getContext('2d'), layerSide = 0, dirty = true, coarse = matchMedia('(pointer: coarse)').matches, armed = false, armedAt = 0, galTap = null;
    var TS = 64, thumb = document.createElement('canvas'), tg = thumb.getContext('2d'); thumb.width = TS; thumb.height = TS;   // the map in miniature, for the Galaxy inset
    var lastDd = 0, LWU = 4.4, LWT = 2.4, LWI = 2.2;   // line widths for the polylines that are drawn in device pixels (see sunTail)
    var oSpot = 0, flickAng = 0, flicked = false, RG = 11.5, PMIN = 0, PMAX = 1, frameMode = 0, HG = 11.9, gseen = false, nudgeOn = false;   // the Sun's frame's angle at the last flick (rad), whether a visitor has flicked, the inset's half-width (kpc), the map's potential range, the frame shown (0 Sun's, 1 Galactic), the Galactic frame's half-width (kpc), whether the Galactic frame has been used, whether its button has been nudged
    var GH_T = 1.1, GH_FADE = 0.45, DEMO_EVERY = 14, ghostDone = false;   // the arrival invitation: a ghost drag of 1.1 s, a 0.45 s fade, and a fresh one every 14 s until the first press
    var DEMO = { x: 7.818, y: -2.2, vx: -19.25, vy: 5.42 };   // the ghost drag: it starts on the Sun's orbit, 2.2 kpc to the right of the Sun (kpc), and flicks 20 km/s straight at the Galactic centre (km/s). The star keeps the Sun's angular momentum, so it loops in a closed ring that stays on the map for the whole 14 s
    var RSTEP = 0.1, RT = [], VCT; for (var rb = R0 - 3.5; rb <= R0 + 3.5 + 1e-9; rb += RSTEP) RT.push(rb); VCT = new Float32Array(RT.length);
    function vcOf(R) { var f = (R - RT[0]) / RSTEP, i = Math.floor(f); if (i < 0) return VCT[0]; if (i >= RT.length - 1) return VCT[RT.length - 1]; return VCT[i] + (VCT[i + 1] - VCT[i]) * (f - i); }

    /* ---------- colour: the ramp, and every colour string the frame loop uses, rebuilt only when the theme changes ---------- */
    var pal = PALS.slate.light, RGB = [0, 0, 0], BARN = 20, BARW = 3;
    var TB = 12, K = { halo: '', pill: '', ring: '', demoTrail: '', star: '', ringIn: '', bar: new Array(BARN), tail: new Array(TB), tailU: new Array(TB) }, inGrad = null, inGX = 0, inGY = 0, inGR = 0;
    function ramp(t) {   // t 0 = deep (dark) to 1 = shallow (light); writes RGB
      var f = (t < 0 ? 0 : t > 1 ? 1 : t) * 8, k = f | 0; if (k > 7) k = 7;
      var u = f - k, a = pal[k], b = pal[k + 1];
      RGB[0] = a[0] + (b[0] - a[0]) * u; RGB[1] = a[1] + (b[1] - a[1]) * u; RGB[2] = a[2] + (b[2] - a[2]) * u;
    }
    function recolor() {
      pal = PALS.slate[C.dark ? 'dark' : 'light'];
      K.halo = rgba(C.surface, 0.9); K.pill = rgba(C.surface, 0.84); K.ring = rgba(C.text, 0.7); K.demoTrail = rgba(C.accent, 0.62); K.star = rgba(C.accent, 0.85); K.ringIn = rgba(C.text2, 0.8);
      for (var b = 0; b < TB; b++) { var al = 0.1 + 0.8 * (b + 1) / TB; K.tail[b] = rgba(C.text, al); K.tailU[b] = rgba(C.surface, Math.min(0.9, al + 0.1)); }   // the Sun's tail: TB bands, fading toward its far end; each has a page-coloured underlay
      for (var k = 0; k < BARN; k++) { ramp((k + 0.5) / BARN); K.bar[k] = 'rgb(' + Math.round(RGB[0]) + ',' + Math.round(RGB[1]) + ',' + Math.round(RGB[2]) + ')'; }
      inGrad = null; dirty = true;
    }
    recolor();

    /* ---------- labels: widths are measured once, and a label's position is passed in PT (a call would box every number it is given) ---------- */
    function mk(text, mono, size) { size = size || 12; return { t: text, size: size, w: 0.5, font: size + 'px ' + (mono ? C.mono : C.sans) }; }
    var L_k1 = mk('7 kpc = 23,000'), L_k2 = mk('light-years across'), L_k3 = mk('↑ Galactic centre'), L_g1 = mk('24 kpc = 78,000'), L_g2 = mk('light-years across'),
        L_n1 = mk('this map travels'), L_n2 = mk('round the Galaxy'), L_n3 = mk('with the Sun'),
        L_m1 = mk('the Galaxy holds still;'), L_m2 = mk('the Sun and this map'), L_m3 = mk('circle its centre'),
        L_sun = mk('Sun'), L_orbit = mk('Sun’s orbit'), L_own = mk('its orbit'), L_exit = mk('left the map'), L_gc = mk('Galactic centre'), L_map = mk('map'),
        L_flick = mk('', true), L_rel = mk('relative to the turning frame'),
        L_h1 = mk('Drag on the map to flick a star', false, 13), L_h2 = mk('Tap the map, then drag to flick a star', false, 13), L_h3 = mk('Now drag to flick a star', false, 13),
        L_try = mk('Now try the Galactic frame ↓'), L_hg = mk('Drag to flick: back to the Sun’s frame'), L_hg2 = mk('Tap to flick: back to the Sun’s frame'), L_leg = mk('darker = deeper in gravity’s well');
    function meas(L) { g.font = L.font; L.w = g.measureText(L.t).width; }
    [L_k1, L_k2, L_k3, L_g1, L_g2, L_n1, L_n2, L_n3, L_m1, L_m2, L_m3, L_sun, L_orbit, L_own, L_exit, L_gc, L_map, L_flick, L_rel, L_h1, L_h2, L_h3, L_try, L_hg, L_hg2, L_leg].forEach(meas);   // once, after the fonts are ready
    var PT = { x: 0.5, y: 0.5 }, NR = 0, RX = new Float64Array(12), RY = new Float64Array(12), RW = new Float64Array(12), RH = new Float64Array(12);   // PT: where the next label goes; RX..RH: the rectangles of labels already placed this frame
    function lx(L, al, clamp) {   // left edge of L drawn at PT; al: 0 left, 1 right, 2 centre; clamp keeps it inside the map's square
      var w = L.w, xl = al === 1 ? PT.x - w : al === 2 ? PT.x - w / 2 : PT.x;
      if (clamp) { if (xl + w > Gm.ox + Gm.side - 7) xl = Gm.ox + Gm.side - 7 - w; if (xl < Gm.ox + 7) xl = Gm.ox + 7; }
      return xl;
    }
    function put(L, col, al, halo, clamp) {   // text with a halo in the page colour (never a hard box), at alpha A.v * A.la
      var ga = A.v * A.la; if (ga < 0.02) return;
      var xi = (lx(L, al, clamp) + 0.5) | 0, yi = (PT.y + 0.5) | 0;
      g.font = L.font; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.globalAlpha = ga;
      if (halo === 2) { g.fillStyle = K.pill; pill(xi - 7, yi - L.size - 2, (L.w + 14) | 0, L.size + 9, 7); g.fill(); }
      else if (halo) { g.strokeStyle = K.halo; g.lineWidth = 3.6; g.strokeText(L.t, xi, yi); }
      g.fillStyle = col; g.fillText(L.t, xi, yi); g.globalAlpha = A.v;
    }
    function pill(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
    function addR(x, y, w, h) { if (NR < 12) { RX[NR] = x; RY[NR] = y; RW[NR] = w; RH[NR] = h; NR++; } }
    function reg(L, al, clamp) { if (NR < 12) { RX[NR] = lx(L, al, clamp) - 3; RY[NR] = PT.y - L.size; RW[NR] = L.w + 6; RH[NR] = L.size + 5; NR++; } }
    function rectFree(x, y, w, h) { for (var q = 0; q < NR; q++) if (x < RX[q] + RW[q] && x + w > RX[q] && y < RY[q] + RH[q] && y + h > RY[q]) return false; return true; }   // does the rectangle keep clear of those placed?
    function isFree(L, al, clamp) { return rectFree(lx(L, al, clamp) - 3, PT.y - L.size, L.w + 6, L.size + 5); }   // would L at PT keep clear of the labels already placed?

    /* ---------- geometry: double fields refreshed at the top of every draw and in the pointer handlers ---------- */
    var Gm = { ox: 0.5, oy: 0.5, sc: 0.5, sg: 0.5, side: 0.5, ks: 0.5, r: 40.5, cx: 0.5, cy: 0.5, band: 0.5, noteR: 0.5 };
    function layout() {   // a header band on top (the stage's extra height, at least BANDMIN) and the square map below it
      var W = S.W, Hh = S.H, band = Math.max(BANDMIN, Hh - W), side = Math.min(W - 2 * PAD, Hh - band - 2 * PAD), r = Math.round(Math.max(W < 340 ? 34 : 40, Math.min(52, W * 0.1)));
      Gm.band = band; Gm.side = side; Gm.ox = (W - side) / 2; Gm.oy = band + (Hh - band - side) / 2; Gm.sc = side / (2 * HALF); Gm.sg = side / (2 * HG);   // px per kpc in the Sun's frame and in the Galactic frame (which shows the whole orbit and the map riding round it)
      Gm.ks = 100 / Math.max(100, side);   // km/s per screen pixel: a full-canvas drag is about 100 km/s
      Gm.r = r; Gm.cx = W - r - 8; Gm.cy = r + 6; Gm.noteR = Gm.cx - 1.15 * r - 6;   // the inset: top-right, in the band; its note ends just left of the window's reach
    }
    function inInset(px, py) { var ex = px - Gm.cx, ey = py - Gm.cy; return ex * ex + ey * ey < (Gm.r + 6) * (Gm.r + 6); }

    function prep(d) {
      D = d; n = d.x.length; x0 = d.x[0]; y0 = d.y[0]; dx = d.x[1] - d.x[0];
      PHI = new Float32Array(n * n); OK = new Uint8Array(n * n); GX = new Float32Array(n * n); GY = new Float32Array(n * n);
      var i, j, VALID = new Uint8Array(n * n);
      for (i = 0; i < n; i++) for (j = 0; j < n; j++) { var v = d.phi[i][j]; PHI[i * n + j] = v == null ? 0 : v; OK[i * n + j] = v == null ? 0 : 1; }
      for (i = 1; i < n - 1; i++) for (j = 1; j < n - 1; j++) {
        var o = i * n + j; if (!(OK[o] && OK[o - n] && OK[o + n] && OK[o - 1] && OK[o + 1])) continue;
        VALID[o] = 1; GX[o] = (PHI[o + n] - PHI[o - n]) / (2 * dx); GY[o] = (PHI[o + 1] - PHI[o - 1]) / (2 * dx);
      }
      OK = VALID;
      var p0 = phiXY(R0, 0); for (i = 0; i < n * n; i++) PHI[i] -= p0;   // zero at the Sun exactly
      // The rotation curve of the map: v_c(R)^2 = R <dPhi/dR> averaged around each ring that crosses the map. Stars move in this
      // ring-averaged force; the full 2D map (with its few-percent azimuthal wiggles, partly network noise) is what is drawn.
      var NB = RT.length, sum = new Float64Array(NB), cnt = new Int32Array(NB);
      for (i = 1; i < n - 1; i++) for (j = 1; j < n - 1; j++) {
        var oo = i * n + j; if (!OK[oo]) continue; var xx = d.x[i], yy = d.y[j]; if (hyp(xx - R0, yy) > RDISC - 0.1) continue;
        var RR = hyp(xx, yy), b = Math.floor((RR - RT[0]) / RSTEP + 0.5); if (b < 0 || b >= NB) continue;
        sum[b] += (GX[oo] * xx + GY[oo] * yy) / RR; cnt[b]++;
      }
      var first = -1, lastb = -1;
      for (i = 0; i < NB; i++) { if (cnt[i] >= 12) { VCT[i] = Math.sqrt(Math.max(0, RT[i] * sum[i] / cnt[i])); if (first < 0) first = i; lastb = i; } else VCT[i] = NaN; }
      for (i = 0; i < NB; i++) { if (i < first) VCT[i] = VCT[first]; else if (i > lastb) VCT[i] = VCT[lastb]; else if (VCT[i] !== VCT[i]) { var a2 = i - 1, b2 = i + 1; while (VCT[b2] !== VCT[b2]) b2++; VCT[i] = VCT[a2] + (VCT[b2] - VCT[a2]) / (b2 - a2); } }
      VC0 = vcOf(R0); OMEGA = VC0 / R0; dirty = true;
      setOut(outVc, Math.round(VC0) + ' km/s');
    }
    function showVp(v) {   // the pointer's reading (behind Details): the circular speed of an orbit through the pointer
      var r = v < 0 ? -1 : Math.round(v); if (r !== vpShown) { vpShown = r; setOut(outVp, r < 0 ? '–' : r + ' km/s'); }
    }
    function inDisc(x, y) { return hyp(x - R0, y) <= RDISC; }
    function cellIndex(x, y) {   // index of the grid cell holding (x, y), or -1 outside the map (no allocation)
      if (!inDisc(x, y)) return -1; var fi = (x - x0) / dx, fj = (y - y0) / dx, i = Math.floor(fi), j = Math.floor(fj); if (i < 0 || j < 0 || i >= n - 1 || j >= n - 1) return -1;
      var o = i * n + j; return (OK[o] && OK[o + 1] && OK[o + n] && OK[o + n + 1]) ? o : -1;
    }
    function phiXY(x, y) {   // bilinear Phi, NaN outside the map
      var o = cellIndex(x, y); if (o < 0) return NaN; var fx = (x - x0) / dx - Math.floor((x - x0) / dx), fy = (y - y0) / dx - Math.floor((y - y0) / dx);
      return PHI[o] * (1 - fx) * (1 - fy) + PHI[o + n] * fx * (1 - fy) + PHI[o + 1] * (1 - fx) * fy + PHI[o + n + 1] * fx * fy;
    }
    function vcAt(x, y) { return inDisc(x, y) ? vcOf(hyp(x, y)) : -1; }
    function guidingRadius(st) {   // the circle a star would follow with its angular momentum: R_g v_c(R_g) = L
      var x = st.s[0], y = st.s[1], R = hyp(x, y), vphi = (x * st.s[3] - y * st.s[2]) / R + OMEGA * R, L = R * vphi, lo = 4.7, hi = 11.5;
      if (L <= 0) return null;
      for (var i = 0; i < 30; i++) { var m = (lo + hi) / 2, vc = vcAt(m, 0); if (vc < 0) { if (m > R0) hi = m; else lo = m; continue; } if (m * vc < L) lo = m; else hi = m; }
      return (lo + hi) / 2;
    }
    function accel(s, o) {   // rotating frame: -grad Phi (ring-averaged) + centrifugal + Coriolis (frame turns with the Galaxy, +y at the Sun)
      if (!inDisc(s[0], s[1])) return false;
      var R = hyp(s[0], s[1]), vc = vcOf(R), F = vc * vc / R;
      o[0] = -F * s[0] / R + OMEGA * OMEGA * s[0] + 2 * OMEGA * s[3]; o[1] = -F * s[1] / R + OMEGA * OMEGA * s[1] - 2 * OMEGA * s[2]; return true;
    }
    var k1 = [0, 0], k2 = [0, 0], k3 = [0, 0], k4 = [0, 0], tmp = [0, 0, 0, 0];
    function rk4(st, h) {
      if (!accel(st, k1)) return false;
      tmp[0] = st[0] + 0.5 * h * st[2]; tmp[1] = st[1] + 0.5 * h * st[3]; tmp[2] = st[2] + 0.5 * h * k1[0]; tmp[3] = st[3] + 0.5 * h * k1[1]; if (!accel(tmp, k2)) return false;
      var vx2 = tmp[2], vy2 = tmp[3];
      tmp[0] = st[0] + 0.5 * h * vx2; tmp[1] = st[1] + 0.5 * h * vy2; tmp[2] = st[2] + 0.5 * h * k2[0]; tmp[3] = st[3] + 0.5 * h * k2[1]; if (!accel(tmp, k3)) return false;
      var vx3 = tmp[2], vy3 = tmp[3];
      tmp[0] = st[0] + h * vx3; tmp[1] = st[1] + h * vy3; tmp[2] = st[2] + h * k3[0]; tmp[3] = st[3] + h * k3[1]; if (!accel(tmp, k4)) return false;
      var vx4 = tmp[2], vy4 = tmp[3];
      st[0] += h / 6 * (st[2] + 2 * vx2 + 2 * vx3 + vx4); st[1] += h / 6 * (st[3] + 2 * vy2 + 2 * vy3 + vy4);
      st[2] += h / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]); st[3] += h / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      return true;
    }
    var RATE = 20 / KPC_KMS, SUB = 2;   // 20 Myr per second, two RK4 substeps per frame
    function launch(x, y, vx, vy, demo) {
      if (stars.length >= MAXSTARS) stars.shift();
      var st = { s: [x, y, vx, vy], trail: new Float32Array(TRAIL * 4), ti: 0, len: 0, dead: 0, age: 0, c: 0, demo: !!demo, rg: null, ex: 0, ey: 0, exi: 0, eyi: 0 };   // trail vertices hold x, y in the Sun's frame and the same point in the Galactic frame
      st.rg = guidingRadius(st); stars.push(st);
      if (!demo) {   // only a visitor's flick wakes the loop (demo restarts must not reset its 45 s rest timer), starts the clock and nudges the Galactic frame button
        T.el = 0; flickAng = T.fa; flicked = true; if (!gseen && !nudgeOn && galBtn) { nudgeOn = true; galBtn.classList.add('is-nudge'); }
        run.wake();
      }
    }
    function startDemo() {   // the arrival invitation: a ghost drag, then the red star it launches; again every 14 s until the first press
      if (pressed || RM || !D) return;
      stars = stars.filter(function (st) { return !st.demo; });
      T.el = 0; flicked = false; T.demo = 0; ghostDone = false;
    }
    function step(dt) {
      var h = dt * RATE / SUB, live = false, s, q, st, alive, fan = T.fa + OMEGA * dt * RATE, ct = Math.cos(fan), sn = Math.sin(fan), gal = frameMode === 1 || T.fb > 0;   // fan: the frame's angle at the end of this step; (ct, sn) turn the Sun's frame into the Galactic frame
      T.demo += dt;
      if (!pressed && D && T.demo >= 0 && run.visible()) {
        if (T.demo > DEMO_EVERY) startDemo();
        else if (!ghostDone && T.demo >= GH_T) { ghostDone = true; launch(DEMO.x, DEMO.y, DEMO.vx, DEMO.vy, true); }
      }
      for (s = stars.length - 1; s >= 0; s--) {
        st = stars[s]; st.age += dt;
        if (st.dead > 0) { st.dead += dt; continue; }
        alive = true; for (q = 0; q < SUB && alive; q++) alive = rk4(st.s, h);
        if (!alive) { st.dead = 0.001; st.ex = st.s[0]; st.ey = st.s[1]; st.exi = st.ex * ct - st.ey * sn; st.eyi = st.ex * sn + st.ey * ct; continue; }
        live = true;
        if (++st.c >= STRIDE) { st.c = 0; q = st.ti * 4; st.trail[q] = st.s[0]; st.trail[q + 1] = st.s[1]; st.trail[q + 2] = st.s[0] * ct - st.s[1] * sn; st.trail[q + 3] = st.s[0] * sn + st.s[1] * ct; st.ti = (st.ti + 1) % TRAIL; if (st.len < TRAIL) st.len++; }   // a vertex every third step: 200 vertices hold 200 Myr
      }
      if (live || gal) { T.el += dt * 20; T.fa = fan; }   // the Sun's frame turns at the Sun's angular speed (one turn in about 218 Myr); in the Galactic frame the Sun keeps racing round even with no star left
      if (T.fb !== frameMode) { T.fb += (frameMode > T.fb ? dt : -dt) / 0.5; if (frameMode ? T.fb >= 1 : T.fb <= 0) T.fb = frameMode; }   // the swap between the frames takes 0.5 s
      if (armed && performance.now() - armedAt > 8000) { armed = false; stage.classList.remove('is-armed'); }
    }

    /* ---------- the potential, interpolated per pixel: a smooth single-hue tint (darker = deeper) plus anti-aliased contour lines ---------- */
    function renderMap(cnv, ctx, LS, shared, lw) {   // the tint and its contour lines over the 7.2 kpc square, LS pixels across; lw: a contour line's width in these pixels (shared: reuse the first map's potential range, so both maps agree)
      cnv.width = LS; cnv.height = LS;
      var im = ctx.createImageData(LS, LS), d = im.data, ok = new Uint8Array(LS * LS), vals = new Float32Array(LS * LS), i, j, u, v, o, ph, pmin = Infinity, pmax = -Infinity, kpp = 2 * HALF / LS;
      for (j = 0; j < LS; j++) { u = (j + 0.5) * kpp - HALF; for (i = 0; i < LS; i++) { v = HALF - (i + 0.5) * kpp; o = j * LS + i; ph = hyp(u, v) <= RDISC + kpp ? phiXY(u + R0, v) : NaN; if (ph !== ph) continue; vals[o] = ph; ok[o] = 1; if (ph < pmin) pmin = ph; if (ph > pmax) pmax = ph; } }
      if (shared) { pmin = PMIN; pmax = PMAX; } else { PMIN = pmin; PMAX = pmax; }
      var lm = C.dark ? 0.36 : 0.5, lt = C.dark ? 236 : 24, hw = lw * 0.5 + 0.5;   // contour lines: the local tint pushed toward near-white (dark mode) or ink (light mode), by the line's coverage of the pixel
      for (j = 0; j < LS; j++) { u = (j + 0.5) * kpp - HALF; for (i = 0; i < LS; i++) {
        var o2 = j * LS + i, p = o2 * 4; if (!ok[o2]) { d[p + 3] = 0; continue; }
        v = HALF - (i + 0.5) * kpp;
        var me = vals[o2], edge = Math.max(0, Math.min(1, (RDISC - hyp(u, v)) / kpp + 0.5));
        ramp((me - pmin) / (pmax - pmin));
        var vl = i > 0 && ok[o2 - 1] ? vals[o2 - 1] : me, vr = i < LS - 1 && ok[o2 + 1] ? vals[o2 + 1] : me, vu = j > 0 && ok[o2 - LS] ? vals[o2 - LS] : me, vd = j < LS - 1 && ok[o2 + LS] ? vals[o2 + LS] : me;
        var gx = (vr - vl) * 0.5, gy = (vd - vu) * 0.5, gm = Math.sqrt(gx * gx + gy * gy) + 1e-3, f = me / LEVEL, dist = Math.abs(f - Math.round(f)) * LEVEL / gm;   // dist: pixels from here to the nearest contour
        var cov = hw - dist; cov = cov < 0 ? 0 : cov > 1 ? 1 : cov; var mix = lm * cov;
        d[p] = RGB[0] + (lt - RGB[0]) * mix; d[p + 1] = RGB[1] + (lt - RGB[1]) * mix; d[p + 2] = RGB[2] + (lt - RGB[2]) * mix; d[p + 3] = 255 * edge | 0;
      } }
      ctx.putImageData(im, 0, 0);
    }
    function buildLayer(side) {   // the Sun's-frame map (with its thumbnail for the inset), and the smaller map that rides with the Sun in the Galactic frame (drawn at twice its size and scaled down, so its lines stay smooth as it turns)
      var LS = Math.min(900, Math.round(side * Math.min(2, S.dpr))), gpx = 2 * HALF * Gm.sg, LG = Math.max(96, Math.min(800, Math.round(gpx * Math.min(2, S.dpr) * 2)));
      renderMap(layer, lg, LS, false, 1.1 * LS / side); layerSide = side; buildThumb();
      renderMap(layerG, lgG, LG, true, 1.0 * LG / gpx); dirty = false;
    }
    function buildThumb() {   // the same map at 64 px with no contour lines, sampled straight from the grid, for the inset
      var im = tg.createImageData(TS, TS), d = im.data, kpp = 2 * HALF / TS, i, j, u, v, p, rd, ph;
      for (j = 0; j < TS; j++) { u = (j + 0.5) * kpp - HALF; for (i = 0; i < TS; i++) { v = HALF - (i + 0.5) * kpp; p = (j * TS + i) * 4; rd = hyp(u, v); ph = rd <= RDISC + kpp ? phiXY(u + R0, v) : NaN;
        if (ph !== ph) { d[p + 3] = 0; continue; } ramp((ph - PMIN) / (PMAX - PMIN)); d[p] = RGB[0]; d[p + 1] = RGB[1]; d[p + 2] = RGB[2]; d[p + 3] = 255 * Math.max(0, Math.min(1, (RDISC - rd) / kpp + 0.5)) | 0; } }
      tg.putImageData(im, 0, 0);
    }

    /* ---------- small marks ---------- */
    function sunMark(x, y) {   // the Sun: the astronomers' symbol, a ring round a dot, so no star can be mistaken for it
      g.fillStyle = K.halo; g.beginPath(); g.arc(x, y, 8.5, 0, TAU); g.fill();
      g.strokeStyle = C.text; g.lineWidth = 1.7; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.stroke();
      g.fillStyle = C.text; g.beginPath(); g.arc(x, y, 2.4, 0, TAU); g.fill(); g.lineWidth = 1;
    }
    function starHead(x, y) { g.fillStyle = K.halo; g.beginPath(); g.arc(x, y, 5.6, 0, TAU); g.fill(); g.fillStyle = C.accent; g.beginPath(); g.arc(x, y, 3.6, 0, TAU); g.fill(); }
    function chevron(x, y, tx, ty) {   // an open arrowhead on an orbit: the way it goes round (t: unit tangent)
      var nx = -ty, ny = tx;
      for (var pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass ? C.text : K.halo; g.lineWidth = pass ? 1.8 : 4.6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x - 4 * tx + 5 * nx, y - 4 * ty + 5 * ny); g.lineTo(x + 4 * tx, y + 4 * ty); g.lineTo(x - 4 * tx - 5 * nx, y - 4 * ty - 5 * ny); g.stroke();
      }
      g.lineCap = 'butt'; g.lineWidth = 1;
    }
    function aim(ax, ay, bx, by, al) {   // the flick: a ring where the press is, and an arrow to where it is now (the visitor's drag, and the ghost drag)
      var ang = Math.atan2(by - ay, bx - ax), c1 = Math.cos(ang - 0.45), s1 = Math.sin(ang - 0.45), c2 = Math.cos(ang + 0.45), s2 = Math.sin(ang + 0.45);
      g.globalAlpha = al; g.lineCap = 'round';
      for (var pass = 0; pass < 2; pass++) {
        g.strokeStyle = pass ? C.accent : K.halo; g.lineWidth = pass ? 2 : 5;
        g.beginPath(); g.moveTo(ax + 5, ay); g.arc(ax, ay, 5, 0, TAU); g.moveTo(ax, ay); g.lineTo(bx, by);
        g.moveTo(bx - 9 * c1, by - 9 * s1); g.lineTo(bx, by); g.lineTo(bx - 9 * c2, by - 9 * s2); g.stroke();
      }
      g.lineCap = 'butt'; g.lineWidth = 1; g.globalAlpha = 1;
    }
    function bottomHint(L, col) {   // bottom-right: beside the legend if there is room, else one line above it
      PT.x = Gm.ox + Gm.side - 12; PT.y = (L.w + BARN * BARW + 8 + L_leg.w + 30 < Gm.side) ? Gm.oy + Gm.side + 3 : Gm.oy + Gm.side - 14; put(L, col, 1, 2, false); reg(L, 1, false);
    }

    /* ---------- the inset: the whole Galaxy from above, not turning. The map rides round the Sun's orbit and turns once per orbit ---------- */
    function drawInset() {
      var r = Gm.r, cx = Gm.cx, cy = Gm.cy, k = r / RG, ringR = Math.round(R0 * k), wh = Math.round(HALF * k), a = HALFPI + T.fa, sx = cx + ringR * Math.cos(a), sy = cy + ringR * Math.sin(a), sw = T.fa - flickAng, j, ns, th, a0, a1, dd, cxD, cyD, rD, ac, as, tx, ty;
      if (!inGrad || inGX !== cx || inGY !== cy || inGR !== r) {   // rebuilt only on resize or theme change
        inGrad = g.createRadialGradient(cx, cy, 0, cx, cy, r * 0.9); inGrad.addColorStop(0, rgba(C.text3, 0.34)); inGrad.addColorStop(0.6, rgba(C.text3, 0.12)); inGrad.addColorStop(1, rgba(C.text3, 0)); inGX = cx; inGY = cy; inGR = r;
      }
      g.fillStyle = inGrad; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.strokeStyle = K.ringIn; g.lineWidth = 1; g.setLineDash(DASH3); g.beginPath(); g.arc(cx, cy, ringR, 0, TAU); g.stroke(); g.setLineDash(NODASH);
      g.strokeStyle = C.text; g.lineCap = 'round'; g.lineWidth = 4.8; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx, cy); g.stroke();   // the Galactic centre: a filled dot drawn as a zero-length round-capped line (no boxed arguments)
      if (flicked && sw > 0.02) {   // the stretch of orbit the Sun has covered since the flick (at most five-sixths of the way round), in the Sun's own ink
        a0 = HALFPI + flickAng; a1 = HALFPI + T.fa; if (sw > 5.2) a0 = a1 - 5.2;
        ns = Math.max(2, ((a1 - a0) * 10) | 0); th = (a1 - a0) / ns; ac = Math.cos(th); as = Math.sin(th); tx = Math.cos(a0); ty = Math.sin(a0);
        dd = S.dpr; if (dd !== lastDd) { lastDd = dd; LWU = 4.4 * dd; LWT = 2.4 * dd; LWI = 2.2 * dd; }
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); cxD = rd(cx * dd); cyD = rd(cy * dd); rD = ringR * dd; g.lineWidth = LWI; g.beginPath(); g.moveTo(cxD + rd(rD * tx), cyD + rd(rD * ty));   // device pixels, as the Galactic frame's tail
        for (j = 0; j < ns; j++) { th = tx * ac - ty * as; ty = tx * as + ty * ac; tx = th; g.lineTo(cxD + rd(rD * tx), cyD + rd(rD * ty)); }
        g.stroke(); g.restore();
      }
      g.save(); g.translate(sx, sy); g.rotate(T.fa);   // the window keeps its top toward the Galactic centre, so it turns as it goes round
      g.drawImage(thumb, -wh, -wh, 2 * wh, 2 * wh);
      g.strokeStyle = C.text; g.lineWidth = 1.2; g.beginPath(); g.moveTo(-wh, -wh); g.lineTo(wh, -wh); g.lineTo(wh, wh); g.lineTo(-wh, wh); g.closePath(); g.stroke(); g.lineWidth = 1;   // the thumbnail's own shading (dark toward the Galactic centre) shows which way the window faces
      g.restore();
      g.strokeStyle = C.text; g.lineWidth = 3.8; g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx, sy); g.stroke(); g.lineCap = 'butt'; g.lineWidth = 1;   // the Sun, at the window's centre
      var ad = a + wh / ringR + 0.32, qx, qy; ac = Math.cos(ad); as = Math.sin(ad); tx = -as; ty = ac; qx = cx + ringR * ac; qy = cy + ringR * as;   // a chevron ahead of the window: the direction the Sun goes
      g.fillStyle = C.text2; g.beginPath(); g.moveTo(qx + 4 * tx, qy + 4 * ty); g.lineTo(qx - 2.5 * tx + 3 * ac, qy - 2.5 * ty + 3 * as); g.lineTo(qx - 2.5 * tx - 3 * ac, qy - 2.5 * ty - 3 * as); g.closePath(); g.fill();
    }

    function legendRect() { addR(Gm.ox + 6, Gm.oy + Gm.side - 9, BARN * BARW + 14 + L_leg.w, 16); }   // so no map label is placed on the legend
    function placeExit(ex, ey, mid, k) {   // "left the map" next to the ring where a star left, on whichever side has room (k staggers neighbours)
      var lo = Gm.oy + 24, hi = Gm.oy + Gm.side - 20, y1 = ey + (ey < mid ? 20 : -10) + (k % 2) * 14, y2 = ey + (ey < mid ? -10 : 20);
      PT.x = ex; PT.y = Math.max(lo, Math.min(hi, y1));
      if (!isFree(L_exit, 2, true)) { PT.y = Math.max(lo, Math.min(hi, y2)); if (!isFree(L_exit, 2, true)) return; }
      put(L_exit, C.accent, 2, true, true); reg(L_exit, 2, true);
    }
    function exitLabels(n, mid) {   // "left the map" for the two most recent exits only (eight at once would be a column of the same words)
      for (var c = 0; c < 2; c++) {
        var bi = -1, bd = 1e7; for (var q = 0; q < n; q++) if (EXD[q] < bd) { bd = EXD[q]; bi = q; }
        if (bi < 0) return; placeExit(EXX[bi], EXY[bi], mid, c); EXD[bi] = 1e8;   // 1e8: used
      }
    }
    function drawLegend() {   // bottom-left, in both frames: what the tint means
      var ox = Gm.ox, oy = Gm.oy, side = Gm.side, ly = (oy + side + 3) | 0, bx = (ox + 8) | 0, BW = BARN * BARW, k;   // in the strip below the round map, so its rim never runs through the words
      A.v = 1; A.la = 1; g.globalAlpha = 1;
      for (k = 0; k < BARN; k++) { g.fillStyle = K.bar[k]; g.fillRect(bx + k * BARW, ly - 9, BARW, 8); }
      g.fillStyle = C.borderStrong; g.fillRect(bx, ly - 10, BW, 1); g.fillRect(bx, ly - 1, BW, 1); g.fillRect(bx, ly - 10, 1, 10); g.fillRect(bx + BW - 1, ly - 10, 1, 10);   // the bar's outline, on whole pixels
      PT.x = bx + BW + 8; PT.y = ly; put(L_leg, C.text2, 0, true, false);
    }

    function drawSun(la) {   // the Sun's frame: the Sun fixed at the centre, the Galactic centre straight up, the inset showing the frame turning
      var side = Gm.side, ox = Gm.ox, oy = Gm.oy, sc = Gm.sc, i, k, st, px, py, idx, exx, exy, nEx = 0, lastU = null, lv, lu, sx, sy;
      // (cx, cy) is the Sun on screen; a point u kpc along +x and v kpc along +y from the Sun is at (cx - v * sc, cy + u * sc); the Galactic centre is straight above the Sun, at gcy
      var cx = ox + side / 2, cy = oy + side / 2, rr = RDISC * sc, gcy = cy - R0 * sc, cxI = (cx + 0.5) | 0, cyI = (cy + 0.5) | 0, rrI = (rr + 0.5) | 0, gcyI = (gcy + 0.5) | 0, orbI = (R0 * sc + 0.5) | 0;   // whole-pixel centres and radii for the arcs: fractional canvas arguments are boxed
      A.v = 1; A.la = la; g.globalAlpha = 1; NR = 0; legendRect();
      g.imageSmoothingEnabled = true; g.drawImage(layer, ox | 0, oy | 0, side | 0, side | 0);
      g.strokeStyle = C.borderStrong; g.lineWidth = 1; g.beginPath(); g.arc(cxI, cyI, rrI, 0, TAU); g.stroke();
      for (i = 0; i < stars.length; i++) { st = stars[i]; if (!st.demo && st.rg != null && st.dead === 0) lastU = st; }   // the newest visitor star still on the map
      g.save(); g.beginPath(); g.arc(cxI, cyI, rrI, 0, TAU); g.clip();
      g.strokeStyle = K.ring; g.lineWidth = 1.5; g.setLineDash(DASH5); g.beginPath(); g.arc(cxI, gcyI, orbI, 0, TAU); g.stroke();   // the Sun's orbit: a star at rest on it stays on it
      for (i = 0; i < stars.length; i++) {   // each visitor star's own orbit (its guiding circle), red and dashed: the newest strong, the others faint
        st = stars[i]; if (st.demo || st.rg == null || st.dead > 0) continue; g.globalAlpha = st === lastU ? 1 : 0.3;
        g.strokeStyle = K.halo; g.lineWidth = 3; g.beginPath(); g.arc(cxI, gcyI, (st.rg * sc + 0.5) | 0, 0, TAU); g.stroke(); g.strokeStyle = C.accent; g.lineWidth = 1.5; g.stroke();
      }
      g.setLineDash(NODASH); g.globalAlpha = 1; g.lineWidth = 1; g.restore();
      for (i = 0; i < stars.length; i++) {   // trails (and the ring where a star left the map)
        st = stars[i]; g.globalAlpha = st.dead > 0 ? 0.45 : 1;
        g.strokeStyle = st.demo ? K.demoTrail : K.star; g.lineWidth = st.demo ? 1.5 : 1.8; g.beginPath();
        for (k = 0; k < st.len; k++) { idx = ((st.ti - st.len + k) % TRAIL + TRAIL) % TRAIL; px = cx - st.trail[idx * 4 + 1] * sc; py = cy + (st.trail[idx * 4] - R0) * sc; if (k === 0) g.moveTo(px, py); else g.lineTo(px, py); }
        g.stroke(); g.lineWidth = 1;
        if (st.dead > 0) { exx = cx - st.ey * sc; exy = cy + (st.ex - R0) * sc; g.strokeStyle = C.accent; g.beginPath(); g.arc((exx + 0.5) | 0, (exy + 0.5) | 0, 6, 0, TAU); g.stroke(); if (st.dead < 3 && nEx < MAXSTARS) { EXX[nEx] = exx; EXY[nEx] = exy; EXD[nEx] = st.dead; nEx++; } }
        g.globalAlpha = 1;
      }
      // labels sit under the stars' heads, so a star passing a label stays visible
      PT.x = cx + 11; PT.y = cy - 8; reg(L_sun, 0, false);
      var ra = HALFPI + 0.3, rx = cx + R0 * sc * Math.cos(ra), ry = gcy + R0 * sc * Math.sin(ra), tx = -Math.sin(ra), ty = Math.cos(ra);   // the Sun's orbit goes this way: an arrowhead on the orbit itself, named once (rotation is toward the left on screen)
      if (hyp(rx - cx, ry - cy) < rr - 16) { chevron(rx, ry, tx, ty); PT.x = rx - 2; PT.y = ry + 21; put(L_orbit, C.text, 0, true, true); reg(L_orbit, 0, true); }
      if (lastU && Math.abs(lastU.rg - R0) > 0.15) {   // name the newest star's own orbit where it crosses the map's side (the other side if the first is taken)
        lv = lastU.s[1] > 0 ? -1.7 : 1.7;
        for (k = 0; k < 2; k++, lv = -lv) {
          lu = Math.sqrt(Math.max(0, lastU.rg * lastU.rg - lv * lv)) - R0; if (hyp(lu, lv) >= RDISC - 0.3) continue;
          PT.x = cx - lv * sc + 6; PT.y = Math.max(oy + 24, Math.min(oy + side - 24, cy + lu * sc + (lu < 0 ? -6 : 15)));
          if (!isFree(L_own, 0, true)) continue;
          put(L_own, C.accent, 0, true, true); break;
        }
      }
      exitLabels(nEx, cy);
      PT.x = cx + 11; PT.y = cy - 8; put(L_sun, C.text, 0, true, false);
      // the header band: the scale and the direction of the Galactic centre on the left, the inset's note beside the inset
      PT.x = ox + 2; PT.y = 17; put(L_k1, C.text2, 0, false, false); PT.y = 31; put(L_k2, C.text2, 0, false, false); PT.y = 45; put(L_k3, C.text, 0, false, false);
      if (Gm.noteR - Math.max(L_n1.w, L_n2.w, L_n3.w) > ox + 12 + Math.max(L_k2.w, L_k3.w)) { PT.x = Gm.noteR; PT.y = 17; put(L_n1, C.text2, 1, false, false); PT.y = 31; put(L_n2, C.text2, 1, false, false); PT.y = 45; put(L_n3, C.text2, 1, false, false); }
      // the invitation, next to the Sun, until the first flick; after it, the nudge to the other frame
      if (!pressed) { PT.x = cx; PT.y = cy + 64; if (armed) put(L_h3, C.accent, 2, 2, true); else put(coarse ? L_h2 : L_h1, C.text, 2, 2, true); }
      else if (flicked && !gseen) bottomHint(L_try, C.accent);
      else if (armed) bottomHint(L_h3, C.accent);
      for (i = 0; i < stars.length; i++) {   // the stars' heads, above every static label
        st = stars[i]; if (st.dead > 0) continue; sx = (cx - st.s[1] * sc + 0.5) | 0; sy = (cy + (st.s[0] - R0) * sc + 0.5) | 0; starHead(sx, sy);
      }
      sunMark(cxI, cyI);
      drawInset();
    }

    function drawGal(ga, la) {   // the Galactic frame: the centre fixed, the Sun racing round its orbit, the map a disc riding with the Sun; the same stars, drawn where they are in space
      var side = Gm.side, ox = Gm.ox, oy = Gm.oy, sg = Gm.sg, gx = ox + side / 2, gy = oy + side / 2, gxI = (gx + 0.5) | 0, gyI = (gy + 0.5) | 0, RS = Math.round(R0 * sg), hs = Math.round(HALF * sg), rdG = Math.round(RDISC * sg),
          ct = Math.cos(T.fa), sn = Math.sin(T.fa), sx = gx - RS * sn, sy = gy + RS * ct, sxI = (sx + 0.5) | 0, syI = (sy + 0.5) | 0, i, j, k, al, ns, st, px, py, idx, hx, hy, xi, yi, th, a0, a1, rx, ry, exx, exy, dd, gxD, gyD, rD, nEx = 0, lastU = null;
      A.v = ga; A.la = la; NR = 0;
      g.globalAlpha = ga; g.fillStyle = C.surface; g.fillRect(0, 0, S.W, S.H);   // the whole canvas fades in, padding and band included, so nothing of the Sun's frame is left behind at the end of a swap
      for (i = 0; i < stars.length; i++) { st = stars[i]; if (!st.demo && st.rg != null && st.dead === 0) lastU = st; }
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.save(); g.translate(sx, sy); g.rotate(T.fa);   // the map: a disc that rides with the Sun, turned so that its top still points at the Galactic centre
      g.drawImage(layerG, -hs, -hs, 2 * hs, 2 * hs); g.strokeStyle = C.borderStrong; g.lineWidth = 1; g.beginPath(); g.arc(0, 0, rdG, 0, TAU); g.stroke(); g.restore(); g.imageSmoothingQuality = 'low';
      g.strokeStyle = K.ring; g.lineWidth = 1.5; g.setLineDash(DASH5); g.beginPath(); g.arc(gxI, gyI, RS, 0, TAU); g.stroke();   // the Sun's orbit
      for (i = 0; i < stars.length; i++) {   // each visitor star's own orbit, round the Galactic centre: the newest strong, the others faint
        st = stars[i]; if (st.demo || st.rg == null || st.dead > 0) continue; k = Math.round(st.rg * sg); g.globalAlpha = ga * (st === lastU ? 1 : 0.3);
        g.strokeStyle = K.halo; g.lineWidth = 3; g.beginPath(); g.arc(gxI, gyI, k, 0, TAU); g.stroke(); g.strokeStyle = C.accent; g.lineWidth = 1.5; g.stroke();
      }
      g.setLineDash(NODASH); g.lineWidth = 1; g.globalAlpha = ga;
      if (flicked && T.fa - flickAng > 0.02) {   // the Sun's own path since the flick: a tail in the Sun's ink, fading away behind it (never the red of the flicked stars); TB bands of whole-pixel polylines, turned by a fixed step each vertex
        a0 = HALFPI + flickAng; a1 = HALFPI + T.fa; if (a1 - a0 > 5.2) a0 = a1 - 5.2;
        ns = Math.min(72, Math.max(TB, ((a1 - a0) * 12) | 0)); ns = ns - ns % TB; k = ns / TB;
        th = (a1 - a0) / ns; xi = Math.cos(th); yi = Math.sin(th); hx = Math.cos(a0); hy = Math.sin(a0);   // (xi, yi): the step's rotation; (hx, hy): the unit vector at the vertex
        dd = S.dpr; if (dd !== lastDd) { lastDd = dd; LWU = 4.4 * dd; LWT = 2.4 * dd; LWI = 2.2 * dd; }
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); gxD = rd(gx * dd); gyD = rd(gy * dd); rD = RS * dd;   // device pixels: whole-number coordinates on the finest grid, so the arc stays smooth and nothing is boxed
        for (j = 0; j < TB; j++) {
          g.beginPath(); g.moveTo(gxD + rd(rD * hx), gyD + rd(rD * hy));
          for (i = 0; i < k; i++) { th = hx * xi - hy * yi; hy = hx * yi + hy * xi; hx = th; g.lineTo(gxD + rd(rD * hx), gyD + rd(rD * hy)); }
          g.strokeStyle = K.tailU[j]; g.lineWidth = LWU; g.stroke(); g.strokeStyle = K.tail[j]; g.lineWidth = LWT; g.stroke();
        }
        g.restore();
      }
      for (i = 0; i < stars.length; i++) {   // trails in inertial positions, and the ring where a star left the map (it stays where it left)
        st = stars[i]; g.globalAlpha = ga * (st.dead > 0 ? 0.45 : 1);
        g.strokeStyle = st.demo ? K.demoTrail : K.star; g.lineWidth = st.demo ? 1.5 : 1.8; g.beginPath();
        for (k = 0; k < st.len; k++) { idx = ((st.ti - st.len + k) % TRAIL + TRAIL) % TRAIL; px = gx - st.trail[idx * 4 + 3] * sg; py = gy + st.trail[idx * 4 + 2] * sg; if (k === 0) g.moveTo(px, py); else g.lineTo(px, py); }
        g.stroke(); g.lineWidth = 1;
        if (st.dead > 0) { exx = gx - st.eyi * sg; exy = gy + st.exi * sg; g.strokeStyle = C.accent; g.beginPath(); g.arc((exx + 0.5) | 0, (exy + 0.5) | 0, 6, 0, TAU); g.stroke(); if (st.dead < 3 && nEx < MAXSTARS) { EXX[nEx] = exx; EXY[nEx] = exy; EXD[nEx] = st.dead; nEx++; } }
      }
      g.globalAlpha = ga;
      // labels sit under the stars' heads; the fixed ones first, then the moving ones in order of importance, each keeping clear of those before it
      legendRect(); bottomHint(coarse ? L_hg2 : L_hg, C.text2);   // a press goes back to the Sun's frame to flick
      PT.x = sxI + 11; PT.y = syI - 8; reg(L_sun, 0, true);
      PT.x = gx + 9; PT.y = gy - 8; put(L_gc, C.text, 0, true, false); reg(L_gc, 0, false);
      th = (T.fa + HALFPI + 0.7853981633974483) % TAU; if (th > Math.PI) th = TAU - th;   // how far the Sun is from the upper-right spot (0..pi)
      if (oSpot === 0 ? th < 1 : th > Math.PI - 1) oSpot = 1 - oSpot;   // the arrowhead moves to the opposite spot only when the Sun comes near it
      xi = oSpot ? -0.7071067811865476 : 0.7071067811865476; rx = gx + RS * xi; ry = gy - RS * xi;   // the Sun's orbit goes round this way (clockwise on screen): an arrowhead on the orbit itself, named once
      chevron(rx, ry, xi, xi);
      if (oSpot) { PT.x = rx - 12; PT.y = ry + 16; put(L_orbit, C.text, 1, true, false); reg(L_orbit, 1, false); } else { PT.x = rx + 12; PT.y = ry - 6; put(L_orbit, C.text, 0, true, false); reg(L_orbit, 0, false); }
      if (lastU && Math.abs(lastU.rg - R0) > 0.15) {   // name the newest star's own orbit at the first free spot round its circle: top, bottom, left, right
        k = Math.round(lastU.rg * sg);
        for (j = 0; j < 4; j++) {
          if (j === 0) { PT.x = gx; PT.y = gy - k - 7; al = 2; } else if (j === 1) { PT.x = gx; PT.y = gy + k + 18; al = 2; } else if (j === 2) { PT.x = gx - k - 8; PT.y = gy + 4; al = 1; } else { PT.x = gx + k + 8; PT.y = gy + 4; al = 0; }
          if (PT.y < oy + 20 || PT.y > oy + side - 8 || !isFree(L_own, al, true)) continue;
          put(L_own, C.accent, al, true, true); reg(L_own, al, true); break;
        }
      }
      exitLabels(nEx, gy);
      PT.x = sxI; PT.y = syI + rdG - 8; if (!isFree(L_map, 2, true)) { PT.y = syI - rdG + 18; if (!isFree(L_map, 2, true)) PT.y = -99; }   // the disc's name, below it or above it, unless both spots are taken
      if (PT.y > 0) put(L_map, C.text2, 2, true, true);
      PT.x = sxI + 11; PT.y = syI - 8; put(L_sun, C.text, 0, true, true);
      PT.x = ox + 2; PT.y = 17; put(L_g1, C.text2, 0, false, false); PT.y = 31; put(L_g2, C.text2, 0, false, false);   // the header band: the scale, and what this frame is
      PT.x = S.W - 14; PT.y = 17; put(L_m1, C.text2, 1, false, false); PT.y = 31; put(L_m2, C.text2, 1, false, false); PT.y = 45; put(L_m3, C.text2, 1, false, false);
      for (i = 0; i < stars.length; i++) {   // the stars' heads, above every static label
        st = stars[i]; if (st.dead > 0) continue; xi = st.s[0] * ct - st.s[1] * sn; yi = st.s[0] * sn + st.s[1] * ct; hx = (gx - yi * sg + 0.5) | 0; hy = (gy + xi * sg + 0.5) | 0; starHead(hx, hy);
      }
      g.strokeStyle = K.halo; g.lineWidth = 4; g.beginPath(); g.moveTo(gxI - 6, gyI); g.lineTo(gxI + 6, gyI); g.moveTo(gxI, gyI - 6); g.lineTo(gxI, gyI + 6); g.stroke(); g.strokeStyle = C.text; g.lineWidth = 1.6; g.stroke(); g.lineWidth = 1;   // the Galactic centre: a cross
      sunMark(sxI, syI);
      g.globalAlpha = 1;
    }

    function draw() {
      var W = S.W, Hh = S.H; if (!W) return;
      layout();
      g.fillStyle = C.surface; g.fillRect(0, 0, W, Hh);
      if (!D) return false;
      if (dirty || layerSide !== Gm.side) buildLayer(Gm.side);
      var side = Gm.side, ox = Gm.ox, oy = Gm.oy, cx = ox + side / 2, cy = oy + side / 2, i, anyLive = false, fb = T.fb, sm = sstep(fb);
      for (i = 0; i < stars.length; i++) if (stars[i].dead === 0) anyLive = true;
      g.lineJoin = 'round';
      if (fb < 1) drawSun(sm < 0.5 ? 1 - 2 * sm : 0);   // a swap dissolves one frame into the other (the Sun's frame underneath, the Galactic frame fading in over it) and fades one frame's labels out before the other's fade in
      if (fb > 0) drawGal(sm, sm > 0.5 ? 2 * sm - 1 : 0);
      drawLegend();
      if (!drag && !pressed && frameMode === 0 && fb < 1) {   // the ghost drag: the invitation (a still arrow under reduced motion)
        var gx0 = cx - DEMO.y * Gm.sc, gy0 = cy + (DEMO.x - R0) * Gm.sc, gdx = -DEMO.vy / Gm.ks, gdy = DEMO.vx / Gm.ks, gu, gal;
        if (RM) aim(gx0, gy0, gx0 + gdx, gy0 + gdy, 0.55 * (1 - sm));
        else if (T.demo >= 0 && T.demo < GH_T + GH_FADE) { gu = sstep(T.demo / GH_T); gal = T.demo < GH_T ? 1 : 1 - (T.demo - GH_T) / GH_FADE; aim(gx0, gy0, gx0 + gdx * gu, gy0 + gdy * gu, gal * (1 - sm)); }
      }
      if (drag) {   // the flick, and what it is measured against: drawn last so nothing covers it
        A.v = 1; A.la = 1; aim(drag[0], drag[1], drag[2], drag[3], 1);
        var kr = Math.round(hyp(drag[2] - drag[0], drag[3] - drag[1]) * Gm.ks);
        if (kr !== kickShown) { kickShown = kr; L_flick.t = 'flick ' + kr + ' km/s'; meas(L_flick); }
        // the two-line label goes beyond the arrow's tip, on the side away from its shaft; else on another side; never over the Sun, its name or the legend
        var wF = L_flick.w > L_rel.w ? L_flick.w : L_rel.w, fx = 0, fy = 0, fk, hp = drag[2] >= drag[0] ? 0 : 1, vp = drag[3] >= drag[1] ? 1 : 0, lo = ox + 14, hi = ox + side - 14 - wF;
        NR = 0; legendRect(); addR(cx - 14, cy - 14, 28, 28); addR(cx + 8, cy - 22, L_sun.w + 8, 18);   // (cx, cy): the Sun, as above
        for (fk = 0; fk < 4; fk++) {
          fx = (fk >> 1 ? 1 - hp : hp) ? drag[2] - 16 - wF : drag[2] + 16; fy = Math.max(oy + 28, Math.min(oy + side - 38, (fk & 1 ? 1 - vp : vp) ? drag[3] + 30 : drag[3] - 10));
          if (fx >= lo && fx <= hi && rectFree(fx - 7, fy - 14, wF + 14, 38)) break;
        }
        if (fk === 4) { fx = Math.max(lo, Math.min(hi, drag[2] + 16)); fy = Math.max(oy + 28, Math.min(oy + side - 38, drag[3] - 10)); }
        PT.x = fx; PT.y = fy; put(L_flick, C.accent, 0, 2, true); PT.y = fy + 17; put(L_rel, C.text2, 0, 2, true);
      }
      var tr = flicked ? Math.round(T.el) : -1; if (tr !== tShown) { tShown = tr; setOut(outT, tr < 0 ? 'not yet' : tr + ' million years'); }
      var off = 1; for (i = 0; i < stars.length; i++) if (!stars[i].demo) off = 0; if (off !== clearOff) { clearOff = off; if (clearBtn) clearBtn.disabled = !!off; }
      return (anyLive || drag || (!pressed && !RM) || frameMode === 1 || fb !== frameMode) ? undefined : false;   // the Galactic frame keeps moving (the Sun races round) until the loop's 45 s rest
    }
    var EXX = new Float32Array(MAXSTARS), EXY = new Float32Array(MAXSTARS), EXD = new Float32Array(MAXSTARS);
    run = loop(cv, step, draw, null); run.onVisible(function () { if (D && !pressed && !stars.length) startDemo(); });
    S.onresize = function () { run.wake(); run.redraw(); }; E.onTheme.push(function () { recolor(); run.wake(); run.redraw(); });
    enable(fig, false); note(fig, RM ? 'Animation off (reduced motion): stars are drawn where released.' : 'Loading the gravity map (80 KB)…');
    whenNear(fig, function () { fetchJSON(fig.getAttribute('data-src')).then(function (d) { prep(d); enable(fig, true); clearOff = -1; note(fig, RM ? 'Animation off (reduced motion): stars are drawn where released.' : ''); if (run.visible() && !stars.length) startDemo(); run.wake(); run.redraw(); }).catch(function (e) { failed(fig, e); }); });

    /* ---------- the pointer ---------- */
    function world(e) { var r = cv.getBoundingClientRect(); layout(); var px = e.clientX - r.left, py = e.clientY - r.top; return { u: (py - Gm.oy) / Gm.sc - HALF, v: HALF - (px - Gm.ox) / Gm.sc, px: px, py: py }; }   // the Sun's-frame map under the pointer
    function onMap(w) { return cellIndex(w.u + R0, w.v) >= 0 && !inInset(w.px, w.py); }
    function arm() { armed = true; armedAt = performance.now(); stage.classList.add('is-armed'); run.wake(); run.redraw(); }
    function disarm() { if (armed) { armed = false; stage.classList.remove('is-armed'); } }
    function syncSeg(m) { for (var b = 0; b < frameBtns.length; b++) frameBtns[b].setAttribute('aria-checked', frameBtns[b].getAttribute('data-frame') === (m ? 'gal' : 'sun') ? 'true' : 'false'); }
    function setFrame(m) {   // swap between the Sun's frame and the Galactic frame: the stars are the same, only the drawing differs
      frameMode = m; drag = null; disarm(); cv.style.touchAction = m ? 'pan-y' : ''; cv.style.cursor = m ? 'crosshair' : 'default'; showVp(-1); syncSeg(m);
      if (m) { gseen = true; if (galBtn) galBtn.classList.remove('is-nudge'); }
      if (RM) T.fb = m;   // no animation under reduced motion: swap at once
      run.wake(); run.redraw();
    }
    seg(fig, 'data-frame', function (v) { setFrame(v === 'gal' ? 1 : 0); });
    cv.addEventListener('pointerdown', function (e) {
      if (!D || e.button !== 0) return;
      var w = world(e), inside = onMap(w);
      if (frameMode === 1) {   // the Galactic frame: a press on the map means "flick", and flicks are made in the Sun's frame, so go back there
        if (w.px < Gm.ox || w.px > Gm.ox + Gm.side || w.py < Gm.oy || w.py > Gm.oy + Gm.side) return;   // the header band and the margins do nothing
        if (e.pointerType === 'touch') { galTap = { x: e.clientX, y: e.clientY, t: performance.now() }; return; }   // a touch may be a scroll: decide on release
        setFrame(0);
      }
      if (coarse && !armed) { if (inside) arm(); return; }
      if (!inside) { disarm(); return; }
      pressed = true; stars = stars.filter(function (st) { return !st.demo; });
      drag = [w.px, w.py, w.px, w.py, w.u, w.v]; kickShown = -1; try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } run.wake(); e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      var w = world(e), inside = onMap(w), R;
      if (frameMode === 1) {   // the Galactic frame: the pointer reads the circular speed at its distance from the Galactic centre, where the map measured it
        R = hyp(w.px - (Gm.ox + Gm.side / 2), w.py - (Gm.oy + Gm.side / 2)) / Gm.sg; showVp(R > R0 - 3.3 && R < R0 + 3.3 ? vcOf(R) : -1); return;
      }
      showVp(inside ? vcAt(w.u + R0, w.v) : -1);   // the pointer's own reading, set here so the frame loop never builds it
      cv.style.cursor = inside ? 'crosshair' : 'default'; if (drag) { drag[2] = w.px; drag[3] = w.py; } run.wake(); run.redraw();
    });
    function release() {
      if (!drag) return;
      var KICK = Gm.ks, vx = (drag[3] - drag[1]) * KICK, vy = -(drag[2] - drag[0]) * KICK;   // screen right = -y, screen down = +x
      launch(drag[4] + R0, drag[5], vx, vy, false); drag = null; if (armed) armedAt = performance.now();
      run.redraw();   // under reduced motion no frame follows, so draw the released star now
    }
    cv.addEventListener('pointerup', function (e) {
      if (galTap) {   // a tap in the Galactic frame on a touch screen: back to the Sun's frame, and ready to flick
        var gt = galTap; galTap = null;
        if (frameMode === 1 && Math.abs(e.clientX - gt.x) < 12 && Math.abs(e.clientY - gt.y) < 12 && performance.now() - gt.t < 700) { setFrame(0); if (coarse) arm(); }
        return;
      }
      release();
    });
    cv.addEventListener('pointercancel', function () { drag = null; galTap = null; });
    cv.addEventListener('pointerleave', function () { showVp(-1); run.wake(); run.redraw(); });
    if (clearBtn) clearBtn.addEventListener('click', function () {   // start over: the invitation (hint, ghost drag, red star) comes back
      stars = []; T.el = 0; flicked = false; pressed = false; drag = null; disarm(); ghostDone = false; T.demo = -99;
      if (D && run.visible()) startDemo();
      run.wake(); run.redraw();
    });
  }

  function init() { demoOrbit(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
