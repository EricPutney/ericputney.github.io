/* Interactive figures for eputney.io (prototype).
   Plain JavaScript, no dependencies, canvas 2D. Each figure runs only while it is on screen and the
   tab is visible, at a fixed 60 Hz physics step. With prefers-reduced-motion the figures render a
   still frame that the controls update. Colors come from the site's CSS variables. */
(function () {
  'use strict';

  var RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DARK = matchMedia('(prefers-color-scheme: dark)');
  var TAU = Math.PI * 2;

  /* ---------- theme ---------- */
  var C = {};
  function readTheme() {
    var s = getComputedStyle(document.documentElement);
    var v = function (n) { return s.getPropertyValue(n).trim(); };
    C.text = v('--text'); C.text2 = v('--text-2'); C.text3 = v('--text-3');
    C.accent = v('--accent'); C.accentSoft = v('--accent-soft');
    C.border = v('--border'); C.borderStrong = v('--border-strong');
    C.surface = v('--surface'); C.surface2 = v('--surface-2'); C.bg = v('--bg');
    C.sans = v('--font-sans') || 'sans-serif'; C.mono = v('--font-mono') || 'monospace';
    C.dark = DARK.matches;
  }
  readTheme();
  var onTheme = [];
  DARK.addEventListener('change', function () { readTheme(); onTheme.forEach(function (f) { f(); }); });

  function hexRGB(hex) { var n = parseInt(hex.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgba(hex, a) { var c = hexRGB(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function gauss() { var u = 0; while (u === 0) u = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * Math.random()); }
  function smooth(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }

  /* ---------- canvas + loop ---------- */
  function makeCanvas(canvas) {
    var ctx = canvas.getContext('2d');
    var S = { ctx: ctx, W: 0, H: 0, dpr: 1, onresize: null };
    function fit() {
      var r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var W = Math.round(r.width), H = Math.round(r.height);
      if (W === S.W && H === S.H && dpr === S.dpr) return false;
      S.W = W; S.H = H; S.dpr = dpr;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    }
    fit();
    if ('ResizeObserver' in window) new ResizeObserver(function () { if (fit() && S.onresize) S.onresize(); }).observe(canvas);
    return S;
  }

  // Fixed-step loop gated on visibility. step(dt) runs at 60 Hz, draw() once per frame.
  // draw() may return false to say "nothing is moving"; the loop then sleeps until wake().
  // onFirstVisible fires once, the first time the canvas enters the viewport (also under reduced motion,
  // where no frames ever run and the figures draw still frames on demand).
  function loop(canvas, step, draw, onFirstVisible, opts) {
    opts = opts || {};
    var DT = 1 / 60, raf = 0, last = 0, acc = 0, onscreen = false, idle = false, seen = false, fc = 0;
    var REST = (opts.restAfter == null ? 45 : opts.restAfter) * 1000, EVERY = opts.drawEvery || 1;   // rest after 45 s untouched; optional half-rate drawing while untouched
    var lastActive = performance.now(), lastInput = -1e9;
    function frame(ts) {
      if (!onscreen || document.hidden || idle) { raf = 0; last = 0; return; }
      if (REST > 0 && ts - lastActive > REST) { idle = true; raf = 0; last = 0; return; }   // resting: a pointer, a control or scrolling back wakes it
      var d = last ? Math.min(0.05, (ts - last) / 1000) : DT;
      last = ts; acc += d;
      var n = 0;
      while (acc >= DT && n < 4) { step(DT); acc -= DT; n++; }
      if (n === 4) acc = 0;
      fc++;
      if (EVERY > 1 && (fc % EVERY) && ts - lastInput > 1000) { raf = requestAnimationFrame(frame); return; }
      if (draw() === false && n > 0) idle = true;   // rest only on a frame that ran a step: on 120 Hz screens half the frames run none, and a flag set in step() would be stale
      raf = requestAnimationFrame(frame);
    }
    function poke() { if (!RM && onscreen && !document.hidden && !idle && !raf) raf = requestAnimationFrame(frame); }
    function touch() { lastActive = lastInput = performance.now(); if (idle) idle = false; poke(); }
    var visCbs = [];
    var api = { still: RM, redraw: draw, wake: function () { lastActive = performance.now(); idle = false; poke(); }, visible: function () { return onscreen; },
                onVisible: function (fn) { visCbs.push(fn); if (onscreen) fn(); } };   // fires every time the canvas comes on screen
    draw();
    var host = (canvas.closest && canvas.closest('.demo')) || canvas;
    ['pointerenter', 'pointerdown', 'pointermove', 'touchstart'].forEach(function (t) { host.addEventListener(t, touch, { passive: true }); });
    ['input', 'click', 'change'].forEach(function (t) { host.addEventListener(t, touch, true); });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) {
      var was = onscreen; onscreen = es[es.length - 1].isIntersecting;
      if (onscreen && !seen) { seen = true; if (onFirstVisible) onFirstVisible(); }
      if (onscreen && !was) { lastActive = performance.now(); idle = false; visCbs.forEach(function (f) { f(); }); }
      poke();
    }).observe(canvas);
    else { onscreen = true; seen = true; if (onFirstVisible) onFirstVisible(); visCbs.forEach(function (f) { f(); }); poke(); }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) lastActive = performance.now(); poke(); });
    return api;
  }

  function label(g, text, x, y, o) {
    if (!text) return;
    o = o || {};
    var size = o.size || 11;
    g.font = size + 'px ' + (o.mono ? C.mono : C.sans);
    g.textAlign = o.align || 'left'; g.textBaseline = 'alphabetic';
    if (o.back) {   // a soft backing so text stays legible over data
      var w = g.measureText(text).width, x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
      g.fillStyle = rgba(o.backColor || C.bg, 0.82); g.fillRect(x0 - 3, y - size, w + 6, size + 4);
    }
    g.fillStyle = o.color || C.text2;   // readable by default; pass C.text3 explicitly for decorative ticks
    g.fillText(text, x, y);
  }
  function textW(g, text, o) { o = o || {}; g.font = (o.size || 11) + 'px ' + (o.mono ? C.mono : C.sans); return g.measureText(text).width; }
  // one path of small squares: far cheaper than an arc per particle
  function dots(g, xs, ys, n, size, color, mask, want) {   // mask: a typed array (draw where mask[k] === want, default 1) or a callback
    var h = size / 2, fn = typeof mask === 'function', w = want == null ? 1 : want;
    g.fillStyle = color; g.beginPath();
    for (var k = 0; k < n; k++) { if (mask && (fn ? !mask(k) : mask[k] !== w)) continue; g.rect(xs[k] - h, ys[k] - h, size, size); }
    g.fill();
  }
  function box(g, r) {
    g.fillStyle = C.bg; g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = C.border; g.lineWidth = 1; g.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  }
  function twoPanels(W, H, pad, gap, split) {   // side by side, or stacked when the stage is taller than wide
    if (H <= W) { var w = (W - 2 * pad - gap) / 2; return [{ x: pad, y: pad, w: w, h: H - 2 * pad }, { x: pad + w + gap, y: pad, w: w, h: H - 2 * pad }]; }
    var ha = (H - 2 * pad - gap) * (split || 0.5), hb = H - 2 * pad - gap - ha;
    return [{ x: pad, y: pad, w: W - 2 * pad, h: ha }, { x: pad, y: pad + ha + gap, w: W - 2 * pad, h: hb }];
  }
  function setOut(el, text) { if (el && el.textContent !== text) el.textContent = text; }

  /* =====================================================================
     Physical constants shared by the figures (Fig. 1 itself lives in demos-disk.js)
     ===================================================================== */
  var G = 4.30091e-6;        // kpc (km/s)^2 / Msun
  var R0 = 8.122;            // kpc, Solar radius as in ClearPotential
  var GEV = 2.6318e7;        // Msun/kpc^3 per GeV/cm^3
  var KPC_KMS = 977.8;       // Myr per (kpc / (km/s))

  // a "Details" disclosure: [data-ctl="more"] toggles .demo--more on the figure (demos.css hides .demo__adv until then);
  // cb(open) lets a canvas show or hide its secondary panels; returns a getter for the open state
  function more(fig, cb) {
    var b = fig.querySelector('[data-ctl="more"]'), open = false;
    if (!b) return function () { return false; };
    function set(v) { open = v; fig.classList.toggle('demo--more', v); b.setAttribute('aria-expanded', v ? 'true' : 'false'); b.textContent = v ? 'Fewer details' : 'Details'; if (cb) cb(v); }
    b.addEventListener('click', function () { set(!open); });
    set(false);
    return function () { return open; };
  }

  // shared with assets/js/demos-data.js (the data-backed figures)
  window.EPDemos = { C: C, RM: RM, onTheme: onTheme, rgba: rgba, hexRGB: hexRGB, gauss: gauss, smooth: smooth, makeCanvas: makeCanvas, loop: loop, label: label, textW: textW, dots: dots, box: box, twoPanels: twoPanels, setOut: setOut, KPC_KMS: KPC_KMS, G: G, R0: R0, more: more };
})();
