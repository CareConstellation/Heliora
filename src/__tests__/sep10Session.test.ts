/**
 * @jest-environment node
 */
import { Keypair, Networks, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';

jest.mock('@/hooks/useToast', () => ({ useToast: jest.fn() }));

var mockApi: { get: jest.Mock; post: jest.Mock };
var mockRequestInterceptor: (config: { headers: Record<string, string> }) => {
  headers: Record<string, string>;
};

jest.mock('axios', () => {
  mockApi = { get: jest.fn(), post: jest.fn() };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({
        ...mockApi,
        interceptors: {
          request: { use: jest.fn((fn) => (mockRequestInterceptor = fn)) },
          response: { use: jest.fn() },
        },
      })),
    },
  };
});
jest.mock('axios-retry', () => {
  const retry = jest.fn();
  (retry as any).exponentialDelay = jest.fn();
  (retry as any).isNetworkOrIdempotentRequestError = jest.fn();
  return { __esModule: true, default: retry };
});

import { authenticateWithSep10, clearSession, getSessionToken } from '@/services/api.service';

const server = Keypair.random();
const client = Keypair.random();
const DOMAIN = 'heliora.test'; // web_auth_domain falls back to the page host
(globalThis as any).window = { location: { origin: `https://${DOMAIN}`, hostname: DOMAIN } };

const jwt = (exp: number) => `e30.${btoa(JSON.stringify({ exp })).replace(/=+$/, '')}.sig`;
const challenge = (signer: Keypair) =>
  WebAuth.buildChallengeTx(signer, client.publicKey(), DOMAIN, 300, Networks.TESTNET, DOMAIN);
const walletSign = jest.fn(async (envelope: string, passphrase: string) => {
  const tx = TransactionBuilder.fromXDR(envelope, passphrase);
  tx.sign(client);
  return tx.toXDR();
});

describe('authenticateWithSep10', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSession();
    process.env.NEXT_PUBLIC_AUTH_SIGNING_KEY = server.publicKey();
  });

  it('signs the backend challenge, stores the JWT and attaches it to later requests', async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 3600);
    mockApi.get.mockResolvedValueOnce({ data: { transaction: challenge(server) } });
    mockApi.post.mockResolvedValueOnce({ data: { token } });

    await expect(authenticateWithSep10(client.publicKey(), walletSign)).resolves.toBe(token);

    expect(mockApi.get).toHaveBeenCalledWith('/auth/challenge', {
      params: { account: client.publicKey() },
    });
    const posted = mockApi.post.mock.calls[0]![1] as { transaction: string };
    expect(mockApi.post.mock.calls[0]![0]).toBe('/auth/token');
    expect(
      TransactionBuilder.fromXDR(posted.transaction, Networks.TESTNET).signatures,
    ).toHaveLength(2);
    expect(getSessionToken()).toBe(token);
    expect(mockRequestInterceptor({ headers: {} }).headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('refuses to sign a challenge not signed by the configured server key', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { transaction: challenge(Keypair.random()) } });

    await expect(authenticateWithSep10(client.publicKey(), walletSign)).rejects.toThrow();
    expect(walletSign).not.toHaveBeenCalled();
    expect(mockApi.post).not.toHaveBeenCalled();
    expect(getSessionToken()).toBeNull();
  });

  it('does not attach an expired token', async () => {
    mockApi.get.mockResolvedValueOnce({ data: { transaction: challenge(server) } });
    mockApi.post.mockResolvedValueOnce({ data: { token: jwt(Math.floor(Date.now() / 1000) - 1) } });

    await authenticateWithSep10(client.publicKey(), walletSign);
    expect(getSessionToken()).toBeNull();
    expect(mockRequestInterceptor({ headers: {} }).headers.Authorization).toBeUndefined();
  });
});
