import type { Request } from 'express';

import type { RouteRequest, ValidatedInput } from '../route.js';

/**
 * Validates an incoming request against the route's Zod schemas.
 * Throws ZodError (handled by the error middleware as a 400) on failure.
 */
export function parseRequest<TRequest extends RouteRequest>(
  request: TRequest | undefined,
  req: Request,
): ValidatedInput<TRequest> {
  return {
    params: request?.params ? request.params.parse(req.params) : req.params,
    query: request?.query ? request.query.parse(req.query) : req.query,
    body: request?.body ? request.body.parse(req.body) : (req.body as unknown),
    headers: request?.headers ? request.headers.parse(req.headers) : req.headers,
  } as ValidatedInput<TRequest>;
}
