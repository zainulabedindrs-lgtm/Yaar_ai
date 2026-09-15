/** Formatting helpers used across the chat UI, settings and the usage meter. */

import { describe, expect, it } from 'vitest';

import {
  formatDayLabel,
  formatDuration,
  formatMessageTime,
  isDifferentDay,
  timeUntil,
  truncate,
  usageLabel,
} from '../../client/src/utils/format.js';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

describe('formatDuration', () => {
  it('formats hours and minutes', () => {
    expect(formatDuration(4 * HOUR + 12 * MINUTE)).toBe('4h 12m');
    expect(formatDuration(3 * HOUR)).toBe('3h');
    expect(formatDuration(38 * MINUTE)).toBe('38 min');
  });

  it('never shows a negative duration', () => {
    expect(formatDuration(-5000)).toBe('less than a minute');
    expect(formatDuration(20_000)).toBe('less than a minute');
  });
});

describe('timeUntil', () => {
  it('computes the remaining time from an absolute reset timestamp', () => {
    const now = Date.now();
    expect(timeUntil(now + 2 * HOUR, now)).toBe('2h');
    expect(timeUntil(now - 1000, now)).toBe('less than a minute');
  });
});

describe('usageLabel', () => {
  it('renders the counter the way the UI shows it', () => {
    expect(usageLabel({ used: 12, limit: 20 })).toBe('12 / 20 messages used');
    expect(usageLabel(null)).toBe('');
  });
});

describe('day labels', () => {
  it('labels today and yesterday', () => {
    expect(formatDayLabel(Date.now())).toBe('Today');
    expect(formatDayLabel(Date.now() - 24 * HOUR)).toBe('Yesterday');
  });

  it('detects a day change between two messages', () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * HOUR);
    expect(isDifferentDay(yesterday.getTime(), today.getTime())).toBe(true);
    expect(isDifferentDay(today.getTime(), today.getTime() + 1000)).toBe(false);
  });
});

describe('formatMessageTime', () => {
  it('returns an empty string for a missing timestamp', () => {
    expect(formatMessageTime(null)).toBe('');
    expect(formatMessageTime(0)).toBe('');
  });

  it('formats a timestamp into something readable', () => {
    const formatted = formatMessageTime(Date.now());
    expect(formatted).toMatch(/\d/);
    expect(formatted.length).toBeGreaterThan(2);
  });
});

describe('truncate', () => {
  it('keeps short text untouched', () => {
    expect(truncate('short text', 40)).toBe('short text');
  });

  it('cuts on a word boundary instead of mid-word', () => {
    const text = 'the quick brown fox jumps over the lazy dog again and again';
    const result = truncate(text, 30);
    expect(result.endsWith('…')).toBe(true);
    expect(result).not.toMatch(/\s…$/);
    expect(text.startsWith(result.slice(0, -1).trim())).toBe(true);
  });

  it('handles empty input', () => {
    expect(truncate('', 10)).toBe('');
    expect(truncate(null, 10)).toBe('');
  });
});
