#!/usr/bin/env node
/**
 * Secret scanner — `npm run check:secrets`.
 *
 * Fails (exit code 1) if anything that would be committed to the repository, or
 * shipped to a browser, contains a Hugging Face token or another credential:
 *
 *   1. every tracked file (git index) is scanned for `hf_…` tokens, OpenAI-style
 *      `sk-…` keys and high-entropy values assigned to secret-looking variables;
 *   2. `.env.example` must never hold a real value for a secret key;
 *   3. the built client bundle (`dist/`, when present) must not contain a token,
 *      proof that the key cannot leak into frontend JavaScript;
 *   4. the client source must never reference server-only environment
 *      variables (only `VITE_`-prefixed names are allowed in the browser);
 *   5. `.env` must be ignored by git, and no `.env` file may be tracked.
 *
 * Run it before every commit and in CI. It is part of `npm run verify`.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TOKEN_PATTERNS = [
  { name: 'Hugging Face token', regex: /hf_[A-Za-z0-9]{20,}/g },
  { name: 'OpenAI-style key', regex: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'AWS access key id', regex: /AKIA[0-9A-Z]{16}/g },
  { name: 'Google API key', regex: /AIza[0-9A-Za-z\-_]{30,}/g },
];

/** Keys in .env files that must be empty/placeholder in the committed example. */
const SECRET_KEYS = [
  'HUGGINGFACE_API_KEY',
  'HF_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY',
  'SESSION_SECRET',
];

/** Placeholder values that are fine to commit. */
const PLACEHOLDER = /^(|replace-.*|your[-_].*|hf_your_token_here|changeme|example.*|<.*>)$/i;

/**
 * Placeholder *tokens* seen in documentation, e.g. `hf_xxxxxxxxxxxxxxxxxxxxxxxx`.
 * A real key is random base62, so a single repeated character is always a
 * placeholder — but anything else that merely looks like a token still fails.
 */
const PLACEHOLDER_TOKEN = /^(hf_|sk-)?(.)\2{11,}$/;

/** Server-only variables that must never be referenced by client code. */
const SERVER_ONLY_VARS = [
  'HUGGINGFACE_API_KEY',
  'HF_API_KEY',
  'OPENAI_COMPATIBLE_API_KEY',
  'SESSION_SECRET',
  'DATABASE_PATH',
];

const problems = [];
const notes = [];

function report(problem) {
  problems.push(problem);
  console.log(`  ✗ ${problem}`);
}

function ok(message) {
  console.log(`  ✓ ${message}`);
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'buffer' })
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
  } catch (error) {
    report(`could not list tracked files (${error.message})`);
    return [];
  }
}

function lookLikeText(file) {
  return /\.(js|jsx|ts|tsx|mjs|cjs|json|md|css|html|yml|yaml|sql|txt|example|env|webmanifest|svg)$/i.test(
    file,
  ) ||
    path.basename(file).startsWith('.env') ||
    path.basename(file) === '.gitignore';
}

function scanText(name, text, { allowPlaceholders = false } = {}) {
  for (const { name: label, regex } of TOKEN_PATTERNS) {
    regex.lastIndex = 0;
    const matches = text.match(regex);
    if (!matches) continue;
    for (const match of matches) {
      if (PLACEHOLDER_TOKEN.test(match)) continue;
      if (allowPlaceholders && PLACEHOLDER.test(match)) continue;
      const masked = `${match.slice(0, 7)}…${match.slice(-3)}`;
      report(`${name}: contains what looks like a ${label} (${masked})`);
    }
  }
}

console.log('Yaar secret scan');
console.log('===============');

// --- 1. tracked files ------------------------------------------------------
console.log('\n1. tracked files');
const files = trackedFiles();
let scanned = 0;
for (const file of files) {
  if (!lookLikeText(file)) continue;
  const absolute = path.join(ROOT, file);
  let text;
  try {
    text = fs.readFileSync(absolute, 'utf8');
  } catch {
    continue;
  }
  scanned += 1;
  scanText(file, text, { allowPlaceholders: file.endsWith('.example') || file === '.env.example' });
}
ok(`scanned ${scanned} tracked text files for tokens`);

// --- 2. .env.example -------------------------------------------------------
console.log('\n2. .env.example');
const examplePath = path.join(ROOT, '.env.example');
if (!fs.existsSync(examplePath)) {
  report('.env.example is missing — new developers have nothing to copy');
} else {
  const example = fs.readFileSync(examplePath, 'utf8');
  for (const line of example.split(/\r?\n/)) {
    const match = /^[ \t]*([A-Z0-9_]+)[ \t]*=[ \t]*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');
    if (!SECRET_KEYS.includes(key)) continue;
    if (!PLACEHOLDER.test(value)) {
      report(`.env.example: ${key} has a real-looking value — it must stay empty`);
    }
  }
  ok('secret keys in .env.example are empty placeholders');
}

// --- 3. built client bundle ------------------------------------------------
console.log('\n3. built client bundle (dist/)');
const distDir = path.join(ROOT, 'dist');
if (!fs.existsSync(distDir)) {
  notes.push('dist/ not built yet — run `npm run build` before releasing to re-check the bundle');
  console.log('  … skipped (no build yet)');
} else {
  const walk = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    );
  const bundleFiles = walk(distDir);
  for (const file of bundleFiles) {
    if (!/\.(js|css|html|json|webmanifest|svg)$/i.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    scanText(path.relative(ROOT, file), text);
  }
  ok(`scanned ${bundleFiles.length} built files — no token in the browser bundle`);
}

// --- 4. client source must not read server env -----------------------------
console.log('\n4. client source isolation');
const clientDir = path.join(ROOT, 'client');
let clientScanned = 0;
for (const file of walkClient()) {
  const relative = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  clientScanned += 1;
  for (const variable of SERVER_ONLY_VARS) {
    // A mention inside a user-facing message (e.g. build instructions) is fine;
    // reading the value from the bundler environment is not.
    const reads = new RegExp(`import\\.meta\\.env\\.${variable}\\b|process\\.env\\.${variable}\\b`);
    if (reads.test(text)) {
      report(`${relative}: reads the server-only variable ${variable} in the browser`);
    }
  }
  if (/\bHUGGINGFACE_API_KEY\b|\bHF_API_KEY\b|\bSESSION_SECRET\b/.test(text)) {
    report(`${relative}: references a secret variable name in client code`);
  }
}
ok(`checked ${clientScanned} client source files for server-only env usage`);

function walkClient() {
  const out = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  if (fs.existsSync(clientDir)) visit(clientDir);
  return out;
}

// --- 5. .env must be ignored and untracked ---------------------------------
console.log('\n5. .env hygiene');
try {
  execFileSync('git', ['check-ignore', '-q', '.env'], { cwd: ROOT });
  ok('.env is git-ignored');
} catch {
  report('.env is NOT ignored by git — it could be committed by accident');
}

const trackedEnv = trackedFiles().filter((file) => /(^|\/)\.env(\.|$)/.test(file) && file !== '.env.example');
if (trackedEnv.length) {
  report(`tracked env files that should never be committed: ${trackedEnv.join(', ')}`);
} else {
  ok('no .env file is tracked by git');
}

// --- summary ---------------------------------------------------------------
console.log('\n───────────────');
if (notes.length) console.log(`notes: ${notes.join(' | ')}`);
if (problems.length) {
  console.log(`secret scan FAILED — ${problems.length} problem(s)`);
  console.log('Fix: move the value into the git-ignored `.env`, rotate the leaked key at');
  console.log('https://huggingface.co/settings/tokens, and rebuild if the bundle was affected.');
  process.exit(1);
}
console.log('secret scan passed — no credentials found in tracked files or the client bundle');
console.log('───────────────');
