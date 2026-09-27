#!/usr/bin/env node
/**
 * Deletes the LOCAL embedded PGlite database directory (DATABASE_PATH).
 * Refuses to run when DATABASE_URL is set — it never touches a real Postgres.
 *
 *   npm run db:reset          # asks for confirmation
 *   npm run db:reset -- --yes # non-interactive (CI, scripts)
 *
 * The next server start recreates an empty database automatically.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';

import { config } from '../server/config.js';

const target = config.database.path;

if (config.database.url) {
  console.log('DATABASE_URL is set — refusing to touch a real Postgres database. Nothing deleted.');
  process.exit(1);
}

if (target === ':memory:') {
  console.log('DATABASE_PATH is :memory: — nothing to delete.');
  process.exit(0);
}

const files = [target].filter((file) => fs.existsSync(file));

if (files.length === 0) {
  console.log(`No database found at ${path.relative(process.cwd(), target)} — nothing to do.`);
  process.exit(0);
}

const skipPrompt = process.argv.includes('--yes') || process.argv.includes('-y');

if (!skipPrompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `Delete ${files.length} database director(ies) at ${path.relative(process.cwd(), target)}? [y/N] `,
  );
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Cancelled.');
    process.exit(0);
  }
}

for (const file of files) {
  fs.rmSync(file, { force: true, recursive: true });
  console.log(`removed ${path.relative(process.cwd(), file)}`);
}

console.log('Done. Start the server to create a fresh database.');
