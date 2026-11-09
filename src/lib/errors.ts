import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Every error the API raises on purpose. `handleError` turns it into one JSON shape. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const unauthenticated = (message: string) => new ApiError(401, 'UNAUTHENTICATED', message);
export const forbidden = () => new ApiError(403, 'FORBIDDEN', 'Your role cannot do this');
export const notOwner = (message: string) => new ApiError(403, 'NOT_OWNER', message);
export const notFound = (what: string) => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const validationError = (fields: Record<string, string>) =>
  new ApiError(400, 'VALIDATION_ERROR', 'Some fields are invalid', fields);

export function handleError(err: Error, c: Context) {
  if (err instanceof ApiError) {
    if (err.code === 'UNAUTHENTICATED') c.header('WWW-Authenticate', 'Bearer');
    return c.json(
      { error: err.message, code: err.code, ...(err.fields ? { fields: err.fields } : {}) },
      err.status,
    );
  }
  console.error(err);
  return c.json({ error: 'Something went wrong', code: 'INTERNAL_ERROR' }, 500);
}

// D1 reports constraint failures only as message text.
export const isUniqueViolation = (err: unknown) =>
  err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
export const isCheckViolation = (err: unknown) =>
  err instanceof Error && /CHECK constraint failed/i.test(err.message);
