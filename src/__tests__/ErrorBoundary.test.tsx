import { act, render, screen } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { captureError } from '@/lib/sentry';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AUTH_STORAGE_KEY, acknowledgeStorageRecovery } from '@/store/authStore';

jest.mock('@/lib/sentry', () => ({
  captureError: jest.fn(),
  captureMessage: jest.fn(),
  initSentry: jest.fn(),
  setSentryUser: jest.fn(),
  clearSentryUser: jest.fn(),
}));

const mockedCaptureError = captureError as jest.Mock;
const mockedUseRouter = useRouter as jest.Mock;

function ThrowOnRender(): never {
  throw new Error('render exploded');
}

beforeEach(() => {
  window.localStorage.clear();
  jest.clearAllMocks();
  acknowledgeStorageRecovery();
  mockedUseRouter.mockReturnValue({ replace: jest.fn(), push: jest.fn() });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders children when nothing goes wrong', () => {
    render(
      <ErrorBoundary>
        <p>safe content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('safe content')).toBeInTheDocument();
  });

  it('shows a fallback and reports the error instead of a blank screen', () => {
    render(
      <ErrorBoundary>
        <ThrowOnRender />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(mockedCaptureError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'render exploded' }),
      expect.any(Object),
    );
  });

  it('recovers with the retry action when storage is clean', () => {
    let shouldThrow = true;
    const Flaky = () => {
      if (shouldThrow) return <ThrowOnRender />;
      return <p>recovered content</p>;
    };

    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    shouldThrow = false;
    act(() => {
      screen.getByRole('button', { name: /try again/i }).click();
    });
    expect(screen.getByText('recovered content')).toBeInTheDocument();
  });

  it('redirects to login when corrupted storage is detected on mount', () => {
    const replace = jest.fn();
    mockedUseRouter.mockReturnValue({ replace, push: jest.fn() });
    window.localStorage.setItem(AUTH_STORAGE_KEY, '{corrupted json');

    render(
      <ErrorBoundary>
        <p>safe content</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Restoring your session')).toBeInTheDocument();
    expect(screen.queryByText('safe content')).not.toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith('/login');
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(mockedCaptureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ storageKey: AUTH_STORAGE_KEY }),
    );
  });
});
