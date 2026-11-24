import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { startVideoPlayback, watchVideoPlayback } from '@/lib/video';
import VideoGrid from '@/components/consultation/VideoGrid';

function domError(name: string): Error {
  return Object.assign(new Error(name), { name });
}

function makeVideo() {
  const video = document.createElement('video');
  let paused = true;
  const play = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
  Object.defineProperty(video, 'srcObject', { configurable: true, writable: true, value: {} });
  Object.defineProperty(video, 'play', { configurable: true, value: play });
  return {
    video,
    play,
    setPaused: (value: boolean) => {
      paused = value;
    },
  };
}

async function flushMicrotasks() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
}

async function advance(ms: number) {
  jest.advanceTimersByTime(ms);
  await flushMicrotasks();
}

describe('feat(video): iOS Safari autoplay recovery & tap-to-start (#260)', () => {
  describe('startVideoPlayback', () => {
    it('marks the element inline and reports playing when play() resolves', async () => {
      const { video, play } = makeVideo();

      await expect(startVideoPlayback(video)).resolves.toBe('playing');
      expect(play).toHaveBeenCalledTimes(1);
      expect(video.playsInline).toBe(true);
      expect(video.hasAttribute('playsinline')).toBe(true);
    });

    it('reports blocked when autoplay is refused with NotAllowedError', async () => {
      const { video, play } = makeVideo();
      play.mockRejectedValueOnce(domError('NotAllowedError'));

      await expect(startVideoPlayback(video)).resolves.toBe('blocked');
    });

    it('reports failed for any other playback error', async () => {
      const { video, play } = makeVideo();
      play.mockRejectedValueOnce(domError('NotSupportedError'));

      await expect(startVideoPlayback(video)).resolves.toBe('failed');
    });
  });

  describe('watchVideoPlayback', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('resumes a paused element after an interruption and reports onResumed', async () => {
      const { video, play, setPaused } = makeVideo();
      const onResumed = jest.fn();
      const stop = watchVideoPlayback(video, { retryDelayMs: 1000, onResumed });

      setPaused(true);
      video.dispatchEvent(new Event('pause'));
      await advance(1000);

      expect(play).toHaveBeenCalledTimes(1);
      expect(onResumed).toHaveBeenCalledTimes(1);
      stop();
    });

    it('stops automatic retries once autoplay is blocked and reports onBlocked', async () => {
      const { video, play } = makeVideo();
      play.mockRejectedValue(domError('NotAllowedError'));
      const onBlocked = jest.fn();
      const stop = watchVideoPlayback(video, { retryDelayMs: 1000, onBlocked });

      video.dispatchEvent(new Event('pause'));
      await advance(1000);
      await advance(60_000);

      expect(onBlocked).toHaveBeenCalledTimes(1);
      expect(play).toHaveBeenCalledTimes(1);
      stop();
    });

    it('gives up after maxRetries failed resume attempts and reports onFailed', async () => {
      const { video, play } = makeVideo();
      play.mockRejectedValue(domError('NotSupportedError'));
      const onFailed = jest.fn();
      const stop = watchVideoPlayback(video, { maxRetries: 2, retryDelayMs: 100, onFailed });

      video.dispatchEvent(new Event('pause'));
      await advance(100); // attempt 1 fails, schedules retry after 100 ms
      await advance(100); // attempt 2 fails, reaches maxRetries
      await advance(10_000);

      expect(play).toHaveBeenCalledTimes(2);
      expect(onFailed).toHaveBeenCalledTimes(1);
      stop();
    });

    it('does nothing when the element is already playing', async () => {
      const { video, play, setPaused } = makeVideo();
      const stop = watchVideoPlayback(video, { retryDelayMs: 100 });

      setPaused(false);
      video.dispatchEvent(new Event('pause'));
      await advance(1000);

      expect(play).not.toHaveBeenCalled();
      stop();
    });

    it('removes listeners and pending timers on cleanup', async () => {
      const { video, play } = makeVideo();
      const stop = watchVideoPlayback(video, { retryDelayMs: 1000 });

      video.dispatchEvent(new Event('pause'));
      stop();
      await advance(10_000);

      expect(play).not.toHaveBeenCalled();
    });
  });
});

describe('feat(video): VideoGrid tap-to-start fallback (#260)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows "Tap to Start Video" when autoplay is refused and resumes on tap', async () => {
    const play = jest
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(domError('NotAllowedError'));

    render(
      <VideoGrid
        tiles={[{ id: 'screen', label: 'Shared screen', stream: {} as MediaStream }]}
      />,
    );

    const button = await screen.findByRole('button', { name: 'Tap to Start Video' });
    play.mockResolvedValueOnce(undefined);
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Tap to Start Video' })).not.toBeInTheDocument(),
    );
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('renders no tap prompt when there is no stream to play', () => {
    const play = jest.spyOn(HTMLMediaElement.prototype, 'play');

    render(<VideoGrid tiles={[{ id: 'screen', label: 'Shared screen', stream: null }]} />);

    expect(screen.queryByRole('button', { name: 'Tap to Start Video' })).not.toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
  });
});
