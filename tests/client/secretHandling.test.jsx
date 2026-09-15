/**
 * Key-handling contract for the frontend.
 *
 * These assertions exist so a future change cannot quietly move the Hugging Face
 * credential into the browser: the client bundle must only ever see `VITE_`
 * variables, and no client file may reference a server-only variable name.
 *
 * The server side of the same contract lives in
 * `tests/server/aiProvider.test.js` (the key is read from the environment and
 * never logged) and in `scripts/check-secrets.mjs` (scans tracked files and the
 * built bundle for tokens).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Namespace import on purpose: the test checks every exported value.
import * as appConfig from '../../client/src/config/appConfig.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const clientSrc = path.join(repoRoot, 'client', 'src');

/** Every .js/.jsx file under client/src. */
function clientSourceFiles(dir = clientSrc) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return clientSourceFiles(full);
    return /\.(js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

describe('frontend key isolation', () => {
  it('exposes no secret-looking values through the client config', () => {
    const serialised = JSON.stringify(appConfig).toLowerCase();
    for (const forbidden of [
      'huggingface_api_key',
      'hf_api_key',
      'session_secret',
      'openai_compatible_api_key',
      'api_key',
      'apikey',
      'bearer ',
      'database_path',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('never reads a server-only environment variable in client code', () => {
    const offenders = [];
    for (const file of clientSourceFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      if (/process\.env\.|import\.meta\.env\./.test(text)) {
        // Only VITE_-prefixed keys may be read in the browser.
        const reads = text.match(/(?:process|import\.meta)\.env\.([A-Za-z0-9_]+)/g) ?? [];
        for (const read of reads) {
          const [, name] = /\.([A-Za-z0-9_]+)$/.exec(read);
          if (!name.startsWith('VITE_')) offenders.push(`${path.relative(repoRoot, file)} → ${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('mentions no secret variable names anywhere in client code', () => {
    const offenders = [];
    for (const file of clientSourceFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      if (
        /HUGGINGFACE_API_KEY|HF_API_KEY|SESSION_SECRET|OPENAI_COMPATIBLE_API_KEY|DATABASE_PATH/.test(
          text,
        )
      ) {
        offenders.push(path.relative(repoRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('contains no hard-coded credential-looking strings', () => {
    const patterns = [/hf_[A-Za-z0-9]{20,}/, /sk-[A-Za-z0-9]{20,}/, /Bearer\s+[A-Za-z0-9._-]{20,}/];
    const offenders = [];
    for (const file of clientSourceFiles()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const pattern of patterns) {
        const match = pattern.exec(text);
        if (match) offenders.push(`${path.relative(repoRoot, file)}: ${match[0].slice(0, 6)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('points the client at the API origin, never at a model provider', () => {
    // The browser talks to our own backend only; the provider URL is server-side.
    const apiBaseUrl = appConfig.API_BASE_URL;
    expect(apiBaseUrl === '' || /^https?:\/\//.test(apiBaseUrl)).toBe(true);
    expect(apiBaseUrl).not.toMatch(/huggingface/i);

    const all = Object.values(appConfig)
      .map((value) => (typeof value === 'function' ? '' : JSON.stringify(value)))
      .join(' ');
    expect(all).not.toMatch(/huggingface\.co|router\.huggingface/);
    expect(all).not.toMatch(/Bearer\s/);
  });
});
