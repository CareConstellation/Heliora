/**
 * @jest-environment node
 */

import { Keypair, Memo } from '@stellar/stellar-sdk';
import {
  clearFederationCache,
  createFederationMemo,
  getFederationServer,
  isFederatedAddress,
  lookupFederationByAccount,
  parseFederatedAddress,
  parseFederationServerFromToml,
  resolveFederatedAddress,
  resolveWalletAddress,
  FederationError,
} from '@/lib/stellar';
import { resolveInputAddress } from '@/lib/federationInput';

const ACCOUNT = Keypair.random().publicKey();
const FEDERATION_SERVER = 'https://fed.heliora.io/federation';
const ADDRESS = 'doctor*heliora.io';

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

function mockFetch(responses: Response[]) {
  const fetchMock = jest.fn();
  for (const item of responses) fetchMock.mockResolvedValueOnce(item);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

beforeEach(() => {
  clearFederationCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SEP-0002 address parsing', () => {
  it('parses federated addresses and rejects malformed ones', () => {
    expect(parseFederatedAddress(ADDRESS)).toEqual({
      name: 'doctor',
      domain: 'heliora.io',
      address: ADDRESS,
    });
    expect(isFederatedAddress(' Doctor*Heliora.IO ')).toBe(true);
    expect(parseFederatedAddress('doctor')).toBeNull();
    expect(parseFederatedAddress('doctor*')).toBeNull();
    expect(parseFederatedAddress('doctor*not a domain')).toBeNull();
    expect(isFederatedAddress(ACCOUNT)).toBe(false);
  });

  it('reads FEDERATION_SERVER from stellar.toml', () => {
    const toml = [
      '# federation settings',
      'VERSION="2.0.0"',
      '',
      '[DOCUMENTATION]',
      'ORG_NAME="Heliora"',
      '',
      'FEDERATION_SERVER = "https://fed.heliora.io/federation"',
    ].join('\n');
    expect(parseFederationServerFromToml(toml)).toBe(FEDERATION_SERVER);
    expect(
      parseFederationServerFromToml('FEDERATION_SERVER = "http://evil.example.com"'),
    ).toBeNull();
    expect(parseFederationServerFromToml('OTHER = "value"')).toBeNull();
  });
});

describe('stellar.toml discovery', () => {
  it('queries .well-known/stellar.toml and caches the federation server', async () => {
    const fetchMock = mockFetch([
      response('FEDERATION_SERVER="https://fed.heliora.io/federation"'),
    ]);
    await expect(getFederationServer('heliora.io')).resolves.toBe(FEDERATION_SERVER);
    await expect(getFederationServer('heliora.io')).resolves.toBe(FEDERATION_SERVER);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://heliora.io/.well-known/stellar.toml');
  });

  it('fails clearly when no federation server is published and does not cache failure', async () => {
    mockFetch([
      response('VERSION="2.0.0"'),
      response('FEDERATION_SERVER="https://fed.heliora.io"'),
    ]);
    await expect(getFederationServer('heliora.io')).rejects.toThrow(FederationError);
    await expect(getFederationServer('heliora.io')).resolves.toBe('https://fed.heliora.io');
  });
});

describe('forward federation', () => {
  it('resolves a federated address to a public key and memo requirement', async () => {
    const fetchMock = mockFetch([
      response(`FEDERATION_SERVER="${FEDERATION_SERVER}"`),
      response({
        stellar_address: ADDRESS,
        account_id: ACCOUNT,
        memo_type: 'text',
        memo: 'invoice-42',
      }),
    ]);

    const resolution = await resolveFederatedAddress(ADDRESS);
    expect(resolution.publicKey).toBe(ACCOUNT);
    expect(resolution.memoType).toBe('text');
    expect(resolution.memo).toBe('invoice-42');

    const url = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(url.origin + url.pathname).toBe(FEDERATION_SERVER);
    expect(url.searchParams.get('q')).toBe(ADDRESS);
    expect(url.searchParams.get('type')).toBe('name');
  });

  it('passes raw public keys through unchanged', async () => {
    await expect(resolveWalletAddress(` ${ACCOUNT} `)).resolves.toEqual({
      address: ACCOUNT,
      publicKey: ACCOUNT,
      memoType: null,
      memo: null,
    });
  });

  it('rejects invalid federation responses', async () => {
    mockFetch([
      response(`FEDERATION_SERVER="${FEDERATION_SERVER}"`),
      response({ stellar_address: ADDRESS, account_id: 'GNOTAKEY' }),
    ]);
    await expect(resolveFederatedAddress(ADDRESS)).rejects.toThrow(/invalid Stellar public key/);
  });

  it('rejects a mismatched stellar_address and invalid memos', async () => {
    mockFetch([
      response(`FEDERATION_SERVER="${FEDERATION_SERVER}"`),
      response({ stellar_address: 'other*heliora.io', account_id: ACCOUNT }),
    ]);
    await expect(resolveFederatedAddress(ADDRESS)).rejects.toThrow(/different federated address/);

    clearFederationCache();
    mockFetch([
      response(`FEDERATION_SERVER="${FEDERATION_SERVER}"`),
      response({ stellar_address: ADDRESS, account_id: ACCOUNT, memo_type: 'id', memo: '-1' }),
    ]);
    await expect(resolveFederatedAddress(ADDRESS)).rejects.toThrow(/invalid memo/);
  });

  it('reports a missing federation record', async () => {
    mockFetch([response(`FEDERATION_SERVER="${FEDERATION_SERVER}"`), response({}, 404)]);
    await expect(resolveFederatedAddress(ADDRESS)).rejects.toThrow(/No Stellar account/);
  });

  it('builds the SDK memo required by the federation record', () => {
    expect(
      createFederationMemo({ address: ADDRESS, publicKey: ACCOUNT, memoType: null, memo: null }),
    ).toBeUndefined();
    expect(
      createFederationMemo({
        address: ADDRESS,
        publicKey: ACCOUNT,
        memoType: 'id',
        memo: '42',
      }),
    ).toBeInstanceOf(Memo);
  });
});

describe('reverse federation', () => {
  it('resolves a public key to the federated address', async () => {
    const fetchMock = mockFetch([
      response(`FEDERATION_SERVER="${FEDERATION_SERVER}"`),
      response({ stellar_address: ADDRESS, account_id: ACCOUNT }),
    ]);
    await expect(lookupFederationByAccount(ACCOUNT, 'heliora.io')).resolves.toBe(ADDRESS);
    const url = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(url.searchParams.get('q')).toBe(ACCOUNT);
    expect(url.searchParams.get('type')).toBe('id');
  });

  it('returns null when no reverse record exists and rejects mismatched accounts', async () => {
    mockFetch([response(`FEDERATION_SERVER="${FEDERATION_SERVER}"`), response({}, 404)]);
    await expect(lookupFederationByAccount(ACCOUNT, 'heliora.io')).resolves.toBeNull();

    clearFederationCache();
    mockFetch([
      response(`FEDERATION_SERVER="${FEDERATION_SERVER}"`),
      response({ stellar_address: ADDRESS, account_id: Keypair.random().publicKey() }),
    ]);
    await expect(lookupFederationByAccount(ACCOUNT, 'heliora.io')).rejects.toThrow(
      /different Stellar account/,
    );
  });
});

describe('form input resolution', () => {
  it('resolves local contacts and federated addresses', async () => {
    const contact = { publicKey: ACCOUNT, alias: 'doctor' } as never;
    await expect(resolveInputAddress('doctor', [contact])).resolves.toMatchObject({
      publicKey: ACCOUNT,
    });

    mockFetch([
      response(`FEDERATION_SERVER="${FEDERATION_SERVER}"`),
      response({ stellar_address: ADDRESS, account_id: ACCOUNT }),
    ]);
    await expect(resolveInputAddress(ADDRESS)).resolves.toMatchObject({ publicKey: ACCOUNT });
    await expect(resolveInputAddress('not-an-address')).resolves.toBeNull();
  });
});
