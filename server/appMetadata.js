/**
 * App metadata shared with the client (version, limits, legal links).
 * Kept separate so `/api/health` and `/api/session` can never drift apart.
 */

import fs from 'node:fs';
import path from 'node:path';

import { ROOT_DIR, config } from './config.js';

let cachedVersion = null;

/** Reads the version from package.json once. */
export function appVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    cachedVersion = String(pkg.version ?? '0.0.0');
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

export function appMetadata() {
  return {
    name: 'Yaar',
    version: appVersion(),
    tagline: 'Someone to talk to, anytime.',
    dailyMessageLimit: config.usage.dailyLimit,
    usageWindowHours: config.usage.windowHours,
    privacyPath: '/privacy',
    termsPath: '/terms',
  };
}
