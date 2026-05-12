'use strict';

/**
 * Seed helpers for tests. Call AFTER makeSandbox() and AFTER migrate().
 */

async function seedUsers(db, auth) {
  const admin = await auth.createUser({
    email: 'admin@example.com',
    password: 'correct-horse-battery-staple',
    role: 'admin',
  });
  const superuser = await auth.createUser({
    email: 'root@example.com',
    password: 'correct-horse-battery-staple',
    role: 'superuser',
  });
  return { admin, superuser, password: 'correct-horse-battery-staple' };
}

function seedContent(db, rows) {
  const defaults = [
    {
      key: 'home.hero.headline',
      value: 'Mercy to us. Mercy through us.',
      kind: 'text',
      page: 'home',
      section: 'hero',
      label: 'Hero headline',
    },
    {
      key: 'home.hero.body',
      value: 'A church in Dallas seeking to know Jesus and make him known.',
      kind: 'markdown',
      page: 'home',
      section: 'hero',
      label: 'Hero body',
    },
    {
      key: 'visit.address',
      value: '123 Mercy Lane, Dallas, TX',
      kind: 'text',
      page: 'visit',
      section: 'address',
      label: 'Address',
    },
    {
      key: 'footer.copy',
      value: '(c) Mercy Presbyterian',
      kind: 'text',
      page: 'footer',
      section: 'copy',
      label: 'Footer line',
    },
  ];
  const toInsert = rows || defaults;
  const stmt = db.prepare(`
    INSERT INTO content (key, value, kind, page, section, label)
    VALUES (@key, @value, @kind, @page, @section, @label)
  `);
  const tx = db.transaction((items) => {
    for (const item of items) stmt.run(item);
  });
  tx(toInsert);
  return toInsert;
}

module.exports = { seedUsers, seedContent };
