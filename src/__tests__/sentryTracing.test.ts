const startSpan = jest.fn();
const setAttribute = jest.fn();

jest.mock('@sentry/nextjs', () => ({
  startSpan: (opts: unknown, cb: (span: unknown) => unknown) => {
    startSpan(opts);
    return cb({ setAttribute });
  },
  setUser: jest.fn(),
  setTag: jest.fn(),
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  init: jest.fn(),
  browserTracingIntegration: jest.fn(() => ({ name: 'BrowserTracing' })),
  replayIntegration: jest.fn((opts: unknown) => ({ name: 'Replay', opts })),
}));

import * as Sentry from '@sentry/nextjs';
import {
  REDACTED,
  captureError,
  createTracesSampler,
  getSampleRates,
  getSentryOptions,
  getTracePropagationTargets,
  parseSampleRate,
  scrubBreadcrumb,
  scrubData,
  scrubEvent,
  scrubString,
  scrubUrl,
  traceHorizonCall,
  traceStellarTransaction,
  traceUserAction,
} from '@/lib/sentry';

const SECRET = 'SBK2VIYYSVG76E7VC3QHYARNFLY2EAQXDHRC7BMXBBGIFG74ARPRMNQM';
const ACCOUNT = 'GAKPDO7HGBGBLGDF4GLRQZ5BIMGVZ4R7X5AYSUFVCGI4ZBRWRJUSX7QM';

describe('PII and secret scrubbing', () => {
  it('redacts Stellar secrets, addresses, bearer tokens, JWTs and emails in text', () => {
    const text = `seed=${SECRET} acct ${ACCOUNT} Bearer abc.def-123 eyJhbGciOi.eyJzdWIiOi.sig jane@clinic.org`;
    const out = scrubString(text);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(ACCOUNT);
    expect(out).not.toContain('abc.def-123');
    expect(out).not.toContain('eyJhbGciOi');
    expect(out).not.toContain('jane@clinic.org');
    expect(out).toContain('[stellar-secret]');
    expect(out).toContain('[stellar-address]');
  });

  it('strips query strings (which carry patient addresses) from URLs', () => {
    expect(scrubUrl(`/api/records?patientAddress=${ACCOUNT}&x=1`)).toBe('/api/records');
    expect(scrubUrl(`/api/patients/${ACCOUNT}`)).toBe('/api/patients/[stellar-address]');
  });

  it('masks sensitive keys deeply without mutating input', () => {
    const input = {
      diagnosis: 'Type 2 diabetes',
      notes: 'patient anxious',
      privateKey: SECRET,
      nested: { patientName: 'Jane Doe', icd10: 'E11.9', count: 3 },
      list: [{ email: 'a@b.co' }],
      ok: 'appointment',
    };
    const out = scrubData(input);
    expect(out).toEqual({
      diagnosis: REDACTED,
      notes: REDACTED,
      privateKey: REDACTED,
      nested: { patientName: REDACTED, icd10: REDACTED, count: 3 },
      list: [{ email: REDACTED }],
      ok: 'appointment',
    });
    expect(input.diagnosis).toBe('Type 2 diabetes');
  });

  it('drops request bodies and console arguments from breadcrumbs', () => {
    const xhr = scrubBreadcrumb({
      category: 'xhr',
      data: {
        url: `/records?patientAddress=${ACCOUNT}`,
        method: 'POST',
        status_code: 200,
        body: '{"diagnosis":"x"}',
      },
    });
    expect(xhr?.data).toEqual({ url: '/records', method: 'POST', status_code: 200 });

    const consoleCrumb = scrubBreadcrumb({
      category: 'console',
      message: `signing with ${SECRET}`,
      data: { arguments: [{ notes: 'x' }], logger: 'console' },
    });
    expect(consoleCrumb?.message).toBe('signing with [stellar-secret]');
    expect(consoleCrumb?.data).toEqual({ logger: 'console' });
  });

  it('scrubs error events: request, user, extra, exception values, breadcrumbs and spans', () => {
    const event = scrubEvent({
      message: `failed for ${ACCOUNT}`,
      request: {
        url: `https://app.heliora.io/records?patientAddress=${ACCOUNT}`,
        method: 'POST',
        data: { diagnosis: 'flu' },
        cookies: { session: 'x' },
        headers: { Authorization: 'Bearer abc', 'User-Agent': 'jest' },
      },
      user: { id: ACCOUNT, email: 'x@y.z', ip_address: '1.2.3.4' },
      extra: { clinicalNotes: 'secret', attempt: 2 },
      contexts: {
        browser: { name: 'Chrome', version: '131' },
        trace: { trace_id: 't', span_id: 's', op: 'ui.action', data: { diagnosis: 'flu' } },
        patient: { name: 'Jane Doe' },
      },
      exception: { values: [{ type: 'Error', value: `bad key ${SECRET}` }] },
      breadcrumbs: [{ category: 'fetch', data: { url: '/a?b=c' } }],
      spans: [
        { description: `GET /records?patientAddress=${ACCOUNT}`, data: { 'http.query': '?x' } },
      ],
    });

    expect(event.message).toBe('failed for [stellar-address]');
    expect(event.request).toEqual({
      url: 'https://app.heliora.io/records',
      method: 'POST',
      headers: { Authorization: REDACTED, 'User-Agent': 'jest' },
    });
    expect(event.user).toEqual({ id: ACCOUNT });
    expect(event.extra).toEqual({ clinicalNotes: REDACTED, attempt: 2 });
    expect(event.contexts).toEqual({
      browser: { name: 'Chrome', version: '131' },
      trace: { trace_id: 't', span_id: 's', op: 'ui.action', data: { diagnosis: REDACTED } },
      patient: { name: REDACTED },
    });
    expect(event.exception.values[0]!.value).toBe('bad key [stellar-secret]');
    expect(event.breadcrumbs[0]!.data).toEqual({ url: '/a' });
    expect(event.spans[0]).toEqual({
      description: 'GET /records',
      data: { 'http.query': REDACTED },
    });
  });

  it('scrubs context passed to captureError', () => {
    captureError(new Error('x'), { diagnosis: 'flu', step: 'submit' });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { diagnosis: REDACTED, step: 'submit' },
    });
  });
});

describe('sampling', () => {
  it('parses env sample rates and falls back on invalid input', () => {
    expect(parseSampleRate('0.25', 1)).toBe(0.25);
    expect(parseSampleRate('2', 0.1)).toBe(0.1);
    expect(parseSampleRate('abc', 0.1)).toBe(0.1);
    expect(parseSampleRate(undefined, 0.1)).toBe(0.1);
  });

  it('uses low default rates in production', () => {
    expect(getSampleRates({ NODE_ENV: 'production' })).toEqual({
      traces: 0.1,
      stellarTraces: 0.5,
      replaySession: 0.1,
      replayOnError: 1,
    });
    expect(
      getSampleRates({ NODE_ENV: 'production', NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '0.02' })
        .traces,
    ).toBe(0.02);
  });

  const sampler = createTracesSampler({
    traces: 0.1,
    stellarTraces: 0.5,
    replaySession: 0,
    replayOnError: 1,
  });

  it('never traces health checks or static assets', () => {
    expect(sampler({ name: 'GET /api/health' })).toBe(0);
    expect(sampler({ name: 'GET /_next/static/chunk.js' })).toBe(0);
  });

  it('uses the Stellar rate for stellar.* ops and the base rate otherwise', () => {
    expect(sampler({ name: 'soroban.grant_role', attributes: { 'sentry.op': 'stellar.tx' } })).toBe(
      0.5,
    );
    expect(sampler({ name: '/dashboard', attributes: { 'sentry.op': 'pageload' } })).toBe(0.1);
  });

  it('honours the parent sampling decision to keep distributed traces whole', () => {
    expect(sampler({ name: '/x', parentSampled: true })).toBe(1);
    expect(sampler({ name: '/x', parentSampled: false })).toBe(0);
    const inherit = jest.fn(() => 0.42);
    expect(sampler({ name: '/x', inheritOrSampleWith: inherit })).toBe(0.42);
    expect(inherit).toHaveBeenCalledWith(0.1);
  });

  it('propagates trace headers only to same-origin and the configured API origin', () => {
    const targets = getTracePropagationTargets('https://api.heliora.io/v1');
    const matches = (url: string) =>
      targets.some((t) => (typeof t === 'string' ? url.includes(t) : t.test(url)));
    expect(matches('/api/v1/records')).toBe(true);
    expect(matches('https://api.heliora.io/v1/appointments')).toBe(true);
    expect(matches('https://horizon-testnet.stellar.org/accounts')).toBe(false);
    expect(matches('https://api.heliora.io.evil.com/x')).toBe(false);
    expect(matches('//cdn.example.com/x')).toBe(false);
  });

  it('builds client options with masking replay and scrub hooks', () => {
    const options = getSentryOptions('client') as Record<string, unknown>;
    expect(options.sendDefaultPii).toBe(false);
    expect(typeof options.tracesSampler).toBe('function');
    expect(typeof options.beforeBreadcrumb).toBe('function');
    expect(typeof options.beforeSend).toBe('function');
    expect(typeof options.beforeSendTransaction).toBe('function');
    expect(Sentry.replayIntegration).toHaveBeenCalledWith({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    });
    expect(options.enabled).toBe(false); // no DSN / not production in tests
    expect('integrations' in getSentryOptions('server')).toBe(false);
  });
});

describe('tracing helpers', () => {
  beforeEach(() => {
    startSpan.mockClear();
    setAttribute.mockClear();
  });

  it('wraps user actions in a ui.action transaction', async () => {
    await expect(traceUserAction('appointment.cancel', () => 'ok')).resolves.toBe('ok');
    expect(startSpan).toHaveBeenCalledWith({
      name: 'appointment.cancel',
      op: 'ui.action',
      forceTransaction: true,
    });
  });

  it('creates a parent stellar.tx span with one child span per lifecycle phase', async () => {
    const hash = await traceStellarTransaction(
      'soroban.grant_role',
      { 'stellar.network': 'testnet', address: ACCOUNT },
      async (step, setTxHash) => {
        await step('build', () => 'tx');
        await step('sign', async () => 'signed');
        await step('submit', async () => 'h');
        setTxHash('abc123');
        await step('confirm', async () => undefined);
        return 'abc123';
      },
    );

    expect(hash).toBe('abc123');
    expect(startSpan.mock.calls.map(([o]) => (o as { op: string }).op)).toEqual([
      'stellar.tx',
      'stellar.tx.build',
      'stellar.tx.sign',
      'stellar.tx.submit',
      'stellar.tx.confirm',
    ]);
    // Attributes are scrubbed before being attached.
    expect(startSpan.mock.calls[0]![0]).toMatchObject({
      attributes: { 'stellar.network': 'testnet', address: REDACTED },
    });
    expect(setAttribute).toHaveBeenCalledWith('stellar.tx_hash', 'abc123');
  });

  it('propagates step failures to the caller', async () => {
    await expect(
      traceStellarTransaction('x', {}, async (step) =>
        step('sign', async () => {
          throw new Error('User declined');
        }),
      ),
    ).rejects.toThrow('User declined');
  });

  it('records Horizon endpoint failover attempts on a stellar.horizon span', async () => {
    const result = await traceHorizonCall(async (recordAttempt) => {
      recordAttempt('https://horizon-testnet.stellar.org');
      recordAttempt('https://testnet.stellar.lobstr.co');
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(startSpan).toHaveBeenCalledWith({ name: 'horizon.request', op: 'stellar.horizon' });
    expect(setAttribute).toHaveBeenCalledWith('stellar.horizon.attempts', 2);
    expect(setAttribute).toHaveBeenLastCalledWith(
      'stellar.horizon.endpoint',
      'testnet.stellar.lobstr.co',
    );
  });
});
