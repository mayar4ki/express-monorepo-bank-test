import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import type { RouteDef } from '../route.js';
import { mergeOpenApiDocuments } from './merge.js';
import type { OpenApiDocument } from './merge.js';
import { buildOpenApiDocument } from './registry.js';
import type { OpenApiInfo } from './registry.js';

export interface DocsRouterOptions {
  /**
   * URLs of other services' OpenAPI documents to merge into this one, so a
   * gateway exposing several services on a single origin serves one combined
   * spec. On conflicts the local document wins (see mergeOpenApiDocuments).
   * A source that cannot be fetched is skipped and retried on the next
   * request, so services that start later still show up.
   */
  mergeSpecUrls?: string[];
}

async function fetchSpec(url: string): Promise<OpenApiDocument | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return (await response.json()) as OpenApiDocument;
  } catch {
    return undefined;
  }
}

export function createDocsRouter(
  defs: RouteDef[],
  info: OpenApiInfo,
  options: DocsRouterOptions = {},
): Router {
  const localDocument = buildOpenApiDocument(defs, info);
  const mergeSpecUrls = options.mergeSpecUrls ?? [];
  let cache: OpenApiDocument | undefined;

  async function getDocument(): Promise<OpenApiDocument> {
    if (mergeSpecUrls.length === 0) return localDocument;
    if (cache) return cache;
    const remotes = await Promise.all(mergeSpecUrls.map(fetchSpec));
    const merged = mergeOpenApiDocuments(
      localDocument,
      remotes.filter((doc): doc is OpenApiDocument => doc !== undefined),
    );
    // Cache only once every source answered, so a service that was still
    // starting up gets merged in on a later request instead of never.
    if (remotes.every(Boolean)) cache = merged;
    return merged;
  }

  const router = Router();
  router.get('/docs/openapi.json', (_req, res, next) => {
    getDocument().then((document) => res.json(document), next);
  });
  // The UI loads the spec from the JSON endpoint (instead of an inlined copy)
  // so it always reflects the current merge result.
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(null, { swaggerOptions: { url: '/docs/openapi.json' } }),
  );
  return router;
}
