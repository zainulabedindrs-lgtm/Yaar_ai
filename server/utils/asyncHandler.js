/**
 * `asyncHandler` — forwards rejected promises from async route handlers to the
 * Express error middleware (Express 5 does this natively, but being explicit
 * keeps the behaviour identical if Yaar is ever mounted in another framework).
 */

/**
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown>} handler
 * @returns {import('express').RequestHandler}
 */
export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
