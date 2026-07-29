import { SignJWT, importJWK, jwtVerify } from 'jose';

import { UnauthorizedError } from '@bank/shared';

import { JWT_ALG } from './keys.js';
import type { SigningKeys } from './keys.js';

export interface TokenConfig {
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

export interface TokenUser {
  id: string;
  email: string;
  name: string;
}

export async function signToken(
  keys: SigningKeys,
  config: TokenConfig,
  user: TokenUser,
): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: JWT_ALG, kid: keys.kid })
    .setSubject(String(user.id))
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime(`${config.ttlSeconds}s`)
    .sign(keys.privateKey);
}

/** Local verification against this service's own key (used by /auth/me). */
export async function verifyToken(
  keys: SigningKeys,
  config: TokenConfig,
  token: string,
): Promise<TokenUser> {
  try {
    const publicKey = await importJWK(keys.publicJwk, JWT_ALG);
    const { payload } = await jwtVerify(token, publicKey, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: [JWT_ALG],
    });
    return {
      id: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name),
    };
  } catch {
    throw new UnauthorizedError('UNAUTHORIZED', 'Invalid or expired token');
  }
}
