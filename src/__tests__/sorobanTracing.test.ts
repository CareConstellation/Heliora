const spans: string[] = [];
const setAttribute = jest.fn();

jest.mock('@sentry/nextjs', () => ({
  startSpan: (opts: { op: string }, cb: (span: unknown) => unknown) => {
    spans.push(opts.op);
    return cb({ setAttribute });
  },
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('@stellar/freighter-api', () => ({ signTransaction: jest.fn(), signMessage: jest.fn() }));
jest.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

const server = {
  getAccount: jest.fn(),
  prepareTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  pollTransaction: jest.fn(),
};

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: { ...actual.rpc, Server: jest.fn(() => server) },
    TransactionBuilder: Object.assign(
      jest.fn(() => {
        const builder = {
          addOperation: () => builder,
          setTimeout: () => builder,
          build: () => ({ kind: 'tx' }),
        };
        return builder;
      }),
      { fromXDR: jest.fn(() => ({ kind: 'signed' })) },
    ),
  };
});

import { rpc, type xdr } from '@stellar/stellar-sdk';
import { invokeSorobanContract } from '@/lib/stellar';

const SOURCE = 'GAKPDO7HGBGBLGDF4GLRQZ5BIMGVZ4R7X5AYSUFVCGI4ZBRWRJUSX7QM';

describe('invokeSorobanContract tracing', () => {
  beforeEach(() => {
    spans.length = 0;
    jest.clearAllMocks();
    server.getAccount.mockResolvedValue({});
    server.prepareTransaction.mockResolvedValue({ toXDR: () => 'AAAA' });
    server.sendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'deadbeef' });
    server.pollTransaction.mockResolvedValue({ status: rpc.Api.GetTransactionStatus.SUCCESS });
  });

  it('traces build → simulate → sign → submit → confirm under one stellar.tx span', async () => {
    const signer = jest.fn().mockResolvedValue('signed-xdr');
    const hash = await invokeSorobanContract(SOURCE, {} as xdr.Operation, signer, 'soroban.test');

    expect(hash).toBe('deadbeef');
    expect(spans).toEqual([
      'stellar.tx',
      'stellar.tx.build',
      'stellar.tx.simulate',
      'stellar.tx.sign',
      'stellar.tx.submit',
      'stellar.tx.confirm',
    ]);
    expect(signer).toHaveBeenCalledWith('AAAA', expect.any(String), SOURCE);
    expect(setAttribute).toHaveBeenCalledWith('stellar.tx_hash', 'deadbeef');
  });

  it('stops at the failing phase and surfaces the error', async () => {
    const signer = jest.fn().mockRejectedValue(new Error('User declined'));
    await expect(invokeSorobanContract(SOURCE, {} as xdr.Operation, signer)).rejects.toThrow(
      'User declined',
    );
    expect(spans).toEqual([
      'stellar.tx',
      'stellar.tx.build',
      'stellar.tx.simulate',
      'stellar.tx.sign',
    ]);
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it('fails the submit phase when the RPC rejects the transaction', async () => {
    server.sendTransaction.mockResolvedValue({ status: 'ERROR', hash: 'x' });
    await expect(
      invokeSorobanContract(SOURCE, {} as xdr.Operation, jest.fn().mockResolvedValue('s')),
    ).rejects.toThrow('not accepted (ERROR)');
    expect(spans[spans.length - 1]).toBe('stellar.tx.submit');
  });
});
