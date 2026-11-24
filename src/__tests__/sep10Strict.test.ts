import { Keypair, Networks, WebAuth, TransactionBuilder } from '@stellar/stellar-sdk';
import { verifyStrictSep10Challenge, signChallenge } from '@/lib/sep10';
import { validateLoginChallenge } from '@/app/login/page';

describe('SEP-10 Strict Verification & Nonce Security (#194)', () => {
  const server = Keypair.random();
  const evilServer = Keypair.random();
  const client = Keypair.random();
  const DOMAIN = 'auth.heliora.io';

  const buildChallenge = (
    signer: Keypair,
    account: string,
    homeDomain = DOMAIN,
    timeoutSeconds = 300,
    webAuthDomain = DOMAIN,
  ) =>
    WebAuth.buildChallengeTx(
      signer,
      account,
      homeDomain,
      timeoutSeconds,
      Networks.TESTNET,
      webAuthDomain,
    );

  beforeEach(() => {
    process.env.NEXT_PUBLIC_AUTH_SIGNING_KEY = server.publicKey();
    process.env.NEXT_PUBLIC_AUTH_HOME_DOMAIN = DOMAIN;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AUTH_SIGNING_KEY;
    delete process.env.NEXT_PUBLIC_AUTH_HOME_DOMAIN;
  });

  describe('Strict Mode Verification Rules', () => {
    it('successfully validates genuine challenge with sequence 0, valid server signature, and 300s duration', () => {
      const challengeXdr = buildChallenge(server, client.publicKey(), DOMAIN, 300, DOMAIN);

      const result = verifyStrictSep10Challenge(challengeXdr, {
        serverSigningKey: server.publicKey(),
        homeDomain: DOMAIN,
        webAuthDomain: DOMAIN,
        account: client.publicKey(),
        strict: true,
      });

      expect(result.clientAccountID).toBe(client.publicKey());
      expect(result.matchedHomeDomain).toBe(DOMAIN);
    });

    it('rejects challenges where sequence number is not 0', () => {
      // Build a fake transaction with sequence = '1'
      const account = new (require('@stellar/stellar-sdk').Account)(server.publicKey(), '0');
      account.incrementSequenceNumber(); // sequence is now '1'

      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          require('@stellar/stellar-sdk').Operation.manageData({
            name: `${DOMAIN} auth`,
            value: 'mock_nonce_data',
          }),
        )
        .setTimeout(300)
        .build();

      tx.sign(server);
      const invalidSeqXdr = tx.toXDR();

      expect(() =>
        verifyStrictSep10Challenge(invalidSeqXdr, {
          serverSigningKey: server.publicKey(),
          homeDomain: DOMAIN,
          webAuthDomain: DOMAIN,
          strict: true,
        }),
      ).toThrow('sequence number must be 0');
    });

    it('rejects challenges not signed by NEXT_PUBLIC_AUTH_SIGNING_KEY', () => {
      // Challenge signed by evilServer instead of configured server
      const challengeXdr = buildChallenge(evilServer, client.publicKey(), DOMAIN, 300, DOMAIN);

      expect(() =>
        verifyStrictSep10Challenge(challengeXdr, {
          serverSigningKey: evilServer.publicKey(),
          homeDomain: DOMAIN,
          webAuthDomain: DOMAIN,
          strict: true,
        }),
      ).toThrow('does not match configured NEXT_PUBLIC_AUTH_SIGNING_KEY');
    });

    it('rejects challenges if server signature is invalid/tampered', () => {
      // Claim server signing key is server.publicKey(), but challenge is signed by evilServer
      const challengeXdr = buildChallenge(evilServer, client.publicKey(), DOMAIN, 300, DOMAIN);

      expect(() =>
        verifyStrictSep10Challenge(challengeXdr, {
          serverSigningKey: server.publicKey(),
          homeDomain: DOMAIN,
          webAuthDomain: DOMAIN,
          strict: false, // bypassing key mismatch check to trigger cryptographic signature verify
        }),
      ).toThrow('not signed by the expected server key');
    });

    it('rejects challenges where validity window exceeds 5 minutes (300 seconds)', () => {
      // Timeout is 600s (> 300s)
      const longChallengeXdr = buildChallenge(server, client.publicKey(), DOMAIN, 600, DOMAIN);

      expect(() =>
        verifyStrictSep10Challenge(longChallengeXdr, {
          serverSigningKey: server.publicKey(),
          homeDomain: DOMAIN,
          webAuthDomain: DOMAIN,
          strict: true,
        }),
      ).toThrow('validity window exceeds 300 seconds (5 minutes)');
    });

    it('rejects expired challenges', () => {
      const pastTime = Math.floor(Date.now() / 1000) - 1000;
      const account = new (require('@stellar/stellar-sdk').Account)(server.publicKey(), '-1');

      const tx = new TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
        timebounds: {
          minTime: pastTime.toString(),
          maxTime: (pastTime + 200).toString(),
        },
      })
        .addOperation(
          require('@stellar/stellar-sdk').Operation.manageData({
            name: `${DOMAIN} auth`,
            value: 'expired_nonce',
          }),
        )
        .build();

      tx.sign(server);

      expect(() =>
        verifyStrictSep10Challenge(tx.toXDR(), {
          serverSigningKey: server.publicKey(),
          homeDomain: DOMAIN,
          webAuthDomain: DOMAIN,
          strict: true,
        }),
      ).toThrow('expired');
    });

    it('rejects challenges issued for a different home domain', () => {
      const challengeXdr = buildChallenge(server, client.publicKey(), 'phishing-domain.com', 300);

      expect(() =>
        verifyStrictSep10Challenge(challengeXdr, {
          serverSigningKey: server.publicKey(),
          homeDomain: 'phishing-domain.com',
          webAuthDomain: 'phishing-domain.com',
          strict: true,
        }),
      ).toThrow('Home domain does not match configured NEXT_PUBLIC_AUTH_HOME_DOMAIN');
    });

    it('rejects challenges issued for a different client account', () => {
      const otherClient = Keypair.random();
      const challengeXdr = buildChallenge(server, client.publicKey(), DOMAIN, 300, DOMAIN);

      expect(() =>
        verifyStrictSep10Challenge(challengeXdr, {
          serverSigningKey: server.publicKey(),
          homeDomain: DOMAIN,
          webAuthDomain: DOMAIN,
          account: otherClient.publicKey(),
          strict: true,
        }),
      ).toThrow('issued for a different account');
    });
  });

  describe('signChallenge with strict verification', () => {
    it('validates and signs valid challenge', async () => {
      const challengeXdr = buildChallenge(server, client.publicKey(), DOMAIN, 300, DOMAIN);
      const walletSign = jest.fn(async (xdrStr: string, passphrase: string) => {
        const tx = TransactionBuilder.fromXDR(xdrStr, passphrase);
        tx.sign(client);
        return tx.toXDR();
      });

      const signed = await signChallenge(
        challengeXdr,
        server.publicKey(),
        DOMAIN,
        DOMAIN,
        client.publicKey(),
        walletSign,
      );

      expect(signed).toBeDefined();
      expect(walletSign).toHaveBeenCalledTimes(1);
    });

    it('refuses to sign tampered challenge', async () => {
      const tamperedChallengeXdr = buildChallenge(evilServer, client.publicKey(), DOMAIN, 300, DOMAIN);
      const walletSign = jest.fn();

      await expect(
        signChallenge(
          tamperedChallengeXdr,
          evilServer.publicKey(),
          DOMAIN,
          DOMAIN,
          client.publicKey(),
          walletSign,
        ),
      ).rejects.toThrow();

      expect(walletSign).not.toHaveBeenCalled();
    });
  });

  describe('validateLoginChallenge integration in login page', () => {
    it('validates legitimate login challenge', () => {
      const challengeXdr = buildChallenge(server, client.publicKey(), DOMAIN, 300, DOMAIN);
      const result = validateLoginChallenge(challengeXdr, client.publicKey(), {
        serverSigningKey: server.publicKey(),
        homeDomain: DOMAIN,
      });

      expect(result.clientAccountID).toBe(client.publicKey());
    });

    it('rejects invalid login challenge when server key is not configured', () => {
      delete process.env.NEXT_PUBLIC_AUTH_SIGNING_KEY;
      const challengeXdr = buildChallenge(server, client.publicKey(), DOMAIN, 300, DOMAIN);

      expect(() => validateLoginChallenge(challengeXdr, client.publicKey(), { serverSigningKey: '' })).toThrow(
        'NEXT_PUBLIC_AUTH_SIGNING_KEY must be configured',
      );
    });
  });
});
