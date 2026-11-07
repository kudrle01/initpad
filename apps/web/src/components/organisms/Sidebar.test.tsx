// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { User } from '@/types';
import { PlatformVersion } from './Sidebar';

afterEach(cleanup);

function user(overrides: Partial<User>): User {
  return {
    id: 'u1',
    username: 'dev',
    name: null,
    email: null,
    avatarUrl: null,
    platformRole: 'user',
    edition: 'self-hosted',
    docsUrl: null,
    platformVersion: '0.2.31',
    mustChangePassword: false,
    emailVerified: true,
    ...overrides,
  };
}

function renderVersion(value: User) {
  return render(
    <MemoryRouter>
      <PlatformVersion user={value} />
    </MemoryRouter>,
  );
}

describe('PlatformVersion', () => {
  it('shows the running release as plain text to a developer', () => {
    renderVersion(user({}));
    expect(screen.getByText('InitPad 0.2.31')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('links an administrator to the platform update card', () => {
    renderVersion(user({ platformRole: 'admin' }));
    expect(screen.getByRole('link', { name: 'InitPad 0.2.31' })).toHaveAttribute('href', '/admin');
  });

  it('shows nothing when an older API does not report the version', () => {
    const { container } = renderVersion(user({ platformVersion: undefined }));
    expect(container).toBeEmptyDOMElement();
  });
});
