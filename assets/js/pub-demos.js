/* Interactive figures under papers on the homepage. A row of chips under a paper opens one live figure at a time.
   Nothing demo-related loads until the first click: then the shared stylesheet and helpers (demos.js, demos-data.js)
   and the figure's own stylesheet; the figure's script then loads through the lazy map (window.EPDemosLazy) as its panel shows. */
(function () {
  'use strict';
  var A = window.EPDemosAssets; if (!A) return;
  var cache = {};
  function css(href) {
    return cache[href] || (cache[href] = new Promise(function (res) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; l.onload = l.onerror = function () { res(); }; document.head.appendChild(l); }));
  }
  function js(src) {
    return cache[src] || (cache[src] = new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = function () { res(); }; s.onerror = rej; document.body.appendChild(s); }));
  }
  function core() { return Promise.all([css(A.css), js(A.core).then(function () { return js(A.helpers); })]); }

  function wire(box) {
    var cards = Array.prototype.slice.call(box.querySelectorAll('[data-open]'));
    function panelOf(card) { return document.getElementById('panel-' + card.getAttribute('data-open')); }
    function open(card, scroll) {
      var was = card.getAttribute('aria-expanded') === 'true';
      cards.forEach(function (c) { c.setAttribute('aria-expanded', 'false'); var p = panelOf(c); if (p) p.hidden = true; });
      if (was) return;
      card.setAttribute('aria-expanded', 'true'); card.classList.add('is-loading');
      Promise.all([core(), css(card.getAttribute('data-css'))]).then(function () {
        card.classList.remove('is-loading');
        if (card.getAttribute('aria-expanded') !== 'true') return;   // closed again while loading
        var p = panelOf(card); p.hidden = false;
        var r = p.getBoundingClientRect();
        if (scroll || r.top > window.innerHeight * 0.75) p.scrollIntoView({ block: 'start', behavior: scroll ? 'auto' : 'smooth' });
      }, function () { card.classList.remove('is-loading'); });
    }
    cards.forEach(function (card) { card.addEventListener('click', function () { open(card, false); }); });
    return function (id) { var c = cards.filter(function (x) { return x.getAttribute('data-open') === id; })[0]; if (c) { open(c, true); return true; } return false; };
  }

  var openers = Array.prototype.map.call(document.querySelectorAll('[data-pub-demos]'), wire);
  var h = decodeURIComponent((location.hash || '').slice(1)).replace(/^panel-/, '');   // deep link: /#demo-pions opens that figure
  if (h) openers.some(function (f) { return f(h); });
})();
