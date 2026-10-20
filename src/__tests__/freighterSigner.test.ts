/**
 * @jest-environment node
 */
import { signTransaction } from '@stellar/freighter-api';
import { freighterSigner } from '@/lib/stellar';

jest.mock('@stellar/freighter-api', () => ({ signTransaction: jest.fn() }));
jest.mock('@/hooks/useToast', () => ({ useToast: jest.fn() }));

const mockedSign = signTransaction as jest.MockedFunction<typeof signTransaction>;
const PASSPHRASE = 'Test SDF Network ; September 2015';

describe('freighterSigner', () => {
  beforeEach(() => mockedSign.mockReset());

  it('signs through @stellar/freighter-api with the expected account and returns signedTxXdr', async () => {
    mockedSign.mockResolvedValueOnce({ signedTxXdr: 'SIGNED', signerAddress: 'GABC' });

    await expect(freighterSigner('UNSIGNED', PASSPHRASE, 'GABC')).resolves.toBe('SIGNED');
    expect(mockedSign).toHaveBeenCalledWith('UNSIGNED', {
      networkPassphrase: PASSPHRASE,
      address: 'GABC',
    });
  });

  it('surfaces Freighter errors such as a user rejection', async () => {
    mockedSign.mockResolvedValueOnce({
      signedTxXdr: '',
      signerAddress: '',
      error: { code: -4, message: 'The user rejected this request.' },
    });

    await expect(freighterSigner('UNSIGNED', PASSPHRASE, 'GABC')).rejects.toThrow('rejected');
  });

  it('rejects a signature from a different account', async () => {
    mockedSign.mockResolvedValueOnce({ signedTxXdr: 'SIGNED', signerAddress: 'GOTHER' });

    await expect(freighterSigner('UNSIGNED', PASSPHRASE, 'GABC')).rejects.toThrow(
      'different account',
    );
  });
});
