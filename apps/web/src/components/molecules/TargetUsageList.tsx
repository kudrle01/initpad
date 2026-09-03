import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import type { TargetUsage } from '@/types';

export function TargetUsageList({ usage }: { usage: TargetUsage[] }) {
  if (usage.length === 0) return null;

  return (
    <details className="group rounded-md border border-border bg-secondary/20 px-3 py-2 text-xs">
      <summary className="text-link flex cursor-pointer list-none items-center justify-between gap-2 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <span>Used by {usage.length} {usage.length === 1 ? 'environment' : 'environments'}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="mt-2 space-y-1.5 border-t border-border pt-2">
        {usage.map((binding) => (
          <li key={`${binding.projectId}:${binding.environment}`} className="flex min-w-0 items-center justify-between gap-2">
            <Link
              to={`/projects/${binding.projectId}`}
              className="text-link min-w-0 truncate font-medium hover:underline"
              title={`${binding.projectName} · ${binding.environment}`}
            >
              {binding.projectName} · {binding.environment.toUpperCase()}
            </Link>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
              {binding.status}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Move or remove these environments before removing workspace access or deleting the server.
      </p>
    </details>
  );
}
