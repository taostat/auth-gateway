import {
  generateS256Challenge,
  verifyCodeVerifier,
  validateCodeVerifier,
  validateCodeChallenge,
} from '../../crypto/pkce';
import crypto from 'crypto';

describe('PKCE (RFC 7636)', () => {
  describe('generateS256Challenge', () => {
    test('generates base64url-encoded SHA256 hash', () => {
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const challenge = generateS256Challenge(verifier);

      // Verify it's base64url (no +, /, or = padding)
      expect(challenge).not.toMatch(/[+/=]/);
      expect(challenge.length).toBeGreaterThan(0);
    });

    test('is deterministic', () => {
      const verifier = 'test-verifier-string-that-is-long-enough-for-rfc';
      expect(generateS256Challenge(verifier)).toBe(generateS256Challenge(verifier));
    });

    test('matches known RFC 7636 test vector', () => {
      // RFC 7636 Appendix B
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
      expect(generateS256Challenge(verifier)).toBe(expected);
    });
  });

  describe('verifyCodeVerifier', () => {
    test('returns true for matching verifier/challenge pair', () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = generateS256Challenge(verifier);
      expect(verifyCodeVerifier(verifier, challenge)).toBe(true);
    });

    test('returns false for non-matching pair', () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = generateS256Challenge(verifier);
      const wrongVerifier = crypto.randomBytes(32).toString('base64url');
      expect(verifyCodeVerifier(wrongVerifier, challenge)).toBe(false);
    });

    test('returns false for mismatched challenge length', () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      // Challenge is a different length — timing-safe length check should handle this
      expect(verifyCodeVerifier(verifier, 'too-short')).toBe(false);
    });
  });

  describe('validateCodeVerifier', () => {
    test('accepts valid 43-character verifier', () => {
      const verifier = 'a'.repeat(43);
      expect(validateCodeVerifier(verifier)).toBe(true);
    });

    test('accepts valid 128-character verifier', () => {
      const verifier = 'a'.repeat(128);
      expect(validateCodeVerifier(verifier)).toBe(true);
    });

    test('accepts unreserved characters', () => {
      const verifier = 'abcABC012-._~'.padEnd(43, 'x');
      expect(validateCodeVerifier(verifier)).toBe(true);
    });

    test('rejects too-short verifier (42 chars)', () => {
      expect(validateCodeVerifier('a'.repeat(42))).toBe(false);
    });

    test('rejects too-long verifier (129 chars)', () => {
      expect(validateCodeVerifier('a'.repeat(129))).toBe(false);
    });

    test('rejects verifier with invalid characters', () => {
      const verifier = 'abc!@#$%^&*()'.padEnd(43, 'x');
      expect(validateCodeVerifier(verifier)).toBe(false);
    });

    test('rejects empty string', () => {
      expect(validateCodeVerifier('')).toBe(false);
    });
  });

  describe('validateCodeChallenge', () => {
    test('accepts valid 43-character base64url challenge', () => {
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = generateS256Challenge(verifier);
      expect(validateCodeChallenge(challenge)).toBe(true);
    });

    test('rejects challenge that is too short', () => {
      expect(validateCodeChallenge('abc')).toBe(false);
    });

    test('rejects challenge that is too long', () => {
      expect(validateCodeChallenge('a'.repeat(44))).toBe(false);
    });

    test('rejects challenge with invalid characters', () => {
      expect(validateCodeChallenge('a'.repeat(42) + '!')).toBe(false);
    });
  });
});
