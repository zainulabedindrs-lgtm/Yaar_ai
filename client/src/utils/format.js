/**
 * Formatting helpers shared by the chat UI, settings screen and usage meter.
 */

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
});

/**
 * "3:42 PM" for today, "12 Mar, 3:42 PM" for older messages.
 * @param {number} timestamp epoch ms
 */
export function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? TIME_FORMATTER.format(date)
    : `${DATE_FORMATTER.format(date)}, ${TIME_FORMATTER.format(date)}`;
}

/** Day separator label: "Today", "Yesterday" or a short date. */
export function formatDayLabel(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  if (date.getTime() >= startOfToday) return 'Today';
  if (date.getTime() >= startOfToday - day) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(date);
}

/** True when two timestamps fall on different calendar days. */
export function isDifferentDay(first, second) {
  const a = new Date(first);
  const b = new Date(second);
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}

/**
 * "4h 12m" / "38m" / "under a minute" — used by the limit card countdown.
 * @param {number} ms
 */
export function formatDuration(ms) {
  const safe = Math.max(0, ms);
  const totalMinutes = Math.floor(safe / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0 && minutes === 0) return 'less than a minute';
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/** Live countdown string from an absolute reset timestamp. */
export function timeUntil(resetAt, now = Date.now()) {
  return formatDuration(resetAt - now);
}

/** "12 / 20 messages used" */
export function usageLabel(usage) {
  if (!usage) return '';
  return `${usage.used} / ${usage.limit} messages used`;
}

/** Truncates long text for previews without breaking words mid-way. */
export function truncate(text, max = 120) {
  if (!text) return '';
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  return `${(lastSpace > 40 ? slice.slice(0, lastSpace) : slice).trimEnd()}…`;
}
