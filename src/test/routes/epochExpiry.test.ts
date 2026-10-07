import { getEpochDetails } from '../../subtensor/queries';
import { getEpochInfo, MIN_ACCESS_TOKEN_EXPIRY } from '../../routes/oauth/shared';
import { config } from '../../config';

jest.mock('../../subtensor/queries', () => ({ getEpochDetails: jest.fn() }));

const mockEpochDetails = getEpochDetails as jest.MockedFunction<typeof getEpochDetails>;

function epochIn(secondsUntilNextEpoch: number | null): void {
  mockEpochDetails.mockResolvedValue({ secondsUntilNextEpoch, currentEpoch: 42 });
}

describe('epoch-aligned access token expiry', () => {
  it('expires at the next epoch boundary when it is far enough away', async () => {
    epochIn(3600);
    expect(await getEpochInfo(['subnet:1:miner'])).toEqual({ accessExpiry: 3600, epoch: 42 });
  });

  it('floors the expiry at five minutes when the boundary is closer', async () => {
    epochIn(12);
    const { accessExpiry } = await getEpochInfo(['subnet:1:miner']);
    expect(accessExpiry).toBe(MIN_ACCESS_TOKEN_EXPIRY);
    expect(MIN_ACCESS_TOKEN_EXPIRY).toBe(300);
  });

  it('keeps the boundary when it is exactly at the floor', async () => {
    epochIn(300);
    expect((await getEpochInfo(['subnet:1:miner'])).accessExpiry).toBe(300);
  });

  it('falls back to the configured expiry when epoch info is unavailable', async () => {
    epochIn(null);
    expect((await getEpochInfo(['subnet:1:miner'])).accessExpiry).toBe(config.jwtAccessTokenExpiry);
  });

  it('uses the configured expiry for scopes without a netuid', async () => {
    mockEpochDetails.mockClear();
    expect(await getEpochInfo(['openid'])).toEqual({ accessExpiry: config.jwtAccessTokenExpiry, epoch: null });
    expect(mockEpochDetails).not.toHaveBeenCalled();
  });
});
