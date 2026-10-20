import { renderHook, act } from '@testing-library/react';
import { useQueueTracking } from '@/hooks/useNotifications';

describe('Waiting Room Queue Tracking (#49)', () => {
  it('initializes with default queue position and countdown seconds', () => {
    const { result } = renderHook(() =>
      useQueueTracking({
        appointmentId: 'appt-123',
        initialPosition: 3,
        initialWaitMinutes: 5,
      }),
    );

    expect(result.current.position).toBe(3);
    expect(result.current.estimatedWaitSeconds).toBe(300);
    expect(result.current.isDoctorReady).toBe(false);
    expect(result.current.isStepAwayRegistered).toBe(false);
  });

  it('updates state to doctor_reviewing_charts when position is 1', () => {
    const { result } = renderHook(() =>
      useQueueTracking({
        appointmentId: 'appt-123',
        initialPosition: 1,
        initialWaitMinutes: 2,
      }),
    );

    expect(result.current.position).toBe(1);
    expect(result.current.statusStage).toBe('doctor_reviewing_charts');
    expect(result.current.statusMessage).toContain('reviewing your charts');
  });

  it('allows registering step away SMS/Email notification', async () => {
    const { result } = renderHook(() =>
      useQueueTracking({
        appointmentId: 'appt-123',
        initialPosition: 2,
      }),
    );

    await act(async () => {
      const ok = await result.current.registerStepAway({
        type: 'sms',
        target: '+15551234567',
      });
      expect(ok).toBe(true);
    });

    expect(result.current.isStepAwayRegistered).toBe(true);
    expect(result.current.stepAwayContact).toEqual({
      type: 'sms',
      target: '+15551234567',
    });
  });
});
