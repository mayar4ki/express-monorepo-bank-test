import type { ErrorRequestHandler, RequestHandler } from 'express';
// Type-only: brings in pino-http's `req.log` augmentation without a runtime dep.
import type {} from 'pino-http';
import { ZodError } from 'zod';

import { AppError, NotFoundError } from '../errors.js';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError('NOT_FOUND', `Route ${req.method} ${req.path} does not exist`));
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: {
          issues: err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
    });
    return;
  }

  req.log?.error({ err }, 'unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
};
