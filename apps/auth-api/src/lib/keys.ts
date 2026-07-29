import { readFileSync } from 'node:fs';

import { calculateJwkThumbprint, exportJWK, generateKeyPair, importPKCS8 } from 'jose';
import type { CryptoKey, JWK } from 'jose';
import type { Logger } from 'pino';

export const JWT_ALG = 'ES256';

export interface SigningKeys {
  privateKey: CryptoKey;
  /** Public JWK as served by /.well-known/jwks.json (includes kid/alg/use). */
  publicJwk: JWK;
  kid: string;
}

async function toSigningKeys(privateKey: CryptoKey, publicKey: CryptoKey): Promise<SigningKeys> {
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  return {
    privateKey,
    kid,
    publicJwk: { ...publicJwk, kid, alg: JWT_ALG, use: 'sig' },
  };
}

/**
 * Loads the JWT signing key:
 *  1. JWT_PRIVATE_KEY_FILE — path to an ES256 PKCS8 PEM (how compose mounts it)
 *  2. JWT_PRIVATE_KEY      — the PEM inline
 *  3. outside production   — an ephemeral keypair (tokens die on restart)
 * Production without a configured key refuses to start.
 */
export async function loadSigningKeys(env: {
  NODE_ENV: string;
  JWT_PRIVATE_KEY_FILE?: string | undefined;
  JWT_PRIVATE_KEY?: string | undefined;
  logger?: Logger;
}): Promise<SigningKeys> {
  const pem = env.JWT_PRIVATE_KEY_FILE
    ? readFileSync(env.JWT_PRIVATE_KEY_FILE, 'utf8')
    : env.JWT_PRIVATE_KEY;

  if (pem) {
    const privateKey = await importPKCS8(pem, JWT_ALG, { extractable: true });
    // Derive the public JWK from the private key material.
    const privateJwk = await exportJWK(privateKey);
    const publicJwkRaw = { ...privateJwk };
    delete publicJwkRaw.d;
    const kid = await calculateJwkThumbprint(publicJwkRaw);
    return {
      privateKey,
      kid,
      publicJwk: { ...publicJwkRaw, kid, alg: JWT_ALG, use: 'sig' },
    };
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_PRIVATE_KEY or JWT_PRIVATE_KEY_FILE must be set in production (ES256 PKCS8 PEM)',
    );
  }

  env.logger?.warn(
    'no JWT signing key configured — using an ephemeral keypair (all tokens expire on restart)',
  );
  const { privateKey, publicKey } = await generateKeyPair(JWT_ALG, { extractable: true });
  return toSigningKeys(privateKey, publicKey);
}
