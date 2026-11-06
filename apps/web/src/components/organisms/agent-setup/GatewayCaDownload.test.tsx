// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Target } from '@/types';
import { GatewayCaDownload, formatFingerprint } from './GatewayCaDownload';

afterEach(cleanup);

function target(overrides: Partial<Target>): Target {
  return {
    routingMode: 'managed-gateway',
    publicUrl: 'https://initpad-apps.lab.local',
    gatewayPreflight: {
      adapter: 'caddy',
      status: 'passed',
      checkedAt: null,
      error: null,
      caSha256: 'ab'.repeat(32),
    },
    ...overrides,
  } as Target;
}

describe('GatewayCaDownload', () => {
  it('formats a fingerprint the way openssl prints it', () => {
    expect(formatFingerprint('abcdef0123')).toBe('AB:CD:EF:01:23');
  });

  it('offers the CA at the gateway domain and shows the reported fingerprint', () => {
    render(<GatewayCaDownload target={target({})} />);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'http://initpad-apps.lab.local/initpad-ca.crt',
    );
    expect(screen.getByText(formatFingerprint('ab'.repeat(32)))).toBeInTheDocument();
  });

  it('still offers the file but says the fingerprint is unknown when none was reported', () => {
    render(
      <GatewayCaDownload
        target={target({
          gatewayPreflight: {
            adapter: 'caddy',
            status: 'passed',
            checkedAt: null,
            error: null,
            caSha256: null,
          },
        })}
      />,
    );
    expect(screen.getByRole('link')).toBeInTheDocument();
    expect(screen.queryByText(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)).not.toBeInTheDocument();
  });

  it('renders nothing for a direct-port target or an IP address', () => {
    const { container, rerender } = render(
      <GatewayCaDownload target={target({ routingMode: 'direct-port' })} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<GatewayCaDownload target={target({ publicUrl: 'https://10.0.0.5' })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
