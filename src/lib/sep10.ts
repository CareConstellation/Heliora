/**
 * SEP-1 anchor discovery and SEP-10 Stellar Web Authentication.
 * Provides the JWT that SEP-38 `POST /quote` requires.
 *
 * Specs:
 * - https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0001.md
 * - https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 */

import axios from 'axios';
import { StellarToml, WebAuth } from '@stellar/stellar-sdk';
import { STELLAR_CONFIG, type TransactionSigner } from '@/lib/stellar';

/** Anchor endpoints published in its stellar.toml. */
export interface AnchorEndpoints {
  homeDomain: string;
  quoteServer: string;
  webAuthEndpoint: string;
  signingKey: string;
}

/** Refresh the token this many seconds before its `exp`, so it never expires mid-request. */
const TOKEN_EXPIRY_SKEW_SECONDS = 60;

const anchorCache = new Map<string, Promise<AnchorEndpoints>>();
// Kept in memory only: a SEP-10 JWT is a bearer credential and is never persisted.
const tokenCache = new Map<string, { token: string; exp: number }>();

/**
 * Resolves `ANCHOR_QUOTE_SERVER`, `WEB_AUTH_ENDPOINT` and `SIGNING_KEY` from the
 * anchor's stellar.toml. Each domain is resolved once per session.
 */
export function resolveAnchor(homeDomain: string): Promise<AnchorEndpoints> {
  let cached = anchorCache.get(homeDomain);
  if (!cached) {
    cached = StellarToml.Resolver.resolve(homeDomain).then((toml) => {
      const { ANCHOR_QUOTE_SERVER, WEB_AUTH_ENDPOINT, SIGNING_KEY } = toml;
      if (!ANCHOR_QUOTE_SERVER || !WEB_AUTH_ENDPOINT || !SIGNING_KEY) {
        throw new Error(`${homeDomain} does not support SEP-38 quotes with SEP-10 authentication.`);
      }
      return {
        homeDomain,
        quoteServer: ANCHOR_QUOTE_SERVER.replace(/\/+$/, ''),
        webAuthEndpoint: WEB_AUTH_ENDPOINT,
        signingKey: SIGNING_KEY,
      };
    });
    cached.catch(() => anchorCache.delete(homeDomain));
    anchorCache.set(homeDomain, cached);
  }
  return cached;
}

/** Reads the `exp` claim (seconds) from a JWT payload. The anchor verifies the signature, not the client. */
function jwtExpiry(token: string): number {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('SEP-10: malformed token.');
  const json = atob(
    payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '='),
  );
  const { exp } = JSON.parse(json) as { exp?: number };
  if (typeof exp !== 'number') throw new Error('SEP-10: token has no expiry.');
  return exp;
}

/**
 * Returns a SEP-10 JWT for `account`, reusing a cached token until shortly before it expires.
 *
 * Flow: GET challenge → validate it (sequence 0, server signature, time bounds,
 * `<home_domain> auth` and `web_auth_domain` operations) → sign it with the
 * wallet → POST it → receive the token.
 */
export async function getSep10Token(
  anchor: AnchorEndpoints,
  account: string,
  sign: TransactionSigner,
): Promise<string> {
  const cacheKey = `${anchor.webAuthEndpoint}|${account}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.exp - TOKEN_EXPIRY_SKEW_SECONDS > Date.now() / 1000) return cached.token;

  const { data: challenge } = await axios.get<{ transaction: string; network_passphrase?: string }>(
    anchor.webAuthEndpoint,
    { params: { account, home_domain: anchor.homeDomain } },
  );
  if (challenge.network_passphrase && challenge.network_passphrase !== STELLAR_CONFIG.passphrase) {
    throw new Error('SEP-10: the anchor challenge is for a different Stellar network.');
  }

  // Throws if any SEP-10 challenge requirement is not met.
  const { clientAccountID } = WebAuth.readChallengeTx(
    challenge.transaction,
    anchor.signingKey,
    STELLAR_CONFIG.passphrase,
    anchor.homeDomain,
    new URL(anchor.webAuthEndpoint).hostname,
  );
  if (clientAccountID !== account)
    throw new Error('SEP-10: challenge was issued for a different account.');

  const signed = await sign(challenge.transaction, STELLAR_CONFIG.passphrase, account);
  const { data } = await axios.post<{ token: string }>(anchor.webAuthEndpoint, {
    transaction: signed,
  });

  tokenCache.set(cacheKey, { token: data.token, exp: jwtExpiry(data.token) });
  return data.token;
}
