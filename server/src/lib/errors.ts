import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export const badRequest = (code = 'bad_request', message?: string, extra?: Record<string, unknown>) =>
  new HttpError(400, code, message, extra);
export const unauthorized = (code = 'unauthorized', message?: string) => new HttpError(401, code, message);
export const forbidden = (code = 'forbidden', message?: string) => new HttpError(403, code, message);
export const notFound = (code = 'not_found', message?: string) => new HttpError(404, code, message);
export const conflict = (code = 'conflict', message?: string) => new HttpError(409, code, message);
export const tooMany = (code = 'rate_limited', retryAfter?: number) =>
  new HttpError(429, code, 'Slow down', retryAfter === undefined ? undefined : { retryAfter });

/** Validate input with zod; throws a 400 listing the invalid fields. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      throw badRequest('invalid_body', 'Invalid input', {
        fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    throw err;
  }
}

/** Route params are strings; turn ":id" into a positive integer or 404. */
export function intParam(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw notFound();
  return n;
}
