import {
  buildPreCallRecommendations,
  classifyMediaError,
  classifyRoundTripMs,
  computeVuLevel,
  getTurnConfigFromEnv,
  isSignalDetected,
  PING_FAIR_MS,
  PING_GOOD_MS,
  type PreCallReport,
} from '@/lib/preCallDiagnostics';

const cleanReport: PreCallReport = {
  mediaErrorName: null,
  micSignalDetected: true,
  roundTripMs: 60,
  turnConfigured: true,
};

describe('feat(video): pre-call hardware & network diagnostics (#262)', () => {
  describe('classifyRoundTripMs', () => {
    it('rates round trips against the good and fair thresholds', () => {
      expect(classifyRoundTripMs(PING_GOOD_MS)).toBe('good');
      expect(classifyRoundTripMs(PING_GOOD_MS + 1)).toBe('fair');
      expect(classifyRoundTripMs(PING_FAIR_MS)).toBe('fair');
      expect(classifyRoundTripMs(PING_FAIR_MS + 1)).toBe('poor');
    });

    it('treats a missing or non-finite result as unreachable', () => {
      expect(classifyRoundTripMs(null)).toBe('unreachable');
      expect(classifyRoundTripMs(Number.NaN)).toBe('unreachable');
      expect(classifyRoundTripMs(Number.POSITIVE_INFINITY)).toBe('unreachable');
    });
  });

  describe('computeVuLevel and isSignalDetected', () => {
    it('returns zero for silence and an empty buffer', () => {
      expect(computeVuLevel(new Float32Array(256))).toBe(0);
      expect(computeVuLevel(new Float32Array(0))).toBe(0);
      expect(isSignalDetected(0)).toBe(false);
    });

    it('rises with amplitude and clamps at 1', () => {
      const quiet = computeVuLevel(new Float32Array(256).fill(0.05));
      const loud = computeVuLevel(new Float32Array(256).fill(0.5));
      expect(quiet).toBeGreaterThan(0);
      expect(loud).toBeGreaterThan(quiet);
      expect(computeVuLevel(new Float32Array(256).fill(1))).toBe(1);
      expect(isSignalDetected(quiet)).toBe(true);
    });
  });

  describe('classifyMediaError', () => {
    it.each([
      ['NotAllowedError', 'permission'],
      ['PermissionDeniedError', 'permission'],
      ['NotFoundError', 'missing-device'],
      ['OverconstrainedError', 'missing-device'],
      ['NotReadableError', 'busy'],
      ['TrackStartError', 'busy'],
      ['SomethingElse', 'other'],
    ])('maps %s to %s', (name, kind) => {
      expect(classifyMediaError(name)).toBe(kind);
    });

    it('returns null when there is no error', () => {
      expect(classifyMediaError(null)).toBeNull();
    });
  });

  describe('buildPreCallRecommendations', () => {
    it('reports blocked permissions as the first error', () => {
      const items = buildPreCallRecommendations({ ...cleanReport, mediaErrorName: 'NotAllowedError' });

      expect(items[0]).toMatchObject({ id: 'media', severity: 'error' });
      expect(items[0]!.message).toMatch(/site settings/);
      expect(items.some((item) => item.id === 'ready')).toBe(false);
    });

    it('reports faulty or missing hardware with a device-specific message', () => {
      const items = buildPreCallRecommendations({ ...cleanReport, mediaErrorName: 'NotFoundError' });

      expect(items[0]!.message).toMatch(/No camera or microphone was found/);
    });

    it('reports a device in use by another application', () => {
      const items = buildPreCallRecommendations({ ...cleanReport, mediaErrorName: 'NotReadableError' });

      expect(items[0]!.message).toMatch(/in use by another application/);
    });

    it('warns when no voice is detected but the devices started', () => {
      const items = buildPreCallRecommendations({ ...cleanReport, micSignalDetected: false });

      expect(items.map((item) => item.id)).toContain('microphone-silent');
      expect(items.some((item) => item.id === 'ready')).toBe(false);
    });

    it('warns on a slow connection and errors when the relay is unreachable', () => {
      const slow = buildPreCallRecommendations({ ...cleanReport, roundTripMs: 600 });
      expect(slow.find((item) => item.id === 'network')).toMatchObject({ severity: 'warning' });

      const unreachable = buildPreCallRecommendations({ ...cleanReport, roundTripMs: null });
      expect(unreachable.find((item) => item.id === 'network')).toMatchObject({ severity: 'error' });
    });

    it('explains a skipped network check when no relay is configured', () => {
      const items = buildPreCallRecommendations({
        ...cleanReport,
        roundTripMs: null,
        turnConfigured: false,
      });

      expect(items.find((item) => item.id === 'network')).toMatchObject({ severity: 'warning' });
      expect(items.find((item) => item.id === 'network')!.message).toMatch(/not configured|skipped/);
    });

    it('returns a single all-clear message when every check passes, with errors ordered first', () => {
      const clear = buildPreCallRecommendations(cleanReport);
      expect(clear).toEqual([
        expect.objectContaining({ id: 'network', severity: 'ok' }),
        expect.objectContaining({ id: 'ready', severity: 'ok' }),
      ]);

      const mixed = buildPreCallRecommendations({
        ...cleanReport,
        mediaErrorName: 'NotAllowedError',
        roundTripMs: 600,
      });
      expect(mixed[0]!.severity).toBe('error');
      expect(mixed[mixed.length - 1]!.severity).toBe('warning');
    });
  });

  describe('getTurnConfigFromEnv', () => {
    const original = { ...process.env };

    afterEach(() => {
      process.env = { ...original };
    });

    it('returns null when no relay URLs are configured', () => {
      process.env.NEXT_PUBLIC_TURN_URLS = '  ';
      expect(getTurnConfigFromEnv()).toBeNull();
    });

    it('splits comma-separated URLs and attaches credentials only when both are set', () => {
      process.env.NEXT_PUBLIC_TURN_URLS = 'turn:relay.example.org:3478, turns:relay.example.org:5349';
      process.env.NEXT_PUBLIC_TURN_USERNAME = 'user';
      process.env.NEXT_PUBLIC_TURN_CREDENTIAL = 'secret';

      expect(getTurnConfigFromEnv()).toEqual({
        iceServers: [
          {
            urls: ['turn:relay.example.org:3478', 'turns:relay.example.org:5349'],
            username: 'user',
            credential: 'secret',
          },
        ],
      });

      delete process.env.NEXT_PUBLIC_TURN_CREDENTIAL;
      expect(getTurnConfigFromEnv()).toEqual({
        iceServers: [{ urls: ['turn:relay.example.org:3478', 'turns:relay.example.org:5349'] }],
      });
    });
  });
});
