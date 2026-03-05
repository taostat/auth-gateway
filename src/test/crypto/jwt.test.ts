import { cryptoWaitReady } from '@polkadot/util-crypto';
import jwt from 'jsonwebtoken';

import { loadKeys, getPublicKey, getPrivateKey } from '../../crypto/keys';
import { createAccessToken, createRefreshToken, createAuthCode, verifyToken } from '../../crypto/jwt';

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
    expect(decoded.scopes).toEqual([]);
    expect(decoded.iss).toBe('https://auth.taostats.io');
    expect(decoded.aud).toBe('bittensor-apps');
  });

  test('createAccessToken includes scopes', () => {
    const scopes = ['subnet:1:miner', 'subnet:2:validator'];
    const token = createAccessToken(address, scopes);
    const decoded = verifyToken(token);
    expect(decoded.scopes).toEqual(scopes);
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
    expect(decoded.scopes).toEqual(['subnet:1:miner']);
    // Auth code expires in 30s
    expect(decoded.exp - decoded.iat).toBe(30);
  });

  test('verifyToken rejects expired token', () => {
    const token = jwt.sign(
      { sub: address, scopes: [], type: 'access' },
      getPrivateKey(),
      { algorithm: 'RS256', issuer: 'https://auth.taostats.io', audience: 'bittensor-apps', expiresIn: -10 },
    );
    expect(() => verifyToken(token)).toThrow();
  });

  test('verifyToken rejects wrong algorithm (HS256)', () => {
    const token = jwt.sign(
      { sub: address, scopes: [], type: 'access' },
      'some-secret',
      { algorithm: 'HS256', issuer: 'https://auth.taostats.io', audience: 'bittensor-apps', expiresIn: 900 },
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

  test('access and refresh tokens have different expiry', () => {
    const access = createAccessToken(address, []);
    const refresh = createRefreshToken(address, []);
    const accessDecoded = verifyToken(access);
    const refreshDecoded = verifyToken(refresh);
    const accessExpiry = accessDecoded.exp - accessDecoded.iat;
    const refreshExpiry = refreshDecoded.exp - refreshDecoded.iat;
    expect(refreshExpiry).toBeGreaterThan(accessExpiry);
  });
});
