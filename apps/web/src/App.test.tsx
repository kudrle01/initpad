// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { loginPath } from '@/lib/login-path';

const auth = vi.hoisted(() => ({
  state: {
    user: null as { mustChangePassword: boolean } | null,
    loading: false,
    logout: () => undefined,
    activeWorkspace: null,
    workspacesError: null as string | null,
    refreshWorkspaces: () => Promise.resolve(),
  },
}));

vi.mock('@/auth', () => ({ useAuth: () => auth.state }));
vi.mock('@/components/organisms/Sidebar', () => ({ Sidebar: () => null }));

function LoginProbe() {
  const location = useLocation();
  return <p>login at {location.pathname + location.search}</p>;
}

afterEach(() => {
  cleanup();
  auth.state.user = null;
  auth.state.workspacesError = null;
});

describe('sign-in redirect keeps the destination', () => {
  it('passes the requested page as next', () => {
    render(
      <MemoryRouter initialEntries={['/projects/abc?tab=deployments']}>
        <Routes>
          <Route path="/login" element={<LoginProbe />} />
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByText('login at /login?next=%2Fprojects%2Fabc%3Ftab%3Ddeployments'),
    ).toBeInTheDocument();
  });

  it('omits next for the overview', () => {
    expect(loginPath({ pathname: '/', search: '', hash: '' })).toBe('/login');
  });
});

describe('workspace list errors', () => {
  it('shows a retryable error instead of an empty app', () => {
    const refresh = vi.fn(() => Promise.resolve());
    auth.state.user = { mustChangePassword: false };
    auth.state.workspacesError = 'HTTP 503';
    auth.state.refreshWorkspaces = refresh;
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="*" element={<App />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 503');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refresh).toHaveBeenCalled();
  });
});
