import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * The single-use token of an activation, password reset or e-mail
 * verification link. The API puts it in the URL fragment, which browsers never
 * send to a server, so it stays out of proxy and edge access logs (ADR-143).
 * After reading it, the page drops the fragment from the address bar so the
 * token is not left on screen or in a copied address.
 */
export function useLinkToken(): string {
  const location = useLocation();
  const navigate = useNavigate();
  const [token] = useState(() => location.hash.replace(/^#/, ''));

  useEffect(() => {
    if (!location.hash) return;
    void navigate(
      { pathname: location.pathname, search: location.search },
      { replace: true, state: location.state as unknown },
    );
  }, [location, navigate]);

  return token;
}
