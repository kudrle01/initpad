import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { StatusDot } from '@/components/atoms/StatusDot';
import type { TargetUsage } from '@/types';
import { t, plural } from '@/i18n';
import { statusLabel } from '@/i18n/labels';

export function TargetUsageList({ usage }: { usage: TargetUsage[] }) {
  if (usage.length === 0) return null;

  return (
    <details className="group min-w-0 rounded-md border border-border bg-muted/60 text-xs">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <span>{plural('Used by {count} environments', usage.length)}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <ul className="divide-y divide-border border-t border-border">
        {usage.map((binding) => (
          <li
            key={`${binding.projectId}:${binding.environment}`}
            className="flex min-w-0 items-center justify-between gap-3 px-3 py-2"
          >
            <Link
              to={`/projects/${binding.projectId}`}
              className="text-link min-w-0 truncate font-medium"
              title={`${binding.projectName} · ${binding.environment}`}
            >
              {binding.projectName} · {binding.environment.toUpperCase()}
            </Link>
            <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
              <StatusDot status={binding.status} />
              {statusLabel(binding.status)}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-3 py-2 text-muted-foreground">
        {t(
          'Move or remove these environments before removing workspace access or deleting the server.',
        )}
      </p>
    </details>
  );
}
