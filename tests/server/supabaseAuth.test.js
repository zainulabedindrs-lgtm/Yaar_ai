/**
 * Supabase Auth on the server.
 *
 * A local HTTP server plays the Supabase project (JWKS + admin API). Tokens
 * are minted in-test with `jose`, both with an asymmetric key (ES256 via
 * JWKS — Supabase's current signing keys) and the legacy HS256 secret.
 *
 * The key property under test: the user id ALWAYS comes from a verified
 * token, never from anything the frontend sends.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';

import { SignJWT, exportJWK, generateKeyPair } from 'jose';

import { createClient, loadServer, startTestServer, useTestEnv } from './helpers.js';

const JWT_SECRET = 'test-legacy-jwt-secret-at-least-32-characters-long';
const SECRET_KEY = 'sb_secret_test_not_real';

const { publicKey, privateKey } = await generateKeyPair('ES256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };

/** @type {string[]} */
const deletedUsers = [];
const supabase = http.createServer((req, res) => {
  if (req.url === '/auth/v1/.well-known/jwks.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
    return;
  }
  const match = /^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(req.url ?? '');
  if (req.method === 'DELETE' && match && req.headers.apikey === SECRET_KEY) {
    deletedUsers.push(decodeURIComponent(match[1]));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
    return;
  }
  res.writeHead(404).end();
});
await new Promise((resolve) => supabase.listen(0, '127.0.0.1', resolve));
const SUPABASE_URL = `http://127.0.0.1:${supabase.address().port}`;
const ISSUER = `${SUPABASE_URL}/auth/v1`;

useTestEnv({
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_not_real',
  SUPABASE_SECRET_KEY: SECRET_KEY,
  SUPABASE_JWT_SECRET: JWT_SECRET,
  AUTH_REQUIRED: 'false',
  ALLOW_ANONYMOUS: 'true',
  AI_STREAMING: 'false',
});

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

/** ES256 token signed with the project's (mock) asymmetric key. */
function es256Token(sub, { email = `${sub.slice(0, 4)}@example.com`, audience = 'authenticated', issuer = ISSUER, exp = '1h' } = {}) {
  return new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(privateKey);
}

/** Legacy HS256 token. */
function hs256Token(sub, { secret = JWT_SECRET, exp = '1h' } = {}) {
  return new SignJWT({ email: 'legacy@example.com', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret));
}

let server;
let config;

before(async () => {
  ({ config } = await loadServer());
  server = await startTestServer();
});

after(async () => {
  await server?.close();
  await new Promise((resolve) => supabase.close(resolve));
  const { closeDatabase } = await import('../../server/db/database.js');
  await closeDatabase();
});

const asUser = (token, deviceId = 'authdevice00001') => ({
  client: createClient(server.baseUrl, { deviceId }),
  headers: { authorization: `Bearer ${token}` },
});

describe('public auth config', () => {
  test('exposes only the public URL + publishable key', async () => {
    const client = createClient(server.baseUrl);
    const { status, body } = await client.request('/auth/config');
    assert.equal(status, 200);
    assert.equal(body.auth.enabled, true);
    assert.equal(body.auth.supabaseUrl, SUPABASE_URL);
    assert.equal(body.auth.publishableKey, 'sb_publishable_test_not_real');
    assert.ok(!JSON.stringify(body).includes(SECRET_KEY), 'the secret key never leaves the server');
    assert.ok(!JSON.stringify(body).includes(JWT_SECRET));
  });
});

describe('verified identity', () => {
  test('an ES256 (JWKS) token signs the user in', async () => {
    const { client, headers } = asUser(await es256Token(ALICE, { email: 'alice@example.com' }));
    const { status, body } = await client.request('/session', { headers });
    assert.equal(status, 200);
    assert.equal(body.user.isAnonymous, false);
    assert.equal(body.user.email, 'alice@example.com');
  });

  test('a legacy HS256 token is verified with SUPABASE_JWT_SECRET', async () => {
    const { client, headers } = asUser(await hs256Token(BOB));
    const { status, body } = await client.request('/session', { headers });
    assert.equal(status, 200);
    assert.equal(body.user.isAnonymous, false);
  });

  test('the same account sees the same data from any device', async () => {
    const token = await es256Token(ALICE);
    const phone = asUser(token, 'phonedevice00001');
    const laptop = asUser(token, 'laptopdevice0001');

    const sent = await phone.client.request('/chat/girlfriend/messages', {
      method: 'POST',
      headers: phone.headers,
      body: { content: 'hello from my phone', stream: false },
    });
    // No AI in this suite — the send is refunded, but the message is stored.
    assert.ok([200, 502].includes(sent.status));

    const history = await laptop.client.request('/conversations/girlfriend/messages', {
      headers: laptop.headers,
    });
    assert.equal(history.status, 200);
    assert.ok(history.body.messages.some((m) => m.content === 'hello from my phone'));

    const phoneRef = (await phone.client.request('/session', { headers: phone.headers })).body.user.ref;
    const laptopRef = (await laptop.client.request('/session', { headers: laptop.headers })).body.user.ref;
    assert.equal(phoneRef, laptopRef);
  });

  test('user ids supplied by the frontend are ignored', async () => {
    const aliceRef = (
      await asUser(await es256Token(ALICE)).client.request('/session', {
        headers: { authorization: `Bearer ${await es256Token(ALICE)}` },
      })
    ).body.user.ref;

    // Bob tries to impersonate Alice through every client-controlled channel.
    const bob = asUser(await es256Token(BOB));
    const { body } = await bob.client.request(`/session?userId=sb_${ALICE}`, {
      headers: { ...bob.headers, 'x-user-id': `sb_${ALICE}`, 'x-yaar-user-id': `sb_${ALICE}` },
    });
    assert.notEqual(body.user.ref, aliceRef);

    const history = await bob.client.request('/conversations/girlfriend/messages', {
      headers: bob.headers,
    });
    assert.ok(!history.body.messages.some((m) => m.content === 'hello from my phone'));
  });
});

describe('rejected tokens (never downgraded to anonymous)', () => {
  const cases = {
    'a forged HS256 signature': () => hs256Token(ALICE, { secret: 'x'.repeat(48) }),
    'an expired token': () => es256Token(ALICE, { exp: Math.floor(Date.now() / 1000) - 3600 }),
    'the wrong audience': () => es256Token(ALICE, { audience: 'anon' }),
    'a foreign issuer': () => es256Token(ALICE, { issuer: 'https://evil.example.com/auth/v1' }),
    'garbage': async () => 'not-a-jwt',
    'an unsigned (alg none) token': async () =>
      `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
        JSON.stringify({ sub: ALICE, aud: 'authenticated', iss: ISSUER }),
      ).toString('base64url')}.`,
  };

  for (const [name, makeToken] of Object.entries(cases)) {
    test(`401 for ${name}`, async () => {
      const { client, headers } = asUser(await makeToken());
      const { status, body } = await client.request('/session', { headers });
      assert.equal(status, 401);
      assert.equal(body.error.code, 'unauthorized');
    });
  }
});

describe('AUTH_REQUIRED / ALLOW_ANONYMOUS toggles', () => {
  test('anonymous use works while allowed', async () => {
    const client = createClient(server.baseUrl, { deviceId: 'anondevice000001' });
    const { status, body } = await client.request('/session');
    assert.equal(status, 200);
    assert.equal(body.user.isAnonymous, true);
  });

  test('AUTH_REQUIRED blocks anonymous calls but keeps public routes open', async () => {
    const saved = { ...config.auth };
    config.auth.required = true;
    config.auth.allowAnonymous = false;
    try {
      const client = createClient(server.baseUrl, { deviceId: 'anondevice000002' });
      for (const path of ['/session', '/usage', '/conversations/girlfriend/messages']) {
        const { status, body } = await client.request(path);
        assert.equal(status, 401, path);
        assert.equal(body.error.code, 'unauthorized');
      }
      const chat = await client.request('/chat/girlfriend/messages', {
        method: 'POST',
        body: { content: 'hi', stream: false },
      });
      assert.equal(chat.status, 401);

      assert.equal((await client.request('/health')).status, 200);
      assert.equal((await client.request('/companions')).status, 200);
      assert.equal((await client.request('/auth/config')).body.auth.required, true);

      const { client: authed, headers } = asUser(await es256Token(ALICE));
      assert.equal((await authed.request('/session', { headers })).status, 200);
    } finally {
      Object.assign(config.auth, saved);
    }
  });
});

describe('account deletion', () => {
  test('deletes Yaar data AND the Supabase auth user (secret key, server-side)', async () => {
    const victim = '33333333-3333-4333-8333-333333333333';
    const { client, headers } = asUser(await es256Token(victim));
    await client.request('/session', { headers });

    const { status, body } = await client.request('/session', { method: 'DELETE', headers });
    assert.equal(status, 200);
    assert.deepEqual(body, { deleted: true, accountDeleted: true });
    assert.deepEqual(deletedUsers, [victim]);
  });

  test('anonymous deletion never calls the Supabase admin API', async () => {
    const before = deletedUsers.length;
    const client = createClient(server.baseUrl, { deviceId: 'anondevice000003' });
    const { body } = await client.request('/session', { method: 'DELETE' });
    assert.equal(body.accountDeleted, false);
    assert.equal(deletedUsers.length, before);
  });
});
