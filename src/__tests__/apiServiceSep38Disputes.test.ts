import {
  addEnvelopeRecipientEntry,
  createSep38Quote,
  fetchDisputeCases,
  fetchEncryptionPublicKey,
  fetchEnvelopeHeader,
  fetchSep38Info,
  fetchSep38Prices,
  registerEncryptionPublicKey,
  removeEnvelopeRecipientEntry,
  requestDisputeAttestation,
} from '@/services/api.service';

// `var` keeps these hoisted above the jest.mock factory, which runs before imports.
// eslint-disable-next-line no-var
var mockInterceptorRejected: (err: unknown) => Promise<unknown>;

// One shared mock instance stands in for both the backend and the anchor axios instances.
// eslint-disable-next-line no-var
var mockApi: Record<'get' | 'post' | 'put' | 'delete', jest.Mock>;

jest.mock('axios', () => {
  mockApi = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({
        ...mockApi,
        interceptors: {
          request: { use: jest.fn() },
          response: {
            use: jest.fn((_fulfilled, rejected) => {
              mockInterceptorRejected = rejected;
            }),
          },
        },
      })),
    },
  };
});

jest.mock('axios-retry', () => {
  const mockAxiosRetry = jest.fn();
  (mockAxiosRetry as any).exponentialDelay = jest.fn();
  (mockAxiosRetry as any).isNetworkOrIdempotentRequestError = jest.fn();
  return mockAxiosRetry;
});

const QUOTE_SERVER = 'https://anchor.example.com/sep38';

describe('SEP-38 anchor quote API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetchSep38Info calls GET /info and returns assets', async () => {
    const assets = [
      { asset: 'iso4217:BRL', sell_delivery_methods: [{ name: 'PIX', description: 'Pix' }] },
    ];
    mockApi.get.mockResolvedValueOnce({ data: { assets } });

    await expect(fetchSep38Info(QUOTE_SERVER)).resolves.toEqual(assets);
    expect(mockApi.get).toHaveBeenCalledWith(`${QUOTE_SERVER}/info`, {});
  });

  it('fetchSep38Prices calls GET /prices with buy_asset and buy_amount and returns sell_assets', async () => {
    const sellAssets = [{ asset: 'iso4217:BRL', price: '0.18', decimals: 2 }];
    mockApi.get.mockResolvedValueOnce({ data: { sell_assets: sellAssets } });

    await expect(fetchSep38Prices(QUOTE_SERVER, 'stellar:native', '10', 'jwt')).resolves.toEqual(
      sellAssets,
    );
    expect(mockApi.get).toHaveBeenCalledWith(`${QUOTE_SERVER}/prices`, {
      params: { buy_asset: 'stellar:native', buy_amount: '10' },
      headers: { Authorization: 'Bearer jwt' },
    });
  });

  it('createSep38Quote POSTs /quote with the SEP-10 bearer token', async () => {
    const request = {
      sell_asset: 'iso4217:BRL',
      buy_asset: 'stellar:native',
      buy_amount: '10',
      expire_after: '2026-10-19T12:00:00.000Z',
      sell_delivery_method: 'PIX',
      context: 'sep6' as const,
    };
    const quote = { id: 'q1', expires_at: '2026-10-19T12:10:00Z' };
    mockApi.post.mockResolvedValueOnce({ data: quote });

    await expect(createSep38Quote(QUOTE_SERVER, 'jwt', request)).resolves.toEqual(quote);
    expect(mockApi.post).toHaveBeenCalledWith(`${QUOTE_SERVER}/quote`, request, {
      headers: { Authorization: 'Bearer jwt' },
    });
  });

  it('normalizes SEP-38 `{ error }` bodies into ApiError.message', async () => {
    await expect(
      mockInterceptorRejected({
        response: { status: 400, data: { error: 'unsupported sell_asset' } },
        code: 'ERR_BAD_REQUEST',
      }),
    ).rejects.toEqual({
      message: 'unsupported sell_asset',
      status: 400,
      code: 'ERR_BAD_REQUEST',
      data: { error: 'unsupported sell_asset' },
    });
  });
});

describe('Dispute API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetchDisputeCases calls GET /hospital/disputes with hospitalAddress', async () => {
    mockApi.get.mockResolvedValueOnce({ data: [] });
    await fetchDisputeCases('GHOSP');
    expect(mockApi.get).toHaveBeenCalledWith('/hospital/disputes', {
      params: { hospitalAddress: 'GHOSP' },
    });
  });

  it('requestDisputeAttestation POSTs /disputes/attestations', async () => {
    const signed = { attestation: { appointmentId: 'a1' }, signature: 'ab' };
    mockApi.post.mockResolvedValueOnce({ data: signed });
    await expect(requestDisputeAttestation('a1')).resolves.toEqual(signed);
    expect(mockApi.post).toHaveBeenCalledWith('/disputes/attestations', { appointmentId: 'a1' });
  });
});

describe('Envelope recipient API', () => {
  beforeEach(() => jest.clearAllMocks());
  const jwk = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' };

  it('registers and fetches encryption public keys', async () => {
    mockApi.put.mockResolvedValueOnce({ data: {} });
    mockApi.get.mockResolvedValueOnce({ data: { publicKey: jwk } });

    await registerEncryptionPublicKey('GABC', jwk);
    await expect(fetchEncryptionPublicKey('GABC')).resolves.toEqual(jwk);

    expect(mockApi.put).toHaveBeenCalledWith('/users/GABC/encryption-key', { publicKey: jwk });
    expect(mockApi.get).toHaveBeenCalledWith('/users/GABC/encryption-key');
  });

  it('reads the header and adds/removes recipients without sending ciphertext', async () => {
    const entry = { id: 'GDOC', epk: jwk, wrappedKey: 'AAAA' };
    mockApi.get.mockResolvedValueOnce({ data: { recipients: [] } });
    mockApi.post.mockResolvedValueOnce({ data: { recipients: [entry] } });
    mockApi.delete.mockResolvedValueOnce({ data: { recipients: [] } });

    await fetchEnvelopeHeader('r1');
    await addEnvelopeRecipientEntry('r1', entry);
    await removeEnvelopeRecipientEntry('r1', 'GDOC');

    expect(mockApi.get).toHaveBeenCalledWith('/records/encrypted/r1/envelope-header');
    expect(mockApi.post).toHaveBeenCalledWith('/records/encrypted/r1/recipients', entry);
    expect(mockApi.delete).toHaveBeenCalledWith('/records/encrypted/r1/recipients/GDOC');
  });
});
