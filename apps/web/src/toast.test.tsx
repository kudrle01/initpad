// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TOAST_DURATION_MS, ToastProvider, useToast } from './toast';

function Trigger({ kind, message }: { kind: 'error' | 'success' | 'warning'; message: string }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast[kind](message)}>
      show {kind}
    </button>
  );
}

function renderToasts(kind: 'error' | 'success' | 'warning', message = 'Something happened') {
  render(
    <ToastProvider>
      <Trigger kind={kind} message={message} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: `show ${kind}` }));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('toasts (P1.22)', () => {
  it('announces errors as alerts inside a live region and keeps them until dismissed', () => {
    renderToasts('error', 'Deploy failed');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Deploy failed');
    expect(alert.parentElement).toHaveAttribute('aria-live', 'polite');

    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 5);
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides a success message after its duration', () => {
    renderToasts('success', 'Saved');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS + 10);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('pauses the countdown while the pointer is over the toast', () => {
    renderToasts('warning', 'Careful');
    const toast = screen.getByRole('status');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS - 1000);
    });
    fireEvent.mouseEnter(toast);
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS * 3);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();

    fireEvent.mouseLeave(toast);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not stack the same message twice', () => {
    renderToasts('error', 'Offline');
    fireEvent.click(screen.getByRole('button', { name: 'show error' }));
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });
});
