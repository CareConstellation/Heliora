import { fireEvent, render, screen } from '@testing-library/react';
import ConnectionQualityPill from '@/components/consultation/ConnectionQualityPill';
import ConsultationToolbar from '@/components/consultation/ConsultationToolbar';
import VideoSettingsModal, {
  describeBackgroundEffect,
  optionKeyFor,
} from '@/components/consultation/VideoSettingsModal';
import { DEFAULT_BACKGROUND_SETTINGS } from '@/lib/videoBackgroundBlur';

describe('ConnectionQualityPill (#254)', () => {
  it('shows quality, resolution and details', () => {
    render(<ConnectionQualityPill quality="fair" resolution="480p" packetLossPercent={6.25} rttMs={120} />);
    const pill = screen.getByRole('status');
    expect(pill).toHaveAttribute('data-quality', 'fair');
    expect(pill).toHaveTextContent('Fair');
    expect(pill).toHaveTextContent('480p');
    expect(pill).toHaveAttribute('title', expect.stringContaining('6.3% loss'));
  });

  it('shows Measuring before any stats arrive', () => {
    render(<ConnectionQualityPill quality="unknown" />);
    expect(screen.getByRole('status')).toHaveTextContent('Measuring');
  });

  it('labels audio-only fallback', () => {
    render(<ConnectionQualityPill quality="poor" resolution="audio-only" />);
    expect(screen.getByTestId('quality-resolution')).toHaveTextContent('Audio only');
  });
});

describe('ConsultationToolbar (#254, #255, #256)', () => {
  const base = {
    noiseCancellationEnabled: true,
    noiseCancellationAvailable: true,
    onToggleNoiseCancellation: jest.fn(),
    onOpenVideoSettings: jest.fn(),
  };

  it('toggles noise cancellation', () => {
    const onToggle = jest.fn();
    render(<ConsultationToolbar {...base} onToggleNoiseCancellation={onToggle} />);
    const btn = screen.getByRole('button', { name: /noise cancel on/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();
  });

  it('disables the toggle when no microphone is attached', () => {
    render(<ConsultationToolbar {...base} noiseCancellationAvailable={false} />);
    expect(screen.getByRole('button', { name: /noise cancel/i })).toBeDisabled();
  });

  it('opens video settings and shows the active effect', () => {
    const onOpen = jest.fn();
    render(<ConsultationToolbar {...base} onOpenVideoSettings={onOpen} backgroundEffectLabel="Blur · Strong" />);
    fireEvent.click(screen.getByRole('button', { name: /background: blur · strong/i }));
    expect(onOpen).toHaveBeenCalled();
  });

  it('renders the quality pill from the latest ABR sample', () => {
    render(
      <ConsultationToolbar
        {...base}
        connectionSample={{
          timestamp: 1,
          packetLossPercent: 0.1,
          rttMs: 30,
          availableOutgoingKbps: 2000,
          resolution: '1080p',
          quality: 'excellent',
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Excellent');
    expect(screen.getByRole('status')).toHaveTextContent('1080p');
  });
});

describe('VideoSettingsModal (#255)', () => {
  it('offers Off, Light and Strong blur and clinical backdrops', () => {
    render(<VideoSettingsModal settings={DEFAULT_BACKGROUND_SETTINGS} onChange={jest.fn()} onClose={jest.fn()} />);
    for (const label of ['Off', 'Blur · Light', 'Blur · Strong', 'Clinic neutral', 'Consult room', 'Calm blue']) {
      expect(screen.getByLabelText(new RegExp(label))).toBeInTheDocument();
    }
    expect(screen.getByLabelText(/^Off/)).toBeChecked();
  });

  it('selecting Strong blur emits blur settings', () => {
    const onChange = jest.fn();
    render(<VideoSettingsModal settings={DEFAULT_BACKGROUND_SETTINGS} onChange={onChange} onClose={jest.fn()} />);
    fireEvent.click(screen.getByLabelText(/Blur · Strong/));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'blur', blurIntensity: 'strong' }));
  });

  it('selecting a backdrop emits backdrop settings', () => {
    const onChange = jest.fn();
    render(<VideoSettingsModal settings={DEFAULT_BACKGROUND_SETTINGS} onChange={onChange} onClose={jest.fn()} />);
    fireEvent.click(screen.getByLabelText(/Calm blue/));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'backdrop', backdrop: 'calm-blue' }));
  });

  it('warns that the real background is visible when segmentation is unavailable', () => {
    render(
      <VideoSettingsModal
        settings={{ ...DEFAULT_BACKGROUND_SETTINGS, mode: 'blur' }}
        onChange={jest.fn()}
        onClose={jest.fn()}
        stats={{ fps: 0, avgSegmentationMs: 0, segmentationStride: 1, status: 'unavailable' }}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/real background is visible/i);
  });

  it('shows the measured frame rate', () => {
    render(
      <VideoSettingsModal
        settings={{ ...DEFAULT_BACKGROUND_SETTINGS, mode: 'blur' }}
        onChange={jest.fn()}
        onClose={jest.fn()}
        previewStream={{} as MediaStream}
        stats={{ fps: 29.6, avgSegmentationMs: 8, segmentationStride: 1, status: 'active' }}
      />,
    );
    expect(screen.getByText('30 fps')).toBeInTheDocument();
  });

  it('closes via the Done button', () => {
    const onClose = jest.fn();
    render(<VideoSettingsModal settings={DEFAULT_BACKGROUND_SETTINGS} onChange={jest.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('describes the active effect for the toolbar', () => {
    expect(describeBackgroundEffect(DEFAULT_BACKGROUND_SETTINGS)).toBeNull();
    expect(describeBackgroundEffect({ ...DEFAULT_BACKGROUND_SETTINGS, mode: 'blur', blurIntensity: 'light' })).toBe('Blur · Light');
    expect(optionKeyFor({ ...DEFAULT_BACKGROUND_SETTINGS, mode: 'backdrop', backdrop: 'consult-room' })).toBe('backdrop-consult-room');
  });
});
