import {
  parseStellarAsset,
  CLINICAL_PAYMENT_ASSETS,
} from '@/lib/stellar';
import { Asset } from '@stellar/stellar-sdk';

describe('Cross-Asset Clinical Payment Pathfinding (#18)', () => {
  it('parses native and credit Stellar assets correctly', () => {
    const nativeAsset = parseStellarAsset('native');
    expect(nativeAsset.isNative()).toBe(true);

    const xlmAsset = parseStellarAsset('XLM');
    expect(xlmAsset.isNative()).toBe(true);

    const usdcAsset = parseStellarAsset('USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
    expect(usdcAsset.isNative()).toBe(false);
    expect(usdcAsset.getCode()).toBe('USDC');
    expect(usdcAsset.getIssuer()).toBe('GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');

    const sepAsset = parseStellarAsset('stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
    expect(sepAsset.getCode()).toBe('USDC');
  });

  it('supports major clinical payment tokens on testnet and mainnet', () => {
    expect(CLINICAL_PAYMENT_ASSETS.testnet).toHaveLength(3);
    expect(CLINICAL_PAYMENT_ASSETS.mainnet).toHaveLength(3);

    const codesTestnet = CLINICAL_PAYMENT_ASSETS.testnet.map((a) => a.code);
    expect(codesTestnet).toContain('XLM');
    expect(codesTestnet).toContain('USDC');
    expect(codesTestnet).toContain('EURC');
  });

  it('calculates strict slippage bounds accurately', () => {
    const sourceAmount = 100.0;
    const slippageTolerancePercent = 1.0; // 1%
    const multiplier = 1 + slippageTolerancePercent / 100;
    const sendMax = (sourceAmount * multiplier).toFixed(7);

    expect(sendMax).toBe('101.0000000');
  });
});
