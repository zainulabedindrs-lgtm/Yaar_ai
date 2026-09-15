/**
 * Central error handling.
 *
 * Anything that reaches this middleware is converted into a small, safe JSON
 * payload: `{ error: { code, message, details? } }`. Raw exceptions, provider
 * responses and stack traces are logged server-side only.
 */

import { ERROR_CODES, ERROR_MESSAGES } from '../../shared/errors.js';
import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** 404 handler for unknown /api routes. */
export function apiNotFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: ERROR_CODES.NOT_FOUND,
      message: `No API route for ${req.method} ${req.originalUrl}`,
    },
  });
}

/** @type {import('express').ErrorRequestHandler} */
export function errorHandler(error, req, res, _next) {
  let apiError;

  if (error instanceof ApiError) {
    apiError = error;
  } else if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    apiError = ApiError.badRequest(ERROR_CODES.VALIDATION, 'Malformed JSON body.');
  } else if (error?.type === 'entity.too.large') {
    apiError = new ApiError(413, ERROR_CODES.MESSAGE_TOO_LONG);
  } else {
    apiError = new ApiError(500, ERROR_CODES.SERVER, ERROR_MESSAGES[ERROR_CODES.SERVER]);
    logger.error('unhandled server error', {
      route: `${req.method} ${req.originalUrl}`,
      message: String(error?.message),
      stack: error?.stack?.split('\n').slice(0, 4).join(' | '),
    });
  }

  if (apiError.status >= 500) {
    logger.warn('api error response', {
      route: `${req.method} ${req.originalUrl}`,
      status: apiError.status,
      code: apiError.code,
    });
  }

  // Headers may already be sent when a streaming response fails midway.
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }

  res.status(apiError.status).json(apiError.toJSON());
}
