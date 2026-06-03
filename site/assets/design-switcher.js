/* ============================================================
   Mercy — admin-only design switcher
   ------------------------------------------------------------
   Injected on every public page. Asks /api/me whether the
   current viewer is signed in; if so, renders a small bar at
   the very top of the page that flips between the homepage,
   visit, and about page rendered in each candidate design.

   Regular visitors never see anything: /api/me returns
   { user: null } and we bail out without touching the DOM.
   ============================================================ */
(function () {
  'use strict';

  // The designs the switcher knows about. `base` is the URL prefix each
  // design lives under; '' is the live site (Design 1 — Classic).
  var DESIGNS = [
    { id: 1, base: '',           name: 'Classic' },
    { id: 2, base: '/designs/2', name: 'Warm' },
    { id: 3, base: '/designs/3', name: 'Bold' }
  ];

  // The pages that exist in every design, keyed by the "type" we derive from
  // the current path. `suffix` is appended to a design's base.
  var PAGES = [
    { type: 'home',  suffix: '/',      label: 'Home' },
    { type: 'visit', suffix: '/visit', label: 'Visit' },
    { type: 'about', suffix: '/about', label: 'About' }
  ];

  function normalize(path) {
    // Drop a trailing index.html and any trailing slash (except root).
    path = path.replace(/index\.html$/, '');
    if (path.length > 1) path = path.replace(/\/$/, '');
    return path || '/';
  }

  // Work out which design + which page type we're currently looking at.
  function locate() {
    var path = normalize(location.pathname);
    var design = DESIGNS[0];
    for (var i = DESIGNS.length - 1; i >= 0; i--) {
      var b = DESIGNS[i].base;
      if (b && (path === b || path.indexOf(b + '/') === 0)) {
        design = DESIGNS[i];
        path = normalize(path.slice(b.length) || '/');
        break;
      }
    }
    var type = null;
    if (path === '/' || path === '') type = 'home';
    else if (path === '/visit') type = 'visit';
    else if (path === '/about') type = 'about';
    return { design: design, type: type };
  }

  function urlFor(design, type) {
    var page = null;
    for (var i = 0; i < PAGES.length; i++) {
      if (PAGES[i].type === type) { page = PAGES[i]; break; }
    }
    var suffix = page ? page.suffix : '/';
    if (!design.base) return suffix; // live site lives at the root
    return design.base + (suffix === '/' ? '/' : suffix);
  }

  var STYLE = [
    '.mw-design-bar{position:relative;z-index:9999;display:flex;flex-wrap:wrap;',
    'align-items:center;justify-content:space-between;gap:12px;',
    'padding:8px clamp(16px,4vw,40px);background:#16130f;color:#f4ecdc;',
    "font-family:'JetBrains Mono','SF Mono',Menlo,monospace;",
    'border-bottom:1px solid #3a2f22;}',
    '.mw-design-bar__group{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
    '.mw-design-bar__group--right{margin-left:auto;}',
    '.mw-design-bar__eyebrow{font-size:10px;letter-spacing:0.18em;text-transform:uppercase;',
    'color:#a8927a;margin-right:4px;}',
    '.mw-design-bar__btn{display:flex;flex-direction:column;line-height:1.15;',
    'padding:5px 12px;border:1px solid #3a2f22;border-radius:6px;color:#e8dcc1;',
    'text-decoration:none;transition:border-color .15s,background .15s;}',
    '.mw-design-bar__btn b{font-size:12px;font-weight:600;letter-spacing:0.02em;}',
    '.mw-design-bar__btn span{font-size:9px;letter-spacing:0.16em;text-transform:uppercase;color:#a8927a;}',
    '.mw-design-bar__btn:hover{border-color:#a87a3f;background:#221c14;}',
    '.mw-design-bar__btn.is-active{border-color:#d4a857;background:#221c14;}',
    '.mw-design-bar__btn.is-active span{color:#d4a857;}',
    '.mw-design-bar__page{font-size:11px;letter-spacing:0.1em;text-transform:uppercase;',
    'color:#a8927a;text-decoration:none;padding:4px 8px;border-radius:4px;}',
    '.mw-design-bar__page:hover{color:#f4ecdc;}',
    '.mw-design-bar__page.is-active{color:#f4ecdc;background:#221c14;}',
    '.mw-design-bar__admin{font-size:11px;letter-spacing:0.1em;text-transform:uppercase;',
    'color:#16130f;background:#d4a857;padding:5px 12px;border-radius:6px;text-decoration:none;}',
    '.mw-design-bar__admin:hover{background:#e0b766;}',
    '@media(max-width:640px){.mw-design-bar__btn span{display:none;}',
    '.mw-design-bar__eyebrow{display:none;}}'
  ].join('');

  function injectStyle() {
    if (document.getElementById('mw-design-bar-style')) return;
    var s = document.createElement('style');
    s.id = 'mw-design-bar-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function build(user) {
    injectStyle();
    var here = locate();

    var bar = document.createElement('div');
    bar.className = 'mw-design-bar';
    bar.setAttribute('role', 'navigation');
    bar.setAttribute('aria-label', 'Design preview switcher');

    var left = document.createElement('div');
    left.className = 'mw-design-bar__group';
    var eyebrow = document.createElement('span');
    eyebrow.className = 'mw-design-bar__eyebrow';
    eyebrow.textContent = 'Design preview';
    left.appendChild(eyebrow);

    DESIGNS.forEach(function (d) {
      var a = document.createElement('a');
      a.className = 'mw-design-bar__btn';
      if (d.id === here.design.id) a.className += ' is-active';
      a.href = urlFor(d, here.type);
      a.innerHTML = '<b>Design ' + d.id + '</b><span>' + d.name + '</span>';
      left.appendChild(a);
    });

    var right = document.createElement('div');
    right.className = 'mw-design-bar__group mw-design-bar__group--right';

    if (here.type) {
      PAGES.forEach(function (p) {
        var a = document.createElement('a');
        a.className = 'mw-design-bar__page';
        if (p.type === here.type) a.className += ' is-active';
        a.href = urlFor(here.design, p.type);
        a.textContent = p.label;
        right.appendChild(a);
      });
    }

    var admin = document.createElement('a');
    admin.className = 'mw-design-bar__admin';
    admin.href = '/admin';
    admin.textContent = 'Admin';
    admin.title = 'Signed in as ' + (user.email || 'admin');
    right.appendChild(admin);

    bar.appendChild(left);
    bar.appendChild(right);

    document.body.insertBefore(bar, document.body.firstChild);
    document.documentElement.classList.add('mw-has-design-bar');
  }

  function init() {
    fetch('/api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data && data.user) build(data.user);
      })
      .catch(function () { /* offline or not signed in — show nothing */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
