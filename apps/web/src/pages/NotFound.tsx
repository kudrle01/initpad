import { Link } from 'react-router-dom';
import { ArrowLeft, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/molecules/PageHeader';
import { EmptyState } from '@/components/molecules/EmptyState';

// Zobrazí se uvnitř layoutu pro neznámé cesty (catch-all route).
export default function NotFound() {
  return (
    <div>
      <PageHeader title="Page not found" />
      <EmptyState
        icon={Layers}
        description="This page doesn’t exist or may have moved."
        action={
          <Button asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4" /> Back to dashboard
            </Link>
          </Button>
        }
      />
    </div>
  );
}
