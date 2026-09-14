/* Sidebar menu toggle (mobile) and current-section highlighting. No dependencies. */
(function () {
  var header = document.getElementById('header');
  var toggle = header && header.querySelector('.sidebar__toggle');
  var links = header ? Array.prototype.slice.call(header.querySelectorAll('.sidebar__nav a[data-section]')) : [];

  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = header.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    });
    header.addEventListener('click', function (e) {
      if (e.target.closest('a') && header.classList.contains('is-open')) {
        header.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-label', 'Open menu');
      }
    });
  }

  if (!links.length || !('IntersectionObserver' in window)) return;
  var sections = links.map(function (a) { return document.getElementById(a.getAttribute('data-section')); }).filter(Boolean);
  if (!sections.length) return;

  var visible = {};
  function setCurrent() {
    var best = null;
    sections.forEach(function (s) {
      if (visible[s.id] && (!best || visible[s.id] > visible[best.id])) best = s;
    });
    links.forEach(function (a) {
      var on = best && a.getAttribute('data-section') === best.id;
      if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    });
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting ? en.intersectionRatio : 0; });
    setCurrent();
  }, { rootMargin: '-15% 0px -55% 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] });
  sections.forEach(function (s) { io.observe(s); });
})();
