import { defineRoute, errorEnvelope } from '@bank/shared';

import type { SigningKeys } from '../../lib/keys.js';
import { signToken, verifyToken } from '../../lib/tokens.js';
import type { TokenConfig } from '../../lib/tokens.js';
import type { AuthService } from './service.js';
import {
  authHeaders,
  jwksResponse,
  loginBody,
  meResponse,
  registerBody,
  tokenResponse,
  userResponse,
} from './schemas.js';

export function authRoutes(service: AuthService, keys: SigningKeys, tokenConfig: TokenConfig) {
  return [
    defineRoute({
      method: 'post',
      path: '/auth/register',
      summary: 'Register a bank employee account',
      tags: ['Auth'],
      request: { body: registerBody },
      responses: {
        201: { description: 'User created', schema: userResponse },
        400: { description: 'Validation error', schema: errorEnvelope },
        409: { description: 'Email already registered', schema: errorEnvelope },
      },
      handler: async ({ body }) => {
        const user = await service.register(body);
        return {
          status: 201,
          body: { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt },
        };
      },
    }),

    defineRoute({
      method: 'post',
      path: '/auth/login',
      summary: 'Log in and receive a JWT for the banking API',
      tags: ['Auth'],
      request: { body: loginBody },
      responses: {
        200: { description: 'Signed JWT', schema: tokenResponse },
        400: { description: 'Validation error', schema: errorEnvelope },
        401: { description: 'Invalid credentials', schema: errorEnvelope },
      },
      handler: async ({ body }) => {
        const user = await service.verifyCredentials(body.email, body.password);
        const token = await signToken(keys, tokenConfig, user);
        return {
          status: 200,
          body: { token, tokenType: 'Bearer' as const, expiresIn: tokenConfig.ttlSeconds },
        };
      },
    }),

    defineRoute({
      method: 'get',
      path: '/auth/me',
      summary: 'Return the user behind the presented token',
      tags: ['Auth'],
      request: { headers: authHeaders },
      responses: {
        200: { description: 'The authenticated user', schema: meResponse },
        400: { description: 'Missing/malformed Authorization header', schema: errorEnvelope },
        401: { description: 'Invalid or expired token', schema: errorEnvelope },
      },
      handler: async ({ headers }) => {
        const token = headers.authorization.slice('Bearer '.length);
        const claims = await verifyToken(keys, tokenConfig, token);
        const user = await service.getById(claims.id);
        return { status: 200, body: { id: user.id, email: user.email, name: user.name } };
      },
    }),

    defineRoute({
      method: 'get',
      path: '/.well-known/jwks.json',
      summary: 'Public signing keys (JWKS) used to verify issued JWTs',
      tags: ['Auth'],
      responses: { 200: { description: 'JSON Web Key Set', schema: jwksResponse } },
      handler: () => Promise.resolve({ status: 200, body: { keys: [keys.publicJwk] } }),
    }),
  ];
}
