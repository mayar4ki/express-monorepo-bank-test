import type { RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { UnauthorizedError } from '@bank/shared';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/** Seam between the app and token verification — tests inject a local-key
 *  implementation, production uses the remote JWKS one below. */
export interface TokenVerifier {
  verify(token: string): Promise<AuthUser>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

/**
 * Verifies tokens against the auth API's JWKS endpoint. jose caches the
 * key set and refetches on unknown `kid`, so key rotation just works.
 */
export function createRemoteJwksVerifier(opts: {
  jwksUrl: string;
  issuer: string;
  audience: string;
}): TokenVerifier {
  const jwks = createRemoteJWKSet(new URL(opts.jwksUrl));
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: ['ES256'],
        });
        return {
          id: String(payload.sub),
          email: String(payload.email),
          name: String(payload.name),
        };
      } catch {
        throw new UnauthorizedError('UNAUTHORIZED', 'Invalid or expired token');
      }
    },
  };
}

/**
 * Requires `Authorization: Bearer <jwt>` on every route except the listed
 * public path prefixes. The verified user lands on `req.auth`.
 */
export function requireAuth(
  verifier: TokenVerifier,
  opts: { publicPathPrefixes: string[] },
): RequestHandler {
  return async (req, _res, next) => {
    if (
      opts.publicPathPrefixes.some(
        (prefix) => req.path === prefix || req.path.startsWith(`${prefix}/`),
      )
    ) {
      next();
      return;
    }

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedError(
        'UNAUTHORIZED',
        'Missing bearer token; log in via the auth API and send Authorization: Bearer <token>',
      );
    }

    req.auth = await verifier.verify(header.slice('Bearer '.length));
    next();
  };
}
