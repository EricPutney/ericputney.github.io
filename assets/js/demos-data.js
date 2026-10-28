/* Data-backed interactive figures for eputney.io (prototype).
   Uses the helpers exported by demos.js (window.EPDemos). Each figure fetches a small derived JSON
   from assets/data/ only when it is near the viewport; nothing here needs a model or a raw catalogue. */
(function () {
  'use strict';
  var E = window.EPDemos; if (!E) return;
  var C = E.C, RM = E.RM, rgba = E.rgba, hexRGB = E.hexRGB, gauss = E.gauss, smooth = E.smooth, makeCanvas = E.makeCanvas, loop = E.loop;
  var label = E.label, textW = E.textW, dots = E.dots, box = E.box, setOut = E.setOut, KPC_KMS = E.KPC_KMS, R0 = E.R0;
  var TAU = Math.PI * 2;

  function fetchJSON(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); }); }
  function whenNear(el, fn) {
    if (!('IntersectionObserver' in window)) { fn(); return; }
    var io = new IntersectionObserver(function (es) { if (es[es.length - 1].isIntersecting) { io.disconnect(); fn(); } }, { rootMargin: '700px 0px' });
    io.observe(el);
  }
  function note(fig, text) { var n = fig.querySelector('.demo__note'); if (n) n.textContent = text || ''; }
  function failed(fig, err) { note(fig, 'The data for this figure did not load (' + err.message + ').'); }
  function enable(fig, on) { fig.querySelectorAll('.demo__controls button, .demo__controls input').forEach(function (b) { b.disabled = !on; }); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function interp1(xs, ys, x) {   // linear interpolation on a sorted grid, null outside it
    var n = xs.length; if (x < xs[0] || x > xs[n - 1]) return null;
    var lo = 0, hi = n - 1; while (hi - lo > 1) { var m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    return lerp(ys[lo], ys[hi], (x - xs[lo]) / (xs[hi] - xs[lo] || 1));
  }
  function blue() { return C.dark ? '#6ea2e8' : '#3b6fb6'; }
  function midGrey() { return C.dark ? '#4a4f58' : '#cfd3d9'; }
  function diverge(t) {   // -1..1 -> blue..grey..accent, as [r,g,b]; grey is the midpoint, never the paper
    var a = hexRGB(C.accent), b = hexRGB(blue()), w = hexRGB(midGrey()), s = Math.min(1, Math.abs(t));
    var c = t < 0 ? b : a; return [lerp(w[0], c[0], s), lerp(w[1], c[1], s), lerp(w[2], c[2], s)];
  }
  function seg(fig, attr, cb) {   // segmented radio control
    var bs = fig.querySelectorAll('[' + attr + ']');
    bs.forEach(function (b) { b.addEventListener('click', function () {
      bs.forEach(function (o) { o.setAttribute('aria-checked', o === b ? 'true' : 'false'); }); cb(b.getAttribute(attr));
    }); });
  }
  function toggle(btn, cb) {
    btn.addEventListener('click', function () { var on = btn.getAttribute('aria-checked') !== 'true'; btn.setAttribute('aria-checked', on ? 'true' : 'false'); cb(on); });
  }
  // top-down view from the north Galactic pole: Galactic centre up, Galactic rotation (l = 90) to the left
  function topDown(side, ox, oy, HALF) {
    var sc = side / (2 * HALF);
    return { sc: sc, px: function (u, v) { return ox + (HALF - v) * sc; }, py: function (u, v) { return oy + (u + HALF) * sc; },
             u: function (py) { return (py - oy) / sc - HALF; }, v: function (px) { return HALF - (px - ox) / sc; } };
  }
  function dustRGB() { return C.dark ? [182, 160, 138] : [122, 102, 82]; }
  function clampX(g, x, text, o, lo, hi) {   // keep a label inside [lo, hi] horizontally
    var w = textW(g, text, o), x0 = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
    if (x0 < lo + 3) x += lo + 3 - x0; else if (x0 + w > hi - 3) x -= x0 + w - (hi - 3);
    return x;
  }

  window.EPDemosHelpers = { fetchJSON: fetchJSON, whenNear: whenNear, note: note, failed: failed, enable: enable, lerp: lerp, interp1: interp1, blue: blue, midGrey: midGrey, diverge: diverge, seg: seg, toggle: toggle, topDown: topDown, dustRGB: dustRGB, clampX: clampX };
  // Load each figure's script only when its figure comes within 1500 px of the screen, so the page starts light
  // (figures declare themselves in window.EPDemosLazy: figure id -> script URL). Runs after demos.js and these helpers.
  (function () {
    var map = window.EPDemosLazy; if (!map) return;
    var done = {};
    function load(id) { if (done[id]) return; done[id] = 1; var s = document.createElement('script'); s.src = map[id]; document.body.appendChild(s); }
    var figs = Object.keys(map).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    if (!('IntersectionObserver' in window)) { figs.forEach(function (f) { load(f.id); }); return; }
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); load(e.target.id); } }); }, { rootMargin: '1500px 0px' });
    figs.forEach(function (f) { io.observe(f); });
  })();
})();
