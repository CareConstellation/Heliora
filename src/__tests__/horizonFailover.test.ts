import {
  HORIZON_ENDPOINTS,
  getEndpointHealthMap,
  simulateEndpointOutage,
  recoverEndpoint,
  resetAllEndpointHealth,
  callHorizonWithFallback,
} from '@/lib/stellar';
import { recordNodeHealthTelemetry } from '@/lib/sentry';

jest.mock('@/lib/sentry', () => ({
  recordNodeHealthTelemetry: jest.fn(),
  traceHorizonCall: jest.fn((cb) => cb(jest.fn())),
  addBreadcrumbSafe: jest.fn(),
  captureExceptionSafe: jest.fn(),
}));

describe('Issue #196: Automated Horizon Endpoint Failover and Latency-based Routing', () => {
  beforeEach(() => {
    resetAllEndpointHealth();
    jest.clearAllMocks();
  });

  afterEach(() => {
    resetAllEndpointHealth();
  });

  it('maintains a list of multiple production/testnet Horizon endpoints', () => {
    expect(HORIZON_ENDPOINTS).toBeDefined();
    expect(HORIZON_ENDPOINTS.length).toBeGreaterThanOrEqual(3);
    expect(HORIZON_ENDPOINTS[0]).toContain('stellar.org');
  });

  it('initializes health tracking map for all configured endpoints', () => {
    const healthMap = getEndpointHealthMap();
    expect(Object.keys(healthMap).length).toBe(HORIZON_ENDPOINTS.length);

    for (const url of HORIZON_ENDPOINTS) {
      expect(healthMap[url]).toBeDefined();
      expect(healthMap[url]?.isAlive).toBe(true);
      expect(healthMap[url]?.consecutiveFailures).toBe(0);
    }
  });

  it('routes request to primary healthy endpoint and records latency', async () => {
    const mockOperation = jest.fn().mockImplementation((_server) => {
      return Promise.resolve({ data: 'mock_server_data', serverUrl: server.serverURL.toString() });
    });

    const result = await callHorizonWithFallback(mockOperation);
    expect(result.data).toBe('mock_server_data');

    const healthMap = getEndpointHealthMap();
    const primaryUrl = HORIZON_ENDPOINTS[0]!;
    expect(healthMap[primaryUrl]?.consecutiveFailures).toBe(0);
    expect(healthMap[primaryUrl]?.isAlive).toBe(true);
    expect(recordNodeHealthTelemetry).toHaveBeenCalledWith(
      expect.stringContaining('http'),
      expect.objectContaining({ isAlive: true, consecutiveFailures: 0 }),
    );
  });

  it('dynamically fails over when primary endpoint encounters HTTP 429', async () => {
    let callCount = 0;
    const mockOperation = jest.fn().mockImplementation((_server) => {
      callCount++;
      if (callCount === 1) {
        const err: any = new Error('Too Many Requests');
        err.response = { status: 429 };
        return Promise.reject(err);
      }
      return Promise.resolve({ success: true, serverUrl: server.serverURL.toString() });
    });

    const result = await callHorizonWithFallback(mockOperation);
    expect(result.success).toBe(true);

    const healthMap = getEndpointHealthMap();
    const failedEndpoint = HORIZON_ENDPOINTS[0]!;
    expect(healthMap[failedEndpoint]?.consecutiveFailures).toBe(1);
    expect(recordNodeHealthTelemetry).toHaveBeenCalled();
  });

  it('dynamically fails over on HTTP 502 Bad Gateway and 503 Service Unavailable', async () => {
    let callCount = 0;
    const mockOperation = jest.fn().mockImplementation((_server) => {
      callCount++;
      if (callCount === 1) {
        const err: any = new Error('Bad Gateway');
        err.response = { status: 502 };
        return Promise.reject(err);
      }
      if (callCount === 2) {
        const err: any = new Error('Service Unavailable');
        err.response = { status: 503 };
        return Promise.reject(err);
      }
      return Promise.resolve({ recoveredOnThirdNode: true });
    });

    const result = await callHorizonWithFallback(mockOperation);
    expect(result.recoveredOnThirdNode).toBe(true);
    expect(mockOperation).toHaveBeenCalledTimes(3);
  });

  it('simulates outage with simulateEndpointOutage and recovers with recoverEndpoint', async () => {
    const targetEndpoint = HORIZON_ENDPOINTS[0]!;

    // Simulate outage
    simulateEndpointOutage(targetEndpoint);
    let healthMap = getEndpointHealthMap();
    expect(healthMap[targetEndpoint]?.isAlive).toBe(false);
    expect(healthMap[targetEndpoint]?.consecutiveFailures).toBeGreaterThanOrEqual(3);

    // Call fallback — should skip targetEndpoint and use another node
    const mockOperation = jest.fn().mockResolvedValue({ status: 'ok' });
    await callHorizonWithFallback(mockOperation);

    // Recover endpoint
    recoverEndpoint(targetEndpoint);
    healthMap = getEndpointHealthMap();
    expect(healthMap[targetEndpoint]?.isAlive).toBe(true);
    expect(healthMap[targetEndpoint]?.consecutiveFailures).toBe(0);
  });

  it('throws descriptive error when all configured Horizon endpoints fail', async () => {
    const mockOperation = jest.fn().mockImplementation(() => {
      const err: any = new Error('Gateway Timeout');
      err.response = { status: 504 };
      return Promise.reject(err);
    });

    await expect(callHorizonWithFallback(mockOperation)).rejects.toThrow(
      'All 3 Horizon endpoints failed',
    );
  });
});
