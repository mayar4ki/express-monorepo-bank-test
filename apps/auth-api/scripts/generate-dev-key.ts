/**
 * Generates an ES256 keypair and prints the private key as PKCS8 PEM —
 * paste it into JWT_PRIVATE_KEY or write it to a file for
 * JWT_PRIVATE_KEY_FILE. For local/dev use.
 */
import { exportPKCS8, generateKeyPair } from 'jose';

const { privateKey } = await generateKeyPair('ES256', { extractable: true });
console.log(await exportPKCS8(privateKey));
