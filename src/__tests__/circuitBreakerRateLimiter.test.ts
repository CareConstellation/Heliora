import {
  TokenBucketRateLimiter,
  CircuitBreaker,
  executeResilientRequest,
} from '@/lib/stellar';
import { TOAST_EVENT } from '@/components/ui/Toast';

describe('Issue #169: Client-Side Rate Limiting and DDoS Circuit Breaker', () => {
  describe('TokenBucketRateLimiter (10 calls/second)', () => {
    it('initializes with capacity of 10 and refill rate of 10 tokens/sec', () => {
      const limiter = new TokenBucketRateLimiter(10, 10);
      expect(limiter.getAvailableTokens()).toBe(10);
    });

    it('allows up to 10 consecutive calls instantly without throttling', () => {
      const limiter = new TokenBucketRateLimiter(10, 10);
      for (let i = 0; i < 10; i++) {
        expect(limiter.tryAcquire(1)).toBe(true);
      }
      expect(limiter.tryAcquire(1)).toBe(false);
      expect(limiter.getAvailableTokens()).toBeLessThan(1);
    });

    it('refills tokens over time mathematically at 10 tokens per second', () => {
      const limiter = new TokenBucketRateLimiter(10, 10);
      // Consume all 10 tokens
      for (let i = 0; i < 10; i++) {
        limiter.tryAcquire(1);
      }
      expect(limiter.tryAcquire(1)).toBe(false);

      // Advance time by 500ms -> should refill 5 tokens
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now + 500);

      expect(limiter.getAvailableTokens()).toBeGreaterThanOrEqual(4);
      expect(limiter.tryAcquire(5)).toBe(true);
      expect(limiter.tryAcquire(1)).toBe(false);

      jest.restoreAllMocks();
    });
  });

  describe('CircuitBreaker (5 consecutive 429/503 errors -> OPEN for 30s)', () => {
    let mockToastListener: jest.Mock;

    beforeEach(() => {
      mockToastListener = jest.fn();
      if (typeof window !== 'undefined') {
        window.addEventListener(TOAST_EVENT, mockToastListener);
      }
    });

    afterEach(() => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(TOAST_EVENT, mockToastListener);
      }
      jest.restoreAllMocks();
    });

    it('starts in CLOSED state with 0 consecutive failures', () => {
      const breaker = new CircuitBreaker(5, 30000);
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getStats().consecutiveFailures).toBe(0);
    });

    it('trips to OPEN after 5 consecutive HTTP 429 / 503 errors and emits toast', async () => {
      const breaker = new CircuitBreaker(5, 30000);

      const failOperation = () => {
        const err: any = new Error('Too Many Requests');
        err.response = { status: 429 };
        return Promise.reject(err);
      };

      // 4 consecutive failures
      for (let i = 0; i < 4; i++) {
        await expect(breaker.execute(failOperation)).rejects.toThrow('Too Many Requests');
        expect(breaker.getState()).toBe('CLOSED');
        expect(breaker.getStats().consecutiveFailures).toBe(i + 1);
      }

      // 5th failure trips breaker
      await expect(breaker.execute(failOperation)).rejects.toThrow('Too Many Requests');
      expect(breaker.getState()).toBe('OPEN');
      expect(breaker.getStats().consecutiveFailures).toBe(5);

      // Toast emitted
      expect(mockToastListener).toHaveBeenCalled();
      const eventDetail = mockToastListener.mock.calls[0][0].detail;
      expect(eventDetail.message).toBe('Network request limit reached; cooling down...');
    });

    it('falls back to cached state for 30 seconds when circuit is OPEN', async () => {
      const breaker = new CircuitBreaker(5, 30000);
      const cacheKey = 'account-balance:GTEST123';

      // Prime the cache with successful call
      await breaker.execute(() => Promise.resolve({ balance: '100 XLM' }), cacheKey);
      expect(breaker.getCached(cacheKey)).toEqual({ balance: '100 XLM' });

      // Trip the circuit breaker with 5 consecutive 503 errors
      const failOperation = () => {
        const err: any = new Error('Service Unavailable');
        err.response = { status: 503 };
        return Promise.reject(err);
      };
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(failOperation);
        } catch {}
      }
      expect(breaker.getState()).toBe('OPEN');

      // Subsequent call while OPEN falls back to cache
      const cachedResult = await breaker.execute(
        () => Promise.reject(new Error('Should not even be called')),
        cacheKey,
      );
      expect(cachedResult).toEqual({ balance: '100 XLM' });
    });

    it('transitions to HALF_OPEN after 30s cooldown and recovers on success', async () => {
      const breaker = new CircuitBreaker(5, 30000);

      // Force breaker to OPEN
      const failOperation = () => {
        const err: any = new Error('Rate limit exceeded');
        err.response = { status: 429 };
        return Promise.reject(err);
      };
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute(failOperation);
        } catch {}
      }
      expect(breaker.getState()).toBe('OPEN');

      // Advance time by 30,001 ms (beyond 30s cooldown)
      const baseTime = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(baseTime + 30001);

      // Next call attempts in HALF_OPEN
      const recovered = await breaker.execute(() => Promise.resolve('healthy_data'));
      expect(recovered).toBe('healthy_data');
      expect(breaker.getState()).toBe('CLOSED');
      expect(breaker.getStats().consecutiveFailures).toBe(0);
    });
  });

  describe('executeResilientRequest', () => {
    it('executes through rate limiter and circuit breaker cleanly', async () => {
      const res = await executeResilientRequest(
        () => Promise.resolve({ data: 'resilient_payload' }),
        'resilient-cache-key',
      );
      expect(res.data).toBe('resilient_payload');
    });
  });
});
