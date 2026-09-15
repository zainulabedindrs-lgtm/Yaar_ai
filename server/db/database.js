/**
 * SQLite connection + tiny migration runner.
 *
 * `better-sqlite3` is synchronous, which keeps the data layer simple and fast
 * for a single-node companion app. All writes that must be atomic (message +
 * usage counter) go through `db.transaction(...)`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('better-sqlite3').Database | null} */
let db = null;

const SCHEMA_VERSION = 1;

/** Opens (and migrates) the database. Idempotent. */
export function initDatabase({ file = config.database.path } = {}) {
  if (db) return db;

  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${config.database.busyTimeoutMs}`);
  db.pragma('synchronous = NORMAL');

  applySchema(db);

  logger.info('database ready', { file });
  return db;
}

/** @returns {import('better-sqlite3').Database} */
export function getDb() {
  if (!db) return initDatabase();
  return db;
}

/** @param {import('better-sqlite3').Database} database */
function applySchema(database) {
  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  database.exec(schemaSql);

  const current = database
    .prepare('SELECT value FROM schema_meta WHERE key = ?')
    .get('schema_version');

  if (!current) {
    database
      .prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION));
  }
}

/** Runs `fn` inside a transaction (nested calls become savepoints). */
export function transaction(fn) {
  return getDb().transaction(fn);
}

/** Test helper: drops the cached handle (and the file when in-memory). */
export function closeDatabase() {
  if (!db) return;
  try {
    db.close();
  } catch {
    /* already closed */
  }
  db = null;
}

/** Health/diagnostics helper. */
export function databaseStats() {
  const database = getDb();
  const users = database.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const conversations = database.prepare('SELECT COUNT(*) AS c FROM conversations').get().c;
  const messages = database.prepare('SELECT COUNT(*) AS c FROM messages').get().c;
  return { users, conversations, messages, file: config.database.path };
}
