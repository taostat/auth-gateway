import { detectSignMethod, isValidEvmAddress, normalizeEvmAddress, isValidAddress } from '../../crypto/address';

describe('Address Utilities', () => {
  const VALID_EVM = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  const VALID_SS58 = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

  describe('detectSignMethod', () => {
    test('detects EVM address', () => {
      expect(detectSignMethod(VALID_EVM)).toBe('evm');
      expect(detectSignMethod('0x' + 'ab'.repeat(20))).toBe('evm');
    });

    test('detects sr25519 address', () => {
      expect(detectSignMethod(VALID_SS58)).toBe('sr25519');
    });

    test('non-0x address defaults to sr25519', () => {
      expect(detectSignMethod('not-an-address')).toBe('sr25519');
    });

    test('0x prefix with wrong length defaults to sr25519', () => {
      expect(detectSignMethod('0x1234')).toBe('sr25519');
    });
  });

  describe('isValidEvmAddress', () => {
    test('valid EVM address returns true', () => {
      expect(isValidEvmAddress(VALID_EVM)).toBe(true);
    });

    test('lowercase valid EVM address returns true', () => {
      expect(isValidEvmAddress(VALID_EVM.toLowerCase())).toBe(true);
    });

    test('invalid address returns false', () => {
      expect(isValidEvmAddress('0xinvalid')).toBe(false);
      expect(isValidEvmAddress('not-evm')).toBe(false);
    });
  });

  describe('normalizeEvmAddress', () => {
    test('converts to EIP-55 checksum', () => {
      const lower = VALID_EVM.toLowerCase();
      const normalized = normalizeEvmAddress(lower);
      expect(normalized).toBe(VALID_EVM);
    });
  });

  describe('isValidAddress', () => {
    test('validates EVM address with evm method', () => {
      expect(isValidAddress(VALID_EVM, 'evm')).toBe(true);
      expect(isValidAddress('0xinvalid', 'evm')).toBe(false);
    });

    test('validates SS58 address with sr25519 method', () => {
      expect(isValidAddress(VALID_SS58, 'sr25519')).toBe(true);
      expect(isValidAddress('invalid-ss58', 'sr25519')).toBe(false);
    });
  });
});
