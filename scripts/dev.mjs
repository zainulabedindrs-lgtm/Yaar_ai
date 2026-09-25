#!/usr/bin/env node
/**
 * Development runner.
 *
 *   npm run dev
 *
 * Starts two processes and streams both logs into one terminal:
 *
 *   1. the Yaar API server (Express + SQLite)      → http://localhost:8787
 *   2. the Vite dev server for the web client      → http://localhost:5173
 *
 * The browser only ever talks to Vite; `/api/*` is proxied to the API server, so
 * there is no CORS setup and the client feels like a single-origin app.
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_PORT = process.env.PORT || '8787';
const CLIENT_PORT = process.env.VITE_PORT || '5173';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** @type {import('node:child_process').ChildProcess[]} */
const children = [];

function start(name, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, ...env },
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev] ${name} exited with code ${code}`);
    }
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 200).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(`[dev] starting Yaar — API on :${API_PORT}, client on :${CLIENT_PORT}`);

start('api', process.execPath, ['server/index.js'], { PORT: API_PORT, NODE_ENV: 'development' });
start('client', npm, ['run', '--silent', 'vite', '--', '--port', CLIENT_PORT], {
  PORT: API_PORT,
  VITE_PORT: CLIENT_PORT,
  YAAR_API_TARGET: `http://127.0.0.1:${API_PORT}`,
});
