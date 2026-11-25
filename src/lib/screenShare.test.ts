import { startScreenShare } from './video';

function fakeTrack(kind: 'video'): MediaStreamTrack {
  return { kind, onended: null } as unknown as MediaStreamTrack;
}

describe('startScreenShare (#258)', () => {
  it('replaces the camera track with the screen track, then restores the camera when sharing ends', async () => {
    const cameraTrack = fakeTrack('video');
    const screenTrack = fakeTrack('video');
    const replaceTrack = jest.fn().mockResolvedValue(undefined);
    const sender = { track: cameraTrack, replaceTrack } as unknown as RTCRtpSender;
    const pc = { getSenders: () => [sender] } as unknown as RTCPeerConnection;

    (global as any).navigator = {
      mediaDevices: {
        getDisplayMedia: jest.fn().mockResolvedValue({ getVideoTracks: () => [screenTrack] }),
      },
    };

    const returned = await startScreenShare(pc, cameraTrack);
    expect(returned).toBe(screenTrack);
    expect(replaceTrack).toHaveBeenCalledWith(screenTrack);

    // Simulate the browser's native "Stop Sharing" banner ending the capture.
    screenTrack.onended?.(new Event('ended'));
    expect(replaceTrack).toHaveBeenCalledWith(cameraTrack);
  });
});
