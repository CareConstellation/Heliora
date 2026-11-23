'use client';

import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { captureError } from '@/lib/sentry';
import {
  STORAGE_RECOVERY_EVENT,
  acknowledgeStorageRecovery,
  hasStorageRecovery,
  repairCorruptedPersistedStorage,
} from '@/store/authStore';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  isRecovering: boolean;
}

function RecoveryRedirect() {
  const router = useRouter();

  useEffect(() => {
    acknowledgeStorageRecovery();
    router.replace('/login');
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-xl font-semibold text-text-1">Restoring your session</p>
      <p className="text-sm text-text-2 max-w-md">
        We found invalid saved data and reset it to safe defaults. Taking you back to sign in…
      </p>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, isRecovering: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidMount() {
    if (typeof window === 'undefined') return;

    window.addEventListener(STORAGE_RECOVERY_EVENT, this.handleStorageRecovery);
    if (hasStorageRecovery() || repairCorruptedPersistedStorage()) {
      this.setState({ isRecovering: true });
    }
  }

  componentWillUnmount() {
    if (typeof window === 'undefined') return;
    window.removeEventListener(STORAGE_RECOVERY_EVENT, this.handleStorageRecovery);
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureError(error, { componentStack: info.componentStack ?? undefined });
    if (repairCorruptedPersistedStorage()) {
      this.setState({ isRecovering: true });
    }
  }

  private handleStorageRecovery = () => {
    this.setState({ isRecovering: true });
  };

  private handleRetry = () => {
    const recovered = repairCorruptedPersistedStorage();
    acknowledgeStorageRecovery();
    this.setState({ hasError: false, error: null, isRecovering: recovered });
  };

  render() {
    if (this.state.isRecovering) {
      return <RecoveryRedirect />;
    }

    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-5xl">⚠️</p>
          <h1 className="text-xl font-semibold text-text-1">Something went wrong</h1>
          <p className="text-sm text-text-2 max-w-md">
            An unexpected error occurred. Please refresh the page or contact support if the problem
            persists.
          </p>
          <button
            onClick={this.handleRetry}
            className="rounded-md bg-green px-4 py-2 text-sm font-medium text-[#030D09] hover:bg-green-600"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
