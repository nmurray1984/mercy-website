#!/usr/bin/env node
'use strict';
const { build } = require('../build/build');
try { build(); } catch (e) { console.error(e); process.exit(1); }
