// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatFingerprint } from '@/components/molecules/CaInstallSteps';
import { PlatformCertificateSettings } from './PlatformCertificateSettings';

const mocks = vi.hoisted(() => ({
  api: { getAgentDistribution: vi.fn() },
  user: { edition: 'self-hosted' },
}));

vi.mock('@/api', () => ({ api: mocks.api }));
vi.mock('@/auth', () => ({ useAuth: () => ({ user: mocks.user }) }));

const fingerprint = 'cd'.repeat(32);

function distribution(privateCa: unknown) {
  return { privateCa };
}

afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.edition = 'self-hosted';
});

describe('PlatformCertificateSettings (ADR-167)', () => {
  it('offers the CA root with the fingerprint browsers show', async () => {
    mocks.api.getAgentDistribution.mockResolvedValue(
      distribution({
        path: '/initpad-ca.crt',
        sha256: 'ab'.repeat(32),
        fingerprintSha256: fingerprint,
        registryHost: 'git.lab.local',
      }),
    );
    render(<PlatformCertificateSettings />);

    const link = await screen.findByRole('link', { name: /Download certificate/ });
    expect(link).toHaveAttribute('href', '/initpad-ca.crt');
    expect(link).toHaveAttribute('download', 'initpad-root-ca.crt');
    expect(screen.getByText(formatFingerprint(fingerprint))).toBeInTheDocument();
    // The file hash pinned by the Agent command is not what a browser shows.
    expect(screen.queryByText(formatFingerprint('ab'.repeat(32)))).not.toBeInTheDocument();
    expect(
      screen.getByText(`http://${window.location.hostname}/initpad-ca.crt`),
    ).toBeInTheDocument();
  });

  it('stays hidden on an installation with a public certificate', async () => {
    mocks.api.getAgentDistribution.mockResolvedValue(distribution(null));
    const { container } = render(<PlatformCertificateSettings />);

    await vi.waitFor(() => expect(mocks.api.getAgentDistribution).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('is not offered by the SaaS edition', () => {
    mocks.user.edition = 'saas';
    const { container } = render(<PlatformCertificateSettings />);

    expect(mocks.api.getAgentDistribution).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
