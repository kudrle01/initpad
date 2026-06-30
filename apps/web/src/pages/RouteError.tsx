import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { Icon } from '@/components/Icon';

// errorElement routeru – zachytí 404 i neočekávané chyby a ukáže přívětivou stránku.
export default function RouteError() {
  const error = useRouteError();
  const is404 = isRouteErrorResponse(error) && error.status === 404;
  const message = isRouteErrorResponse(error)
    ? error.statusText || 'Something went wrong'
    : error instanceof Error
      ? error.message
      : 'Something went wrong';

  return (
    <div className="error-page">
      <div className="error-card">
        <div className="error-code">{is404 ? '404' : 'Oops'}</div>
        <div className="error-title">
          {is404 ? 'Page not found' : 'Something went wrong'}
        </div>
        <p className="error-msg">
          {is404 ? 'This page doesn’t exist or may have moved.' : message}
        </p>
        <Link to="/" className="btn btn-primary">
          <Icon name="arrowLeft" size={16} /> Back to dashboard
        </Link>
      </div>
    </div>
  );
}
