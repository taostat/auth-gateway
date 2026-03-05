import fs from 'fs';
import crypto from 'crypto';
import { config } from '../config';

let privateKey: string;
let publicKey: string;
let jwks: object;
let kid: string;

export function loadKeys(): { privateKey: string; publicKey: string } {
  if (config.rsaPrivateKeyBase64 && config.rsaPublicKeyBase64) {
    privateKey = Buffer.from(config.rsaPrivateKeyBase64, 'base64').toString('utf-8');
    publicKey = Buffer.from(config.rsaPublicKeyBase64, 'base64').toString('utf-8');
  } else if (config.rsaPrivateKeyPath && config.rsaPublicKeyPath) {
    privateKey = fs.readFileSync(config.rsaPrivateKeyPath, 'utf-8');
    publicKey = fs.readFileSync(config.rsaPublicKeyPath, 'utf-8');
  } else {
    throw new Error('RSA keys not configured. Set RSA_PRIVATE_KEY_BASE64/RSA_PUBLIC_KEY_BASE64 or RSA_PRIVATE_KEY_PATH/RSA_PUBLIC_KEY_PATH');
  }
  return { privateKey, publicKey };
}

export function getPrivateKey(): string {
  if (!privateKey) throw new Error('Keys not loaded. Call loadKeys() first.');
  return privateKey;
}

export function getPublicKey(): string {
  if (!publicKey) throw new Error('Keys not loaded. Call loadKeys() first.');
  return publicKey;
}

export function getJwks(): object {
  if (jwks) return jwks;
  const pub = getPublicKey();
  const keyObject = crypto.createPublicKey(pub);
  const jwk = keyObject.export({ format: 'jwk' });
  // Generate a kid from thumbprint of the key
  const thumbprint = crypto
    .createHash('sha256')
    .update(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n }))
    .digest('base64url');
  kid = thumbprint;
  jwks = {
    keys: [
      {
        kty: jwk.kty,
        use: 'sig',
        alg: 'RS256',
        kid: thumbprint,
        n: jwk.n,
        e: jwk.e,
      },
    ],
  };
  return jwks;
}

export function getKid(): string {
  if (!kid) getJwks();
  return kid;
}
