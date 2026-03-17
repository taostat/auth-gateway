import { validateScopesForSignMethod } from '../../scopes';

describe('validateScopesForSignMethod', () => {
  test('sr25519 allows all scopes', () => {
    expect(() => validateScopesForSignMethod(['openid', 'subnet:1:miner'], 'sr25519')).not.toThrow();
  });

  test('evm allows openid', () => {
    expect(() => validateScopesForSignMethod(['openid'], 'evm')).not.toThrow();
  });

  test('evm allows empty scopes', () => {
    expect(() => validateScopesForSignMethod([], 'evm')).not.toThrow();
  });

  test('evm rejects subnet scopes', () => {
    expect(() => validateScopesForSignMethod(['subnet:1:miner'], 'evm'))
      .toThrow('not available for EVM wallets');
  });

  test('evm rejects tao:holder', () => {
    expect(() => validateScopesForSignMethod(['tao:holder'], 'evm'))
      .toThrow('not available for EVM wallets');
  });

  test('evm rejects mixed scopes', () => {
    expect(() => validateScopesForSignMethod(['openid', 'subnet:1:validator'], 'evm'))
      .toThrow('not available for EVM wallets');
  });
});
