import type { ReactNode } from 'react';
import { Server, Activity, Network, Settings, Layers } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/molecules/PageHeader';
import { EmptyState } from '@/components/molecules/EmptyState';

const ICONS: Record<string, LucideIcon> = {
  server: Server,
  activity: Activity,
  network: Network,
  settings: Settings,
  layers: Layers,
};

// Unified placeholder for sections that are designed but not built yet.
export function ComingSoon({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <PageHeader title={title} />
      <EmptyState
        icon={ICONS[icon] ?? Layers}
        description={children}
        action={
          <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
            Coming soon
          </span>
        }
      />
    </div>
  );
}
