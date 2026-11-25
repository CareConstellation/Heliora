'use client';

import { useEffect, useRef, useState } from 'react';

interface Props {
  peerConnection: RTCPeerConnection | null;
  /** Linear playback gain; 0.1 while feedback ducking (#269) is active. */
  gain: number;
  /** Registers the element so speaker selection (#267) can route it. */
  registerElement: (el: HTMLMediaElement | null) => void;
  unregisterElement: (el: HTMLMediaElement | null) => void;
}

/**
 * Plays the remote participant's audio from the peer connection in an
 * element the app controls, so it can be routed to the chosen speaker and
 * ducked when acoustic feedback is detected.
 */
export default function RemoteAudio({ peerConnection, gain, registerElement, unregisterElement }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    if (!peerConnection) {
      setStream(null);
      return;
    }
    const remote = new MediaStream();
    const addTrack = (track: MediaStreamTrack) => {
      if (track.kind === 'audio' && !remote.getTrackById(track.id)) remote.addTrack(track);
    };
    peerConnection.getReceivers().forEach((r) => r.track && addTrack(r.track));
    const onTrack = (e: RTCTrackEvent) => addTrack(e.track);
    peerConnection.addEventListener('track', onTrack);
    setStream(remote);
    return () => peerConnection.removeEventListener('track', onTrack);
  }, [peerConnection]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.srcObject = stream;
    registerElement(el);
    return () => unregisterElement(el);
  }, [stream, registerElement, unregisterElement]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, gain));
  }, [gain]);

  if (!peerConnection) return null;
  return <audio ref={audioRef} autoPlay data-testid="remote-call-audio" className="hidden" />;
}
