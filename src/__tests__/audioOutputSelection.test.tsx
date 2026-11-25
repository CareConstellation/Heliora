jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  addBreadcrumb: jest.fn(),
  startSpan: (_o: unknown, cb: (s: unknown) => unknown) => cb({ setAttribute: jest.fn() }),
  setUser: jest.fn(),
  setTag: jest.fn(),
  init: jest.fn(),
}));

import { fireEvent, render, screen } from '@testing-library/react';
import VideoSettingsModal, { type AudioOutputSettings } from '@/components/consultation/VideoSettingsModal';
import {
  applyAudioOutputDevice,
  AUDIO_OUTPUT_STORAGE_KEY,
  createTestToneWav,
  isAudioOutputSelectionSupported,
  listAudioOutputDevices,
  loadPreferredAudioOutput,
  playTestSpeakerSample,
  savePreferredAudioOutput,
} from '@/lib/video';
import { DEFAULT_BACKGROUND_SETTINGS } from '@/lib/videoBackgroundBlur';

const device = (kind: MediaDeviceKind, deviceId: string, label = ''): MediaDeviceInfo =>
  ({ kind, deviceId, label, groupId: 'g', toJSON: () => ({}) }) as MediaDeviceInfo;

const sinkable = (impl?: (id: string) => Promise<void>) => {
  const el = document.createElement('audio') as HTMLAudioElement & { setSinkId: jest.Mock };
  el.setSinkId = jest.fn(impl ?? (async () => undefined));
  return el;
};

describe('listAudioOutputDevices (#267)', () => {
  it('returns only audiooutput devices, de-duplicated, via enumerateDevices()', async () => {
    const enumerateDevices = jest.fn(async () => [
      device('audioinput', 'mic-1', 'Built-in Mic'),
      device('audiooutput', 'default', ''),
      device('audiooutput', 'spk-1', 'Desk Speakers'),
      device('audiooutput', 'spk-1', 'Desk Speakers'),
      device('videoinput', 'cam-1', 'Camera'),
      device('audiooutput', 'spk-2', ''),
    ]);
    const list = await listAudioOutputDevices({ enumerateDevices });
    expect(enumerateDevices).toHaveBeenCalled();
    expect(list).toEqual([
      { deviceId: 'default', label: 'System default' },
      { deviceId: 'spk-1', label: 'Desk Speakers' },
      { deviceId: 'spk-2', label: 'Speaker 4' },
    ]);
  });

  it('returns an empty list when mediaDevices is unavailable', async () => {
    await expect(listAudioOutputDevices(undefined)).resolves.toEqual([]);
  });
});

describe('applyAudioOutputDevice (#267)', () => {
  it('routes every element with setSinkId', async () => {
    const a = sinkable();
    const b = sinkable();
    const result = await applyAudioOutputDevice([a, b, null], 'spk-1');
    expect(a.setSinkId).toHaveBeenCalledWith('spk-1');
    expect(b.setSinkId).toHaveBeenCalledWith('spk-1');
    expect(result).toEqual({ applied: 2, failed: 0 });
  });

  it("maps the 'default' choice to setSinkId('') (user agent default)", async () => {
    const a = sinkable();
    await applyAudioOutputDevice([a], 'default');
    expect(a.setSinkId).toHaveBeenCalledWith('');
  });

  it('keeps routing the other elements when one device assignment fails', async () => {
    const bad = sinkable(async () => {
      throw new DOMException('Device not found', 'NotFoundError');
    });
    const good = sinkable();
    const result = await applyAudioOutputDevice([bad, good], 'spk-9');
    expect(good.setSinkId).toHaveBeenCalledWith('spk-9');
    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.error?.message).toMatch(/not found/i);
  });

  it('skips elements without setSinkId (Safari)', async () => {
    const plain = document.createElement('audio');
    await expect(applyAudioOutputDevice([plain], 'spk-1')).resolves.toEqual({ applied: 0, failed: 0 });
  });
});

describe('speaker preference persistence (#267)', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the system output and remembers the choice', () => {
    expect(loadPreferredAudioOutput()).toBe('default');
    savePreferredAudioOutput('spk-2');
    expect(localStorage.getItem(AUDIO_OUTPUT_STORAGE_KEY)).toBe('spk-2');
    expect(loadPreferredAudioOutput()).toBe('spk-2');
  });
});

describe('isAudioOutputSelectionSupported (#267)', () => {
  const proto = HTMLMediaElement.prototype as unknown as { setSinkId?: unknown };
  afterEach(() => delete proto.setSinkId);

  it('reflects whether HTMLMediaElement.setSinkId exists', () => {
    delete proto.setSinkId;
    expect(isAudioOutputSelectionSupported()).toBe(false);
    proto.setSinkId = jest.fn();
    expect(isAudioOutputSelectionSupported()).toBe(true);
  });
});

describe('Test Speaker sample (#267)', () => {
  it('generates a valid mono 16-bit PCM WAV', () => {
    const wav = createTestToneWav({ sampleRate: 8000, durationSeconds: 0.5 });
    const view = new DataView(wav.buffer);
    const ascii = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
    expect(ascii(0)).toBe('RIFF');
    expect(ascii(8)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(4000 * 2);
    expect(wav.length).toBe(44 + 8000);
    // Not silent.
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)));
    expect(peak).toBeGreaterThan(1000);
  });

  it('routes the sample to the selected device before playing', async () => {
    const createObjectURL = jest.fn(() => 'blob:tone');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const audio = sinkable();
    const order: string[] = [];
    audio.setSinkId.mockImplementation(async () => {
      order.push('sink');
    });
    audio.play = jest.fn(async () => {
      order.push('play');
    });

    await playTestSpeakerSample('spk-1', { createAudio: () => audio });
    expect(audio.setSinkId).toHaveBeenCalledWith('spk-1');
    expect(order).toEqual(['sink', 'play']);
    expect(audio.src).toContain('blob:tone');
  });

  it('rejects and cleans up when the device cannot be assigned', async () => {
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL: () => 'blob:tone', revokeObjectURL });
    const audio = sinkable(async () => {
      throw new Error('NotAllowedError');
    });
    audio.play = jest.fn();
    await expect(playTestSpeakerSample('spk-1', { createAudio: () => audio })).rejects.toThrow('NotAllowedError');
    expect(audio.play).not.toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:tone');
  });
});

describe('VideoSettingsModal speaker section (#267)', () => {
  const controls = (overrides: Partial<AudioOutputSettings> = {}): AudioOutputSettings => ({
    supported: true,
    devices: [
      { deviceId: 'default', label: 'System default' },
      { deviceId: 'spk-1', label: 'Desk Speakers' },
      { deviceId: 'hs-1', label: 'USB Headset' },
    ],
    selectedId: 'default',
    selectDevice: jest.fn(),
    testSpeaker: jest.fn(),
    testState: 'idle',
    error: null,
    ...overrides,
  });

  const renderModal = (audioOutput?: AudioOutputSettings) =>
    render(
      <VideoSettingsModal
        settings={DEFAULT_BACKGROUND_SETTINGS}
        onChange={jest.fn()}
        onClose={jest.fn()}
        {...(audioOutput ? { audioOutput } : {})}
      />,
    );

  it('is hidden when no audio output controls are passed', () => {
    renderModal();
    expect(screen.queryByLabelText(/audio output device/i)).not.toBeInTheDocument();
  });

  it('lists output devices and assigns the chosen one', () => {
    const c = controls();
    renderModal(c);
    const select = screen.getByLabelText(/audio output device/i);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'System default',
      'Desk Speakers',
      'USB Headset',
    ]);
    fireEvent.change(select, { target: { value: 'hs-1' } });
    expect(c.selectDevice).toHaveBeenCalledWith('hs-1');
  });

  it('plays the test sample', () => {
    const c = controls();
    renderModal(c);
    fireEvent.click(screen.getByRole('button', { name: /test speaker/i }));
    expect(c.testSpeaker).toHaveBeenCalled();
  });

  it('disables the test button while the sample plays', () => {
    renderModal(controls({ testState: 'playing' }));
    expect(screen.getByRole('button', { name: /playing/i })).toBeDisabled();
  });

  it('explains the fallback when the browser cannot choose an output', () => {
    renderModal(controls({ supported: false }));
    expect(screen.queryByLabelText(/audio output device/i)).not.toBeInTheDocument();
    expect(screen.getByText(/system output/i)).toBeInTheDocument();
  });

  it('surfaces device assignment errors', () => {
    renderModal(controls({ error: 'Could not switch speaker: NotFoundError' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/could not switch speaker/i);
  });
});
