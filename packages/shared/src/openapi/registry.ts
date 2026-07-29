import { createDocument } from 'zod-openapi';
import type { ZodOpenApiOperationObject, ZodOpenApiPathsObject } from 'zod-openapi';
import type { ZodObject } from 'zod';

import type { RouteDef } from '../route.js';

export interface OpenApiInfo {
  title: string;
  version: string;
  description: string;
  /**
   * When set, the scheme is registered and applied to every operation
   * except those whose path is listed in `publicPaths`.
   */
  bearerAuth?: { publicPaths: string[] };
}

/** `/accounts/:accountId` → `/accounts/{accountId}` */
function toOpenApiPath(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function buildOpenApiDocument(defs: RouteDef[], info: OpenApiInfo) {
  const paths: ZodOpenApiPathsObject = {};

  for (const def of defs) {
    const secured = info.bearerAuth && !info.bearerAuth.publicPaths.includes(def.path);
    const operation: ZodOpenApiOperationObject = {
      summary: def.summary,
      tags: def.tags,
      ...(secured && { security: [{ bearerAuth: [] }] }),
      requestParams: {
        ...(def.request?.params && { path: def.request.params as ZodObject }),
        ...(def.request?.query && { query: def.request.query as ZodObject }),
        ...(def.request?.headers && { header: def.request.headers as ZodObject }),
      },
      ...(def.request?.body && {
        requestBody: { content: { 'application/json': { schema: def.request.body } } },
      }),
      responses: Object.fromEntries(
        Object.entries(def.responses).map(([status, response]) => [
          status,
          {
            description: response.description,
            ...(response.schema && {
              content: { 'application/json': { schema: response.schema } },
            }),
          },
        ]),
      ),
    };

    const path = toOpenApiPath(def.path);
    paths[path] = { ...paths[path], [def.method]: operation };
  }

  return createDocument({
    openapi: '3.1.0',
    info: { title: info.title, version: info.version, description: info.description },
    paths,
    ...(info.bearerAuth && {
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'JWT issued by the auth API (POST /auth/login)',
          },
        },
      },
    }),
  });
}
