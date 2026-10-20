import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { Sep38FirmQuote } from '@/types';

process.env.NEXT_PUBLIC_SEP38_ANCHOR_DOMAIN = 'anchor.example.com';

const mockAnchor = {
  homeDomain: 'anchor.example.com',
  quoteServer: 'https://anchor.example.com/sep38',
  webAuthEndpoint: 'https://anchor.example.com/auth',
  signingKey: 'GSERVER',
};

jest.mock('@/lib/sep10', () => ({
  resolveAnchor: jest.fn(async () => mockAnchor),
  getSep10Token: jest.fn(async () => 'jwt'),
}));
jest.mock('@/lib/stellar', () => ({ freighterSigner: jest.fn() }));
jest.mock('@/store/useWalletStore', () => ({ useWalletStore: () => ({ publicKey: 'GPATIENT' }) }));
jest.mock('@/services/api.service', () => ({
  fetchSep38Info: jest.fn(async () => [
    {
      asset: 'iso4217:BRL',
      sell_delivery_methods: [
        { name: 'PIX', description: 'Pix transfer' },
        { name: 'TED', description: 'Bank wire' },
      ],
    },
  ]),
  fetchSep38Prices: jest.fn(async () => [{ asset: 'iso4217:BRL', price: '0.62', decimals: 2 }]),
  createSep38Quote: jest.fn(),
}));

const { createSep38Quote } = jest.requireMock('@/services/api.service') as {
  createSep38Quote: jest.Mock;
};
const { default: AnchorQuote, isQuoteActive } =
  require('@/components/appointments/AnchorQuote') as typeof import('@/components/appointments/AnchorQuote');

const NOW = new Date('2026-10-19T12:00:00.000Z').getTime();

const firmQuote = (expiresInMs: number): Sep38FirmQuote => ({
  id: 'quote-1',
  expires_at: new Date(NOW + expiresInMs).toISOString(),
  price: '0.60',
  total_price: '0.62',
  sell_asset: 'iso4217:BRL',
  sell_amount: '6.20',
  sell_delivery_method: 'PIX',
  buy_asset: 'stellar:native',
  buy_amount: '10',
  fee: { total: '0.20', asset: 'iso4217:BRL', details: [{ name: 'PIX fee', amount: '0.20' }] },
});

function Harness({ onQuote }: { onQuote: (q: Sep38FirmQuote | null) => void }) {
  const [quote, setQuote] = useState<Sep38FirmQuote | null>(null);
  return (
    <AnchorQuote
      buyAsset="stellar:native"
      buyAmount="10"
      quote={quote}
      onQuote={(q) => {
        setQuote(q);
        onQuote(q);
      }}
    />
  );
}

function renderHarness(onQuote = jest.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness onQuote={onQuote} />
    </QueryClientProvider>,
  );
  return onQuote;
}

describe('AnchorQuote', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    createSep38Quote.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('locks a firm quote and shows fees and an expiry countdown', async () => {
    createSep38Quote.mockResolvedValueOnce(firmQuote(5 * 60 * 1000));
    renderHarness();

    fireEvent.change(await screen.findByLabelText('Pay with'), {
      target: { value: 'iso4217:BRL' },
    });
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'PIX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lock in rate' }));

    expect(await screen.findByText(/expires in 5:00/)).toBeInTheDocument();
    expect(screen.getByText('6.20 BRL')).toBeInTheDocument();
    expect(screen.getByText('PIX fee')).toBeInTheDocument();
    expect(createSep38Quote).toHaveBeenCalledWith(mockAnchor.quoteServer, 'jwt', {
      sell_asset: 'iso4217:BRL',
      buy_asset: 'stellar:native',
      buy_amount: '10',
      expire_after: expect.any(String),
      context: 'sep6',
      sell_delivery_method: 'PIX',
    });
    const { expire_after } = createSep38Quote.mock.calls[0]![2] as { expire_after: string };
    expect(new Date(expire_after).getTime()).toBeGreaterThanOrEqual(NOW + 10 * 60 * 1000);

    act(() => jest.advanceTimersByTime(61_000));
    expect(screen.getByText(/expires in 3:59/)).toBeInTheDocument();
  });

  it('requires a delivery method when the anchor offers more than one', async () => {
    renderHarness();

    fireEvent.change(await screen.findByLabelText('Pay with'), {
      target: { value: 'iso4217:BRL' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lock in rate' }));

    expect(await screen.findByText('Select how you will send the payment.')).toBeInTheDocument();
    expect(createSep38Quote).not.toHaveBeenCalled();
  });

  it('releases the quote when it expires', async () => {
    createSep38Quote.mockResolvedValueOnce(firmQuote(2000));
    const onQuote = renderHarness();

    fireEvent.change(await screen.findByLabelText('Pay with'), {
      target: { value: 'iso4217:BRL' },
    });
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'PIX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lock in rate' }));
    await screen.findByText(/expires in/);

    act(() => jest.advanceTimersByTime(3000));

    await waitFor(() => expect(onQuote).toHaveBeenLastCalledWith(null));
    expect(
      screen.getByText('Your quote expired. Request a new one to continue.'),
    ).toBeInTheDocument();
  });

  it('rejects a quote that does not match the requested amount', async () => {
    createSep38Quote.mockResolvedValueOnce({ ...firmQuote(60_000), buy_amount: '9' });
    const onQuote = renderHarness();

    fireEvent.change(await screen.findByLabelText('Pay with'), {
      target: { value: 'iso4217:BRL' },
    });
    fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: 'PIX' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lock in rate' }));

    expect(await screen.findByText(/does not match this appointment/)).toBeInTheDocument();
    expect(onQuote).not.toHaveBeenCalled();
  });

  it('isQuoteActive is false at and after expires_at', () => {
    const quote = firmQuote(1000);
    expect(isQuoteActive(quote, NOW)).toBe(true);
    expect(isQuoteActive(quote, NOW + 1000)).toBe(false);
    expect(isQuoteActive(null)).toBe(false);
  });
});
