// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n';
import { helpUrl } from '@/lib/help';
import { HelpLink } from './HelpLink';

const auth = vi.hoisted(() => ({ docsUrl: null as string | null }));

vi.mock('@/auth', () => ({
  useAuth: () => ({ user: { docsUrl: auth.docsUrl } }),
}));

afterEach(() => {
  cleanup();
  setLocale('en');
  auth.docsUrl = null;
});

describe('user guide links (ADR-156)', () => {
  it('builds the chapter address in the given language', () => {
    expect(helpUrl('https://docs.example.test', 'cs', 'servers')).toBe(
      'https://docs.example.test/cs/#servers',
    );
    expect(helpUrl('https://example.test/help/', 'en')).toBe('https://example.test/help/en/');
  });

  it('opens the chapter in the active language in a new tab', () => {
    auth.docsUrl = 'https://docs.example.test';
    setLocale('cs');
    render(<HelpLink topic="import" />);

    const link = screen.getByRole('link', { name: /Více v nápovědě/ });
    expect(link).toHaveAttribute('href', 'https://docs.example.test/cs/#import');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders nothing when the instance links no guide', () => {
    const { container } = render(<HelpLink topic="import" />);
    expect(container).toBeEmptyDOMElement();
  });
});
