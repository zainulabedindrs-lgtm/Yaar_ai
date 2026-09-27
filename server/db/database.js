/**
 * Database connection + tiny migration runner.
 *
 * Two interchangeable drivers, one SQL dialect (PostgreSQL):
 *
 *   • `DATABASE_URL` set  → a `pg` connection pool (Supabase Postgres in
 *                           production, or any Postgres you point it at).
 *   • `DATABASE_URL` empty → embedded PGlite (Postgres compiled to WASM), stored
 *                           in `DATABASE_PATH` (default ./data/pglite). Zero
 *                           setup for local development and the test suite.
 *
 * Every repository calls `query()` / `queryOne()`. `transaction(fn)` runs `fn`
 * on a single connection and repositories called inside it automatically join
 * that transaction (via AsyncLocalStorage), so atomic writes such as
 * "insert user message + increment usage counter" stay atomic on both drivers.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SCHEMA_VERSION = 2;

/** Postgres type OIDs that should come back as JS numbers (epoch ms, counts). */
const INT8_OID = 20;
const NUMERIC_OID = 1700;

/**
 * @typedef {Object} Executor
 * @property {(sql: string, params?: unknown[]) => Promise<any[]>} query
 */

/**
 * @typedef {Object} Driver
 * @property {'postgres'|'pglite'} kind
 * @property {(sql: string, params?: unknown[]) => Promise<any[]>} query
 * @property {(sql: string) => Promise<void>} exec
 * @property {<T>(fn: (executor: Executor) => Promise<T>) => Promise<T>} transaction
 * @property {() => Promise<void>} close
 */

/** @type {Driver | null} */
let driver = null;
/** @type {Promise<Driver> | null} */
let initPromise = null;

/** @type {AsyncLocalStorage<Executor>} */
const txStorage = new AsyncLocalStorage();

/** Opens (and migrates) the database. Idempotent and safe to call concurrently. */
export function initDatabase() {
  if (driver) return Promise.resolve(driver);
  if (!initPromise) {
    initPromise = openDriver()
      .then(async (opened) => {
        await applySchema(opened);
        driver = opened;
        logger.info('database ready', { driver: opened.kind, target: describeTarget() });
        return opened;
      })
      .catch((error) => {
        initPromise = null;
        throw error;
      });
  }
  return initPromise;
}

/** @returns {Promise<Driver>} */
async function openDriver() {
  if (config.database.url) return openPostgres();
  return openPglite();
}

/** @returns {Promise<Driver>} */
async function openPostgres() {
  const { default: pg } = await import('pg');

  const pool = new pg.Pool({
    connectionString: config.database.url,
    max: config.database.poolMax,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
    types: {
      getTypeParser(oid, format) {
        if (oid === INT8_OID || oid === NUMERIC_OID) return (value) => Number(value);
        return pg.types.getTypeParser(oid, format);
      },
    },
  });

  pool.on('error', (error) => {
    logger.error('postgres pool error', { message: String(error?.message) });
  });

  return {
    kind: 'postgres',
    async query(sql, params = []) {
      const result = await pool.query(sql, params);
      return result.rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({
          query: async (sql, params = []) => (await client.query(sql, params)).rows,
        });
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/** @returns {Promise<Driver>} */
async function openPglite() {
  const { PGlite } = await import('@electric-sql/pglite');

  const target = config.database.path;
  const dataDir = target === ':memory:' ? undefined : target;
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });

  const numberParser = (value) => Number(value);
  const db = await PGlite.create(dataDir, {
    parsers: { [INT8_OID]: numberParser, [NUMERIC_OID]: numberParser },
  });

  return {
    kind: 'pglite',
    async query(sql, params = []) {
      return (await db.query(sql, params)).rows;
    },
    async exec(sql) {
      await db.exec(sql);
    },
    async transaction(fn) {
      return db.transaction((tx) =>
        fn({ query: async (sql, params = []) => (await tx.query(sql, params)).rows }),
      );
    },
    async close() {
      await db.close();
    },
  };
}

/** @param {Driver} database */
async function applySchema(database) {
  // Serverless cold starts call this constantly: skip the DDL (and its table
  // locks) when the schema is already current.
  try {
    const rows = await database.query(
      "SELECT value FROM schema_meta WHERE key = 'schema_version'",
    );
    if (rows[0] && Number(rows[0].value) >= SCHEMA_VERSION) return;
  } catch {
    /* fresh database — schema_meta does not exist yet */
  }

  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  // A multi-statement simple query runs as one implicit transaction, so the
  // advisory lock serialises concurrent cold starts migrating at once.
  await database.exec(`SELECT pg_advisory_xact_lock(727274);\n${schemaSql}`);
  await database.query(
    `INSERT INTO schema_meta (key, value) VALUES ('schema_version', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(SCHEMA_VERSION)],
  );
}

async function getDriver() {
  return driver ?? initDatabase();
}

/**
 * Runs a statement and returns every row. Joins the surrounding transaction
 * when called inside `transaction()`.
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<any[]>}
 */
export async function query(sql, params = []) {
  const tx = txStorage.getStore();
  if (tx) return tx.query(sql, params);
  return (await getDriver()).query(sql, params);
}

/** First row or `undefined`. */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0];
}

/**
 * Runs `fn` inside ONE transaction. Nested calls join the outer transaction.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function transaction(fn) {
  if (txStorage.getStore()) return fn();
  const database = await getDriver();
  return database.transaction((executor) => txStorage.run(executor, fn));
}

/** Closes the connection (graceful shutdown / tests). */
export async function closeDatabase() {
  const current = driver ?? (initPromise ? await initPromise.catch(() => null) : null);
  driver = null;
  initPromise = null;
  if (!current) return;
  try {
    await current.close();
  } catch {
    /* already closed */
  }
}

/** Which driver is active (diagnostics). */
export function databaseKind() {
  return config.database.url ? 'postgres' : 'pglite';
}

/** Non-secret description of where data lives. Never includes credentials. */
function describeTarget() {
  if (!config.database.url) return config.database.path;
  try {
    const url = new URL(config.database.url);
    return `${url.hostname}:${url.port || 5432}${url.pathname}`;
  } catch {
    return 'postgres';
  }
}

/** Health/diagnostics helper. */
export async function databaseStats() {
  const row = await queryOne(
    `SELECT
       (SELECT COUNT(*) FROM users)         AS users,
       (SELECT COUNT(*) FROM conversations) AS conversations,
       (SELECT COUNT(*) FROM messages)      AS messages`,
  );
  return {
    users: Number(row.users),
    conversations: Number(row.conversations),
    messages: Number(row.messages),
    driver: databaseKind(),
  };
}
