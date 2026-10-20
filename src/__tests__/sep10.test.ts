/**
 * @jest-environment node
 */
import axios from 'axios';
import { Keypair, Networks, StellarToml, TransactionBuilder, WebAuth } from '@stellar/stellar-sdk';
import { getSep10Token, resolveAnchor, type AnchorEndpoints } from '@/lib/sep10';

jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('@/hooks/useToast', () => ({ useToast: jest.fn() }));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const HOME_DOMAIN = 'testanchor.example.com';
const server = Keypair.random();
const client = Keypair.random();

const anchor: AnchorEndpoints = {
  homeDomain: HOME_DOMAIN,
  quoteServer: `https://${HOME_DOMAIN}/sep38`,
  webAuthEndpoint: `https://${HOME_DOMAIN}/auth`,
  signingKey: server.publicKey(),
};

const jwt = (exp: number) =>
  `e30.${btoa(JSON.stringify({ sub: client.publicKey(), exp })).replace(/=+$/, '')}.sig`;

const challengeFor = (signer: Keypair, account = client.publicKey()) =>
  WebAuth.buildChallengeTx(signer, account, HOME_DOMAIN, 300, Networks.TESTNET, HOME_DOMAIN);

/** Wallet signer: signs the challenge with the client key, as Freighter would. */
const walletSign = jest.fn(async (envelope: string, passphrase: string) => {
  const tx = TransactionBuilder.fromXDR(envelope, passphrase);
  tx.sign(client);
  return tx.toXDR();
});

describe('getSep10Token', () => {
  beforeEach(() => jest.clearAllMocks());

  it('validates the challenge, signs it with the wallet and returns the JWT', async () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 3600);
    mockedAxios.get.mockResolvedValueOnce({
      data: { transaction: challengeFor(server), network_passphrase: Networks.TESTNET },
    });
    mockedAxios.post.mockResolvedValueOnce({ data: { token } });

    await expect(getSep10Token(anchor, client.publicKey(), walletSign)).resolves.toBe(token);

    expect(mockedAxios.get).toHaveBeenCalledWith(anchor.webAuthEndpoint, {
      params: { account: client.publicKey(), home_domain: HOME_DOMAIN },
    });
    expect(walletSign).toHaveBeenCalledWith(
      expect.any(String),
      Networks.TESTNET,
      client.publicKey(),
    );
    const posted = mockedAxios.post.mock.calls[0]![1] as { transaction: string };
    const signedTx = TransactionBuilder.fromXDR(posted.transaction, Networks.TESTNET);
    expect(signedTx.signatures).toHaveLength(2); // server + client
  });

  it('reuses a cached token until shortly before it expires', async () => {
    const otherClient = Keypair.random();
    const token = jwt(Math.floor(Date.now() / 1000) + 3600);
    mockedAxios.get.mockResolvedValueOnce({
      data: { transaction: challengeFor(server, otherClient.publicKey()) },
    });
    mockedAxios.post.mockResolvedValueOnce({ data: { token } });
    const sign = jest.fn(async (envelope: string, passphrase: string) => {
      const tx = TransactionBuilder.fromXDR(envelope, passphrase);
      tx.sign(otherClient);
      return tx.toXDR();
    });

    await getSep10Token(anchor, otherClient.publicKey(), sign);
    await getSep10Token(anchor, otherClient.publicKey(), sign);

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    expect(sign).toHaveBeenCalledTimes(1);
  });

  it('refuses to sign a challenge not signed by the anchor SIGNING_KEY', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { transaction: challengeFor(Keypair.random()) },
    });

    await expect(
      getSep10Token({ ...anchor }, Keypair.random().publicKey(), walletSign),
    ).rejects.toThrow();
    expect(walletSign).not.toHaveBeenCalled();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('refuses a challenge for a different network', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: { transaction: challengeFor(server), network_passphrase: Networks.PUBLIC },
    });

    await expect(getSep10Token(anchor, Keypair.random().publicKey(), walletSign)).rejects.toThrow(
      'different Stellar network',
    );
    expect(walletSign).not.toHaveBeenCalled();
  });
});

describe('resolveAnchor', () => {
  it('reads SEP-38 and SEP-10 endpoints from stellar.toml', async () => {
    jest.spyOn(StellarToml.Resolver, 'resolve').mockResolvedValueOnce({
      ANCHOR_QUOTE_SERVER: 'https://anchor.example.com/sep38/',
      WEB_AUTH_ENDPOINT: 'https://anchor.example.com/auth',
      SIGNING_KEY: server.publicKey(),
    });

    await expect(resolveAnchor('anchor.example.com')).resolves.toEqual({
      homeDomain: 'anchor.example.com',
      quoteServer: 'https://anchor.example.com/sep38',
      webAuthEndpoint: 'https://anchor.example.com/auth',
      signingKey: server.publicKey(),
    });
  });

  it('rejects anchors that do not publish an ANCHOR_QUOTE_SERVER', async () => {
    jest
      .spyOn(StellarToml.Resolver, 'resolve')
      .mockResolvedValueOnce({ WEB_AUTH_ENDPOINT: 'https://x/auth' });

    await expect(resolveAnchor('no-quotes.example.com')).rejects.toThrow('does not support SEP-38');
  });
});
