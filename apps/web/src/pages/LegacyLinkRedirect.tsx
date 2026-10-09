import { Navigate, useParams } from 'react-router-dom';

// Links issued before ADR-143 carry the token in the path. They still open the
// page, with the token moved to the fragment the page reads.
export default function LegacyLinkRedirect({ to }: { to: string }) {
  const { token = '' } = useParams();
  return <Navigate to={{ pathname: to, hash: token }} replace />;
}
