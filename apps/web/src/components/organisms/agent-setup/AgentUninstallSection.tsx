import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AgentDistribution } from '@/types';
import { CopyField } from '@/components/molecules/CopyField';
import { t } from '@/i18n';
import { buildAgentUninstallCommand } from '@/lib/agent-install-command';

interface Props {
  targetId: string;
  distribution: AgentDistribution;
}

/**
 * Shows the verified uninstall command. InitPad never removes the Agent
 * remotely: the person at the server runs the reviewed installer in
 * --uninstall mode, which lists what it removes and asks for confirmation.
 */
export function AgentUninstallSection({ targetId, distribution }: Props) {
  const [open, setOpen] = useState(false);
  const [removeWorkloads, setRemoveWorkloads] = useState(false);
  const command = buildAgentUninstallCommand({
    origin: window.location.origin,
    distribution,
    targetId,
    removeWorkloads,
  });

  return (
    <details
      className="rounded-lg border p-3 text-sm"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <Trash2 className="h-4 w-4 text-muted-foreground" />
        {t('Uninstall from the server')}
      </summary>
      {/* Rendered only when expanded: a destructive command should not sit
          in the dialog (or its copy targets) until someone asks for it. */}
      {open && (
        <div className="mt-3 flex min-w-0 flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {t(
              'Run this command on the Docker server. It verifies the installer checksum, refuses a server enrolled for another server, lists what it removes and asks you to confirm. It removes the Agent container, its saved identity and the InitPad CA installed for it.',
            )}
          </p>
          <label className="flex cursor-pointer items-start gap-3 tint-warning rounded-lg border border-warning/30 p-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-warning"
              checked={removeWorkloads}
              onChange={(e) => setRemoveWorkloads(e.target.checked)}
            />
            <span>
              <span className="block font-medium">
                {t('Also remove applications InitPad deployed on this server')}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t(
                  'Deletes their containers and networks directly on the server. InitPad keeps showing them as deployed, so prefer removing environments in InitPad while the Agent is connected.',
                )}
              </span>
            </span>
          </label>
          <CopyField command={command} />
          <p className="text-xs text-muted-foreground">
            {t(
              'Afterwards disconnect the Agent here or delete the server, so InitPad no longer waits for it.',
            )}
          </p>
        </div>
      )}
    </details>
  );
}
