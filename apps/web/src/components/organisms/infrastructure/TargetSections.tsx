import { Plus, Server } from 'lucide-react';
import { EmptyState } from '@/components/molecules/EmptyState';
import { Button } from '@/components/ui/button';
import type { Target } from '@/types';
import { TargetCard } from './TargetCard';

interface Props {
  targets: Target[];
  readOnly: boolean;
  canManageAgent: boolean;
  busyTargetId: string | null;
  onAdd: () => void;
  onEdit: (target: Target) => void;
  onVerify: (target: Target) => void;
  onManageAgent: (target: Target) => void;
  onDelete: (target: Target) => void;
}

export function TargetSections({
  targets,
  readOnly,
  canManageAgent,
  busyTargetId,
  onAdd,
  onEdit,
  onVerify,
  onManageAgent,
  onDelete,
}: Props) {
  const builtins = targets.filter((target) => target.scope === 'builtin');
  const userTargets = targets.filter((target) => target.scope === 'user');

  return (
    <>
      {builtins.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Built-in (simulated infrastructure)
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {builtins.map((target) => (
              <TargetCard
                key={target.id}
                target={target}
                busy={busyTargetId === target.id}
                readOnly={readOnly}
                canManageAgent={false}
                onVerify={() => onVerify(target)}
                onManageAgent={() => undefined}
                onEdit={() => undefined}
                onDelete={() => undefined}
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Your targets
        </h2>
        {userTargets.length === 0 ? (
          <EmptyState
            icon={Server}
            title="No targets yet"
            description="Register a server (e.g. your school SFTP host or a VPS) to deploy production there."
            action={!readOnly ? (
              <Button onClick={onAdd}>
                <Plus className="h-4 w-4" /> Add target
              </Button>
            ) : undefined}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {userTargets.map((target) => (
              <TargetCard
                key={target.id}
                target={target}
                busy={busyTargetId === target.id}
                readOnly={readOnly}
                canManageAgent={canManageAgent}
                onVerify={() => onVerify(target)}
                onManageAgent={() => onManageAgent(target)}
                onEdit={() => onEdit(target)}
                onDelete={() => onDelete(target)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
