'use client';

import { useState } from 'react';
import { useQueueTracking } from '@/hooks/useNotifications';
import type { StepAwayContact } from '@/types';

interface WaitingRoomProps {
  appointmentId: string;
  doctorName: string;
  videoRoomUrl?: string | undefined;
  initialPosition?: number | undefined;
  initialWaitMinutes?: number | undefined;
  onEnterCall?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}

export default function WaitingRoom({
  appointmentId,
  doctorName,
  videoRoomUrl,
  initialPosition = 2,
  initialWaitMinutes = 8,
  onEnterCall,
  onClose,
}: WaitingRoomProps) {
  const {
    position,
    estimatedWaitSeconds,
    statusStage,
    statusMessage,
    isDoctorReady,
    isStepAwayRegistered,
    stepAwayContact,
    registerStepAway,
  } = useQueueTracking({
    appointmentId,
    initialPosition,
    initialWaitMinutes,
  });

  const [stepAwayType, setStepAwayType] = useState<'sms' | 'email'>('sms');
  const [stepAwayTarget, setStepAwayTarget] = useState('');
  const [isSubmittingStepAway, setIsSubmittingStepAway] = useState(false);
  const [stepAwayError, setStepAwayError] = useState('');

  const minutes = Math.floor(estimatedWaitSeconds / 60);
  const seconds = estimatedWaitSeconds % 60;
  const formattedCountdown = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const handleStepAwaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stepAwayTarget.trim()) {
      setStepAwayError(`Please enter a valid ${stepAwayType === 'sms' ? 'phone number' : 'email address'}.`);
      return;
    }
    setStepAwayError('');
    setIsSubmittingStepAway(true);
    try {
      const contact: StepAwayContact = {
        type: stepAwayType,
        target: stepAwayTarget.trim(),
      };
      await registerStepAway(contact);
    } finally {
      setIsSubmittingStepAway(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-card p-6 shadow-xl max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <span className="text-2xs font-semibold uppercase tracking-wider text-green">Virtual Waiting Room</span>
          <h2 className="text-xl font-bold text-text-1">Dr. {doctorName}</h2>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-xs text-text-3 hover:text-text-1 transition-colors px-2.5 py-1 rounded-md border border-border"
          >
            Leave
          </button>
        )}
      </div>

      {/* Doctor Ready Banner */}
      {isDoctorReady ? (
        <div className="rounded-xl border border-green/40 bg-green/10 p-5 text-center space-y-3 animate-pulse">
          <div className="inline-flex items-center gap-2 text-green font-bold text-base">
            <span className="w-3 h-3 rounded-full bg-green" />
            The Doctor is Ready!
          </div>
          <p className="text-xs text-text-2">
            Dr. {doctorName} has entered the consultation room.
          </p>
          {videoRoomUrl ? (
            <a
              href={videoRoomUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onEnterCall}
              className="inline-block rounded-xl bg-green px-6 py-2.5 text-sm font-semibold text-[#030D09] hover:bg-green/90 transition-colors shadow-lg"
            >
              Enter Consultation Call Now
            </a>
          ) : (
            <button
              onClick={onEnterCall}
              className="rounded-xl bg-green px-6 py-2.5 text-sm font-semibold text-[#030D09] hover:bg-green/90 transition-colors shadow-lg"
            >
              Join Consultation Room
            </button>
          )}
        </div>
      ) : (
        /* Queue & Live Position Status */
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Position Indicator Card */}
          <div className="rounded-xl border border-border bg-surface-inset p-4 flex flex-col justify-between">
            <span className="text-2xs text-text-3 font-medium">Your Place in Queue</span>
            <div className="my-2">
              {position === 1 ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-green/20 border border-green/40 px-3 py-1 text-sm font-bold text-green">
                  <span className="w-2 h-2 rounded-full bg-green animate-ping" />
                  Next in line
                </div>
              ) : (
                <div className="text-3xl font-extrabold text-text-1">
                  #{position} <span className="text-xs text-text-3 font-normal">in line</span>
                </div>
              )}
            </div>
            <p className="text-2xs text-text-2">
              {position === 1
                ? 'Prepare your audio & video. You will enter next.'
                : `${position - 1} patient${position - 1 > 1 ? 's' : ''} ahead of you`}
            </p>
          </div>

          {/* Animated Countdown Card */}
          <div className="rounded-xl border border-border bg-surface-inset p-4 flex flex-col justify-between">
            <span className="text-2xs text-text-3 font-medium">Estimated Wait Time</span>
            <div className="my-2 font-mono text-3xl font-extrabold text-text-1 flex items-baseline gap-1">
              {formattedCountdown}
              <span className="text-xs font-sans text-text-3 font-normal">min:sec</span>
            </div>
            <div className="w-full bg-border rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-green h-full transition-all duration-1000 ease-linear"
                style={{ width: `${Math.max(5, Math.min(100, (estimatedWaitSeconds / (initialWaitMinutes * 60)) * 100))}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Live Status Indicator */}
      <div className="rounded-xl border border-border bg-surface-inset p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green" />
          </span>
          <span className="text-xs font-semibold text-text-1">Live Status</span>
        </div>
        <p className="text-sm text-text-2 font-medium">{statusMessage}</p>

        {/* Status Stage Timeline */}
        <div className="grid grid-cols-3 gap-2 pt-2 text-2xs">
          <div className={`p-2 rounded-lg border text-center ${statusStage === 'waiting' ? 'border-green bg-green/10 text-green font-semibold' : 'border-border text-text-3'}`}>
            1. Queue Wait
          </div>
          <div className={`p-2 rounded-lg border text-center ${statusStage === 'doctor_reviewing_charts' ? 'border-green bg-green/10 text-green font-semibold' : 'border-border text-text-3'}`}>
            2. Reviewing Charts
          </div>
          <div className={`p-2 rounded-lg border text-center ${statusStage === 'doctor_entering' || statusStage === 'ready' ? 'border-green bg-green/10 text-green font-semibold' : 'border-border text-text-3'}`}>
            3. Entering Room
          </div>
        </div>
      </div>

      {/* Step Away Notification Section */}
      <div className="rounded-xl border border-border bg-surface-inset p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-text-1">Step Away from Screen</h3>
          <span className="text-2xs text-text-3">SMS / Email Alert</span>
        </div>
        <p className="text-2xs text-text-2">
          Step away for a coffee or stretch. We will immediately ping you when Dr. {doctorName} enters the room so you never miss your consultation.
        </p>

        {isStepAwayRegistered && stepAwayContact ? (
          <div className="rounded-lg border border-green/30 bg-green/10 p-3 text-xs text-green flex items-center justify-between">
            <div>
              <span className="font-semibold">Alert registered: </span>
              {stepAwayContact.type.toUpperCase()} to {stepAwayContact.target}
            </div>
            <span className="text-2xs">✓ Active</span>
          </div>
        ) : (
          <form onSubmit={handleStepAwaySubmit} className="space-y-3 pt-1">
            <div className="flex gap-4 text-xs text-text-2">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="stepAwayType"
                  value="sms"
                  checked={stepAwayType === 'sms'}
                  onChange={() => setStepAwayType('sms')}
                />
                SMS Text Message
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="stepAwayType"
                  value="email"
                  checked={stepAwayType === 'email'}
                  onChange={() => setStepAwayType('email')}
                />
                Email Alert
              </label>
            </div>

            <div className="flex gap-2">
              <input
                type={stepAwayType === 'sms' ? 'tel' : 'email'}
                placeholder={stepAwayType === 'sms' ? '+1 (555) 000-0000' : 'patient@example.com'}
                value={stepAwayTarget}
                onChange={(e) => setStepAwayTarget(e.target.value)}
                className="flex-1 rounded-md border border-border bg-surface-card px-3 py-2 text-xs text-text-1 focus:outline-none focus:ring-2 focus:ring-border-focus"
              />
              <button
                type="submit"
                disabled={isSubmittingStepAway}
                className="rounded-md bg-green px-4 py-2 text-xs font-semibold text-[#030D09] hover:bg-green/90 transition-colors disabled:opacity-50"
              >
                {isSubmittingStepAway ? 'Saving…' : 'Notify Me'}
              </button>
            </div>

            {stepAwayError && (
              <p role="alert" className="text-2xs text-red-500">
                {stepAwayError}
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
