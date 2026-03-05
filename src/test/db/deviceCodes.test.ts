import { commitDeviceCodeRedemption } from '../../db/deviceCodes';

describe('device code redemption finalization', () => {
  test('releases the client after a successful commit', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const release = jest.fn();

    await commitDeviceCodeRedemption({ query, release } as never);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith('COMMIT');
    expect(release).toHaveBeenCalledTimes(1);
  });

  test('best-effort rolls back and releases when commit fails', async () => {
    const commitError = new Error('commit failed');
    const query = jest.fn().mockRejectedValueOnce(commitError).mockResolvedValueOnce(undefined);
    const release = jest.fn();

    await expect(commitDeviceCodeRedemption({ query, release } as never)).rejects.toThrow('commit failed');

    expect(query).toHaveBeenNthCalledWith(1, 'COMMIT');
    expect(query).toHaveBeenNthCalledWith(2, 'ROLLBACK');
    expect(release).toHaveBeenCalledTimes(1);
  });
});
