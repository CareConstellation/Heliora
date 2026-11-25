import { sessionSync } from './sessionSync';

describe('sessionSync auto-lock (#251)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    sessionSync.cleanup();
    jest.useRealTimers();
  });

  it('fires SESSION_TIMEOUT after 15 minutes of inactivity', () => {
    const onEvent = jest.fn();
    sessionSync.resetInactivityTimer(onEvent);
    jest.advanceTimersByTime(15 * 60 * 1000);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SESSION_TIMEOUT' })
    );
  });

  it('resetting the timer postpones the timeout instead of stacking another one', () => {
    const onEvent = jest.fn();
    sessionSync.resetInactivityTimer(onEvent);
    jest.advanceTimersByTime(14 * 60 * 1000);
    sessionSync.resetInactivityTimer(onEvent); // simulates re-authentication / activity
    jest.advanceTimersByTime(14 * 60 * 1000);
    expect(onEvent).not.toHaveBeenCalled();
  });
});
