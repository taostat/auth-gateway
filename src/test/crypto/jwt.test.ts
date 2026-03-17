import { cryptoWaitReady } from '@polkadot/util-crypto';
import jwt from 'jsonwebtoken';

import { config } from '../../config';
import { loadKeys, getPrivateKey } from '../../crypto/keys';
import { createAccessToken, createRefreshToken, createAuthCode, createIdToken, computeAtHash, verifyToken, verifyIdToken } from '../../crypto/jwt';

beforeAll(async () => {
  await cryptoWaitReady();
  loadKeys();
});

describe('JWT', () => {
  const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'; // Alice

  test('createAccessToken returns a valid JWT', () => {
    const token = createAccessToken(address, []);
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe(address);
    expect(decoded.type).toBe('access');
    expect(decoded.scope).toBe('');
    expect(decoded.iss).toBe(config.jwtIssuer);
    expect(decoded.aud).toBe('bittensor-apps');
  });

  test('createAccessToken includes scope', () => {
    const scopes = ['subnet:1:miner', 'subnet:2:validator'];
    const token = createAccessToken(address, scopes);
    const decoded = verifyToken(token);
    expect(decoded.scope).toBe('subnet:1:miner subnet:2:validator');
  });

  test('createRefreshToken has type refresh', () => {
    const token = createRefreshToken(address, []);
    const decoded = verifyToken(token);
    expect(decoded.type).toBe('refresh');
    expect(decoded.sub).toBe(address);
  });

  test('createAuthCode has type auth_code and short expiry', () => {
    const token = createAuthCode(address, ['subnet:1:miner']);
    const decoded = verifyToken(token);
    expect(decoded.type).toBe('auth_code');
    expect(decoded.scope).toBe('subnet:1:miner');
    // Auth code expires in 30s
    expect(decoded.exp - decoded.iat).toBe(30);
  });

  test('verifyToken rejects expired token', () => {
    const token = jwt.sign(
      { sub: address, scopes: [], type: 'access' },
      getPrivateKey(),
      { algorithm: 'RS256', issuer: config.jwtIssuer, audience: 'bittensor-apps', expiresIn: -10 },
    );
    expect(() => verifyToken(token)).toThrow();
  });

  test('verifyToken rejects wrong algorithm (HS256)', () => {
    const token = jwt.sign(
      { sub: address, scopes: [], type: 'access' },
      'some-secret',
      { algorithm: 'HS256', issuer: config.jwtIssuer, audience: 'bittensor-apps', expiresIn: 900 },
    );
    expect(() => verifyToken(token)).toThrow();
  });

  test('verifyToken rejects wrong issuer', () => {
    const token = jwt.sign(
      { sub: address, scopes: [], type: 'access' },
      getPrivateKey(),
      { algorithm: 'RS256', issuer: 'wrong-issuer', audience: 'bittensor-apps', expiresIn: 900 },
    );
    expect(() => verifyToken(token)).toThrow();
  });

  test('createIdToken has type id, aud is client_id, and includes at_hash', () => {
    const accessToken = createAccessToken(address, ['subnet:1:miner']);
    const authTime = Math.floor(Date.now() / 1000);
    const idToken = createIdToken(address, ['subnet:1:miner'], accessToken, {
      client_id: 'my-client', auth_time: authTime,
    });
    const decoded = verifyIdToken(idToken, 'my-client');
    expect(decoded.type).toBe('id');
    expect(decoded.sub).toBe(address);
    expect(decoded.aud).toBe('my-client');
    expect(decoded.at_hash).toBe(computeAtHash(accessToken));
    expect(decoded.auth_time).toBe(authTime);
  });

  test('createIdToken includes nonce when provided', () => {
    const accessToken = createAccessToken(address, []);
    const idToken = createIdToken(address, [], accessToken, {
      client_id: 'my-client', auth_time: Math.floor(Date.now() / 1000), nonce: 'test-nonce',
    });
    const decoded = verifyIdToken(idToken, 'my-client');
    expect(decoded.nonce).toBe('test-nonce');
  });

  test('createIdToken omits nonce when not provided', () => {
    const accessToken = createAccessToken(address, []);
    const idToken = createIdToken(address, [], accessToken, {
      client_id: 'my-client', auth_time: Math.floor(Date.now() / 1000),
    });
    const decoded = verifyIdToken(idToken, 'my-client');
    expect(decoded.nonce).toBeUndefined();
  });

  test('verifyIdToken rejects wrong audience', () => {
    const accessToken = createAccessToken(address, []);
    const idToken = createIdToken(address, [], accessToken, {
      client_id: 'my-client', auth_time: Math.floor(Date.now() / 1000),
    });
    expect(() => verifyIdToken(idToken, 'wrong-client')).toThrow();
  });

  test('computeAtHash returns left half of SHA-256 base64url', () => {
    const hash = computeAtHash('test-token');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(0);
    // base64url: no +, /, or = characters
    expect(hash).not.toMatch(/[+/=]/);
  });

  test('createAuthCode includes nonce when provided', () => {
    const token = createAuthCode(address, [], { nonce: 'oidc-nonce-123' });
    const decoded = verifyToken(token);
    expect(decoded.nonce).toBe('oidc-nonce-123');
  });

  test('access and refresh tokens have different expiry', () => {
    const access = createAccessToken(address, []);
    const refresh = createRefreshToken(address, []);
    const accessDecoded = verifyToken(access);
    const refreshDecoded = verifyToken(refresh);
    const accessExpiry = accessDecoded.exp - accessDecoded.iat;
    const refreshExpiry = refreshDecoded.exp - refreshDecoded.iat;
    expect(refreshExpiry).toBeGreaterThan(accessExpiry);
  });

  test('evm_address claim is included when provided', () => {
    const evmAddr = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const token = createAccessToken(evmAddr, ['openid'], {
      evm_address: evmAddr,
      hotkey: null,
      coldkey: null,
    });
    const decoded = verifyToken(token);
    expect(decoded.evm_address).toBe(evmAddr);
    expect(decoded.hotkey).toBeNull();
    expect(decoded.coldkey).toBeNull();
  });

  test('evm_address is null when not provided', () => {
    const token = createAccessToken(address, []);
    const decoded = verifyToken(token);
    expect(decoded.evm_address).toBeNull();
  });

  test('evm_address in refresh token', () => {
    const evmAddr = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const token = createRefreshToken(evmAddr, ['openid'], {
      evm_address: evmAddr,
    });
    const decoded = verifyToken(token);
    expect(decoded.evm_address).toBe(evmAddr);
  });

  test('evm_address in auth code', () => {
    const evmAddr = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const token = createAuthCode(evmAddr, ['openid'], {
      evm_address: evmAddr,
    });
    const decoded = verifyToken(token);
    expect(decoded.evm_address).toBe(evmAddr);
  });

  test('evm_address in id token', () => {
    const evmAddr = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
    const accessToken = createAccessToken(evmAddr, ['openid'], { evm_address: evmAddr });
    const idToken = createIdToken(evmAddr, ['openid'], accessToken, {
      client_id: 'evm-client',
      auth_time: Math.floor(Date.now() / 1000),
      evm_address: evmAddr,
    });
    const decoded = verifyIdToken(idToken, 'evm-client');
    expect(decoded.evm_address).toBe(evmAddr);
  });
});
