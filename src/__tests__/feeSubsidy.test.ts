import { computeFeeInvoice } from '@/lib/feeSubsidy';

describe('computeFeeInvoice (#65)', () => {
  it('charges the full fee without a subsidy', () => {
    expect(computeFeeInvoice(10)).toMatchObject({
      subsidyAmount: 0,
      patientPays: 10,
      tier: 'standard',
    });
  });

  it('splits the fee between grantor and patient', () => {
    expect(
      computeFeeInvoice(10, { tier: 'tier-2', discountPercent: 60, grantor: 'City Fund' }),
    ).toEqual({
      baseFee: 10,
      subsidyAmount: 6,
      patientPays: 4,
      tier: 'tier-2',
      grantor: 'City Fund',
    });
  });

  it('clamps out-of-range discounts and rounds to 7 decimals', () => {
    expect(computeFeeInvoice(10, { tier: 'x', discountPercent: 150 }).patientPays).toBe(0);
    expect(computeFeeInvoice(10, { tier: 'x', discountPercent: -5 }).patientPays).toBe(10);
    expect(computeFeeInvoice(1, { tier: 'x', discountPercent: 33.3333333333 }).patientPays).toBe(
      0.6666667,
    );
  });
});
