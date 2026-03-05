import crypto from 'crypto';

let testKeys: { privateKey: string; publicKey: string } | null = null;

export function getTestKeys(): { privateKey: string; publicKey: string } {
  if (testKeys) return testKeys;
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  testKeys = { privateKey, publicKey };
  return testKeys;
}
