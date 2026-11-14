// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { loginPath } from '@/lib/login-path';

vi.mock('@/auth', () => ({
  useAuth: () => ({ user: null, loading: false, logout: vi.fn() }),
}));

function LoginProbe() {
  const location = useLocation();
  return <p>login at {location.pathname + location.search}</p>;
}

afterEach(cleanup);

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
