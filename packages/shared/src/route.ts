import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ZodType, output } from 'zod';

import { parseRequest } from './middleware/validate.js';

export interface RouteResponse {
  description: string;
  schema?: ZodType;
}

export interface RouteRequest {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
  headers?: ZodType;
}

export interface RouteDef<TRequest extends RouteRequest = RouteRequest> {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Express-style path, e.g. `/accounts/:accountId`. */
  path: string;
  summary: string;
  tags: string[];
  request?: TRequest;
  responses: Record<number, RouteResponse>;
  handler: (
    input: ValidatedInput<TRequest>,
    req: Request,
    res: Response,
  ) => Promise<{ status: number; body?: unknown }>;
}

export type ValidatedInput<TRequest extends RouteRequest> = {
  params: TRequest['params'] extends ZodType ? output<TRequest['params']> : unknown;
  query: TRequest['query'] extends ZodType ? output<TRequest['query']> : unknown;
  body: TRequest['body'] extends ZodType ? output<TRequest['body']> : unknown;
  headers: TRequest['headers'] extends ZodType ? output<TRequest['headers']> : unknown;
};

/** Identity helper that preserves the request schemas' inferred types. */
export function defineRoute<const TRequest extends RouteRequest>(
  def: RouteDef<TRequest>,
): RouteDef {
  return def;
}

/** Mounts route definitions onto a fresh Express router with validation applied. */
export function mountRoutes(defs: RouteDef[]): Router {
  const router = Router();
  for (const def of defs) {
    // Express 5 forwards rejected promises to the error middleware automatically.
    router[def.method](def.path, async (req, res) => {
      const input = parseRequest(def.request, req);
      const result = await def.handler(input, req, res);
      res.status(result.status).json(result.body);
    });
  }
  return router;
}
