import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';

// Zobrazí se uvnitř layoutu pro neznámé cesty (catch-all route).
export default function NotFound() {
  return (
    <div>
      <div className="page-head">
        <h1>Page not found</h1>
      </div>
      <div className="coming-soon">
        <span className="coming-soon-icon">
          <Icon name="layers" size={26} />
        </span>
        <p className="coming-soon-lead">
          This page doesn’t exist or may have moved.
        </p>
        <Link to="/" className="btn btn-primary">
          <Icon name="arrowLeft" size={16} /> Back to dashboard
        </Link>
      </div>
    </div>
  );
}
