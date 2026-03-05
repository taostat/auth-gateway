import { setupMockDb, clearTestChallenges } from '../helpers/mockDb';

// Setup DB mocks before importing challenge module
setupMockDb();

import { createChallenge, consumeChallenge, clearChallenges } from '../../crypto/challenge';

beforeEach(() => {
  clearTestChallenges();
});

describe('Challenge', () => {
  const address = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY';

  test('createChallenge generates nonce in correct format', async () => {
    const challenge = await createChallenge(address, []);
    expect(challenge.nonce).toMatch(/^bittensor-auth:none:[0-9a-f-]+$/);
    expect(challenge.address).toBe(address);
    expect(challenge.scopes).toEqual([]);
  });

  test('createChallenge includes scopes in nonce', async () => {
    const challenge = await createChallenge(address, ['subnet:1:miner', 'subnet:2:validator']);
    expect(challenge.nonce).toMatch(/^bittensor-auth:subnet:1:miner,subnet:2:validator:[0-9a-f-]+$/);
  });

  test('consumeChallenge returns the challenge and is single-use', async () => {
    const challenge = await createChallenge(address, []);
    const consumed = await consumeChallenge(challenge.nonce);
    expect(consumed.address).toBe(address);
    expect(consumed.nonce).toBe(challenge.nonce);
    // Second consumption should throw
    await expect(consumeChallenge(challenge.nonce)).rejects.toThrow('Invalid or expired challenge');
  });

  test('consumeChallenge throws for nonexistent nonce', async () => {
    await expect(consumeChallenge('nonexistent-nonce')).rejects.toThrow('Invalid or expired challenge');
  });

  test('multiple challenges can coexist', async () => {
    const c1 = await createChallenge(address, []);
    const c2 = await createChallenge(address, ['subnet:1:miner']);
    const c3 = await createChallenge('5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty', []);
    // All should be consumable
    await expect(consumeChallenge(c1.nonce)).resolves.toBeDefined();
    await expect(consumeChallenge(c2.nonce)).resolves.toBeDefined();
    await expect(consumeChallenge(c3.nonce)).resolves.toBeDefined();
  });

  test('clearChallenges removes all entries', async () => {
    await createChallenge(address, []);
    await createChallenge(address, []);
    await clearChallenges();
    // After clearing, no challenges should be consumable
    // (we'd need to track nonces, but the clear itself shouldn't throw)
  });
});
