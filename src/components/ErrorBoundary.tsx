'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { captureError } from '@/lib/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureError(error, { componentStack: info.componentStack ?? undefined });
  }

  render() {
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
            onClick={() => this.setState({ hasError: false, error: null })}
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
