// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CopyField } from './CopyField';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function setSecureContext(secure: boolean) {
  Object.defineProperty(window, 'isSecureContext', {
    configurable: true,
    value: secure,
  });
}

describe('CopyField', () => {
  it('uses the Clipboard API on a secure origin', async () => {
    const user = userEvent.setup();
    setSecureContext(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<CopyField command="docker ps" />);

    await user.click(screen.getByRole('button', { name: /copy to clipboard/i }));

    expect(writeText).toHaveBeenCalledWith('docker ps');
    expect(screen.getByText('copied')).toBeInTheDocument();
  });

  it('falls back to a selected textarea on a LAN HTTP origin', async () => {
    const user = userEvent.setup();
    setSecureContext(false);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    render(<CopyField command="sudo sh ./installer.sh" />);

    await user.click(screen.getByRole('button', { name: /copy to clipboard/i }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByText('copied')).toBeInTheDocument();
    expect(document.querySelector('textarea')).not.toBeInTheDocument();
  });

  it('explains manual copying when the browser blocks both methods', async () => {
    const user = userEvent.setup();
    setSecureContext(false);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn().mockReturnValue(false),
    });
    render(<CopyField command="docker ps" />);

    await user.click(screen.getByRole('button', { name: /copy to clipboard/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/Ctrl\+C/);
  });
});
