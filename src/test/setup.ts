import crypto from 'crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

process.env.RSA_PRIVATE_KEY_BASE64 = Buffer.from(privateKey).toString('base64');
process.env.RSA_PUBLIC_KEY_BASE64 = Buffer.from(publicKey).toString('base64');
process.env.NODE_ENV = 'test';
