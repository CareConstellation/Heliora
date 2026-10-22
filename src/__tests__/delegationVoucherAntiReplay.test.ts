import {
  generateUUIDv4,
  createDelegationVoucher,
  verifyDelegationVoucher,
  VoucherReplayCache,
  AccountSequenceTracker,
  type DelegationVoucher,
} from '@/lib/crypto';

describe('Anti-Replay Protection & Nonce Verification for Delegation Vouchers (#35)', () => {
  let testReplayCache: VoucherReplayCache;
  let testSequenceTracker: AccountSequenceTracker;

  beforeEach(() => {
    testReplayCache = new VoucherReplayCache();
    testSequenceTracker = new AccountSequenceTracker();
  });

  it('generates compliant UUIDv4 nonces', () => {
    const uuid1 = generateUUIDv4();
    const uuid2 = generateUUIDv4();

    expect(uuid1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(uuid2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(uuid1).not.toBe(uuid2);
  });

  it('creates and verifies a valid delegation voucher within the 5-minute window', async () => {
    const now = Math.floor(Date.now() / 1000);
    const voucher = await createDelegationVoucher({
      targetRecipient: 'GRECIPIENT...01',
      granterAddress: 'GGRANTER...01',
      accountSequence: 1,
      permissions: ['records:read'],
      timestamp: now,
    });

    const result = verifyDelegationVoucher(voucher, {
      nowSeconds: now,
      replayCache: testReplayCache,
      sequenceTracker: testSequenceTracker,
    });

    expect(result.isValid).toBe(true);
  });

  it('rejects vouchers with timestamps skewed by more than 120 seconds into the future or past', async () => {
    const now = Math.floor(Date.now() / 1000);

    // Skewed 125 seconds into the past
    const pastVoucher: DelegationVoucher = {
      nonce: generateUUIDv4(),
      timestamp: now - 125,
      targetRecipient: 'GRECIPIENT...01',
      granterAddress: 'GGRANTER...01',
      accountSequence: 1,
      validityWindowSeconds: 300,
      permissions: ['records:read'],
    };

    const pastResult = verifyDelegationVoucher(pastVoucher, {
      nowSeconds: now,
      replayCache: testReplayCache,
      sequenceTracker: testSequenceTracker,
    });
    expect(pastResult.isValid).toBe(false);
    expect(pastResult.code).toBe('TIMESTAMP_SKEW');

    // Skewed 130 seconds into the future
    const futureVoucher: DelegationVoucher = {
      nonce: generateUUIDv4(),
      timestamp: now + 130,
      targetRecipient: 'GRECIPIENT...01',
      granterAddress: 'GGRANTER...01',
      accountSequence: 2,
      validityWindowSeconds: 300,
      permissions: ['records:read'],
    };

    const futureResult = verifyDelegationVoucher(futureVoucher, {
      nowSeconds: now,
      replayCache: testReplayCache,
      sequenceTracker: testSequenceTracker,
    });
    expect(futureResult.isValid).toBe(false);
    expect(futureResult.code).toBe('TIMESTAMP_SKEW');
  });

  it('rejects replayed vouchers using the anti-replay cache', async () => {
    const now = Math.floor(Date.now() / 1000);
    const voucher = await createDelegationVoucher({
      targetRecipient: 'GRECIPIENT...01',
      granterAddress: 'GGRANTER...01',
      accountSequence: 1,
      permissions: ['records:read'],
      timestamp: now,
    });

    // First presentation should succeed
    const firstResult = verifyDelegationVoucher(voucher, {
      nowSeconds: now,
      replayCache: testReplayCache,
      sequenceTracker: testSequenceTracker,
    });
    expect(firstResult.isValid).toBe(true);

    // Second presentation of the exact same voucher must be rejected
    const replayResult = verifyDelegationVoucher(voucher, {
      nowSeconds: now,
      replayCache: testReplayCache,
      sequenceTracker: testSequenceTracker,
    });
    expect(replayResult.isValid).toBe(false);
    expect(replayResult.code).toBe('REPLAY_ATTACK');
  });

  it('enforces monotonically increasing account sequences', async () => {
    const now = Math.floor(Date.now() / 1000);

    const voucherSeq5: DelegationVoucher = {
      nonce: generateUUIDv4(),
      timestamp: now,
      targetRecipient: 'GRECIPIENT...01',
      granterAddress: 'GGRANTER...SEQ',
      accountSequence: 5,
      validityWindowSeconds: 300,
      permissions: ['records:read'],
    };

    const result5 = verifyDelegationVoucher(voucherSeq5, {
      nowSeconds: now,
      replayCache: testReplayCache,
      sequenceTracker: testSequenceTracker,
    });
    expect(result5.isValid).toBe(true);

    // Sequence 3 (lower than 5) must be rejected
    const voucherSeq3: DelegationVoucher = {
      nonce: generateUUIDv4(),
      timestamp: now,
      targetRecipient: 'GRECIPIENT...01',
      granterAddress: 'GGRANTER...SEQ',
      accountSequence: 3,
      validityWindowSeconds: 300,
      permissions: ['records:read'],
    };

    const result3 = verifyDelegationVoucher(voucherSeq3, {
      nowSeconds: now,
      replayCache: testReplayCache,
      sequenceTracker: testSequenceTracker,
    });
    expect(result3.isValid).toBe(false);
    expect(result3.code).toBe('INVALID_SEQUENCE');

    // Duplicate sequence 5 must also be rejected
    const voucherSeq5Dup: DelegationVoucher = {
      nonce: generateUUIDv4(),
      timestamp: now,
      targetRecipient: 'GRECIPIENT...01',
      granterAddress: 'GGRANTER...SEQ',
      accountSequence: 5,
      validityWindowSeconds: 300,
      permissions: ['records:read'],
    };

    const result5Dup = verifyDelegationVoucher(voucherSeq5Dup, {
      nowSeconds: now,
      replayCache: testReplayCache,
      sequenceTracker: testSequenceTracker,
    });
    expect(result5Dup.isValid).toBe(false);
    expect(result5Dup.code).toBe('INVALID_SEQUENCE');

    // Higher sequence (e.g. 6) must succeed
    const voucherSeq6: DelegationVoucher = {
      nonce: generateUUIDv4(),
      timestamp: now,
      targetRecipient: 'GRECIPIENT...01',
      granterAddress: 'GGRANTER...SEQ',
      accountSequence: 6,
      validityWindowSeconds: 300,
      permissions: ['records:read'],
    };

    const result6 = verifyDelegationVoucher(voucherSeq6, {
      nowSeconds: now,
      replayCache: testReplayCache,
      sequenceTracker: testSequenceTracker,
    });
    expect(result6.isValid).toBe(true);
  });

  it('rejects vouchers where validityWindowSeconds does not match the strict 300s window', async () => {
    const now = Math.floor(Date.now() / 1000);
    const voucherNon300: DelegationVoucher = {
      nonce: generateUUIDv4(),
      timestamp: now,
      targetRecipient: 'GRECIPIENT...01',
      granterAddress: 'GGRANTER...01',
      accountSequence: 1,
      validityWindowSeconds: 600, // Invalid: must strictly be 300
      permissions: ['records:read'],
    };

    const result = verifyDelegationVoucher(voucherNon300, {
      nowSeconds: now,
      replayCache: testReplayCache,
      sequenceTracker: testSequenceTracker,
    });
    expect(result.isValid).toBe(false);
    expect(result.code).toBe('EXPIRED');
  });
});

