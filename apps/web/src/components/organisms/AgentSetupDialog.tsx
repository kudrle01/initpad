import { useEffect, useState } from 'react';
import { Bot, ShieldAlert } from 'lucide-react';
import type { AgentEnrollment, Target } from '@/types';
import { CopyField } from '@/components/molecules/CopyField';
import { StatusBadge } from '@/components/molecules/StatusBadge';
import { Spinner } from '@/components/atoms/Spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  target: Target | null;
  busy: boolean;
  enrollment: AgentEnrollment | null;
  onOpenChange: (open: boolean) => void;
  onIssueEnrollment: () => void;
  onDisable: () => void;
}

const STATE_LABEL: Record<string, string> = {
  'not-enrolled': 'not enrolled',
  offline: 'offline',
  online: 'online',
  disabled: 'disabled',
};

export function AgentSetupDialog({
  open,
  target,
  busy,
  enrollment,
  onOpenChange,
  onIssueEnrollment,
  onDisable,
}: Props) {
  const [confirmDisable, setConfirmDisable] = useState(false);
  useEffect(() => {
    if (!open) setConfirmDisable(false);
  }, [open]);

  if (!target) return null;
  const agent = target.agent;
  const state = agent?.state ?? 'not-enrolled';
  const installCommand = `sudo initpad-agent enroll --url '${window.location.origin}'`;

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle><Bot className="h-[18px] w-[18px]" /> InitPad Agent</DialogTitle>
          <DialogDescription>
            {target.name} connects outbound to this control plane. InitPad never needs inbound
            SSH access or a public management port on the Docker server.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Agent status</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {agent?.version ? `Version ${agent.version} · protocol ${agent.protocolVersion}` : 'No Agent heartbeat received yet'}
              </p>
            </div>
            <StatusBadge status={state} label={STATE_LABEL[state]} />
          </div>

          {enrollment ? (
            <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3">
              <div className="flex items-start gap-2 text-sm">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>
                  This token is shown once and expires at{' '}
                  <b className="font-medium">{new Date(enrollment.enrollmentExpiresAt!).toLocaleTimeString()}</b>.
                  Closing this dialog discards the plaintext.
                </p>
              </div>
              <div className="min-w-0">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Enrollment token</p>
                <CopyField command={enrollment.enrollmentToken} />
              </div>
              <div className="min-w-0">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Run on the Docker server</p>
                <CopyField command={installCommand} />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  The command prompts for the token so the secret does not enter shell history.
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-secondary/20 p-3 text-sm text-muted-foreground">
              Generate a short-lived, single-use enrollment when you are ready at the Docker server.
              A new enrollment does not disconnect the current Agent until it is redeemed.
            </div>
          )}

          {agent?.lastSeenAt && (
            <p className="text-xs text-muted-foreground">
              Last contact: {new Date(agent.lastSeenAt).toLocaleString()}
            </p>
          )}

          {confirmDisable && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
              Disable this credential? Running applications stay untouched, but the server cannot
              receive further jobs until a new enrollment succeeds.
            </div>
          )}
        </div>

        <DialogFooter>
          {agent && agent.state !== 'disabled' && agent.state !== 'not-enrolled' && (
            confirmDisable ? (
              <Button variant="destructive" disabled={busy} onClick={onDisable}>
                {busy && <Spinner className="h-4 w-4" />} Confirm disable
              </Button>
            ) : (
              <Button variant="ghost" disabled={busy} onClick={() => setConfirmDisable(true)}>
                Disable Agent
              </Button>
            )
          )}
          <Button disabled={busy} onClick={onIssueEnrollment}>
            {busy && <Spinner className="h-4 w-4" />}
            {enrollment || agent?.enrollmentPending ? 'Generate a new token' : 'Generate enrollment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
