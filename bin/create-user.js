#!/usr/bin/env node
'use strict';

/**
 * Create a user from the command line.
 *
 *   node bin/create-user.js --email you@example.com --role superuser
 *
 * Prompts for a password (TTY) unless --password is supplied (not recommended;
 * lands in shell history).
 */

const readline = require('readline');
const auth = require('../server/auth');
require('../db/migrate').migrate?.(); // safe to run; idempotent

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function promptHidden(label) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(label);
    const stdin = process.stdin;
    let value = '';
    // poor-man's no-echo
    const onData = (char) => {
      char = char.toString('utf8');
      if (char === '\n' || char === '\r' || char === '') {
        process.stdout.write('\n');
        stdin.removeListener('data', onData);
        rl.close();
        resolve(value);
      } else if (char === '') {
        process.exit(0);
      } else if (char.charCodeAt(0) === 127 || char === '\b') {
        if (value.length) { value = value.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        value += char;
        process.stdout.write('*');
      }
    };
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

async function main() {
  const email = arg('email');
  const role  = arg('role') || 'admin';
  let password = arg('password');

  if (!email) {
    console.error('Usage: node bin/create-user.js --email you@example.com --role [admin|superuser]');
    process.exit(2);
  }
  if (!['admin', 'superuser'].includes(role)) {
    console.error('Role must be admin or superuser.');
    process.exit(2);
  }
  if (!password) {
    password = await promptHidden('Password (min 12 chars): ');
    const confirm = await promptHidden('Confirm: ');
    if (password !== confirm) {
      console.error('Passwords did not match.');
      process.exit(1);
    }
  }
  try {
    const user = await auth.createUser({ email, password, role });
    console.log(`Created user #${user.id}: ${user.email} (${user.role})`);
  } catch (e) {
    console.error('Failed:', e.message);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
