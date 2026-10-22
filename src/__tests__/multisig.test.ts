/**
 * @jest-environment node
 */
import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  type Transaction,
  type xdr,
} from '@stellar/stellar-sdk';
import {
  collectedSignatures,
  mergeSignatures,
  parseStagedTx,
  requiredThreshold,
  type SignerConfig,
} from '@/lib/stellar';

jest.mock('@/hooks/useToast', () => ({ useToast: jest.fn() }));

const [a, b, c] = [Keypair.random(), Keypair.random(), Keypair.random()];
const config: SignerConfig = {
  signers: [a, b, c].map((k) => ({ key: k.publicKey(), weight: 1 })),
  thresholds: { low: 1, med: 2, high: 3 },
};

const build = (op: xdr.Operation) =>
  new TransactionBuilder(new Account(a.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(op)
    .setTimeout(300)
    .build();

const copy = (tx: Transaction) => parseStagedTx(tx.toXDR());

describe('multisig staging helpers', () => {
  it('requires the high threshold for signer changes and medium otherwise', () => {
    const setSigner = build(
      Operation.setOptions({ signer: { ed25519PublicKey: c.publicKey(), weight: 1 } }),
    );
    expect(requiredThreshold(setSigner, config)).toBe(3);
    expect(requiredThreshold(build(Operation.setOptions({ homeDomain: 'x.org' })), config)).toBe(2);
  });

  it('counts only valid signatures from account signers', () => {
    const tx = build(Operation.setOptions({ homeDomain: 'x.org' }));
    tx.sign(a, Keypair.random()); // stranger's signature must not count
    expect(collectedSignatures(tx, config)).toEqual({ signedBy: [a.publicKey()], weight: 1 });
  });

  it('merges co-signer copies without duplicating signatures and reaches "2 of 3"', () => {
    const base = build(Operation.setOptions({ homeDomain: 'x.org' }));
    base.sign(a);
    const cosigned = copy(base);
    cosigned.sign(b);

    const merged = mergeSignatures(copy(base), cosigned);
    expect(merged.signatures).toHaveLength(2);
    const { signedBy, weight } = collectedSignatures(merged, config);
    expect(signedBy).toHaveLength(2);
    expect(weight).toBeGreaterThanOrEqual(requiredThreshold(merged, config));
  });

  it('refuses to merge signatures from a different transaction', () => {
    const one = build(Operation.setOptions({ homeDomain: 'one.org' }));
    const two = build(Operation.setOptions({ homeDomain: 'two.org' }));
    expect(() => mergeSignatures(one, two)).toThrow('different transactions');
  });
});
