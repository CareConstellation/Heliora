import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn(() => ({ headers: new (globalThis as { Headers: new () => unknown }).Headers() })),
  },
}));

class TestHeaders {
  private values = new Map<string, string>();

  constructor(init?: { forEach?: (callback: (value: string, key: string) => void) => void }) {
    init?.forEach?.((value, key) => this.values.set(key.toLowerCase(), value));
  }

  set(key: string, value: string): void {
    this.values.set(key.toLowerCase(), value);
  }

  get(key: string): string | null {
    return this.values.get(key.toLowerCase()) ?? null;
  }

  forEach(callback: (value: string, key: string) => void): void {
    this.values.forEach((value, key) => callback(value, key));
  }
}

const SECURE_ROUTES = ['/', '/appointments', '/appointments/confirm', '/wallet/send', '/dashboard/patient'];

describe('clickjacking prevention headers', () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, 'Headers', {
      value: TestHeaders,
      configurable: true,
      writable: true,
    });
  });

  it.each(SECURE_ROUTES)('denies framing of %s', (_route) => {
    const request = { headers: new TestHeaders() } as unknown as NextRequest;
    const response = middleware(request);

    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('declares X-Frame-Options DENY for every path in next.config.mjs', () => {
    const config = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8');

    expect(config).toMatch(/source:\s*'\/:path\*'/);
    expect(config).toMatch(/key:\s*'X-Frame-Options',\s*value:\s*'DENY'/);
    expect(config).toMatch(/key:\s*'Content-Security-Policy',\s*value:\s*"frame-ancestors 'none'"/);
  });
});
