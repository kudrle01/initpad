import { StatusDot } from '@/components/atoms/StatusDot';
import { cn } from '@/lib/utils';
import { statusLabel } from '@/i18n/labels';

interface EnvironmentSummary {
  name: string;
  status: string;
  version?: string | null;
}

/**
 * One line that answers "is everything up?" for a project: an inline dot +
 * name per environment. Detail (version, reason) lives on the project page.
 */
export function EnvironmentStatusList({
  environments,
  className,
}: {
  environments: EnvironmentSummary[];
  className?: string;
}) {
  if (environments.length === 0) return null;
  return (
    <span className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {environments.map((environment) => (
        <span
          key={environment.name}
          className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
          title={`${environment.name}: ${statusLabel(environment.status)}${
            environment.version ? ` · v${environment.version.slice(0, 7)}` : ''
          }`}
        >
          <StatusDot status={environment.status} />
          {environment.name}
          <span className="sr-only">{statusLabel(environment.status)}</span>
        </span>
      ))}
    </span>
  );
}
