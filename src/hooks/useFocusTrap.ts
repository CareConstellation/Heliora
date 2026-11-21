'use client';

import { useEffect, useRef } from 'react';

/**
 * Accessible WCAG 2.1 AA focus trap and Escape key dismissal hook (#167).
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  isOpen: boolean,
  onClose?: () => void,
) {
  const containerRef = useRef<T>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElement.current = document.activeElement as HTMLElement | null;
    const element = containerRef.current;
    if (!element) return;

    const focusableSelectors = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    const focusable = Array.from(element.querySelectorAll<HTMLElement>(focusableSelectors));
    if (focusable.length > 0) {
      focusable[0]?.focus();
    } else {
      element.focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }

      if (e.key === 'Tab') {
        const currentFocusables = Array.from(element!.querySelectorAll<HTMLElement>(focusableSelectors));
        if (currentFocusables.length === 0) return;

        const first = currentFocusables[0]!;
        const last = currentFocusables[currentFocusables.length - 1]!;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousActiveElement.current?.focus?.();
    };
  }, [isOpen, onClose]);

  return containerRef;
}
