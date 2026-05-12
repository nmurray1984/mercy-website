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
  { url: '/',         template: 'index.njk',   data: () => ({ active: 'home' }) },
  { url: '/visit',    template: 'visit.njk',   data: () => ({ active: 'visit' }) },
  { url: '/about',    template: 'about.njk',   data: () => ({ active: 'about' }) },
  { url: '/sermons',  template: 'sermons.njk', data: () => ({ active: 'sermons' }) },
  { url: '/groups',   template: 'groups.njk',  data: () => ({ active: 'groups' }) },
  { url: '/events',   template: 'events.njk',  data: () => ({ active: 'events' }) },
  { url: '/give',     template: 'give.njk',    data: () => ({ active: 'give' }) },
];
