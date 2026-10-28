/* Fig. 4 The ruler printed on the sky. Needs demos.js loaded first; styles in demos-ruler.css.
   Split out of demos.js on 2026-10-28. Final round (2026-10-28), words and bugs only, the picture is the same:
   - plain names with one gloss each (oldest light, nearby stars, expansion rate, light-years next to the Mpc unit), the two
     measurements framed as a disagreement, and "paper's value" instead of "(full fit)" with a bracket that says why the red
     triangle (ruler alone) stops short of the paper's full fit;
   - the red arc has a visible grab handle and follows the pointer one to one (its drawn pull-in is exaggerated 4x, like the
     angle already was); the red triangle is a real handle too, so a rightward drag on the number line can never lower H0;
   - number-line labels on separate rows (others' measurements above the axis, the paper's results below), words in sans,
     numbers in mono, 12 to 13 px in the text colours; the dashed/thin legend is gone (the dashed arc is labelled directly).
   Code layout: physics, layout (lay), drawing (draw), input. */
(function () {
  'use strict';
  var E = window.EPDemos; if (!E) return;
  var C = E.C, RM = E.RM, onTheme = E.onTheme, rgba = E.rgba, smooth = E.smooth, makeCanvas = E.makeCanvas, loop = E.loop, setOut = E.setOut;
  var TAU = Math.PI * 2, MLY = 3.26156;   // million light-years per Mpc

  function demoRuler() {
    var fig = document.getElementById('demo-ruler'); if (!fig) return;
    var cv = fig.querySelector('canvas'), S = makeCanvas(cv), g = S.ctx;
    var range = fig.querySelector('[data-ctl="dn"]'), oDN = fig.querySelector('[data-out="dn"]'), paperBtn = fig.querySelector('[data-ctl="paper"]');
    var c = 299792.458, og = 2.4728e-5, wb = 0.02237, wc = 0.1200, ZS = 1089.9, NEFF = 3.044;
    var H0_PLANCK = 67.4, H0_SHOES = 73.0, H0_PAPER = 71.6, DN_PAPER = 0.54;
    var LO = 64, HI = 75;          // the number line, km/s/Mpc
    var KPULL = 4;                 // the pull-in is drawn 4x larger than true scale, so the arc can stay under the pointer

    /* ---------- physics (unchanged): flat universe, sound horizon rs, distance DM to the oldest light, fixed angle ---------- */
    function integ(f, a, b, n) {   // trapezoid in u = ln(1+z)
      var u0 = Math.log(1 + a), du = (Math.log(1 + b) - u0) / n, s = 0;
      for (var i = 0; i <= n; i++) { var z = Math.exp(u0 + i * du) - 1, v = f(z) * (1 + z); s += (i === 0 || i === n) ? v / 2 : v; }
      return s * du;
    }
    function model(dN) {   // flat; omega_b fixed; omega_m scaled so matter-radiation equality stays put
      var orad = og * (1 + 0.2271 * (NEFF + dN)), wm = (wb + wc) * orad / (og * (1 + 0.2271 * NEFF));
      function Hz(z, h) { var a = 1 + z; return 100 * Math.sqrt(orad * a * a * a * a + wm * a * a * a + (h * h - wm - orad)); }
      function cs(z) { return c / Math.sqrt(3 * (1 + 3 * wb / (4 * og * (1 + z)))); }
      var rs = integ(function (z) { return cs(z) / Hz(z, 0.67); }, ZS, 3e7, 600);
      return { rs: rs, DM: function (h) { return integ(function (z) { return c / Hz(z, h); }, 0, ZS, 600); } };
    }
    var base = model(0), THETA = base.rs / base.DM(H0_PLANCK / 100);   // the fixed angle (radians), calibrated to Planck's H0
    function solve(dN) {
      var m = model(dN), lo = 0.55, hi = 0.85;
      for (var i = 0; i < 30; i++) { var mid = (lo + hi) / 2; if (m.rs / m.DM(mid) > THETA) hi = mid; else lo = mid; }
      var h = (lo + hi) / 2; return { rs: m.rs, h0: 100 * h, DM: m.DM(h) };
    }
    // dragging asks the opposite question (which dN puts the arc, or the triangle, under the pointer?): a quadratic through
    // dN = 0, 0.5, 1 is within 0.05% of the exact curves, and bisection inverts it
    function quad(y0, y1, y2) { var a = 2 * y0 - 4 * y1 + 2 * y2, b = -3 * y0 + 4 * y1 - y2; return function (x) { return y0 + b * x + a * x * x; }; }
    function invert(f, y, increasing) { var lo = 0, hi = 1; for (var i = 0; i < 24; i++) { var m = (lo + hi) / 2, up = increasing ? f(m) < y : f(m) > y; if (up) lo = m; else hi = m; } return (lo + hi) / 2; }
    var ref = solve(0), mid = solve(0.5), end = solve(1), qDM = quad(ref.DM, mid.DM, end.DM), qH0 = quad(ref.h0, mid.h0, end.h0), qRS = quad(ref.rs, mid.rs, end.rs);
    var paperH0 = solve(DN_PAPER).h0;

    var dn = +range.value, cur = solve(dn), shown = { rs: cur.rs, h0: cur.h0, DM: cur.DM };
    var intro = null, glide = null, run = null, started = false, touched = false, dragged = false, hint = 1, pulseT = -1, drag = null, hover = '', Lc = null, lcKey = '';

    function tag(v) { return v.toFixed(2) + (Math.abs(v - DN_PAPER) < 0.005 ? ' (paper’s value)' : ''); }
    // fast: while something is moving (the arrival sweep, a glide, a drag) the three numbers come from the quadratic fits, which are
    // within 0.05% of the exact curves and cost nothing; everything at rest is exact
    function setDN(v, silent, snap, fast) {
      v = Math.max(0, Math.min(1, v)); dn = v; range.value = v.toFixed(2);
      if (fast) { cur.rs = qRS(v); cur.h0 = qH0(v); cur.DM = qDM(v); } else { var ex0 = solve(v); cur.rs = ex0.rs; cur.h0 = ex0.h0; cur.DM = ex0.DM; }
      setOut(oDN, tag(v));
      if (paperBtn) { var on = Math.abs(v - DN_PAPER) < 0.005; paperBtn.classList.toggle('is-on', on); paperBtn.setAttribute('aria-pressed', on ? 'true' : 'false'); }
      if (snap || (run && (run.still || !run.visible()))) { shown.rs = cur.rs; shown.h0 = cur.h0; shown.DM = cur.DM; }
      if (run && !silent) refresh();
    }
    function refresh() { run.wake(); if (run.still) run.redraw(); }   // the loop draws on its next frame; a reduced-motion figure has no loop, so it draws by hand

    /* ---------- text: words in sans, `numbers` in mono. Each string is split and measured once (a few hundred distinct strings at most) ---------- */
    var tcache = Object.create(null), tcount = 0;
    function parsed(s, size, wt) {
      var key = wt + size + '|' + s, e = tcache[key];
      if (e) return e;
      if (tcount > 800) { tcache = Object.create(null); tcount = 0; }
      var parts = s.split('`'), ws = [], w = 0, fSans = wt + size + 'px ' + C.sans, fMono = wt + size + 'px ' + C.mono;
      for (var i = 0; i < parts.length; i++) { g.font = i % 2 ? fMono : fSans; ws[i] = g.measureText(parts[i]).width; w += ws[i]; }
      tcount++; return (tcache[key] = { parts: parts, ws: ws, w: w, fSans: fSans, fMono: fMono });
    }
    function rich(s, x, y, o) {
      o = o || {}; var size = o.size || 12, e = parsed(s, size, o.bold ? '600 ' : ''), w = e.w, parts = e.parts, i;
      var x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
      if (o.back) { g.fillStyle = rgba(o.backColor || C.surface, 0.9); g.fillRect(x0 - 3, y - size + 1, w + 6, size + 4); }
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = o.color || C.text2;
      var cx = x0; for (i = 0; i < parts.length; i++) { if (parts[i]) { g.font = i % 2 ? e.fMono : e.fSans; g.fillText(parts[i], cx, y); } cx += e.ws[i]; }
      return w;
    }
    function richW(s, size) { return parsed(s, size, '').w; }
    function firstFit(list, size, room) { for (var i = 0; i < list.length; i++) if (richW(list[i], size) <= room) return i; return list.length - 1; }   // index of the first wording that fits
    function pick(list, size, room) { return list[firstFit(list, size, room)]; }
    function lyText(mpc) {   // a distance in Mpc as everyday words
      var m = mpc * MLY;
      return m < 1000 ? '`' + (m < 10 ? m.toFixed(1) : Math.round(m)) + '` million light-years' : '`' + (m / 1000).toFixed(1) + '` billion light-years';
    }

    /* ---------- layout: everything is measured once per size, as offsets from the number line's axis ---------- */
    function lay(W, Hh) {
      var key = W + 'x' + Hh; if (Lc && lcKey === key) return Lc;
      var narrow = W < 520, fs = W >= 700 ? 13 : 12, lh = fs + 3, pad = narrow ? 12 : 14, L = { W: W, H: Hh, narrow: narrow, fs: fs, lh: lh, pad: pad };
      L.nlx = pad + 14; L.nlw = W - 2 * pad - 28;
      L.xo = function (v) { return L.nlx + (v - LO) / (HI - LO) * L.nlw; };
      // offsets from the axis (negative is up)
      L.yv = -19; L.yn = L.yv - lh; L.roofY = L.yn - Math.round(0.72 * fs) - 11; L.topOff = L.roofY - Math.round(fs / 2) - 5;
      L.y1 = 19 + fs; L.y2 = L.y1 + lh; L.y3 = L.y2 + lh; L.yk = L.y3 + lh + 3; L.yt1 = L.yk + lh + 3; L.yt2 = L.yt1 + lh;
      var titleA = 'expansion rate today, H₀, in km/s per Mpc (1 Mpc = 3.3 million light-years)';
      L.oneTitle = richW(titleA, fs) <= W - 2 * pad;
      L.ya = Hh - pad - 3 - (L.oneTitle ? L.yt1 : L.yt2);
      L.lowTop = L.ya + L.topOff;
      // the geometry panel: us, the oldest light, the ruler
      var T = L.T = { x: pad, y: pad, w: W - 2 * pad, h: Math.max(120, L.lowTop - 12 - pad) };
      L.ex = T.x + (narrow ? 20 : 26); L.ey = T.y + T.h / 2;
      var w1 = richW('no extra radiation', fs);
      L.ghost2 = (T.w - (L.ex - T.x)) - (w1 + 28) < 0.66 * T.w;   // on a phone the ghost's label takes two lines
      var need = (L.ghost2 ? Math.max(richW('no extra', fs), richW('radiation', fs)) : w1) + 24;
      L.Rref = T.x + T.w - need - L.ex; L.scale = L.Rref / ref.DM;
      L.ANG = Math.max(0.05, Math.min(0.3, Math.asin(Math.min(1, Math.max(0.05, (T.h / 2 - 2 * lh - 12)) / L.Rref))));
      L.EXT = Math.asin(Math.min(1, (T.h / 2 - 2) / L.Rref));
      L.EXAG = Math.round(2 * L.ANG / THETA);
      // the pull-in label sits by the dimension line when it fits inside the wedge at the nearest the ruler can get, else it joins the ruler's label
      var Rmin = L.Rmin = L.Rref - KPULL * (ref.DM - end.DM) * L.scale;
      L.pullInside = (Rmin - 16 - richW(lyText(ref.DM - end.DM) + ' closer', fs)) * Math.tan(L.ANG) >= fs + 12;
      // each label has a longer and a shorter wording; the choice is made here, for the nearest the ruler can get, so no label changes wording while the slider moves
      var dyMin = Rmin * Math.sin(L.ANG) + 21 + (L.pullInside ? 0 : lh) + 3, roomMin = (L.ex - T.x) + Math.min(Rmin * Math.cos(L.ANG), Math.sqrt(Math.max(0, Rmin * Rmin - dyMin * dyMin))) - 8 - 3;
      L.kRuler = firstFit(['ruler `6.1%` shorter (drawn `4×`)', 'ruler `6.1%` shorter', 'ruler'], fs, roomMin);
      L.kPull = firstFit([lyText(ref.DM - end.DM) + ' closer', lyText(ref.DM - end.DM)], fs, roomMin);
      L.kAngle = firstFit(['same angle (drawn `' + L.EXAG + '×` wider)', 'same angle (`' + L.EXAG + '×` wider)', 'same angle'], fs, Rmin - 34);
      L.kCmb = firstFit(['the oldest light (CMB)', 'oldest light (CMB)'], fs, (L.ex - T.x) + Rmin * Math.cos(L.EXT) - 16);
      Lc = L; lcKey = key; return L;
    }
    function arcR(L) { return L.Rref - KPULL * (ref.DM - shown.DM) * L.scale; }   // drawn radius of the ruler's surface

    /* ---------- motion ---------- */
    function step(dt) {
      if (intro) { intro.t += dt / 2.0; var t = intro.t; setDN(t < 0.5 ? smooth(t / 0.5) : 1 - (1 - DN_PAPER) * smooth((t - 0.5) / 0.5), true, false, true); if (t >= 1) { intro = null; setDN(DN_PAPER, true); pulseT = 0; } }
      if (glide) { glide.t += dt / 0.55; setDN(glide.a + (glide.b - glide.a) * smooth(glide.t), true, false, true); if (glide.t >= 1) { setDN(glide.b, true); glide = null; } }
      if (pulseT >= 0) { pulseT += dt / 1.3; if (pulseT >= 1) pulseT = -1; }
      if (dragged && hint > 0) hint -= dt / 0.5;
      var f = drag ? 1 : 1 - Math.exp(-dt / 0.08);
      shown.rs += (cur.rs - shown.rs) * f; shown.h0 += (cur.h0 - shown.h0) * f; shown.DM += (cur.DM - shown.DM) * f;
    }

    function box(xo, v, s, y0, y1, col, fa, la, ext0, ext1) {   // a measurement: a translucent box of +-1 sigma with an outline and a centre line
      var x0 = Math.round(xo(v - s)), x1 = Math.round(xo(v + s));
      g.fillStyle = rgba(col, fa); g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = rgba(col, la); g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
      g.strokeStyle = col; g.beginPath(); g.moveTo(Math.round(xo(v)) + 0.5, ext0); g.lineTo(Math.round(xo(v)) + 0.5, ext1); g.stroke();
    }

    /* ---------- drawing ---------- */
    function draw() {
      var W = S.W, Hh = S.H; if (!W) return;
      var L = lay(W, Hh), fs = L.fs, lh = L.lh, ya = L.ya, xo = L.xo;
      var moving = !!intro || !!glide || pulseT >= 0 || (dragged && hint > 0) || Math.abs(cur.h0 - shown.h0) > 0.003;
      if (!intro && !glide && Math.abs(cur.h0 - shown.h0) <= 0.003) { shown.rs = cur.rs; shown.h0 = cur.h0; shown.DM = cur.DM; }
      var cA = C.accent, t2 = C.text2, tx = C.text, bk = C.surface;
      g.fillStyle = bk; g.fillRect(0, 0, W, Hh);

      /* ===== the geometry: us, the oldest light, the ruler printed on it ===== */
      var T = L.T, ex = L.ex, ey = L.ey, Rref = L.Rref, ANG = L.ANG, EXT = L.EXT, R = arcR(L), xArc = ex + R, xRef = ex + Rref, Rmin2 = L.Rmin;
      var pulled = ref.DM - shown.DM, caA = Math.cos(ANG), saA = Math.sin(ANG);
      g.save(); g.beginPath(); g.rect(T.x, T.y, T.w, T.h); g.clip();
      if (Rref - R > 0.5) { g.beginPath(); g.arc(ex, ey, Rref, -ANG, ANG); g.arc(ex, ey, R, ANG, -ANG, true); g.closePath(); g.fillStyle = rgba(cA, 0.1); g.fill(); }   // the pull-in, tinted
      g.lineWidth = 1; g.strokeStyle = rgba(t2, 0.55); g.setLineDash([4, 4]); g.beginPath(); g.arc(ex, ey, Rref, -EXT, EXT); g.stroke(); g.setLineDash([]);   // the oldest light with no extra radiation
      g.lineWidth = 1.5; g.strokeStyle = rgba(t2, 0.85); g.beginPath(); g.arc(ex, ey, R, -EXT, EXT); g.stroke(); g.lineWidth = 1;                          // the oldest light itself
      g.strokeStyle = rgba(t2, 0.4); g.setLineDash([2, 4]); g.beginPath(); g.moveTo(ex, ey + 0.5); g.lineTo(xArc, ey + 0.5); g.stroke(); g.setLineDash([]);   // the line of sight to it
      g.strokeStyle = rgba(cA, 0.55); g.beginPath();                                                                                                       // the fixed angle
      g.moveTo(ex, ey); g.lineTo(ex + R * caA, ey - R * saA); g.moveTo(ex, ey); g.lineTo(ex + R * caA, ey + R * saA); g.stroke();
      g.strokeStyle = rgba(cA, 0.5); g.lineWidth = 3; g.setLineDash([6, 5]); g.beginPath(); g.arc(ex, ey, Rref, -ANG, ANG); g.stroke(); g.setLineDash([]); g.lineWidth = 1;   // the ghost ruler (no extra radiation)
      [-1, 1].forEach(function (sg) { var cs = Math.cos(sg * ANG), sn = Math.sin(sg * ANG); g.strokeStyle = rgba(cA, 0.5); g.setLineDash([3, 3]); g.beginPath(); g.moveTo(ex + (Rref - 6) * cs, ey + (Rref - 6) * sn); g.lineTo(ex + (Rref + 6) * cs, ey + (Rref + 6) * sn); g.stroke(); g.setLineDash([]); });
      g.strokeStyle = cA; g.lineWidth = 5; g.beginPath(); g.arc(ex, ey, R, -ANG, ANG); g.stroke(); g.lineWidth = 1;                                          // the ruler, with end caps
      [-1, 1].forEach(function (sg) { var cs = Math.cos(sg * ANG), sn = Math.sin(sg * ANG); g.strokeStyle = cA; g.lineWidth = 2; g.beginPath(); g.moveTo(ex + (R - 7) * cs, ey + (R - 7) * sn); g.lineTo(ex + (R + 7) * cs, ey + (R + 7) * sn); g.stroke(); g.lineWidth = 1; });
      if (xRef - xArc >= 14) {   // dimension line between the ruler and its ghost
        g.strokeStyle = cA; g.beginPath(); g.moveTo(xArc, ey + 0.5); g.lineTo(xRef, ey + 0.5); g.moveTo(xRef, ey - 5); g.lineTo(xRef, ey + 5); g.stroke();
      }
      g.fillStyle = tx; g.beginPath(); g.arc(ex, ey, 4, 0, TAU); g.fill();
      rich('us', ex - 4, ey + 21, { color: t2, size: fs, back: true });
      // direct labels: the ruler's own label hangs below its lower end, clear of the oldest-light arc that curves back there;
      // each has a shorter wording for narrow figures. The pull-in label sits by the dimension line when the wedge is wide enough, else under the ruler's
      var endX = ex + R * caA, endY = ey + R * saA, shorter = (ref.rs - shown.rs) / ref.rs * 100, withPull = !L.pullInside && pulled > 0.5;
      var lowY = endY + 21 + (withPull ? lh : 0) + 3, blockR = Math.min(endX - 8, ex + Math.sqrt(Math.max(0, R * R - (lowY - ey) * (lowY - ey))) - 8), by = endY + 21, room = blockR - (T.x + 3);
      var sh = '`' + shorter.toFixed(1) + '%` shorter';
      var rl = shorter > 0.05 ? ['ruler ' + sh + ' (drawn `4×`)', 'ruler ' + sh, 'ruler'][L.kRuler] : 'ruler';
      rich(rl, Math.max(blockR, T.x + 4 + richW(rl, fs)), by, { color: cA, size: fs, align: 'right', back: true });   // never clipped at the left, even on the narrowest figure
      if (pulled > 0.5) {
        var pl = [lyText(pulled) + ' closer', lyText(pulled)][L.kPull];
        if (L.pullInside) rich(pl, xArc - 16, ey - 9, { color: cA, size: fs, align: 'right', back: true });
        else rich(pl, Math.max(blockR, T.x + 4 + richW(pl, fs)), by + lh, { color: cA, size: fs, align: 'right', back: true });
      }
      var gl = rgba(cA, 0.9);
      if (L.ghost2) { rich('no extra', xRef + 16, ey - 1, { color: gl, size: fs }); rich('radiation', xRef + 16, ey - 1 + lh, { color: gl, size: fs }); }
      else rich('no extra radiation', xRef + 16, ey + 4, { color: gl, size: fs });
      // the angle, written along the upper line of sight so nothing crosses it
      var al = ['same angle (drawn `' + L.EXAG + '×` wider)', 'same angle (`' + L.EXAG + '×` wider)', 'same angle'][L.kAngle];
      g.save(); g.translate(ex + 30 * caA, ey - 30 * saA); g.rotate(-ANG); rich(al, 0, -7, { color: t2, size: fs }); g.restore();
      var cmb = ['the oldest light (CMB)', 'oldest light (CMB)'][L.kCmb];
      if (richW(cmb, fs) <= (ex - T.x) + Rmin2 * Math.cos(EXT) - 16) rich(cmb, ex + R * Math.cos(EXT) - 8, T.y + fs + 5, { color: t2, size: fs, align: 'right', back: true });
      // the handle on the ruler
      var hov = hover === 'arc' || (drag && drag.kind === 'arc'), hr = hov ? 13 : 11;
      if (pulseT >= 0 && !RM) { var pe = 1 - Math.pow(1 - pulseT, 2); g.strokeStyle = rgba(cA, 0.6 * (1 - pulseT)); g.lineWidth = 2; g.beginPath(); g.arc(xArc, ey, 12 + 18 * pe, 0, TAU); g.stroke(); g.lineWidth = 1; }
      g.fillStyle = bk; g.beginPath(); g.arc(xArc, ey, hr + 2, 0, TAU); g.fill();
      g.fillStyle = cA; g.beginPath(); g.arc(xArc, ey, hr, 0, TAU); g.fill();
      g.fillStyle = bk;
      g.beginPath(); g.moveTo(xArc - 7.5, ey); g.lineTo(xArc - 2.5, ey - 4); g.lineTo(xArc - 2.5, ey + 4); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(xArc + 7.5, ey); g.lineTo(xArc + 2.5, ey - 4); g.lineTo(xArc + 2.5, ey + 4); g.closePath(); g.fill();
      if (hint > 0) rich('drag', xArc - 18, ey + 18, { color: rgba(cA, Math.min(1, hint)), size: fs, align: 'right', back: true, bold: true });
      g.restore();

      /* ===== the number line: others' measurements above the axis, the paper's results below ===== */
      g.lineWidth = 1; g.strokeStyle = C.borderStrong; g.beginPath(); g.moveTo(L.nlx, ya + 0.5); g.lineTo(L.nlx + L.nlw, ya + 0.5); g.stroke();
      for (var t = LO; t <= HI; t++) { var tx0 = Math.round(xo(t)) + 0.5; g.beginPath(); g.moveTo(tx0, ya - 3); g.lineTo(tx0, ya + 3); g.stroke(); }
      for (t = LO; t <= HI; t += 2) rich('`' + t + '`', xo(t), ya + L.yk, { color: t2, size: fs, align: 'center' });
      // grey: Planck (the oldest light) and SH0ES (nearby stars), with the disagreement between them
      var xp = xo(H0_PLANCK), xs = xo(H0_SHOES);
      box(xo, H0_PLANCK, 0.5, ya - 13, ya - 1, t2, C.dark ? 0.28 : 0.2, 0.75, ya - 15, ya + 3);
      box(xo, H0_SHOES, 1.0, ya - 13, ya - 1, t2, C.dark ? 0.28 : 0.2, 0.75, ya - 15, ya + 3);
      var nameP = pick(['oldest light (Planck)', 'Planck'], fs, xs - xp - 6), nameS = pick(['nearby stars (SH`0`ES)', 'SH`0`ES'], fs, 2 * (W - L.pad - xs));
      var cxP = Math.max(L.pad + richW(nameP, fs) / 2, xp), cxS = Math.min(W - L.pad - richW(nameS, fs) / 2, xs);
      rich(nameP, cxP, ya + L.yn, { color: t2, size: fs, align: 'center' }); rich('`67.4 ± 0.5`', cxP, ya + L.yv, { color: tx, size: fs, align: 'center' });
      rich(nameS, cxS, ya + L.yn, { color: t2, size: fs, align: 'center' }); rich('`73.0 ± 1.0`', cxS, ya + L.yv, { color: tx, size: fs, align: 'center' });
      var ry = ya + L.roofY, rt = pick(['the disagreement', 'disagree'], fs, xs - xp - 20);
      g.strokeStyle = t2; g.beginPath(); g.moveTo(Math.round(xp) + 0.5, ry + 8); g.lineTo(Math.round(xp) + 0.5, ry + 0.5); g.lineTo(Math.round(xs) + 0.5, ry + 0.5); g.lineTo(Math.round(xs) + 0.5, ry + 8); g.stroke();
      rich(rt, (xp + xs) / 2, ry + Math.round(fs * 0.35), { color: tx, size: fs, align: 'center', back: true });
      // red: the paper's full fit (fixed) and the ruler alone (moves)
      var fitL = xo(H0_PAPER + 0.6) + 8, fitName = pick(['paper’s full fit', 'paper’s fit'], fs, W - L.pad - fitL);
      box(xo, H0_PAPER, 0.6, ya + 1, ya + 13, cA, 0.16, 0.75, ya - 3, ya + 15);
      rich(fitName, fitL, ya + L.y1, { color: cA, size: fs }); rich('`71.6 ± 0.6`', fitL, ya + L.y2, { color: cA, size: fs });
      var mx = xo(shown.h0), tri = hover === 'tri' || (drag && drag.kind === 'tri');
      var annA = intro ? 0 : Math.max(0, 1 - Math.abs(shown.h0 - paperH0) / 0.12);
      if (annA > 0.02) {   // at the paper's setting: why the ruler alone stops short of the paper's full fit
        var ax0 = mx + 12, ax1 = xo(H0_PAPER - 0.6) - 5, amid = (ax0 + ax1) / 2;
        g.save(); g.globalAlpha = annA; g.strokeStyle = cA; g.setLineDash([3, 3]);
        if (ax1 - ax0 > 10) { g.beginPath(); g.moveTo(ax0, ya + 8.5); g.lineTo(ax1 - 1, ya + 8.5); g.stroke(); g.setLineDash([]); g.fillStyle = cA; g.beginPath(); g.moveTo(ax1 + 3, ya + 8.5); g.lineTo(ax1 - 4, ya + 5); g.lineTo(ax1 - 4, ya + 12); g.closePath(); g.fill(); }
        g.setLineDash([]); g.globalAlpha = annA * 0.55; g.beginPath(); g.moveTo(Math.round(amid) + 0.5, ya + 14); g.lineTo(Math.round(amid) + 0.5, ya + L.y3 - fs); g.stroke(); g.globalAlpha = annA;
        var at = 'other parameters add the rest', aw = richW(at, fs); rich(at, Math.max(L.pad + aw, Math.min(W - L.pad, amid + aw / 2)), ya + L.y3, { color: cA, size: fs, align: 'right', back: true });
        g.restore();
      }
      var lblR = Math.min(mx + 8, fitL - 20);
      rich('ruler alone `' + shown.h0.toFixed(1) + '`', lblR, ya + L.y1, { color: cA, size: fs, align: 'right', back: true });
      var th = tri ? 1.18 : 1;   // the triangle is a handle: it grows a little under the pointer
      g.fillStyle = bk; g.beginPath(); g.moveTo(mx, ya + 2 - 1.5); g.lineTo(mx - 9.5 * th, ya + 17 * th); g.lineTo(mx + 9.5 * th, ya + 17 * th); g.closePath(); g.fill();
      g.fillStyle = cA; g.beginPath(); g.moveTo(mx, ya + 2); g.lineTo(mx - 8 * th, ya + 15 * th); g.lineTo(mx + 8 * th, ya + 15 * th); g.closePath(); g.fill();
      // the axis title: the expansion rate, with its unit in everyday words
      if (L.oneTitle) rich('expansion rate today, H₀, in km/s per Mpc (1 Mpc = `3.3` million light-years)', W / 2, ya + L.yt1, { color: t2, size: fs, align: 'center' });
      else { rich('expansion rate today, H₀', W / 2, ya + L.yt1, { color: t2, size: fs, align: 'center' }); rich('in km/s per Mpc (1 Mpc = `3.3` million light-years)', W / 2, ya + L.yt2, { color: t2, size: fs, align: 'center' }); }
      return moving ? undefined : false;
    }

    /* ---------- input ---------- */
    function startIntro() { if (RM || touched || intro || started) return; started = true; intro = { t: 0 }; setDN(0, true, true); if (run) run.wake(); }
    function toPaper() { intro = null; touched = true; if (RM || (run && !run.visible())) { setDN(DN_PAPER, false, true); return; } glide = { a: dn, b: DN_PAPER, t: 0 }; if (run) run.wake(); }
    run = loop(cv, step, draw, 'IntersectionObserver' in window ? null : startIntro);
    S.onresize = function () { run.wake(); run.redraw(); }; onTheme.push(run.redraw);
    if (!RM && 'IntersectionObserver' in window) {   // the arrival sweep starts when most of the figure is on screen, once
      var io = new IntersectionObserver(function (es) { if (es[es.length - 1].isIntersecting) { io.disconnect(); startIntro(); } }, { threshold: 0.55 });
      io.observe(cv);
    }
    range.addEventListener('input', function () { intro = null; glide = null; touched = true; setDN(+range.value); });
    if (paperBtn) paperBtn.addEventListener('click', toPaper);
    E.more(fig, function () { if (run) refresh(); });

    function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    function whatsAt(p, e) {   // which handle the pointer is over
      var L = lay(S.W, S.H), hit = e.pointerType === 'touch' ? 28 : 18, mx = L.xo(shown.h0), xa = L.ex + arcR(L);
      if (p.y >= L.ya - 4 && p.y <= L.ya + 28 && Math.abs(p.x - mx) <= hit) return 'tri';
      if (p.y < L.lowTop) { if (Math.hypot(p.x - xa, p.y - L.ey) <= hit) return 'arc'; var d = Math.hypot(p.x - L.ex, p.y - L.ey), an = Math.atan2(p.y - L.ey, p.x - L.ex); if (Math.abs(d - arcR(L)) <= 10 && Math.abs(an) <= L.ANG + 0.06) return 'arc'; }
      return '';
    }
    function setCursor(v) { if (cv.style.cursor !== v) cv.style.cursor = v; }
    cv.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || drag) return;   // one pointer at a time
      var L = lay(S.W, S.H), p = pos(e);
      drag = p.y >= L.lowTop - 6 ? { kind: 'tri', off: p.x - L.xo(shown.h0), x0: p.x, id: e.pointerId } : { kind: 'arc', off: p.x - (L.ex + arcR(L)), x0: p.x, id: e.pointerId };   // a press anywhere drags the nearer picture: relative, so nothing jumps
      intro = null; glide = null; touched = true; hover = drag.kind;
      cv.setPointerCapture(e.pointerId); setCursor('grabbing'); refresh(); e.preventDefault();
    });
    cv.addEventListener('pointermove', function (e) {
      var p = pos(e), L = lay(S.W, S.H);
      if (drag) {
        if (e.pointerId !== drag.id) return;
        if (!dragged && Math.abs(p.x - drag.x0) > 3) { dragged = true; if (RM) hint = 0; }   // with reduced motion nothing fades: the hint just goes
        var v;
        if (drag.kind === 'arc') v = invert(qDM, ref.DM - (L.Rref - (p.x - drag.off - L.ex)) / (KPULL * L.scale), false);   // the arc follows the pointer one to one
        else v = invert(qH0, LO + (p.x - drag.off - L.nlx) / L.nlw * (HI - LO), true);                                       // right on the number line is a larger H0, never smaller
        if (Math.abs(v - DN_PAPER) < 0.012) v = DN_PAPER;   // a little magnet at the paper's value
        setDN(v, false, true, true); return;
      }
      if (e.pointerType === 'touch') return;
      var h = whatsAt(p, e); if (h !== hover) { hover = h; setCursor(h ? 'grab' : ''); refresh(); }
    });
    function release(e) { if (!drag || (e && e.pointerId !== drag.id)) return; drag = null; hover = ''; setCursor(''); setDN(dn, false, true); }   // the exact numbers once the pointer lets go
    cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
    cv.addEventListener('pointerleave', function () { if (!drag && hover) { hover = ''; setCursor(''); refresh(); } });
    setDN(dn, true, true);
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', function () { tcache = Object.create(null); tcount = 0; Lc = null; run.redraw(); });   // a late font changes every width
  }

  function init() { demoRuler(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(init); else init();
})();
