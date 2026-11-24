import { render, screen, act } from '@testing-library/react';
import OfflineBanner from '@/components/ui/OfflineBanner';

describe('OfflineBanner Component (#121)', () => {
  const originalOnLine = navigator.onLine;

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnLine });
  });

  it('renders nothing when navigator is online', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders offline warning banner when navigator is offline', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(<OfflineBanner />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Offline Mode Active:')).toBeInTheDocument();
    expect(
      screen.getByText(/Operating on client-side encrypted local cache/i),
    ).toBeInTheDocument();
  });

  it('transitions to offline on window offline event and displays status', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    render(<OfflineBanner />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Offline Mode Active:')).toBeInTheDocument();
  });

  it('displays reconnected message when connectivity returns', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    render(<OfflineBanner />);

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    expect(
      screen.getByText(/Internet connection restored. Synchronizing clinical data.../i),
    ).toBeInTheDocument();
  });
});
