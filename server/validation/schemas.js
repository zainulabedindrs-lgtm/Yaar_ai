/**
 * Request schemas (zod).
 *
 * Routes parse with these so every handler receives already-validated data.
 * Message text is additionally put through `sanitiseMessage`.
 */

import { z } from 'zod';

import { MAX_MESSAGE_LENGTH } from '../../shared/errors.js';
import { ApiError } from '../utils/errors.js';

export const companionIdSchema = z.enum(['girlfriend', 'boyfriend']);

export const sendMessageSchema = z.object({
  // Length is enforced by `validateMessage`, which distinguishes "empty" from
  // "too long" with dedicated error codes; the bound here is just a hard cap.
  content: z.string().max(MAX_MESSAGE_LENGTH * 4),
  /** Optional client-generated id — makes retries idempotent. */
  clientMessageId: z.string().min(8).max(64).optional(),
  /** Client preference; the server decides based on AI_STREAMING too. */
  stream: z.boolean().optional(),
});

export const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  before: z.coerce.number().int().min(1).optional(),
});

export const profileSchema = z.object({
  displayName: z.string().max(40).nullable().optional(),
});

/**
 * Parses `data` with `schema` or throws a user-safe 422 ApiError.
 * @template T
 * @param {{ safeParse: (data: unknown) => { success: true, data: T } | { success: false, error: { issues: { path: (string|number)[], message: string }[] } } }} schema
 * @param {unknown} data
 * @returns {T}
 */
export function parseOrThrow(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  const path = first?.path?.join('.') ?? '';
  const message = `${path ? `${path}: ` : ''}${first?.message ?? 'Invalid request'}`;
  throw ApiError.validation(message);
}
