/**
 * The rules that decide how many messages a user can send.
 *
 * These tests hit the real services and the real SQLite database — no mocks —
 * because the whole point of the limit is that it is enforced server-side.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { loadServer, useTestEnv } from './helpers.js';

useTestEnv({ DAILY_MESSAGE_LIMIT: '20' });

const { initDatabase, closeDatabase, getDb, chatService, usageService, messagesRepo } =
  await loadServer();

const USER = 'usr_test_user_0001';
const OTHER_USER = 'usr_test_user_0002';
const COMPANION = 'girlfriend';

/** Stores one user message and one AI reply, like a real turn does. */
function recordTurn({ withReply = true } = {}) {
  const turn = chatService.beginTurn({
    userId: USER,
    companionId: COMPANION,
    content: 'hello there',
  });
  if (withReply) {
    chatService.saveAssistantReply({
      userId: USER,
      conversation: turn.conversation,
      content: 'hi, I am here 💛',
      model: 'test-model',
      provider: 'test',
    });
  }
  return turn;
}

describe('daily usage limit', () => {
  before(() => {
    initDatabase();
  });

  after(() => {
    closeDatabase();
  });

  test('starts at zero with the configured limit', () => {
    const usage = usageService.getUsageState(USER);
    assert.equal(usage.used, 0);
    assert.equal(usage.limit, 20);
    assert.equal(usage.remaining, 20);
    assert.equal(usage.exhausted, false);
    assert.ok(usage.resetAt > Date.now(), 'the window should expire in the future');
  });

  test('accepts exactly 20 user messages, counting only user messages', () => {
    for (let index = 1; index <= 20; index += 1) {
      const turn = recordTurn();
      assert.equal(turn.usage.used, index, `message ${index} should be counted`);
      assert.equal(turn.usage.remaining, 20 - index);
    }

    const usage = usageService.getUsageState(USER);
    assert.equal(usage.used, 20);
    assert.equal(usage.exhausted, true);

    // 20 user messages + 20 AI replies + 1 seeded greeting were stored, yet the
    // counter says 20: only user messages count.
    const conversationRow = getDb()
      .prepare('SELECT id FROM conversations WHERE user_id = ? LIMIT 1')
      .get(USER);
    const rows = messagesRepo.listMessages(conversationRow.id, { limit: 500 });
    assert.equal(rows.filter((row) => row.sender === 'user').length, 20);
    assert.equal(rows.filter((row) => row.sender === 'assistant').length, 21);
    assert.equal(rows[0].model, 'yaar-greeting', 'the greeting is seeded first');
    assert.equal(usageService.getUsageState(USER).used, 20);
  });

  test('rejects message 21 with the limit error and usage details', () => {
    assert.throws(
      () => chatService.beginTurn({ userId: USER, companionId: COMPANION, content: 'message 21' }),
      (error) => {
        assert.equal(error.status, 429);
        assert.equal(error.code, 'daily_limit_reached');
        assert.equal(error.details.usage.used, 20);
        assert.equal(error.details.usage.remaining, 0);
        return true;
      },
    );
  });

  test('a rejected message is never stored', () => {
    const rows = getDb()
      .prepare("SELECT COUNT(*) AS count FROM messages WHERE content = 'message 21'")
      .get();
    assert.equal(rows.count, 0);
    assert.equal(usageService.getUsageState(USER).used, 20);
  });

  test('a window rollover frees the allowance again', () => {
    // Simulate 24 hours passing by moving the stored window into the past.
    const past = Date.now() - 25 * 60 * 60 * 1000;
    getDb()
      .prepare(
        'UPDATE usage_limits SET window_started_at = ?, window_expires_at = ? WHERE user_id = ?',
      )
      .run(past, past + 1000, USER);

    const usage = usageService.getUsageState(USER);
    assert.equal(usage.used, 0, 'the counter resets once the window has passed');
    assert.equal(usage.exhausted, false);

    const turn = chatService.beginTurn({ userId: USER, companionId: COMPANION, content: 'new day' });
    assert.equal(turn.usage.used, 1);
  });

  test('a refund gives the message back after an AI failure', () => {
    const before = usageService.getUsageState(USER).used;
    const turn = chatService.beginTurn({
      userId: USER,
      companionId: COMPANION,
      content: 'this one will fail',
    });
    assert.equal(turn.usage.used, before + 1);

    const refunded = chatService.refundTurn(USER);
    assert.equal(refunded.used, before);

    // Refunds never push the counter below zero.
    chatService.refundTurn(USER);
    chatService.refundTurn(USER);
    assert.equal(usageService.getUsageState(USER).used, 0);
  });

  test('usage is tracked per user', () => {
    assert.equal(usageService.getUsageState(OTHER_USER).used, 0);
    const turn = chatService.beginTurn({
      userId: OTHER_USER,
      companionId: COMPANION,
      content: 'hi from another device',
    });
    assert.equal(turn.usage.used, 1);
    assert.equal(usageService.getUsageState(USER).used, 0, 'the first user is unaffected');
  });

  test('resending with the same clientMessageId never consumes a second credit', () => {
    const clientMessageId = 'client-message-id-abc-123';
    const first = chatService.beginTurn({
      userId: OTHER_USER,
      companionId: COMPANION,
      content: 'did this arrive?',
      clientMessageId,
    });
    assert.equal(first.duplicate, false);
    assert.equal(first.usage.used, 2);

    const second = chatService.beginTurn({
      userId: OTHER_USER,
      companionId: COMPANION,
      content: 'did this arrive?',
      clientMessageId,
    });
    assert.equal(second.duplicate, true);
    assert.equal(second.usage.used, 2, 'the retry must not be counted again');

    // And only one copy of the message exists.
    const rows = messagesRepo.listMessages(first.conversation.id, { limit: 500 });
    assert.equal(rows.filter((row) => row.id === clientMessageId).length, 1);
  });

  test('remaining window time is reported for the UI', () => {
    const usage = usageService.getUsageState(OTHER_USER);
    assert.ok(usage.msUntilReset > 0);
    assert.ok(usage.msUntilReset <= 24 * 60 * 60 * 1000);
    assert.equal(typeof usage.resetAt, 'number');
  });
});
