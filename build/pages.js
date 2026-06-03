'use strict';

/**
 * The list of pages the public site builds.
 *
 * Each entry:
 *   url:      the URL path. `/` writes /index.html, `/visit` writes /visit/index.html
 *   template: file under site/templates/, relative
 *   data:     optional function returning page-specific data (lists, fixtures)
 */

module.exports = [
  // ----- Live site (Design 1 — "Classic / editorial") -----
  { url: '/',         template: 'index.njk',   data: () => ({ active: 'home' }) },
  { url: '/visit',    template: 'visit.njk',   data: () => ({ active: 'visit' }) },
  { url: '/about',    template: 'about.njk',   data: () => ({ active: 'about' }) },
  { url: '/sermons',  template: 'sermons.njk', data: () => ({ active: 'sermons' }) },
  { url: '/groups',   template: 'groups.njk',  data: () => ({ active: 'groups' }) },
  { url: '/events',   template: 'events.njk',  data: () => ({ active: 'events' }) },
  { url: '/give',     template: 'give.njk',    data: () => ({ active: 'give' }) },

  // ----- Design previews (admin-only switcher; same content, new skins) -----
  // Design 2 — "Warm / modern". Lives under /designs/2/*; `base` keeps its
  // own nav links inside the preview.
  { url: '/designs/2',       template: 'designs/warm/index.njk', data: () => ({ active: 'home',  base: '/designs/2' }) },
  { url: '/designs/2/visit', template: 'designs/warm/visit.njk', data: () => ({ active: 'visit', base: '/designs/2' }) },
  { url: '/designs/2/about', template: 'designs/warm/about.njk', data: () => ({ active: 'about', base: '/designs/2' }) },

  // Design 3 — "Bold / minimal".
  { url: '/designs/3',       template: 'designs/bold/index.njk', data: () => ({ active: 'home',  base: '/designs/3' }) },
  { url: '/designs/3/visit', template: 'designs/bold/visit.njk', data: () => ({ active: 'visit', base: '/designs/3' }) },
  { url: '/designs/3/about', template: 'designs/bold/about.njk', data: () => ({ active: 'about', base: '/designs/3' }) },
];
