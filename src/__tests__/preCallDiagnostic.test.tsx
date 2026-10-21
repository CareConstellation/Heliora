import React from 'react';
import { render, screen } from '@testing-library/react';
import PreCallDiagnostic from '@/components/ui/PreCallDiagnostic';

describe('Pre-Call Diagnostic Test (#48)', () => {
  beforeEach(() => {
    // Mock navigator.mediaDevices.getUserMedia
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: jest.fn().mockResolvedValue({
          getVideoTracks: () => [{ readyState: 'live', stop: jest.fn() }],
          getAudioTracks: () => [{ readyState: 'live', stop: jest.fn() }],
          getTracks: () => [
            { readyState: 'live', stop: jest.fn() },
            { readyState: 'live', stop: jest.fn() },
          ],
        }),
      },
      writable: true,
      configurable: true,
    });

    // Mock RTCPeerConnection
    class MockRTCPeerConnection {
      iceGatheringState = 'complete';
      onicecandidate: ((ev: { candidate: { candidate: string } | null }) => void) | null = null;
      createDataChannel() {
        return {};
      }
      createOffer() {
        return Promise.resolve({ type: 'offer', sdp: '' });
      }
      setLocalDescription() {
        return Promise.resolve();
      }
      close() {}
    }

    Object.defineProperty(globalThis, 'RTCPeerConnection', {
      value: MockRTCPeerConnection,
      writable: true,
      configurable: true,
    });
  });

  it('renders pre-flight check header and audio/camera sections', () => {
    render(<PreCallDiagnostic onSuccess={jest.fn()} durationSeconds={1} />);

    expect(screen.getByText('Pre-Flight Diagnostic')).toBeInTheDocument();
    expect(screen.getByText('Call Connection Check')).toBeInTheDocument();
    expect(screen.getByText(/Microphone Input Level/i)).toBeInTheDocument();
  });

  it('blocks entry button initially while diagnostic is running', () => {
    render(<PreCallDiagnostic onSuccess={jest.fn()} durationSeconds={5} />);

    const button = screen.getByRole('button', { name: /Testing Connection/i });
    expect(button).toBeDisabled();
  });
});
