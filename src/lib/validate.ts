import type { Context } from 'hono';
import { z } from 'zod';

import { validationError } from './errors';

/** Turns zod's issues into `{ field: message }`, naming each unknown field individually. */
export function toFields(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields[[...issue.path, key].join('.')] = 'Unknown field';
      continue;
    }
    fields[issue.path.join('.') || 'body'] ??= issue.message;
  }
  return fields;
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw validationError(toFields(result.error));
  return result.data;
}

export async function parseJsonBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.output<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw validationError({ body: 'Send a valid JSON body' });
  }
  return parse(schema, body);
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.output<T> {
  return parse(schema, c.req.query());
}

export const paginationFields = {
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
};
