'use client';

import { createContext, useCallback, useState, type ReactNode } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

/** Optional call-to-action rendered inside a toast (e.g. "Retry"). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction | undefined;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, action?: ToastAction) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

const STYLES: Record<ToastType, string> = {
  success: 'bg-green-600',
  error: 'bg-red-600',
  warning: 'bg-yellow-500',
  info: 'bg-green-600',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info', action?: ToastAction) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type, action }]);
    // Give action toasts a little longer so the user can actually click the action.
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), action ? 8000 : 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => {
          const action = t.action;
          return (
            <div
              key={t.id}
              className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm text-white shadow-lg pointer-events-auto ${STYLES[t.type]}`}
            >
              <span className="font-bold">{ICONS[t.type]}</span>
              <span className="flex-1">{t.message}</span>
              {action && (
                <button
                  type="button"
                  onClick={() => {
                    setToasts((prev) => prev.filter((item) => item.id !== t.id));
                    action.onClick();
                  }}
                  className="shrink-0 rounded-md bg-white/20 px-2 py-1 text-xs font-semibold text-white transition-colors hover:bg-white/30"
                >
                  {action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
